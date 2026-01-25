use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::Manager;
use uuid::Uuid;
use walkdir::WalkDir;

#[derive(Serialize)]
struct LibraryItem {
  id: String,
  title: Option<String>,
  published_year: Option<i64>,
  authors: Vec<String>,
  file_count: i64,
  formats: Vec<String>,
}

#[derive(Serialize)]
struct ScanStats {
  added: i64,
  updated: i64,
  moved: i64,
  unchanged: i64,
  missing: i64,
}

#[tauri::command]
fn get_library_items(app: tauri::AppHandle) -> Result<Vec<LibraryItem>, String> {
  let db_path = db_path(&app).map_err(|err| err.to_string())?;
  if !db_path.exists() {
    return Ok(vec![]);
  }
  let conn = Connection::open(db_path).map_err(|err| err.to_string())?;
  let mut stmt = conn
    .prepare(
      "SELECT items.id, items.title, items.published_year, \
       GROUP_CONCAT(DISTINCT authors.name) as authors, \
       COUNT(DISTINCT files.id) as file_count, \
       GROUP_CONCAT(DISTINCT files.extension) as formats \
       FROM items \
       LEFT JOIN item_authors ON item_authors.item_id = items.id \
       LEFT JOIN authors ON authors.id = item_authors.author_id \
       LEFT JOIN files ON files.item_id = items.id \
       GROUP BY items.id"
    )
    .map_err(|err| err.to_string())?;

  let rows = stmt
    .query_map(params![], |row| {
      let authors: Option<String> = row.get(3)?;
      let formats: Option<String> = row.get(5)?;
      Ok(LibraryItem {
        id: row.get(0)?,
        title: row.get(1)?,
        published_year: row.get(2)?,
        authors: authors
          .unwrap_or_default()
          .split(',')
          .filter(|value| !value.trim().is_empty())
          .map(|value| value.trim().to_string())
          .collect(),
        file_count: row.get(4)?,
        formats: formats
          .unwrap_or_default()
          .split(',')
          .filter(|value| !value.trim().is_empty())
          .map(|value| value.trim().to_uppercase())
          .collect(),
      })
    })
    .map_err(|err| err.to_string())?;

  let mut items = Vec::new();
  for row in rows {
    items.push(row.map_err(|err| err.to_string())?);
  }

  Ok(items)
}

