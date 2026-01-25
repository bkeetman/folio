use lopdf::{Document, Object};
use regex::Regex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::Read;
use tauri::{Emitter, Manager};
use tauri::menu::{Menu, MenuItem, Submenu};
use uuid::Uuid;
use walkdir::WalkDir;
use zip::ZipArchive;

const MIGRATION_SQL: &str = include_str!(
  "../../../../packages/core/drizzle/0000_nebulous_mysterio.sql"
);

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
struct InboxItem {
  id: String,
  title: String,
  reason: String,
}

#[derive(Serialize)]
struct DuplicateGroup {
  id: String,
  title: String,
  files: Vec<String>,
}

#[derive(Serialize, serde::Deserialize, Clone)]
struct EnrichmentCandidate {
  id: String,
  title: Option<String>,
  authors: Vec<String>,
  published_year: Option<i64>,
  identifiers: Vec<String>,
  source: String,
  confidence: f64,
}

#[derive(Serialize, serde::Deserialize)]
struct OrganizeEntry {
  file_id: String,
  source_path: String,
  target_path: String,
  action: String,
}

#[derive(Serialize, serde::Deserialize)]
struct OrganizePlan {
  mode: String,
  library_root: String,
  template: String,
  entries: Vec<OrganizeEntry>,
}

#[derive(Serialize)]
struct ScanStats {
  added: i64,
  updated: i64,
  moved: i64,
  unchanged: i64,
  missing: i64,
}

struct ExtractedMetadata {
  title: Option<String>,
  authors: Vec<String>,
  language: Option<String>,
  published_year: Option<i64>,
  description: Option<String>,
  identifiers: Vec<String>,
}

