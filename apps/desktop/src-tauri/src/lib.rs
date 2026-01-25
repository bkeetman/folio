use lopdf::{Document, Object};
use regex::Regex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::Read;
use tauri::Manager;
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
  let db_path = db_path(app).map_err(|err| err.to_string())?;
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

  if let Some(info) = info {
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
  let regex = Regex::new(r"full-path=\"([^\"]+)\"").ok()?;
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