#[tauri::command]
fn scan_folder(app: tauri::AppHandle, root: String) -> Result<ScanStats, String> {
  let db_path = db_path(&app).map_err(|err| err.to_string())?;
  if !db_path.exists() {
    return Err("Database not initialized. Run migrations first.".to_string());
  }

  let mut stats = ScanStats {
    added: 0,
    updated: 0,
    moved: 0,
    unchanged: 0,
    missing: 0,
  };

  let conn = Connection::open(db_path).map_err(|err| err.to_string())?;
  let now = chrono::Utc::now().timestamp_millis();
  let session_id = Uuid::new_v4().to_string();

  conn.execute(
    "INSERT INTO scan_sessions (id, root_path, started_at, status) VALUES (?1, ?2, ?3, ?4)",
    params![session_id, root, now, "running"],
  )
  .map_err(|err| err.to_string())?;

  let mut seen_paths: std::collections::HashSet<String> = std::collections::HashSet::new();

  for entry in WalkDir::new(&root).into_iter().filter_map(Result::ok) {
    if !entry.file_type().is_file() {
      continue;
    }
    let path = entry.path();
    let ext = path.extension().and_then(|value| value.to_str()).unwrap_or("");
    let ext = format!(".{}", ext).to_lowercase();
    if ext != ".epub" && ext != ".pdf" {
      continue;
    }

    let path_str = path.to_string_lossy().to_string();
    seen_paths.insert(path_str.clone());
    let metadata = entry.metadata().map_err(|err| err.to_string())?;
    let size_bytes = metadata.len() as i64;
    let modified_at = metadata
      .modified()
      .ok()
      .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
      .map(|value| value.as_millis() as i64);

    let existing_by_path: Option<(String, Option<i64>, Option<i64>)> = conn
      .query_row(
        "SELECT id, modified_at, size_bytes FROM files WHERE path = ?1",
        params![path_str],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
      )
      .optional()
      .map_err(|err| err.to_string())?;

    if let Some((file_id, existing_mtime, existing_size)) = existing_by_path {
      if existing_mtime == modified_at && existing_size == Some(size_bytes) {
        stats.unchanged += 1;
        conn.execute(
          "INSERT INTO scan_entries (id, session_id, path, modified_at, size_bytes, action, file_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
          params![Uuid::new_v4().to_string(), session_id, path_str, modified_at, size_bytes, "unchanged", file_id],
        )
        .map_err(|err| err.to_string())?;
        continue;
      }
    }

    let sha256 = hash_file(path).map_err(|err| err.to_string())?;

    let existing_by_hash: Option<(String, String)> = conn
      .query_row(
        "SELECT id, path FROM files WHERE sha256 = ?1 AND hash_algo = 'sha256'",
        params![sha256],
        |row| Ok((row.get(0)?, row.get(1)?)),
      )
      .optional()
      .map_err(|err| err.to_string())?;

    if let Some((file_id, old_path)) = existing_by_hash {
      let old_exists = std::path::Path::new(&old_path).exists();
      if old_exists {
        let duplicate_id = Uuid::new_v4().to_string();
        let filename = path.file_name().and_then(|value| value.to_str()).unwrap_or("file");
        conn.execute(
          "INSERT INTO files (id, item_id, path, filename, extension, size_bytes, sha256, hash_algo, modified_at, created_at, updated_at, status) \
           SELECT ?1, item_id, ?2, ?3, ?4, ?5, ?6, 'sha256', ?7, ?8, ?8, 'active' FROM files WHERE id = ?9",
          params![
            duplicate_id,
            path_str,
            filename,
            ext,
            size_bytes,
            sha256,
            modified_at,
            now,
            file_id
          ],
        )
        .map_err(|err| err.to_string())?;

        conn.execute(
          "INSERT INTO issues (id, item_id, file_id, type, message, severity, created_at) \
           SELECT ?1, item_id, ?2, 'duplicate', 'Duplicate content detected by hash.', 'warn', ?3 FROM files WHERE id = ?4",
          params![Uuid::new_v4().to_string(), duplicate_id, now, file_id],
        )
        .map_err(|err| err.to_string())?;

        stats.added += 1;
        conn.execute(
          "INSERT INTO scan_entries (id, session_id, path, modified_at, size_bytes, sha256, action, file_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
          params![Uuid::new_v4().to_string(), session_id, path_str, modified_at, size_bytes, sha256, "added", duplicate_id],
        )
        .map_err(|err| err.to_string())?;
        continue;
      }

      stats.moved += 1;
      let filename = path.file_name().and_then(|value| value.to_str()).unwrap_or("file");
      conn.execute(
        "UPDATE files SET path = ?1, filename = ?2, extension = ?3, size_bytes = ?4, modified_at = ?5, updated_at = ?6, status = 'active' WHERE id = ?7",
        params![path_str, filename, ext, size_bytes, modified_at, now, file_id],
      )
      .map_err(|err| err.to_string())?;

      conn.execute(
        "INSERT INTO scan_entries (id, session_id, path, modified_at, size_bytes, sha256, action, file_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![Uuid::new_v4().to_string(), session_id, path_str, modified_at, size_bytes, sha256, "moved", file_id],
      )
      .map_err(|err| err.to_string())?;
      continue;
    }

    if let Some((file_id, _, _)) = existing_by_path {
      stats.updated += 1;
      let filename = path.file_name().and_then(|value| value.to_str()).unwrap_or("file");
      conn.execute(
        "UPDATE files SET filename = ?1, extension = ?2, size_bytes = ?3, modified_at = ?4, sha256 = ?5, hash_algo = 'sha256', updated_at = ?6, status = 'active' WHERE id = ?7",
        params![filename, ext, size_bytes, modified_at, sha256, now, file_id],
      )
      .map_err(|err| err.to_string())?;

      conn.execute(
        "INSERT INTO scan_entries (id, session_id, path, modified_at, size_bytes, sha256, action, file_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![Uuid::new_v4().to_string(), session_id, path_str, modified_at, size_bytes, sha256, "updated", file_id],
      )
      .map_err(|err| err.to_string())?;
      continue;
    }

    let item_id = Uuid::new_v4().to_string();
    let file_id = Uuid::new_v4().to_string();
    let filename = path.file_name().and_then(|value| value.to_str()).unwrap_or("file");
    let title_guess = path
      .file_stem()
      .and_then(|value| value.to_str())
      .map(|value| value.replace('_', " "));

    conn.execute(
      "INSERT INTO items (id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
      params![item_id, title_guess, now],
    )
    .map_err(|err| err.to_string())?;

    conn.execute(
      "INSERT INTO files (id, item_id, path, filename, extension, size_bytes, sha256, hash_algo, modified_at, created_at, updated_at, status) \
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'sha256', ?8, ?9, ?9, 'active')",
      params![file_id, item_id, path_str, filename, ext, size_bytes, sha256, modified_at, now],
    )
    .map_err(|err| err.to_string())?;

    stats.added += 1;
    conn.execute(
      "INSERT INTO scan_entries (id, session_id, path, modified_at, size_bytes, sha256, action, file_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
      params![Uuid::new_v4().to_string(), session_id, path_str, modified_at, size_bytes, sha256, "added", file_id],
    )
    .map_err(|err| err.to_string())?;
  }

  let mut stmt = conn
    .prepare("SELECT id, path FROM files WHERE status = 'active' AND path LIKE ?1")
    .map_err(|err| err.to_string())?;
  let rows = stmt
    .query_map(params![format!("{}%", root)], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
    .map_err(|err| err.to_string())?;
  for row in rows {
    let (file_id, path) = row.map_err(|err| err.to_string())?;
    if seen_paths.contains(&path) {
      continue;
    }
    stats.missing += 1;
    conn.execute(
      "UPDATE files SET status = 'missing', updated_at = ?1 WHERE id = ?2",
      params![now, file_id],
    )
    .map_err(|err| err.to_string())?;
    conn.execute(
      "INSERT INTO scan_entries (id, session_id, path, action, file_id) VALUES (?1, ?2, ?3, ?4, ?5)",
      params![Uuid::new_v4().to_string(), session_id, path, "missing", file_id],
    )
    .map_err(|err| err.to_string())?;
  }

  conn.execute(
    "UPDATE scan_sessions SET status = 'success', ended_at = ?1 WHERE id = ?2",
    params![chrono::Utc::now().timestamp_millis(), session_id],
  )
  .map_err(|err| err.to_string())?;

  Ok(stats)
}

fn db_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, std::io::Error> {
  let app_dir = app.path().app_data_dir()?;
  std::fs::create_dir_all(&app_dir)?;
  Ok(app_dir.join("folio.db"))
}

fn hash_file(path: &std::path::Path) -> Result<String, std::io::Error> {
  let mut file = std::fs::File::open(path)?;
  let mut hasher = Sha256::new();
  let mut buffer = [0u8; 1024 * 1024];
  loop {
    let read = std::io::Read::read(&mut file, &mut buffer)?;
    if read == 0 {
      break;
    }
    hasher.update(&buffer[..read]);
  }
  let result = hasher.finalize();
  Ok(result.iter().map(|byte| format!("{:02x}", byte)).collect())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![get_library_items, scan_folder])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