#[tauri::command]
fn get_library_items(app: tauri::AppHandle) -> Result<Vec<LibraryItem>, String> {
  let conn = open_db(&app)?;
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
fn get_inbox_items(app: tauri::AppHandle) -> Result<Vec<InboxItem>, String> {
  let conn = open_db(&app)?;
  let mut stmt = conn
    .prepare(
      "SELECT issues.id, COALESCE(items.title, 'Untitled') as title, issues.message \
       FROM issues \
       LEFT JOIN items ON items.id = issues.item_id \
       WHERE issues.type = 'missing_metadata' AND issues.resolved_at IS NULL \
       ORDER BY issues.created_at DESC"
    )
    .map_err(|err| err.to_string())?;

  let rows = stmt
    .query_map(params![], |row| {
      Ok(InboxItem {
        id: row.get(0)?,
        title: row.get(1)?,
        reason: row.get::<_, Option<String>>(2)?.unwrap_or_else(|| "Missing metadata".to_string()),
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
fn get_duplicate_groups(app: tauri::AppHandle) -> Result<Vec<DuplicateGroup>, String> {
  let conn = open_db(&app)?;
  let mut stmt = conn
    .prepare(
      "SELECT files.sha256, COALESCE(items.title, 'Untitled') as title, \
       GROUP_CONCAT(files.filename, '|') as filenames \
       FROM files \
       LEFT JOIN items ON items.id = files.item_id \
       WHERE files.sha256 IS NOT NULL AND files.status = 'active' \
       GROUP BY files.sha256 \
       HAVING COUNT(files.id) > 1"
    )
    .map_err(|err| err.to_string())?;

  let rows = stmt
    .query_map(params![], |row| {
      let filenames: Option<String> = row.get(2)?;
      Ok(DuplicateGroup {
        id: row.get(0)?,
        title: row.get(1)?,
        files: filenames
          .unwrap_or_default()
          .split('|')
          .filter(|value| !value.trim().is_empty())
          .map(|value| value.trim().to_string())
          .collect(),
      })
    })
    .map_err(|err| err.to_string())?;

  let mut groups = Vec::new();
  for row in rows {
    groups.push(row.map_err(|err| err.to_string())?);
  }
  Ok(groups)
}

#[tauri::command]
fn get_fix_candidates(app: tauri::AppHandle, item_id: String) -> Result<Vec<EnrichmentCandidate>, String> {
  let conn = open_db(&app)?;
  let title: Option<String> = conn
    .query_row(
      "SELECT title FROM items WHERE id = ?1",
      params![item_id],
      |row| row.get(0),
    )
    .optional()
    .map_err(|err| err.to_string())?;

  let authors: Vec<String> = conn
    .prepare("SELECT authors.name FROM item_authors JOIN authors ON authors.id = item_authors.author_id WHERE item_authors.item_id = ?1")
    .map_err(|err| err.to_string())?
    .query_map(params![item_id], |row| row.get(0))
    .map_err(|err| err.to_string())?
    .collect::<Result<Vec<String>, _>>()
    .map_err(|err| err.to_string())?;

  let isbn: Option<String> = conn
    .query_row(
      "SELECT value FROM identifiers WHERE item_id = ?1 AND (type = 'ISBN13' OR type = 'ISBN10') ORDER BY type = 'ISBN13' DESC LIMIT 1",
      params![item_id],
      |row| row.get(0),
    )
    .optional()
    .map_err(|err| err.to_string())?;

  let mut candidates: Vec<EnrichmentCandidate> = vec![];
  if let Some(isbn) = isbn {
    candidates.extend(fetch_openlibrary_isbn(&isbn));
    candidates.extend(fetch_google_isbn(&isbn));
  } else if let Some(title) = &title {
    let author = authors.first().cloned();
    candidates.extend(fetch_openlibrary_search(title, author.as_deref()));
    candidates.extend(fetch_google_search(title, author.as_deref()));
    candidates = score_candidates(candidates, title, author.as_deref());
  }

  Ok(candidates)
}

#[tauri::command]
fn apply_fix_candidate(
  app: tauri::AppHandle,
  item_id: String,
  candidate: EnrichmentCandidate,
) -> Result<(), String> {
  let conn = open_db(&app)?;
  let now = chrono::Utc::now().timestamp_millis();
  apply_enrichment_candidate(&conn, &item_id, &candidate, now)?;
  conn.execute(
    "UPDATE issues SET resolved_at = ?1 WHERE item_id = ?2 AND type = 'missing_metadata' AND resolved_at IS NULL",
    params![now, item_id],
  )
  .map_err(|err| err.to_string())?;
  Ok(())
}

#[tauri::command]
fn plan_organize(
  app: tauri::AppHandle,
  mode: String,
  library_root: String,
  template: String,
) -> Result<OrganizePlan, String> {
  let conn = open_db(&app)?;
  let mut stmt = conn
    .prepare(
      "SELECT files.id, files.path, files.extension, items.title, items.published_year, \
       GROUP_CONCAT(DISTINCT authors.name) as authors, \
       MAX(CASE WHEN identifiers.type = 'ISBN13' THEN identifiers.value ELSE NULL END) as isbn13 \
       FROM files \
       JOIN items ON items.id = files.item_id \
       LEFT JOIN item_authors ON item_authors.item_id = items.id \
       LEFT JOIN authors ON authors.id = item_authors.author_id \
       LEFT JOIN identifiers ON identifiers.item_id = items.id \
       WHERE files.status = 'active' \
       GROUP BY files.id"
    )
    .map_err(|err| err.to_string())?;

  let rows = stmt
    .query_map(params![], |row| {
      Ok((
        row.get::<_, String>(0)?,
        row.get::<_, String>(1)?,
        row.get::<_, String>(2)?,
        row.get::<_, Option<String>>(3)?,
        row.get::<_, Option<i64>>(4)?,
        row.get::<_, Option<String>>(5)?,
        row.get::<_, Option<String>>(6)?,
      ))
    })
    .map_err(|err| err.to_string())?;

  let mut entries = Vec::new();
  for row in rows {
    let (file_id, source_path, extension, title, published_year, authors, isbn13) =
      row.map_err(|err| err.to_string())?;
    let author = authors
      .unwrap_or_default()
      .split(',')
      .next()
      .unwrap_or("Unknown Author")
      .to_string();
    let relative = render_template(
      &template,
      &author,
      title.as_deref().unwrap_or("Untitled"),
      published_year,
      isbn13.as_deref(),
      &extension,
    );
    let target = resolve_collision(&library_root, &relative);
    let action = if mode == "reference" {
      "skip"
    } else if mode == "copy" {
      "copy"
    } else {
      "move"
    };

    entries.push(OrganizeEntry {
      file_id,
      source_path,
      target_path: target,
      action: action.to_string(),
    });
  }

  Ok(OrganizePlan {
    mode,
    library_root,
    template,
    entries,
  })
}

#[tauri::command]
fn apply_organize(app: tauri::AppHandle, plan: OrganizePlan) -> Result<String, String> {
  let conn = open_db(&app)?;
  let now = chrono::Utc::now().timestamp_millis();
  let mut log_entries: Vec<serde_json::Value> = vec![];

  for entry in &plan.entries {
    if entry.action == "skip" {
      continue;
    }
    let target_dir = std::path::Path::new(&entry.target_path)
      .parent()
      .ok_or("Invalid target path")?;
    std::fs::create_dir_all(target_dir).map_err(|err| err.to_string())?;

    if entry.action == "copy" {
      std::fs::copy(&entry.source_path, &entry.target_path).map_err(|err| err.to_string())?;
      let filename = std::path::Path::new(&entry.target_path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("file")
        .to_string();
      let extension = std::path::Path::new(&entry.target_path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{}", value.to_lowercase()))
        .unwrap_or_default();

      let (item_id, size_bytes, sha256, hash_algo, modified_at): (String, Option<i64>, Option<String>, Option<String>, Option<i64>) = conn
        .query_row(
          "SELECT item_id, size_bytes, sha256, hash_algo, modified_at FROM files WHERE id = ?1",
          params![entry.file_id],
          |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        )
        .map_err(|err| err.to_string())?;

      let new_id = Uuid::new_v4().to_string();
      conn.execute(
        "INSERT INTO files (id, item_id, path, filename, extension, size_bytes, sha256, hash_algo, modified_at, created_at, updated_at, status) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, 'active')",
        params![new_id, item_id, entry.target_path, filename, extension, size_bytes, sha256, hash_algo, modified_at, now],
      )
      .map_err(|err| err.to_string())?;
    } else {
      std::fs::rename(&entry.source_path, &entry.target_path).map_err(|err| err.to_string())?;
      let filename = std::path::Path::new(&entry.target_path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("file")
        .to_string();
      let extension = std::path::Path::new(&entry.target_path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{}", value.to_lowercase()))
        .unwrap_or_default();

      conn.execute(
        "UPDATE files SET path = ?1, filename = ?2, extension = ?3, updated_at = ?4, status = 'active' WHERE id = ?5",
        params![entry.target_path, filename, extension, now, entry.file_id],
      )
      .map_err(|err| err.to_string())?;
    }

    log_entries.push(serde_json::json!({
      "action": entry.action,
      "from": entry.source_path,
      "to": entry.target_path,
      "timestamp": now
    }));
  }

  let log_dir = std::path::Path::new(&plan.library_root).join(".folio");
  std::fs::create_dir_all(&log_dir).map_err(|err| err.to_string())?;
  let log_path = log_dir.join(format!("organizer-log-{}.json", now));
  std::fs::write(&log_path, serde_json::to_vec_pretty(&log_entries).unwrap())
    .map_err(|err| err.to_string())?;

  Ok(log_path.to_string_lossy().to_string())
}

#[tauri::command]
fn scan_folder(app: tauri::AppHandle, root: String) -> Result<ScanStats, String> {
  let conn = open_db(&app)?;
  let mut stats = ScanStats {
    added: 0,
    updated: 0,
    moved: 0,
    unchanged: 0,
    missing: 0,
  };

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

    if let Some((file_id, existing_mtime, existing_size)) = existing_by_path.clone() {
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
      let item_id: Option<String> = conn
        .query_row(
          "SELECT item_id FROM files WHERE id = ?1",
          params![file_id],
          |row| row.get(0),
        )
        .optional()
        .map_err(|err| err.to_string())?;
      if let Some(item_id) = item_id {
        if let Ok(metadata) = extract_metadata(path) {
          apply_metadata(&conn, &item_id, &metadata, now)?;
        }
      }
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

    if let Ok(metadata) = extract_metadata(path) {
      apply_metadata(&conn, &item_id, &metadata, now)?;
    }
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

fn open_db(app: &tauri::AppHandle) -> Result<Connection, String> {
  let db_path = db_path(app)?;
  let needs_migration = !db_path.exists();
  let conn = Connection::open(db_path).map_err(|err| err.to_string())?;
  if needs_migration {
    conn.execute_batch(MIGRATION_SQL)
      .map_err(|err| err.to_string())?;
  }
  Ok(conn)
}

fn extract_metadata(path: &std::path::Path) -> Result<ExtractedMetadata, String> {
  let extension = path
    .extension()
    .and_then(|value| value.to_str())
    .unwrap_or("")
    .to_lowercase();
  if extension == "epub" {
    return extract_epub_metadata(path);
  }
  if extension == "pdf" {
    return extract_pdf_metadata(path);
  }
  Ok(ExtractedMetadata {
    title: None,
    authors: vec![],
    language: None,
    published_year: None,
    description: None,
    identifiers: vec![],
  })
}

fn extract_epub_metadata(path: &std::path::Path) -> Result<ExtractedMetadata, String> {
  let file = std::fs::File::open(path).map_err(|err| err.to_string())?;
  let mut archive = ZipArchive::new(file).map_err(|err| err.to_string())?;
  let mut container = String::new();
  archive
    .by_name("META-INF/container.xml")
    .map_err(|err| err.to_string())?
    .read_to_string(&mut container)
    .map_err(|err| err.to_string())?;

  let rootfile = find_rootfile(&container).ok_or("Missing rootfile")?;
  let mut opf = String::new();
  archive
    .by_name(&rootfile)
    .map_err(|err| err.to_string())?
    .read_to_string(&mut opf)
    .map_err(|err| err.to_string())?;

  let mut metadata = ExtractedMetadata {
    title: None,
    authors: vec![],
    language: None,
    published_year: None,
    description: None,
    identifiers: vec![],
  };

  parse_opf_metadata(&opf, &mut metadata)?;
  Ok(metadata)
}

fn extract_pdf_metadata(path: &std::path::Path) -> Result<ExtractedMetadata, String> {
  let doc = Document::load(path).map_err(|err| err.to_string())?;
  let info = doc.trailer.get(b"Info");
  let mut metadata = ExtractedMetadata {
    title: None,
    authors: vec![],
    language: None,
    published_year: None,
    description: None,
    identifiers: vec![],
  };

  if let Ok(info) = info {
    if let Ok(info) = info.as_dict() {
      if let Some(title) = dict_string(info, b"Title") {
        metadata.title = Some(title);
      }
      if let Some(author) = dict_string(info, b"Author") {
        metadata.authors.push(author);
      }
      if let Some(subject) = dict_string(info, b"Subject") {
        metadata.description = Some(subject);
      }
      if let Some(keywords) = dict_string(info, b"Keywords") {
        metadata.identifiers.extend(extract_isbn_candidates(&keywords));
      }
      if let Some(created) = dict_string(info, b"CreationDate") {
        metadata.published_year = extract_year(&created);
      }
    }
  }

  let pages = doc.get_pages();
  let page_numbers: Vec<u32> = pages.keys().take(10).cloned().collect();
  if !page_numbers.is_empty() {
    if let Ok(text) = doc.extract_text(&page_numbers) {
      metadata.identifiers.extend(extract_isbn_candidates(&text));
    }
  }

  Ok(metadata)
}

fn dict_string(dict: &lopdf::Dictionary, key: &[u8]) -> Option<String> {
  let value = dict.get(key).ok()?;
  match value {
    Object::String(data, _) => Some(String::from_utf8_lossy(data).to_string()),
    Object::Name(name) => Some(String::from_utf8_lossy(name).to_string()),
    _ => None,
  }
}

fn apply_metadata(
  conn: &Connection,
  item_id: &str,
  metadata: &ExtractedMetadata,
  now: i64,
) -> Result<(), String> {
  let existing: (Option<String>, Option<String>, Option<i64>, Option<String>) = conn
    .query_row(
      "SELECT title, language, published_year, description FROM items WHERE id = ?1",
      params![item_id],
      |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )
    .map_err(|err| err.to_string())?;

  let title = existing.0.or_else(|| metadata.title.clone());
  let language = existing.1.or_else(|| metadata.language.clone());
  let published_year = existing.2.or(metadata.published_year);
  let description = existing.3.or_else(|| metadata.description.clone());

  conn.execute(
    "UPDATE items SET title = ?1, language = ?2, published_year = ?3, description = ?4, updated_at = ?5 WHERE id = ?6",
    params![title, language, published_year, description, now, item_id],
  )
  .map_err(|err| err.to_string())?;

  if metadata.title.is_some() {
    insert_field_source(conn, item_id, "title", now)?;
  }
  if metadata.language.is_some() {
    insert_field_source(conn, item_id, "language", now)?;
  }
  if metadata.published_year.is_some() {
    insert_field_source(conn, item_id, "published_year", now)?;
  }
  if metadata.description.is_some() {
    insert_field_source(conn, item_id, "description", now)?;
  }

  for author in &metadata.authors {
    let author_id: Option<String> = conn
      .query_row(
        "SELECT id FROM authors WHERE name = ?1",
        params![author],
        |row| row.get(0),
      )
      .optional()
      .map_err(|err| err.to_string())?;
    let author_id = author_id.unwrap_or_else(|| Uuid::new_v4().to_string());
    conn.execute(
      "INSERT OR IGNORE INTO authors (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
      params![author_id, author, now],
    )
    .map_err(|err| err.to_string())?;
    conn.execute(
      "INSERT OR IGNORE INTO item_authors (item_id, author_id, role, ord) VALUES (?1, ?2, 'author', 0)",
      params![item_id, author_id],
    )
    .map_err(|err| err.to_string())?;
  }

  for raw in &metadata.identifiers {
    let normalized = normalize_isbn(raw);
    let value = normalized.unwrap_or_else(|| raw.to_string());
    let id_type = if value.len() == 10 {
      "ISBN10"
    } else if value.len() == 13 {
      "ISBN13"
    } else {
      "OTHER"
    };
    let identifier_id = Uuid::new_v4().to_string();
    conn.execute(
      "INSERT OR IGNORE INTO identifiers (id, item_id, type, value, source, confidence, created_at) VALUES (?1, ?2, ?3, ?4, 'embedded', 0.8, ?5)",
      params![identifier_id, item_id, id_type, value, now],
    )
    .map_err(|err| err.to_string())?;
  }

  let mut missing = vec![];
  if title.is_none() {
    missing.push("title");
  }
  if metadata.authors.is_empty() {
    missing.push("author");
  }
  if !missing.is_empty() {
    conn.execute(
      "INSERT INTO issues (id, item_id, type, message, severity, created_at) VALUES (?1, ?2, 'missing_metadata', ?3, 'info', ?4)",
      params![
        Uuid::new_v4().to_string(),
        item_id,
        format!("Missing metadata: {}.", missing.join(", ")),
        now
      ],
    )
    .map_err(|err| err.to_string())?;
  }

  Ok(())
}

fn insert_field_source(
  conn: &Connection,
  item_id: &str,
  field: &str,
  now: i64,
) -> Result<(), String> {
  conn.execute(
    "INSERT INTO item_field_sources (id, item_id, field, source, confidence, created_at) VALUES (?1, ?2, ?3, 'embedded', 0.8, ?4)",
    params![Uuid::new_v4().to_string(), item_id, field, now],
  )
  .map_err(|err| err.to_string())?;
  Ok(())
}

fn extract_isbn_candidates(text: &str) -> Vec<String> {
  let regex = Regex::new(r"\b(?:97[89][\s-]?)?\d{1,5}[\s-]?\d{1,7}[\s-]?\d{1,7}[\s-]?[\dX]\b")
    .map_err(|_| "regex")
    .unwrap();
  let mut values = vec![];
  for mat in regex.find_iter(text) {
    values.push(mat.as_str().to_string());
  }
  values
}

fn normalize_isbn(value: &str) -> Option<String> {
  let cleaned = value
    .chars()
    .filter(|ch| ch.is_ascii_digit() || *ch == 'X' || *ch == 'x')
    .map(|ch| ch.to_ascii_uppercase())
    .collect::<String>();
  if cleaned.len() == 10 && is_valid_isbn10(&cleaned) {
    return Some(cleaned);
  }
  if cleaned.len() == 13 && is_valid_isbn13(&cleaned) {
    return Some(cleaned);
  }
  None
}

fn is_valid_isbn10(value: &str) -> bool {
  let mut sum = 0;
  for (index, ch) in value.chars().take(9).enumerate() {
    let digit = ch.to_digit(10);
    if digit.is_none() {
      return false;
    }
    sum += digit.unwrap() as i32 * (10 - index as i32);
  }
  let check = value.chars().nth(9).unwrap_or('0');
  let check_val = if check == 'X' { 10 } else { check.to_digit(10).unwrap_or(0) as i32 };
  sum += check_val;
  sum % 11 == 0
}

fn is_valid_isbn13(value: &str) -> bool {
  let mut sum = 0;
  for (index, ch) in value.chars().take(12).enumerate() {
    let digit = ch.to_digit(10);
    if digit.is_none() {
      return false;
    }
    let digit = digit.unwrap() as i32;
    sum += if index % 2 == 0 { digit } else { digit * 3 };
  }
  let check = value.chars().nth(12).unwrap_or('0');
  let check_val = check.to_digit(10).unwrap_or(0) as i32;
  (10 - (sum % 10)) % 10 == check_val
}

fn extract_year(text: &str) -> Option<i64> {
  let regex = Regex::new(r"\b(\d{4})\b").ok()?;
  let captures = regex.captures(text)?;
  captures.get(1)?.as_str().parse().ok()
}

fn find_rootfile(container: &str) -> Option<String> {
  let regex = Regex::new(r#"full-path="([^"]+)""#).ok()?;
  let captures = regex.captures(container)?;
  Some(captures.get(1)?.as_str().to_string())
}

fn parse_opf_metadata(opf: &str, metadata: &mut ExtractedMetadata) -> Result<(), String> {
  let mut reader = quick_xml::Reader::from_str(opf);
  reader.trim_text(true);
  let mut buf = Vec::new();
  let mut current_tag = String::new();

  loop {
    match reader.read_event_into(&mut buf) {
      Ok(quick_xml::events::Event::Start(event)) => {
        current_tag = String::from_utf8_lossy(event.name().as_ref()).to_string();
      }
      Ok(quick_xml::events::Event::Text(event)) => {
        let text = event.unescape().map_err(|err| err.to_string())?.to_string();
        match current_tag.as_str() {
          "dc:title" => {
            if metadata.title.is_none() {
              metadata.title = Some(text);
            }
          }
          "dc:creator" => {
            if !text.is_empty() {
              metadata.authors.push(text);
            }
          }
          "dc:language" => {
            if metadata.language.is_none() {
              metadata.language = Some(text);
            }
          }
          "dc:identifier" => {
            if !text.is_empty() {
              metadata.identifiers.push(text);
            }
          }
          "dc:date" => {
            if metadata.published_year.is_none() {
              metadata.published_year = extract_year(&text);
            }
          }
          "dc:description" => {
            if metadata.description.is_none() {
              metadata.description = Some(text);
            }
          }
          _ => {}
        }
      }
      Ok(quick_xml::events::Event::Eof) => break,
      Err(err) => return Err(err.to_string()),
      _ => {}
    }
    buf.clear();
  }

  if metadata.identifiers.is_empty() {
    metadata.identifiers = extract_isbn_candidates(opf);
  }

  Ok(())
}

fn fetch_openlibrary_isbn(isbn: &str) -> Vec<EnrichmentCandidate> {
  let url = format!("https://openlibrary.org/isbn/{}.json", isbn);
  let response = reqwest::blocking::get(url);
  let response = match response {
    Ok(value) => value,
    Err(_) => return vec![],
  };
  let data: serde_json::Value = match response.json() {
    Ok(value) => value,
    Err(_) => return vec![],
  };
  let title = data.get("title").and_then(|value| value.as_str()).map(|value| value.to_string());
  let published_year = data
    .get("publish_date")
    .and_then(|value| value.as_str())
    .and_then(|value| extract_year(value));
  let mut authors = Vec::new();
  if let Some(author_refs) = data.get("authors").and_then(|value| value.as_array()) {
    for author_ref in author_refs.iter().take(3) {
      if let Some(key) = author_ref.get("key").and_then(|value| value.as_str()) {
        if let Ok(resp) = reqwest::blocking::get(format!("https://openlibrary.org{}.json", key)) {
          if let Ok(author_data) = resp.json::<serde_json::Value>() {
            if let Some(name) = author_data.get("name").and_then(|value| value.as_str()) {
              authors.push(name.to_string());
            }
          }
        }
      }
    }
  }

  vec![EnrichmentCandidate {
    id: Uuid::new_v4().to_string(),
    title,
    authors,
    published_year,
    identifiers: vec![isbn.to_string()],
    source: "Open Library".to_string(),
    confidence: 0.9,
  }]
}

fn fetch_google_isbn(isbn: &str) -> Vec<EnrichmentCandidate> {
  let url = format!("https://www.googleapis.com/books/v1/volumes?q=isbn:{}", isbn);
  let response = reqwest::blocking::get(url);
  let response = match response {
    Ok(value) => value,
    Err(_) => return vec![],
  };
  let data: serde_json::Value = match response.json() {
    Ok(value) => value,
    Err(_) => return vec![],
  };
  let items = data.get("items").and_then(|value| value.as_array()).cloned().unwrap_or_default();
  items
    .iter()
    .take(5)
    .enumerate()
    .map(|(index, item)| {
      let info = item.get("volumeInfo").cloned().unwrap_or(serde_json::Value::Null);
      let title = info.get("title").and_then(|value| value.as_str()).map(|value| value.to_string());
      let authors = info
        .get("authors")
        .and_then(|value| value.as_array())
        .map(|values| values.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();
      let published_year = info
        .get("publishedDate")
        .and_then(|value| value.as_str())
        .and_then(|value| extract_year(value));
      let identifiers = info
        .get("industryIdentifiers")
        .and_then(|value| value.as_array())
        .map(|values| {
          values
            .iter()
            .filter_map(|entry| entry.get("identifier").and_then(|value| value.as_str()).map(|s| s.to_string()))
            .collect()
        })
        .unwrap_or_default();

      EnrichmentCandidate {
        id: Uuid::new_v4().to_string(),
        title,
        authors,
        published_year,
        identifiers,
        source: "Google Books".to_string(),
        confidence: if index == 0 { 0.85 } else { 0.7 },
      }
    })
    .collect()
}

fn fetch_openlibrary_search(title: &str, author: Option<&str>) -> Vec<EnrichmentCandidate> {
  let mut url = format!("https://openlibrary.org/search.json?title={}", urlencoding::encode(title));
  if let Some(author) = author {
    url.push_str(&format!("&author={}", urlencoding::encode(author)));
  }
  let response = reqwest::blocking::get(url);
  let response = match response {
    Ok(value) => value,
    Err(_) => return vec![],
  };
  let data: serde_json::Value = match response.json() {
    Ok(value) => value,
    Err(_) => return vec![],
  };
  let docs = data.get("docs").and_then(|value| value.as_array()).cloned().unwrap_or_default();
  docs
    .iter()
    .take(5)
    .enumerate()
    .map(|(index, doc)| {
      let title = doc.get("title").and_then(|value| value.as_str()).map(|value| value.to_string());
      let authors = doc
        .get("author_name")
        .and_then(|value| value.as_array())
        .map(|values| values.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();
      let published_year = doc.get("first_publish_year").and_then(|value| value.as_i64());
      let identifiers = doc
        .get("isbn")
        .and_then(|value| value.as_array())
        .map(|values| values.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();

      EnrichmentCandidate {
        id: Uuid::new_v4().to_string(),
        title,
        authors,
        published_year,
        identifiers,
        source: "Open Library".to_string(),
        confidence: 0.7 - index as f64 * 0.05,
      }
    })
    .collect()
}

fn fetch_google_search(title: &str, author: Option<&str>) -> Vec<EnrichmentCandidate> {
  let mut terms = vec![format!("intitle:{}", title)];
  if let Some(author) = author {
    terms.push(format!("inauthor:{}", author));
  }
  let url = format!(
    "https://www.googleapis.com/books/v1/volumes?q={}",
    urlencoding::encode(&terms.join("+"))
  );
  let response = reqwest::blocking::get(url);
  let response = match response {
    Ok(value) => value,
    Err(_) => return vec![],
  };
  let data: serde_json::Value = match response.json() {
    Ok(value) => value,
    Err(_) => return vec![],
  };
  let items = data.get("items").and_then(|value| value.as_array()).cloned().unwrap_or_default();
  items
    .iter()
    .take(5)
    .enumerate()
    .map(|(index, item)| {
      let info = item.get("volumeInfo").cloned().unwrap_or(serde_json::Value::Null);
      let title = info.get("title").and_then(|value| value.as_str()).map(|value| value.to_string());
      let authors = info
        .get("authors")
        .and_then(|value| value.as_array())
        .map(|values| values.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();
      let published_year = info
        .get("publishedDate")
        .and_then(|value| value.as_str())
        .and_then(|value| extract_year(value));
      let identifiers = info
        .get("industryIdentifiers")
        .and_then(|value| value.as_array())
        .map(|values| {
          values
            .iter()
            .filter_map(|entry| entry.get("identifier").and_then(|value| value.as_str()).map(|s| s.to_string()))
            .collect()
        })
        .unwrap_or_default();

      EnrichmentCandidate {
        id: Uuid::new_v4().to_string(),
        title,
        authors,
        published_year,
        identifiers,
        source: "Google Books".to_string(),
        confidence: 0.75 - index as f64 * 0.05,
      }
    })
    .collect()
}

fn score_candidates(
  mut candidates: Vec<EnrichmentCandidate>,
  title: &str,
  author: Option<&str>,
) -> Vec<EnrichmentCandidate> {
  let author = author.unwrap_or("");
  candidates.iter_mut().for_each(|candidate| {
    let title_score = similarity(candidate.title.as_deref().unwrap_or(""), title);
    let author_score = if author.is_empty() {
      1.0
    } else {
      similarity(&candidate.authors.join(" "), author)
    };
    let score = (title_score * 0.7) + (author_score * 0.3);
    candidate.confidence = (candidate.confidence * score).min(0.95);
  });
  let mut filtered: Vec<EnrichmentCandidate> = candidates
    .into_iter()
    .filter(|candidate| candidate.confidence >= 0.45)
    .collect();
  filtered.sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap_or(std::cmp::Ordering::Equal));
  filtered
}

fn similarity(a: &str, b: &str) -> f64 {
  let a_tokens = tokenize(a);
  let b_tokens = tokenize(b);
  if a_tokens.is_empty() || b_tokens.is_empty() {
    return 0.2;
  }
  let intersection = a_tokens.iter().filter(|token| b_tokens.contains(*token)).count();
  let union = a_tokens.union(&b_tokens).count();
  intersection as f64 / union as f64
}

fn tokenize(value: &str) -> std::collections::HashSet<String> {
  value
    .to_lowercase()
    .replace(|ch: char| !ch.is_ascii_alphanumeric() && !ch.is_whitespace(), " ")
    .split_whitespace()
    .map(|token| token.to_string())
    .collect()
}

fn apply_enrichment_candidate(
  conn: &Connection,
  item_id: &str,
  candidate: &EnrichmentCandidate,
  now: i64,
) -> Result<(), String> {
  let existing: (Option<String>, Option<i64>) = conn
    .query_row(
      "SELECT title, published_year FROM items WHERE id = ?1",
      params![item_id],
      |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .map_err(|err| err.to_string())?;

  let title = existing.0.or_else(|| candidate.title.clone());
  let published_year = existing.1.or(candidate.published_year);
  conn.execute(
    "UPDATE items SET title = ?1, published_year = ?2, updated_at = ?3 WHERE id = ?4",
    params![title, published_year, now, item_id],
  )
  .map_err(|err| err.to_string())?;

  if candidate.title.is_some() {
    insert_field_source_with_source(conn, item_id, "title", &candidate.source, candidate.confidence, now)?;
  }
  if candidate.published_year.is_some() {
    insert_field_source_with_source(conn, item_id, "published_year", &candidate.source, candidate.confidence, now)?;
  }

  for author in &candidate.authors {
    let author_id: Option<String> = conn
      .query_row(
        "SELECT id FROM authors WHERE name = ?1",
        params![author],
        |row| row.get(0),
      )
      .optional()
      .map_err(|err| err.to_string())?;
    let author_id = author_id.unwrap_or_else(|| Uuid::new_v4().to_string());
    conn.execute(
      "INSERT OR IGNORE INTO authors (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
      params![author_id, author, now],
    )
    .map_err(|err| err.to_string())?;
    conn.execute(
      "INSERT OR IGNORE INTO item_authors (item_id, author_id, role, ord) VALUES (?1, ?2, 'author', 0)",
      params![item_id, author_id],
    )
    .map_err(|err| err.to_string())?;
  }

  for raw in &candidate.identifiers {
    let normalized = normalize_isbn(raw);
    let value = normalized.unwrap_or_else(|| raw.to_string());
    let id_type = if value.len() == 10 {
      "ISBN10"
    } else if value.len() == 13 {
      "ISBN13"
    } else {
      "OTHER"
    };
    let identifier_id = Uuid::new_v4().to_string();
    conn.execute(
      "INSERT OR IGNORE INTO identifiers (id, item_id, type, value, source, confidence, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
      params![identifier_id, item_id, id_type, value, candidate.source, candidate.confidence, now],
    )
    .map_err(|err| err.to_string())?;
  }

  Ok(())
}

fn insert_field_source_with_source(
  conn: &Connection,
  item_id: &str,
  field: &str,
  source: &str,
  confidence: f64,
  now: i64,
) -> Result<(), String> {
  conn.execute(
    "INSERT INTO item_field_sources (id, item_id, field, source, confidence, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    params![Uuid::new_v4().to_string(), item_id, field, source, confidence, now],
  )
  .map_err(|err| err.to_string())?;
  Ok(())
}

fn render_template(
  template: &str,
  author: &str,
  title: &str,
  year: Option<i64>,
  isbn13: Option<&str>,
  extension: &str,
) -> String {
  let author = sanitize(author);
  let title = sanitize(title);
  let year = year.map(|value| value.to_string()).unwrap_or_else(|| "Unknown".to_string());
  let isbn13 = isbn13.unwrap_or("Unknown");
  let ext = extension.trim_start_matches('.');
  template
    .replace("{Author}", &author)
    .replace("{Title}", &title)
    .replace("{Year}", &year)
    .replace("{ISBN13}", isbn13)
    .replace("{ext}", ext)
}

fn sanitize(value: &str) -> String {
  value
    .chars()
    .map(|ch| match ch {
      '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
      _ => ch,
    })
    .collect::<String>()
    .split_whitespace()
    .collect::<Vec<&str>>()
    .join(" ")
    .trim()
    .to_string()
}

fn resolve_collision(library_root: &str, relative: &str) -> String {
  let base = std::path::Path::new(library_root).join(relative);
  if !base.exists() {
    return base.to_string_lossy().to_string();
  }
  let mut index = 1;
  let stem = base.file_stem().and_then(|value| value.to_str()).unwrap_or("file");
  let ext = base.extension().and_then(|value| value.to_str()).unwrap_or("");
  loop {
    let filename = if ext.is_empty() {
      format!("{} [{}]", stem, index)
    } else {
      format!("{} [{}].{}", stem, index, ext)
    };
    let candidate = base.with_file_name(filename);
    if !candidate.exists() {
      return candidate.to_string_lossy().to_string();
    }
    index += 1;
  }
}

fn db_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
  let app_dir = app
    .path()
    .app_data_dir()
    .map_err(|err| err.to_string())?;
  std::fs::create_dir_all(&app_dir).map_err(|err| err.to_string())?;
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
  let app_menu = |app: &tauri::App| {
    let scan_item = MenuItem::with_id(app, "scan_folder", "Scan Folder", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit Folio", true, None::<&str>)?;
    let folio_menu = Submenu::with_items(app, "Folio", true, &[&scan_item, &quit_item])?;
    Menu::with_items(app, &[&folio_menu])
  };

  tauri::Builder::default()
    .setup(move |app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      let menu = app_menu(app)?;
      app.set_menu(menu)?;
      Ok(())
    })
    .plugin(tauri_plugin_dialog::init())
    .on_menu_event(|app, event| {
      if event.id().as_ref() == "scan_folder" {
        let _ = app.emit("menu-scan-folder", ());
      }
      if event.id().as_ref() == "quit" {
        app.exit(0);
      }
    })
    .invoke_handler(tauri::generate_handler![
      get_library_items,
      get_inbox_items,
      get_duplicate_groups,
      get_fix_candidates,
      apply_fix_candidate,
      plan_organize,
      apply_organize,
      scan_folder
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
