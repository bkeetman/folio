use ab_glyph::{FontRef, PxScale};
use image::{ImageBuffer, Rgba, ImageEncoder};
use image::codecs::png::PngEncoder;
use imageproc::drawing::draw_text_mut;
use lopdf::{Document, Object};
use regex::Regex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::{Emitter, Manager};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use uuid::Uuid;
use walkdir::WalkDir;
use zip::ZipArchive;

/// Global flag to cancel the enrich operation
static ENRICH_CANCELLED: AtomicBool = AtomicBool::new(false);
static BOL_TOKEN_CACHE: OnceLock<Mutex<Option<BolAccessToken>>> = OnceLock::new();

pub mod db;
pub mod models;
pub mod parser;
pub mod scanner;

const MIGRATION_SQL: &str = include_str!(
  "../../../../packages/core/drizzle/0000_nebulous_mysterio.sql"
);
const MIGRATION_COVERS_SQL: &str = include_str!(
  "../../../../packages/core/drizzle/0001_wandering_young_avengers.sql"
);
const MIGRATION_PENDING_CHANGES_SQL: &str = include_str!(
  "../../../../packages/core/drizzle/0002_pending_changes.sql"
);
const MIGRATION_TAG_COLORS_SQL: &str = include_str!(
  "../../../../packages/core/drizzle/0003_tag_colors.sql"
);
const MIGRATION_EREADER_SQL: &str = include_str!(
  "../../../../packages/core/drizzle/0004_ereader.sql"
);
const MIGRATION_ORGANIZER_SETTINGS_SQL: &str = include_str!(
  "../../../../packages/core/drizzle/0005_organizer_settings.sql"
);
const MIGRATION_ORGANIZER_LOGS_SQL: &str = include_str!(
  "../../../../packages/core/drizzle/0006_organizer_logs.sql"
);
const MIGRATION_TITLE_CLEANUP_IGNORES_SQL: &str = include_str!(
  "../../../../packages/core/drizzle/0007_title_cleanup_ignores.sql"
);

#[derive(Serialize, Clone)]
struct Tag {
  id: String,
  name: String,
  color: Option<String>,
}

#[derive(Serialize)]
struct LibraryItem {
  id: String,
  title: Option<String>,
  published_year: Option<i64>,
  created_at: i64,
  authors: Vec<String>,
  file_count: i64,
  formats: Vec<String>,
  cover_path: Option<String>,
  tags: Vec<Tag>,
  language: Option<String>,
  series: Option<String>,
  series_index: Option<f64>,
  isbn: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MissingFileItem {
  file_id: String,
  item_id: String,
  title: String,
  authors: Vec<String>,
  path: String,
  extension: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OrganizerSettings {
  library_root: Option<String>,
  mode: String,
  template: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OrganizerLogEntry {
  action: String,
  from: String,
  to: String,
  timestamp: i64,
  error: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OrganizerLog {
  id: String,
  created_at: i64,
  processed: usize,
  errors: usize,
  entries: Vec<OrganizerLogEntry>,
}

fn parse_tags(raw: Option<String>) -> Vec<Tag> {
  let raw = match raw {
    Some(value) => value,
    None => return vec![],
  };
  raw
    .split("||")
    .filter_map(|entry| {
      let mut parts = entry.splitn(3, '|');
      let id = parts.next()?.trim();
      let name = parts.next()?.trim();
      let color = parts.next().unwrap_or("").trim();
      if id.is_empty() || name.is_empty() {
        return None;
      }
      Some(Tag {
        id: id.to_string(),
        name: name.to_string(),
        color: if color.is_empty() {
          None
        } else {
          Some(color.to_string())
        },
      })
    })
    .collect()
}

#[derive(Serialize)]
struct InboxItem {
  id: String,
  title: String,
  reason: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TitleCleanupIgnore {
  item_id: String,
  title_snapshot: String,
}

#[derive(Serialize)]
struct DuplicateGroup {
  id: String,
  kind: String,
  title: String,
  files: Vec<String>,
  file_ids: Vec<String>,
  file_paths: Vec<String>,
  file_titles: Vec<String>,
  file_sizes: Vec<i64>,
}

#[derive(Serialize)]
struct PendingChange {
  id: String,
  file_id: String,
  change_type: String,
  from_path: Option<String>,
  to_path: Option<String>,
  changes_json: Option<String>,
  status: String,
  created_at: i64,
  applied_at: Option<i64>,
  error: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EReaderDevice {
  id: String,
  name: String,
  mount_path: String,
  device_type: String,
  books_subfolder: String,
  last_connected_at: Option<i64>,
  is_connected: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EReaderBook {
  path: String,
  filename: String,
  title: Option<String>,
  authors: Vec<String>,
  file_hash: String,
  matched_item_id: Option<String>,
  match_confidence: Option<String>,
}

#[derive(Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SyncQueueItem {
  id: String,
  device_id: String,
  action: String,
  item_id: Option<String>,
  ereader_path: Option<String>,
  status: String,
  created_at: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SyncResult {
  added: i64,
  removed: i64,
  imported: i64,
  errors: Vec<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SyncProgressPayload {
  processed: usize,
  total: usize,
  current: String,
  action: String,
}

#[derive(serde::Deserialize, serde::Serialize)]
struct EpubChangeSet {
  title: Option<String>,
  author: Option<String>,
  isbn: Option<String>,
  description: Option<String>,
}

#[derive(Serialize)]
struct LibraryHealth {
  total: i64,
  missing_isbn: i64,
  duplicates: i64,
  complete: i64,
  missing_cover: i64,
}

#[derive(Serialize)]
struct CoverBlob {
  mime: String,
  bytes: Vec<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DescriptionCleanupResult {
  items_updated: i64,
  files_queued: i64,
}

#[derive(Serialize, serde::Deserialize, Clone)]
struct EnrichmentCandidate {
  id: String,
  title: Option<String>,
  authors: Vec<String>,
  published_year: Option<i64>,
  identifiers: Vec<String>,
  cover_url: Option<String>,
  source: String,
  confidence: f64,
}

#[derive(Clone)]
struct BolAccessToken {
  access_token: String,
  expires_at: i64,
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

#[derive(Serialize, Clone)]
struct ScanProgressPayload {
  processed: usize,
  total: usize,
  current: String,
}

/// Unified progress payload for all background operations.
/// All operations should emit events conforming to this shape.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OperationProgress {
  item_id: String,
  status: String, // "pending", "processing", "done", "skipped", "error"
  message: Option<String>,
  current: usize,
  total: usize,
}

/// Unified stats payload for operation completion.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct OperationStats {
  total: usize,
  processed: usize,
  skipped: usize,
  errors: usize,
}

struct ExtractedMetadata {
  title: Option<String>,
  authors: Vec<String>,
  language: Option<String>,
  published_year: Option<i64>,
  description: Option<String>,
  identifiers: Vec<String>,
  series: Option<String>,
  series_index: Option<f64>,
}

#[derive(Serialize)]
struct FileItem {
  id: String,
  path: String,
  filename: String,
  format: String,
}

#[tauri::command]
fn get_item_files(app: tauri::AppHandle, item_id: String) -> Result<Vec<FileItem>, String> {
  let conn = open_db(&app)?;
  let mut stmt = conn
    .prepare("SELECT id, path, filename, extension FROM files WHERE item_id = ?1 AND status = 'active'")
    .map_err(|err| err.to_string())?;

  let rows = stmt
    .query_map(params![item_id], |row| {
      Ok(FileItem {
        id: row.get(0)?,
        path: row.get(1)?,
        filename: row.get(2)?,
        format: row.get::<_, String>(3)?.to_uppercase(),
      })
    })
    .map_err(|err| err.to_string())?;

  let mut files = Vec::new();
  for row in rows {
    files.push(row.map_err(|err| err.to_string())?);
  }
  Ok(files)
}

#[tauri::command]
fn reveal_file(path: String) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  {
    std::process::Command::new("open")
      .arg("-R")
      .arg(&path)
      .spawn()
      .map_err(|err| err.to_string())?;
  }
  #[cfg(target_os = "windows")]
  {
    std::process::Command::new("explorer")
      .arg("/select,")
      .arg(&path)
      .spawn()
      .map_err(|err| err.to_string())?;
  }
  #[cfg(target_os = "linux")]
  {
     // Simple fallback for linux, opening parent dir
     let parent = std::path::Path::new(&path).parent().unwrap_or(std::path::Path::new("/"));
     std::process::Command::new("xdg-open")
      .arg(parent)
      .spawn()
      .map_err(|err| err.to_string())?;
  }
  Ok(())
}

#[tauri::command]
fn get_item_details(app: tauri::AppHandle, item_id: String) -> Result<ItemMetadata, String> {
  let conn = open_db(&app)?;
  let (title, published_year, language, series, series_index, description, isbn) = conn
    .query_row(
       "SELECT title, published_year, language, series, series_index, description, \
        (SELECT value FROM identifiers WHERE item_id = items.id AND type IN ('ISBN10', 'ISBN13', 'OTHER', 'isbn10', 'isbn13', 'other') LIMIT 1) as isbn \
        FROM items WHERE id = ?1",
      params![item_id],
      |row| {
        Ok((
          row.get(0)?,
          row.get(1)?,
          row.get(2)?,
          row.get(3)?,
          row.get(4)?,
          row.get(5)?,
          row.get(6)?,
        ))
      },
    )
    .map_err(|err| err.to_string())?;

  let mut stmt = conn
    .prepare(
      "SELECT authors.name FROM item_authors \
       JOIN authors ON authors.id = item_authors.author_id \
       WHERE item_authors.item_id = ?1 \
       ORDER BY item_authors.ord",
    )
    .map_err(|err| err.to_string())?;

  let author_rows = stmt
    .query_map(params![item_id], |row| row.get::<_, String>(0))
    .map_err(|err| err.to_string())?;

  let mut authors = Vec::new();
  for row in author_rows {
    authors.push(row.map_err(|err| err.to_string())?);
  }

  Ok(ItemMetadata {
    title,
    authors,
    published_year,
    language,
    isbn,
    series,
    series_index,
    description: normalize_optional_description(description),
  })
}

#[tauri::command]
fn get_missing_files(app: tauri::AppHandle) -> Result<Vec<MissingFileItem>, String> {
  let conn = open_db(&app)?;
  let mut stmt = conn
    .prepare(
      "SELECT files.id, files.item_id, files.path, files.extension, items.title, \
       GROUP_CONCAT(DISTINCT authors.name) as authors \
       FROM files \
       JOIN items ON items.id = files.item_id \
       LEFT JOIN item_authors ON item_authors.item_id = items.id \
       LEFT JOIN authors ON authors.id = item_authors.author_id \
       WHERE files.status = 'missing' \
       GROUP BY files.id \
       ORDER BY items.title",
    )
    .map_err(|err| err.to_string())?;

  let rows = stmt
    .query_map(params![], |row| {
      let authors: Option<String> = row.get(5)?;
      Ok(MissingFileItem {
        file_id: row.get(0)?,
        item_id: row.get(1)?,
        path: row.get(2)?,
        extension: row.get(3)?,
        title: row.get::<_, Option<String>>(4)?.unwrap_or_else(|| "Untitled".to_string()),
        authors: authors
          .unwrap_or_default()
          .split(',')
          .filter(|value| !value.trim().is_empty())
          .map(|value| value.trim().to_string())
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
fn relink_missing_file(app: tauri::AppHandle, file_id: String, new_path: String) -> Result<(), String> {
  let conn = open_db(&app)?;
  let now = chrono::Utc::now().timestamp_millis();
  let existing: Option<String> = conn
    .query_row(
      "SELECT id FROM files WHERE path = ?1 AND id != ?2 LIMIT 1",
      params![new_path, file_id],
      |row| row.get(0),
    )
    .optional()
    .map_err(|err| err.to_string())?;
  if existing.is_some() {
    return Err("Selected file is already linked to another item.".to_string());
  }
  let metadata = std::fs::metadata(&new_path).map_err(|err| err.to_string())?;
  let size_bytes = metadata.len() as i64;
  let modified_at = metadata
    .modified()
    .ok()
    .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
    .map(|value| value.as_millis() as i64);
  let filename = std::path::Path::new(&new_path)
    .file_name()
    .and_then(|value| value.to_str())
    .unwrap_or("file")
    .to_string();
  let extension = std::path::Path::new(&new_path)
    .extension()
    .and_then(|value| value.to_str())
    .map(|value| format!(".{}", value.to_lowercase()))
    .unwrap_or_default();

  conn.execute(
    "UPDATE files SET path = ?1, filename = ?2, extension = ?3, size_bytes = ?4, modified_at = ?5, updated_at = ?6, status = 'active' WHERE id = ?7",
    params![new_path, filename, extension, size_bytes, modified_at, now, file_id],
  )
  .map_err(|err| err.to_string())?;
  Ok(())
}

#[tauri::command]
fn remove_missing_file(app: tauri::AppHandle, file_id: String) -> Result<(), String> {
  let conn = open_db(&app)?;
  conn.execute(
    "UPDATE files SET status = 'inactive', updated_at = ?1 WHERE id = ?2",
    params![chrono::Utc::now().timestamp_millis(), file_id],
  )
  .map_err(|err| err.to_string())?;
  Ok(())
}

#[tauri::command]
fn get_library_items(app: tauri::AppHandle) -> Result<Vec<LibraryItem>, String> {
  let conn = open_db(&app)?;
  let mut stmt = conn
    .prepare(
       "SELECT items.id, items.title, items.published_year, items.created_at, \
        GROUP_CONCAT(DISTINCT authors.name) as authors, \
        COUNT(DISTINCT files.id) as file_count, \
        GROUP_CONCAT(DISTINCT files.extension) as formats, \
        MAX(covers.local_path) as cover_path, \
        tag_map.tags as tags, \
        items.language, items.series, items.series_index, \
        (SELECT value FROM identifiers WHERE item_id = items.id AND type IN ('ISBN10', 'ISBN13', 'OTHER', 'isbn10', 'isbn13', 'other') LIMIT 1) as isbn \
       FROM items \
       LEFT JOIN item_authors ON item_authors.item_id = items.id \
       LEFT JOIN authors ON authors.id = item_authors.author_id \
       LEFT JOIN files ON files.item_id = items.id AND files.status = 'active' \
       LEFT JOIN covers ON covers.item_id = items.id \
       LEFT JOIN ( \
         SELECT item_id, GROUP_CONCAT(tag_entry, '||') as tags \
         FROM ( \
           SELECT DISTINCT item_tags.item_id as item_id, \
             tags.id || '|' || tags.name || '|' || IFNULL(tags.color, '') as tag_entry \
           FROM item_tags \
           JOIN tags ON tags.id = item_tags.tag_id \
         ) \
         GROUP BY item_id \
       ) as tag_map ON tag_map.item_id = items.id \
       WHERE EXISTS (SELECT 1 FROM files WHERE item_id = items.id AND status = 'active') \
       GROUP BY items.id"
    )
    .map_err(|err| err.to_string())?;

  let rows = stmt
    .query_map(params![], |row| {
      let authors: Option<String> = row.get(4)?;
      let formats: Option<String> = row.get(6)?;
      let cover_path: Option<String> = row.get(7)?;
      let tags: Option<String> = row.get(8)?;
      Ok(LibraryItem {
        id: row.get(0)?,
        title: row.get(1)?,
        published_year: row.get(2)?,
        created_at: row.get(3)?,
        authors: authors
          .unwrap_or_default()
          .split(',')
          .filter(|value| !value.trim().is_empty())
          .map(|value| value.trim().to_string())
          .collect(),
        file_count: row.get(5)?,
        formats: formats
          .unwrap_or_default()
          .split(',')
          .filter(|value| !value.trim().is_empty())
          .map(|value| value.trim().to_uppercase())
          .collect(),
        cover_path,
        tags: parse_tags(tags),
        language: row.get(9)?,
        series: row.get(10)?,
        series_index: row.get(11)?,
        isbn: row.get(12)?,
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
      "SELECT items.id, COALESCE(items.title, 'Untitled') as title, \
        items.title IS NULL as missing_title, \
        author_counts.author_count as author_count, \
        isbn_counts.isbn_count as isbn_count, \
        cover_counts.cover_count as cover_count \
       FROM items \
       LEFT JOIN files ON files.item_id = items.id AND files.status = 'active' \
       LEFT JOIN ( \
         SELECT item_id, COUNT(*) as author_count \
         FROM item_authors \
         GROUP BY item_id \
       ) as author_counts ON author_counts.item_id = items.id \
       LEFT JOIN ( \
         SELECT item_id, COUNT(*) as isbn_count \
         FROM identifiers \
         WHERE type IN ('ISBN10','ISBN13','OTHER','isbn10','isbn13','other') \
         GROUP BY item_id \
       ) as isbn_counts ON isbn_counts.item_id = items.id \
       LEFT JOIN ( \
         SELECT item_id, COUNT(*) as cover_count \
         FROM covers \
         GROUP BY item_id \
        ) as cover_counts ON cover_counts.item_id = items.id \
       WHERE EXISTS (SELECT 1 FROM files WHERE item_id = items.id AND status = 'active')"
    )
    .map_err(|err| err.to_string())?;

  let rows = stmt
    .query_map(params![], |row| {
      let missing_title: bool = row.get(2)?;
      let author_count: Option<i64> = row.get(3)?;
      let isbn_count: Option<i64> = row.get(4)?;
      let cover_count: Option<i64> = row.get(5)?;
      let mut missing = Vec::new();
      if missing_title {
        missing.push("title");
      }
      if author_count.unwrap_or(0) == 0 {
        missing.push("author");
      }
      if cover_count.unwrap_or(0) == 0 {
        missing.push("cover");
      }
      if missing.is_empty() {
        return Ok(None);
      }
      Ok(Some(InboxItem {
        id: row.get(0)?,
        title: row.get(1)?,
        reason: format!("Missing metadata: {}.", missing.join(", ")),
      }))
    })
    .map_err(|err| err.to_string())?;

  let mut items = Vec::new();
  for row in rows {
    if let Some(item) = row.map_err(|err| err.to_string())? {
      items.push(item);
    }
  }
  Ok(items)
}

#[tauri::command]
fn list_tags(app: tauri::AppHandle) -> Result<Vec<Tag>, String> {
  let conn = open_db(&app)?;
  let mut stmt = conn
    .prepare("SELECT id, name, color FROM tags ORDER BY name")
    .map_err(|err| err.to_string())?;
  let rows = stmt
    .query_map(params![], |row| {
      Ok(Tag {
        id: row.get(0)?,
        name: row.get(1)?,
        color: row.get(2)?,
      })
    })
    .map_err(|err| err.to_string())?;
  let mut tags = Vec::new();
  for row in rows {
    tags.push(row.map_err(|err| err.to_string())?);
  }
  Ok(tags)
}

#[tauri::command]
fn create_tag(app: tauri::AppHandle, name: String, color: Option<String>) -> Result<Tag, String> {
  let conn = open_db(&app)?;
  let trimmed = name.trim();
  if trimmed.is_empty() {
    return Err("Tag name cannot be empty".to_string());
  }
  if trimmed.contains('|') {
    return Err("Tag name cannot contain |".to_string());
  }
  if let Some(value) = color.as_deref() {
    let allowed = ["amber", "rose", "sky", "emerald", "violet", "slate"];
    if !allowed.contains(&value) {
      return Err("Unsupported tag color".to_string());
    }
  }
  let normalized = trimmed.to_lowercase();
  if let Some(existing) = conn
    .query_row(
      "SELECT id, name, color FROM tags WHERE normalized = ?1",
      params![normalized],
      |row| {
        Ok(Tag {
          id: row.get(0)?,
          name: row.get(1)?,
          color: row.get(2)?,
        })
      },
    )
    .optional()
    .map_err(|err| err.to_string())?
  {
    return Ok(existing);
  }
  let id = Uuid::new_v4().to_string();
  conn
    .execute(
      "INSERT INTO tags (id, name, normalized, color, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      params![id, trimmed, normalized, color, chrono::Utc::now().timestamp_millis()],
    )
    .map_err(|err| err.to_string())?;
  Ok(Tag {
    id,
    name: trimmed.to_string(),
    color,
  })
}

#[tauri::command]
fn add_tag_to_item(app: tauri::AppHandle, item_id: String, tag_id: String) -> Result<(), String> {
  let conn = open_db(&app)?;
  conn
    .execute(
      "INSERT OR IGNORE INTO item_tags (item_id, tag_id, source, confidence) VALUES (?1, ?2, 'user', 1)",
      params![item_id, tag_id],
    )
    .map_err(|err| err.to_string())?;
  Ok(())
}

#[tauri::command]
fn remove_tag_from_item(app: tauri::AppHandle, item_id: String, tag_id: String) -> Result<(), String> {
  let conn = open_db(&app)?;
  conn
    .execute(
      "DELETE FROM item_tags WHERE item_id = ?1 AND tag_id = ?2",
      params![item_id, tag_id],
    )
    .map_err(|err| err.to_string())?;
  Ok(())
}

#[tauri::command]
fn get_cover_blob(app: tauri::AppHandle, item_id: String) -> Result<Option<CoverBlob>, String> {
  let conn = open_db(&app)?;
  let path: Option<String> = conn
    .query_row(
      "SELECT local_path FROM covers WHERE item_id = ?1 ORDER BY created_at DESC LIMIT 1",
      params![item_id],
      |row| row.get(0),
    )
    .optional()
    .map_err(|err| err.to_string())?;
  let path = match path {
    Some(value) => value,
    None => return Ok(None),
  };
  let bytes = std::fs::read(&path).map_err(|err| err.to_string())?;
  if bytes.is_empty() {
    return Ok(None);
  }
  let mime = match std::path::Path::new(&path)
    .extension()
    .and_then(|value| value.to_str())
    .unwrap_or("")
    .to_lowercase()
    .as_str()
  {
    "png" => "image/png",
    "webp" => "image/webp",
    "jpg" | "jpeg" => "image/jpeg",
    _ => "image/jpeg",
  }
  .to_string();

  Ok(Some(CoverBlob { mime, bytes }))
}

#[tauri::command]
fn get_duplicate_groups(app: tauri::AppHandle) -> Result<Vec<DuplicateGroup>, String> {
  let conn = open_db(&app)?;
  let mut stmt = conn
    .prepare(
      "SELECT files.sha256, COALESCE(items.title, 'Untitled') as title, \
       GROUP_CONCAT(files.filename, '|') as filenames, \
       GROUP_CONCAT(files.id, '|') as file_ids, \
       GROUP_CONCAT(files.path, '|') as file_paths, \
       GROUP_CONCAT(COALESCE(items.title, 'Untitled'), '|') as item_titles, \
       GROUP_CONCAT(COALESCE(files.size_bytes, 0), '|') as file_sizes \
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
      let file_ids: Option<String> = row.get(3)?;
      let file_paths: Option<String> = row.get(4)?;
      let item_titles: Option<String> = row.get(5)?;
      let file_sizes: Option<String> = row.get(6)?;
      Ok(DuplicateGroup {
        id: row.get(0)?,
        kind: "hash".to_string(),
        title: row.get(1)?,
        files: filenames
          .unwrap_or_default()
          .split('|')
          .filter(|value| !value.trim().is_empty())
          .map(|value| value.trim().to_string())
          .collect(),
        file_ids: file_ids
          .unwrap_or_default()
          .split('|')
          .filter(|value| !value.trim().is_empty())
          .map(|value| value.trim().to_string())
          .collect(),
        file_paths: file_paths
          .unwrap_or_default()
          .split('|')
          .filter(|value| !value.trim().is_empty())
          .map(|value| value.trim().to_string())
          .collect(),
        file_titles: item_titles
          .unwrap_or_default()
          .split('|')
          .filter(|value| !value.trim().is_empty())
          .map(|value| value.trim().to_string())
          .collect(),
        file_sizes: file_sizes
          .unwrap_or_default()
          .split('|')
          .filter(|value| !value.trim().is_empty())
          .map(|value| value.trim().parse::<i64>().unwrap_or(0))
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
fn get_title_duplicate_groups(app: tauri::AppHandle) -> Result<Vec<DuplicateGroup>, String> {
  get_title_like_duplicate_groups(&app, "title")
}

#[tauri::command]
fn get_fuzzy_duplicate_groups(app: tauri::AppHandle) -> Result<Vec<DuplicateGroup>, String> {
  get_title_like_duplicate_groups(&app, "fuzzy")
}

fn get_title_like_duplicate_groups(app: &tauri::AppHandle, mode: &str) -> Result<Vec<DuplicateGroup>, String> {
  let conn = open_db(app)?;
  let mut stmt = conn
    .prepare(
      "SELECT files.id, files.filename, files.path, COALESCE(files.size_bytes, 0), \
       items.title, items.published_year, \
       GROUP_CONCAT(DISTINCT authors.name) as authors \
       FROM files \
       JOIN items ON items.id = files.item_id \
       LEFT JOIN item_authors ON item_authors.item_id = items.id \
       LEFT JOIN authors ON authors.id = item_authors.author_id \
       WHERE files.status = 'active' \
       GROUP BY files.id",
    )
    .map_err(|err| err.to_string())?;

  let rows = stmt
    .query_map(params![], |row| {
      Ok((
        row.get::<_, String>(0)?,
        row.get::<_, String>(1)?,
        row.get::<_, String>(2)?,
        row.get::<_, i64>(3)?,
        row.get::<_, Option<String>>(4)?,
        row.get::<_, Option<i64>>(5)?,
        row.get::<_, Option<String>>(6)?,
      ))
    })
    .map_err(|err| err.to_string())?;

  let mut groups: std::collections::HashMap<String, DuplicateGroup> = std::collections::HashMap::new();
  for row in rows {
    let (file_id, filename, path, size_bytes, title, published_year, authors) =
      row.map_err(|err| err.to_string())?;
    let title_value = title.unwrap_or_else(|| "Untitled".to_string());
    let normalized_title = normalize_title_for_matching(&title_value);
    if normalized_title.len() < 3 {
      continue;
    }
    let author_value = authors
      .unwrap_or_default()
      .split(',')
      .next()
      .unwrap_or("")
      .trim()
      .to_string();
    let normalized_author = normalize_author_for_matching(&author_value);
    if normalized_author.is_empty() {
      continue;
    }
    let year = published_year.unwrap_or(0);
    let key = if mode == "fuzzy" {
      format!("fuzzy:{}:{}", normalized_title, normalized_author)
    } else {
      format!("title:{}:{}:{}", normalized_title, normalized_author, year)
    };
    let group = groups.entry(key.clone()).or_insert(DuplicateGroup {
      id: key.clone(),
      kind: mode.to_string(),
      title: title_value.clone(),
      files: Vec::new(),
      file_ids: Vec::new(),
      file_paths: Vec::new(),
      file_titles: Vec::new(),
      file_sizes: Vec::new(),
    });
    group.files.push(filename);
    group.file_ids.push(file_id);
    group.file_paths.push(path);
    group.file_titles.push(title_value);
    group.file_sizes.push(size_bytes);
  }

  let mut result = Vec::new();
  for (_, group) in groups {
    if group.file_ids.len() > 1 {
      result.push(group);
    }
  }
  Ok(result)
}

#[tauri::command]
fn get_pending_changes(app: tauri::AppHandle, status: Option<String>) -> Result<Vec<PendingChange>, String> {
  let conn = open_db(&app)?;
  let status = status.unwrap_or_else(|| "pending".to_string());
  let mut stmt = conn
    .prepare(
      "SELECT id, file_id, type, from_path, to_path, changes_json, status, created_at, applied_at, error \
       FROM pending_changes \
       WHERE status = ?1 \
       ORDER BY created_at DESC",
    )
    .map_err(|err| err.to_string())?;
  let rows = stmt
    .query_map(params![status], |row| {
      Ok(PendingChange {
        id: row.get(0)?,
        file_id: row.get(1)?,
        change_type: row.get(2)?,
        from_path: row.get(3)?,
        to_path: row.get(4)?,
        changes_json: row.get(5)?,
        status: row.get(6)?,
        created_at: row.get(7)?,
        applied_at: row.get(8)?,
        error: row.get(9)?,
      })
    })
    .map_err(|err| err.to_string())?;
  let mut changes = Vec::new();
  for row in rows {
    changes.push(row.map_err(|err| err.to_string())?);
  }
  Ok(changes)
}

#[tauri::command]
fn apply_pending_changes(app: tauri::AppHandle, ids: Vec<String>) -> Result<(), String> {
  // Spawn in background thread so UI stays responsive
  std::thread::spawn(move || {
    if let Err(e) = apply_pending_changes_sync(&app, ids) {
      log::error!("Failed to apply pending changes: {}", e);
    }
  });
  Ok(())
}

#[tauri::command]
fn remove_pending_changes(app: tauri::AppHandle, ids: Vec<String>) -> Result<i64, String> {
  let conn = open_db(&app)?;
  let mut removed = 0i64;

  if ids.is_empty() {
    // Remove all pending changes
    removed = conn
      .execute("DELETE FROM pending_changes WHERE status = 'pending'", params![])
      .map_err(|err| err.to_string())? as i64;
  } else {
    // Remove specific changes
    for id in &ids {
      let result = conn
        .execute("DELETE FROM pending_changes WHERE id = ?1 AND status = 'pending'", params![id])
        .map_err(|err| err.to_string())?;
      removed += result as i64;
    }
  }

  Ok(removed)
}

fn apply_pending_changes_sync(app: &tauri::AppHandle, ids: Vec<String>) -> Result<(), String> {
  let conn = open_db(app)?;
  let now = chrono::Utc::now().timestamp_millis();
  let mut changes: Vec<PendingChange> = Vec::new();

  if ids.is_empty() {
    let mut stmt = conn
      .prepare(
        "SELECT id, file_id, type, from_path, to_path, changes_json, status, created_at, applied_at, error \
         FROM pending_changes WHERE status = 'pending' ORDER BY created_at ASC",
      )
      .map_err(|err| err.to_string())?;
    let rows = stmt
      .query_map(params![], |row| {
        Ok(PendingChange {
          id: row.get(0)?,
          file_id: row.get(1)?,
          change_type: row.get(2)?,
          from_path: row.get(3)?,
          to_path: row.get(4)?,
          changes_json: row.get(5)?,
          status: row.get(6)?,
          created_at: row.get(7)?,
          applied_at: row.get(8)?,
          error: row.get(9)?,
        })
      })
      .map_err(|err| err.to_string())?;
    for row in rows {
      changes.push(row.map_err(|err| err.to_string())?);
    }
  } else {
    let mut stmt = conn
      .prepare(
        "SELECT id, file_id, type, from_path, to_path, changes_json, status, created_at, applied_at, error \
         FROM pending_changes WHERE status = 'pending' AND id = ?1",
      )
      .map_err(|err| err.to_string())?;
    for id in ids {
      let row = stmt
        .query_row(params![id], |row| {
          Ok(PendingChange {
            id: row.get(0)?,
            file_id: row.get(1)?,
            change_type: row.get(2)?,
            from_path: row.get(3)?,
            to_path: row.get(4)?,
            changes_json: row.get(5)?,
            status: row.get(6)?,
            created_at: row.get(7)?,
            applied_at: row.get(8)?,
            error: row.get(9)?,
          })
        })
        .optional()
        .map_err(|err| err.to_string())?;
      if let Some(change) = row {
        changes.push(change);
      }
    }
  }

  use tauri::Emitter;
  let total = changes.len();
  let mut stats = OperationStats {
    total,
    processed: 0,
    skipped: 0,
    errors: 0,
  };

  for (index, change) in changes.iter().enumerate() {
    // Emit "processing" event
    let _ = app.emit("change-progress", OperationProgress {
      item_id: change.id.clone(),
      status: "processing".to_string(),
      message: Some(change.from_path.clone().unwrap_or_default()),
      current: index + 1,
      total,
    });

    let result = match change.change_type.as_str() {
      "rename" => apply_rename_change(&conn, change, now),
      "epub_meta" => apply_epub_change(change, now),
      "delete" => apply_delete_change(&conn, change, now),
      _ => Err("Unsupported change type".to_string()),
    };

    match result {
      Ok(()) => {
        conn.execute(
          "UPDATE pending_changes SET status = 'applied', applied_at = ?1, error = NULL WHERE id = ?2",
          params![now, change.id],
        )
        .map_err(|err| err.to_string())?;
        log::info!(
          "applied change {} ({}) for file {}",
          change.id,
          change.change_type,
          change.file_id
        );
        stats.processed += 1;
        // Emit "done" event
        let _ = app.emit("change-progress", OperationProgress {
          item_id: change.id.clone(),
          status: "done".to_string(),
          message: None,
          current: index + 1,
          total,
        });
      }
      Err(message) => {
        conn.execute(
          "UPDATE pending_changes SET status = 'error', error = ?1 WHERE id = ?2",
          params![message, change.id],
        )
        .map_err(|err| err.to_string())?;
        log::error!(
          "failed change {} ({}) for file {}: {}",
          change.id,
          change.change_type,
          change.file_id,
          message
        );
        stats.errors += 1;
        // Emit "error" event
        let _ = app.emit("change-progress", OperationProgress {
          item_id: change.id.clone(),
          status: "error".to_string(),
          message: Some(message),
          current: index + 1,
          total,
        });
      }
    }
  }

  // Emit event to notify frontend that changes are complete
  let _ = app.emit("change-complete", stats);

  Ok(())
}

#[tauri::command]
fn resolve_duplicate_group(
  app: tauri::AppHandle,
  group_id: String,
  keep_file_id: String,
) -> Result<(), String> {
  let conn = open_db(&app)?;
  let now = chrono::Utc::now().timestamp_millis();
  let valid_keep: Option<String> = conn
    .query_row(
      "SELECT id FROM files WHERE sha256 = ?1 AND status = 'active' AND id = ?2 LIMIT 1",
      params![group_id, keep_file_id],
      |row| row.get(0),
    )
    .optional()
    .map_err(|err| err.to_string())?;
  let keep_id = match valid_keep {
    Some(value) => value,
    None => return Err("Selected file is not part of this duplicate group.".to_string()),
  };

  let mut stmt = conn
    .prepare(
      "SELECT id, path FROM files WHERE sha256 = ?1 AND status = 'active' AND id != ?2",
    )
    .map_err(|err| err.to_string())?;
  let rows = stmt
    .query_map(params![group_id, keep_id], |row| {
      Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })
    .map_err(|err| err.to_string())?;
  let mut queued = 0i64;
  for row in rows {
    let (file_id, path) = row.map_err(|err| err.to_string())?;
    let change_id = Uuid::new_v4().to_string();
    conn.execute(
      "INSERT INTO pending_changes (id, file_id, type, from_path, to_path, changes_json, status, created_at) \
       VALUES (?1, ?2, 'delete', ?3, NULL, NULL, 'pending', ?4)",
      params![change_id, file_id, path, now],
    )
    .map_err(|err| err.to_string())?;
    queued += 1;
  }
  if queued > 0 {
    log::info!("queued delete changes: {} for duplicate group {}", queued, group_id);
  }

  conn.execute(
    "UPDATE files SET status = 'inactive', updated_at = ?1 WHERE sha256 = ?2 AND id != ?3",
    params![now, group_id, keep_id],
  )
  .map_err(|err| err.to_string())?;

  conn.execute(
    "UPDATE issues SET resolved_at = ?1 WHERE type = 'duplicate' AND file_id IN (SELECT id FROM files WHERE sha256 = ?2 AND id != ?3)",
    params![now, group_id, keep_id],
  )
  .map_err(|err| err.to_string())?;

  Ok(())
}

#[tauri::command]
fn resolve_duplicate_group_by_files(
  app: tauri::AppHandle,
  file_ids: Vec<String>,
  keep_file_id: String,
) -> Result<(), String> {
  let conn = open_db(&app)?;
  let now = chrono::Utc::now().timestamp_millis();
  let mut queued = 0i64;
  for file_id in &file_ids {
    if file_id == &keep_file_id {
      continue;
    }
    let path: Option<String> = conn
      .query_row(
        "SELECT path FROM files WHERE id = ?1 AND status = 'active'",
        params![file_id],
        |row| row.get(0),
      )
      .optional()
      .map_err(|err| err.to_string())?;
    if let Some(path) = path {
      let change_id = Uuid::new_v4().to_string();
      conn.execute(
        "INSERT INTO pending_changes (id, file_id, type, from_path, to_path, changes_json, status, created_at) \
         VALUES (?1, ?2, 'delete', ?3, NULL, NULL, 'pending', ?4)",
        params![change_id, file_id, path, now],
      )
      .map_err(|err| err.to_string())?;
      queued += 1;
    }
    conn.execute(
      "UPDATE files SET status = 'inactive', updated_at = ?1 WHERE id = ?2",
      params![now, file_id],
    )
    .map_err(|err| err.to_string())?;
  }
  if queued > 0 {
    log::info!("queued delete changes: {} for duplicate files", queued);
  }
  Ok(())
}

fn apply_rename_change(
  conn: &Connection,
  change: &PendingChange,
  now: i64,
) -> Result<(), String> {
  let from_path = if let Some(value) = change.from_path.as_ref() {
    value.clone()
  } else {
    conn
      .query_row(
        "SELECT path FROM files WHERE id = ?1",
        params![change.file_id],
        |row| row.get(0),
      )
      .map_err(|err| err.to_string())?
  };
  let to_path = change
    .to_path
    .as_ref()
    .ok_or_else(|| "Missing target path".to_string())?
    .clone();

  let target_dir = std::path::Path::new(&to_path)
    .parent()
    .ok_or_else(|| "Invalid target path".to_string())?;
  std::fs::create_dir_all(target_dir).map_err(|err| err.to_string())?;
  std::fs::rename(&from_path, &to_path).map_err(|err| err.to_string())?;

  let filename = std::path::Path::new(&to_path)
    .file_name()
    .and_then(|value| value.to_str())
    .unwrap_or("file")
    .to_string();
  let extension = std::path::Path::new(&to_path)
    .extension()
    .and_then(|value| value.to_str())
    .unwrap_or("")
    .to_string();
  conn.execute(
    "UPDATE files SET path = ?1, filename = ?2, extension = ?3, updated_at = ?4 WHERE id = ?5",
    params![to_path, filename, extension, now, change.file_id],
  )
  .map_err(|err| err.to_string())?;
  Ok(())
}

fn apply_epub_change(change: &PendingChange, _now: i64) -> Result<(), String> {
  let path = change
    .from_path
    .as_ref()
    .ok_or_else(|| "Missing EPUB path".to_string())?;
  let changes_json = change
    .changes_json
    .as_ref()
    .ok_or_else(|| "Missing changes".to_string())?;
  let changes: EpubChangeSet = serde_json::from_str(changes_json)
    .map_err(|err| err.to_string())?;
  update_epub_metadata(path, &changes)?;
  Ok(())
}

fn apply_delete_change(conn: &Connection, change: &PendingChange, now: i64) -> Result<(), String> {
  let path = change
    .from_path
    .as_ref()
    .ok_or_else(|| "Missing file path".to_string())?;
  if let Err(err) = std::fs::remove_file(path) {
    if err.kind() != std::io::ErrorKind::NotFound {
      // Keep file visible in the library when delete could not be applied.
      let _ = conn.execute(
        "UPDATE files SET status = 'active', updated_at = ?1 WHERE id = ?2",
        params![now, change.file_id],
      );
      return Err(format!("Could not delete file {}: {}", path, err));
    }
  }
  conn.execute(
    "UPDATE files SET status = 'inactive', updated_at = ?1 WHERE id = ?2",
    params![now, change.file_id],
  )
  .map_err(|err| err.to_string())?;
  conn.execute(
    "UPDATE issues SET resolved_at = ?1 WHERE file_id = ?2 AND type = 'duplicate'",
    params![now, change.file_id],
  )
  .map_err(|err| err.to_string())?;
  Ok(())
}

fn update_epub_metadata(path: &str, changes: &EpubChangeSet) -> Result<(), String> {
  let file = std::fs::File::open(path).map_err(|err| err.to_string())?;
  let mut archive = ZipArchive::new(file).map_err(|err| err.to_string())?;
  let mut container_xml = String::new();
  {
    let mut container = archive
      .by_name("META-INF/container.xml")
      .map_err(|err| err.to_string())?;
    container
      .read_to_string(&mut container_xml)
      .map_err(|err| err.to_string())?;
  }
  let rootfile = extract_rootfile(&container_xml)?;
  let mut opf_file = archive.by_name(&rootfile).map_err(|err| err.to_string())?;
  let mut opf = String::new();
  opf_file
    .read_to_string(&mut opf)
    .map_err(|err| err.to_string())?;

  let updated_opf = rewrite_opf_metadata(&opf, changes)?;
  rewrite_epub_with_opf(path, &rootfile, updated_opf)?;
  Ok(())
}

fn extract_rootfile(container_xml: &str) -> Result<String, String> {
  let mut reader = quick_xml::Reader::from_str(container_xml);
  reader.trim_text(true);
  let mut buf = Vec::new();
  loop {
    match reader.read_event_into(&mut buf) {
      Ok(quick_xml::events::Event::Empty(ref e))
      | Ok(quick_xml::events::Event::Start(ref e)) => {
        let name = e.name().as_ref().to_vec();
        if name.ends_with(b"rootfile") {
          for attr in e.attributes().flatten() {
            if attr.key.as_ref() == b"full-path" {
              return String::from_utf8(attr.value.to_vec()).map_err(|err| err.to_string());
            }
          }
        }
      }
      Ok(quick_xml::events::Event::Eof) => break,
      Err(err) => return Err(err.to_string()),
      _ => {}
    }
    buf.clear();
  }
  Err("Missing rootfile".to_string())
}

fn rewrite_opf_metadata(opf: &str, changes: &EpubChangeSet) -> Result<String, String> {
  let mut reader = quick_xml::Reader::from_str(opf);
  reader.trim_text(false);
  let mut writer = quick_xml::Writer::new(std::io::Cursor::new(Vec::new()));
  let mut buf = Vec::new();
  let mut in_metadata = false;
  let mut prefix = "dc".to_string();
  let mut replaced_title = false;
  let mut replaced_creator = false;
  let mut replaced_identifier = false;
  let mut replaced_description = false;

  loop {
    match reader.read_event_into(&mut buf) {
      Ok(quick_xml::events::Event::Start(ref e)) => {
        let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
        if name.ends_with("metadata") {
          in_metadata = true;
        } else if in_metadata && name.contains(':') {
          let parts: Vec<&str> = name.split(':').collect();
          if parts.len() == 2 {
            prefix = parts[0].to_string();
          }
        }

        let local = name.split(':').last().unwrap_or(""
        );
        if in_metadata && local == "title" && changes.title.is_some() && !replaced_title {
          writer.write_event(quick_xml::events::Event::Start(e.clone()))
            .map_err(|err| err.to_string())?;
          writer.write_event(quick_xml::events::Event::Text(
            quick_xml::events::BytesText::new(changes.title.as_ref().unwrap()),
          ))
          .map_err(|err| err.to_string())?;
          consume_element(&mut reader, &name)?;
          writer.write_event(quick_xml::events::Event::End(
            quick_xml::events::BytesEnd::new(name.as_str()),
          ))
          .map_err(|err| err.to_string())?;
          replaced_title = true;
        } else if in_metadata && local == "creator" && changes.author.is_some() && !replaced_creator {
          writer.write_event(quick_xml::events::Event::Start(e.clone()))
            .map_err(|err| err.to_string())?;
          writer.write_event(quick_xml::events::Event::Text(
            quick_xml::events::BytesText::new(changes.author.as_ref().unwrap()),
          ))
          .map_err(|err| err.to_string())?;
          consume_element(&mut reader, &name)?;
          writer.write_event(quick_xml::events::Event::End(
            quick_xml::events::BytesEnd::new(name.as_str()),
          ))
          .map_err(|err| err.to_string())?;
          replaced_creator = true;
        } else if in_metadata && local == "identifier" && changes.isbn.is_some() && !replaced_identifier {
          writer.write_event(quick_xml::events::Event::Start(e.clone()))
            .map_err(|err| err.to_string())?;
          writer.write_event(quick_xml::events::Event::Text(
            quick_xml::events::BytesText::new(changes.isbn.as_ref().unwrap()),
          ))
          .map_err(|err| err.to_string())?;
          consume_element(&mut reader, &name)?;
          writer.write_event(quick_xml::events::Event::End(
            quick_xml::events::BytesEnd::new(name.as_str()),
          ))
          .map_err(|err| err.to_string())?;
          replaced_identifier = true;
        } else if in_metadata && local == "description" && changes.description.is_some() && !replaced_description {
          writer.write_event(quick_xml::events::Event::Start(e.clone()))
            .map_err(|err| err.to_string())?;
          writer.write_event(quick_xml::events::Event::Text(
            quick_xml::events::BytesText::new(changes.description.as_ref().unwrap()),
          ))
          .map_err(|err| err.to_string())?;
          consume_element(&mut reader, &name)?;
          writer.write_event(quick_xml::events::Event::End(
            quick_xml::events::BytesEnd::new(name.as_str()),
          ))
          .map_err(|err| err.to_string())?;
          replaced_description = true;
        } else {
          writer.write_event(quick_xml::events::Event::Start(e.clone()))
            .map_err(|err| err.to_string())?;
        }
      }
      Ok(quick_xml::events::Event::End(ref e)) => {
        let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
        if name.ends_with("metadata") {
          if in_metadata {
            if changes.title.is_some() && !replaced_title {
              let tag = format!("{}:title", prefix);
              writer.write_event(quick_xml::events::Event::Start(
                quick_xml::events::BytesStart::new(tag.as_str()),
              ))
              .map_err(|err| err.to_string())?;
              writer.write_event(quick_xml::events::Event::Text(
                quick_xml::events::BytesText::new(changes.title.as_ref().unwrap()),
              ))
              .map_err(|err| err.to_string())?;
              writer.write_event(quick_xml::events::Event::End(
                quick_xml::events::BytesEnd::new(tag.as_str()),
              ))
              .map_err(|err| err.to_string())?;
            }
            if changes.author.is_some() && !replaced_creator {
              let tag = format!("{}:creator", prefix);
              writer.write_event(quick_xml::events::Event::Start(
                quick_xml::events::BytesStart::new(tag.as_str()),
              ))
              .map_err(|err| err.to_string())?;
              writer.write_event(quick_xml::events::Event::Text(
                quick_xml::events::BytesText::new(changes.author.as_ref().unwrap()),
              ))
              .map_err(|err| err.to_string())?;
              writer.write_event(quick_xml::events::Event::End(
                quick_xml::events::BytesEnd::new(tag.as_str()),
              ))
              .map_err(|err| err.to_string())?;
            }
            if changes.isbn.is_some() && !replaced_identifier {
              let tag = format!("{}:identifier", prefix);
              writer.write_event(quick_xml::events::Event::Start(
                quick_xml::events::BytesStart::new(tag.as_str()),
              ))
              .map_err(|err| err.to_string())?;
              writer.write_event(quick_xml::events::Event::Text(
                quick_xml::events::BytesText::new(changes.isbn.as_ref().unwrap()),
              ))
              .map_err(|err| err.to_string())?;
              writer.write_event(quick_xml::events::Event::End(
                quick_xml::events::BytesEnd::new(tag.as_str()),
              ))
              .map_err(|err| err.to_string())?;
            }
            if changes.description.is_some() && !replaced_description {
              let tag = format!("{}:description", prefix);
              writer.write_event(quick_xml::events::Event::Start(
                quick_xml::events::BytesStart::new(tag.as_str()),
              ))
              .map_err(|err| err.to_string())?;
              writer.write_event(quick_xml::events::Event::Text(
                quick_xml::events::BytesText::new(changes.description.as_ref().unwrap()),
              ))
              .map_err(|err| err.to_string())?;
              writer.write_event(quick_xml::events::Event::End(
                quick_xml::events::BytesEnd::new(tag.as_str()),
              ))
              .map_err(|err| err.to_string())?;
            }
          }
          in_metadata = false;
        }
        writer.write_event(quick_xml::events::Event::End(e.clone()))
          .map_err(|err| err.to_string())?;
      }
      Ok(quick_xml::events::Event::Empty(ref e)) => {
        writer.write_event(quick_xml::events::Event::Empty(e.clone()))
          .map_err(|err| err.to_string())?;
      }
      Ok(quick_xml::events::Event::Text(e)) => {
        writer.write_event(quick_xml::events::Event::Text(e.clone()))
          .map_err(|err| err.to_string())?;
      }
      Ok(quick_xml::events::Event::CData(e)) => {
        writer.write_event(quick_xml::events::Event::CData(e.clone()))
          .map_err(|err| err.to_string())?;
      }
      Ok(quick_xml::events::Event::Comment(e)) => {
        writer.write_event(quick_xml::events::Event::Comment(e.clone()))
          .map_err(|err| err.to_string())?;
      }
      Ok(quick_xml::events::Event::Decl(e)) => {
        writer.write_event(quick_xml::events::Event::Decl(e.clone()))
          .map_err(|err| err.to_string())?;
      }
      Ok(quick_xml::events::Event::PI(e)) => {
        writer.write_event(quick_xml::events::Event::PI(e.clone()))
          .map_err(|err| err.to_string())?;
      }
      Ok(quick_xml::events::Event::DocType(e)) => {
        writer.write_event(quick_xml::events::Event::DocType(e.clone()))
          .map_err(|err| err.to_string())?;
      }
      Ok(quick_xml::events::Event::Eof) => break,
      Err(err) => return Err(err.to_string()),
    }
    buf.clear();
  }

  let result = writer.into_inner().into_inner();
  String::from_utf8(result).map_err(|err| err.to_string())
}

fn consume_element(reader: &mut quick_xml::Reader<&[u8]>, name: &str) -> Result<(), String> {
  let mut buf = Vec::new();
  let target = name.as_bytes();
  loop {
    match reader.read_event_into(&mut buf) {
      Ok(quick_xml::events::Event::End(e)) => {
        if e.name().as_ref() == target {
          break;
        }
      }
      Ok(quick_xml::events::Event::Eof) => break,
      Err(err) => return Err(err.to_string()),
      _ => {}
    }
    buf.clear();
  }
  Ok(())
}

fn rewrite_epub_with_opf(path: &str, opf_path: &str, updated_opf: String) -> Result<(), String> {
  let original = std::fs::File::open(path).map_err(|err| err.to_string())?;
  let mut archive = ZipArchive::new(original).map_err(|err| err.to_string())?;
  let temp_path = format!("{}.tmp", path);
  let temp_file = std::fs::File::create(&temp_path).map_err(|err| err.to_string())?;
  let mut writer = zip::ZipWriter::new(temp_file);
  let options = zip::write::FileOptions::<()>::default();

  for i in 0..archive.len() {
    let mut file = archive.by_index(i).map_err(|err| err.to_string())?;
    let name = file.name().to_string();
    let mut data = Vec::new();
    file.read_to_end(&mut data).map_err(|err| err.to_string())?;

    if name == opf_path {
      writer
        .start_file(name, options)
        .map_err(|err| err.to_string())?;
      writer
        .write_all(updated_opf.as_bytes())
        .map_err(|err| err.to_string())?;
    } else {
      writer
        .start_file(name, options)
        .map_err(|err| err.to_string())?;
      writer.write_all(&data).map_err(|err| err.to_string())?;
    }
  }

  writer.finish().map_err(|err| err.to_string())?;
  std::fs::rename(&temp_path, path).map_err(|err| err.to_string())?;
  Ok(())
}

#[tauri::command]
fn get_library_health(app: tauri::AppHandle) -> Result<LibraryHealth, String> {
  let conn = open_db(&app)?;
  let total: i64 = conn
    .query_row("SELECT COUNT(*) FROM items", params![], |row| row.get(0))
    .map_err(|err| err.to_string())?;
  let missing_isbn: i64 = conn
    .query_row(
      "SELECT COUNT(*) FROM items WHERE id NOT IN (SELECT item_id FROM identifiers WHERE type IN ('ISBN10','ISBN13'))",
      params![],
      |row| row.get(0),
    )
    .map_err(|err| err.to_string())?;
  let duplicates: i64 = conn
    .query_row(
      "SELECT COUNT(*) FROM (SELECT sha256 FROM files WHERE sha256 IS NOT NULL GROUP BY sha256 HAVING COUNT(*) > 1)",
      params![],
      |row| row.get(0),
    )
    .map_err(|err| err.to_string())?;
  let complete: i64 = conn
    .query_row(
      "SELECT COUNT(*) FROM items WHERE title IS NOT NULL AND id IN (SELECT item_id FROM item_authors)",
      params![],
      |row| row.get(0),
    )
    .map_err(|err| err.to_string())?;
  let missing_cover: i64 = conn
    .query_row(
      "SELECT COUNT(*) FROM items WHERE id NOT IN (SELECT item_id FROM covers)",
      params![],
      |row| row.get(0),
    )
    .map_err(|err| err.to_string())?;
  Ok(LibraryHealth {
    total,
    missing_isbn,
    duplicates,
    complete,
    missing_cover,
  })
}

/// Clean up a title for search - remove file extensions, special characters, etc.
fn clean_search_title(title: &str) -> String {
  let mut cleaned = title.to_string();

  // Remove common file extensions
  for ext in &[".epub", ".pdf", ".mobi", ".azw", ".azw3", ".fb2", ".djvu"] {
    if cleaned.to_lowercase().ends_with(ext) {
      cleaned = cleaned[..cleaned.len() - ext.len()].to_string();
    }
  }

  // Remove content in brackets that looks like metadata (e.g., "[calibre]", "(z-lib)")
  let bracket_re = Regex::new(r"\s*[\[\(][^\]\)]*(?:calibre|z-lib|epub|pdf|lib\.org|libgen|www\.|http)[^\]\)]*[\]\)]").unwrap();
  cleaned = bracket_re.replace_all(&cleaned, "").to_string();

  // Remove trailing numbers that might be edition numbers in parentheses
  let edition_re = Regex::new(r"\s*\(\d+\)\s*$").unwrap();
  cleaned = edition_re.replace_all(&cleaned, "").to_string();

  // Replace underscores and multiple spaces with single space
  cleaned = cleaned.replace('_', " ");
  let multi_space_re = Regex::new(r"\s+").unwrap();
  cleaned = multi_space_re.replace_all(&cleaned, " ").to_string();

  // Remove leading/trailing whitespace and special characters
  cleaned = cleaned.trim().trim_matches(|c: char| !c.is_alphanumeric() && c != ' ').to_string();

  cleaned
}

/// Clean up author name for search
fn clean_search_author(author: &str) -> Option<String> {
  let cleaned = author.trim();

  // Skip if it looks like garbage (too short, or mostly non-alphabetic)
  if cleaned.len() < 2 {
    return None;
  }

  let alpha_count = cleaned.chars().filter(|c| c.is_alphabetic()).count();
  if alpha_count < cleaned.len() / 2 {
    return None;
  }

  // Skip common garbage patterns
  let lower = cleaned.to_lowercase();
  if lower.contains("unknown") || lower.contains("various") || lower == "author" {
    return None;
  }

  Some(cleaned.to_string())
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
      "SELECT value FROM identifiers WHERE item_id = ?1 AND type IN ('ISBN13','ISBN10','isbn13','isbn10') ORDER BY type = 'ISBN13' DESC LIMIT 1",
      params![item_id],
      |row| row.get(0),
    )
    .optional()
    .map_err(|err| err.to_string())?;

  let mut candidates: Vec<EnrichmentCandidate> = vec![];

  // Strategy 1: Search by ISBN if available
  if let Some(isbn) = isbn {
    candidates.extend(fetch_openlibrary_isbn(&isbn));
    if candidates.is_empty() {
      candidates.extend(fetch_bol_isbn(&isbn));
    }
    candidates.extend(fetch_google_isbn(&isbn));
  }

  // Strategy 2: Search by title (and optionally author)
  if candidates.is_empty() {
    if let Some(title) = &title {
      let clean_title = clean_search_title(title);
      if !clean_title.is_empty() {
        let clean_author = authors.first().and_then(|a| clean_search_author(a));

        // First try: search with title + author
        if clean_author.is_some() {
          candidates.extend(fetch_openlibrary_search(&clean_title, clean_author.as_deref()));
          candidates.extend(fetch_google_search(&clean_title, clean_author.as_deref()));
        }

        // Fallback: if no results with author, try title only
        if candidates.is_empty() {
          candidates.extend(fetch_openlibrary_search(&clean_title, None));
          candidates.extend(fetch_google_search(&clean_title, None));
        }

        candidates = score_candidates(candidates, &clean_title, clean_author.as_deref());
      }
    }
  }

  Ok(candidates)
}

#[tauri::command]
fn search_candidates(
  app: tauri::AppHandle,
  query: String,
  item_id: Option<String>,
) -> Result<Vec<EnrichmentCandidate>, String> {
  let trimmed = query.trim();
  if trimmed.is_empty() {
    if let Some(item_id) = item_id {
      return get_fix_candidates(app, item_id);
    }
    return Ok(vec![]);
  }

  // First check if it's an ISBN
  if let Some(isbn) = normalize_isbn(trimmed) {
    let mut candidates: Vec<EnrichmentCandidate> = vec![];
    candidates.extend(fetch_openlibrary_isbn(&isbn));
    if candidates.is_empty() {
      candidates.extend(fetch_bol_isbn(&isbn));
    }
    candidates.extend(fetch_google_isbn(&isbn));
    candidates
      .sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap_or(std::cmp::Ordering::Equal));
    candidates.truncate(5);
    return Ok(candidates);
  }

  // Clean up the query
  let cleaned_query = clean_search_title(trimmed);
  let (title, author) = parse_search_query(&cleaned_query);

  let mut candidates: Vec<EnrichmentCandidate> = vec![];

  // Search with title + author if parsed
  candidates.extend(fetch_openlibrary_search(&title, author.as_deref()));
  candidates.extend(fetch_google_search(&title, author.as_deref()));

  // If no results and we had an author, try without author
  if candidates.is_empty() && author.is_some() {
    candidates.extend(fetch_openlibrary_search(&title, None));
    candidates.extend(fetch_google_search(&title, None));
  }

  candidates = score_candidates(candidates, &title, author.as_deref());
  candidates.truncate(5);
  Ok(candidates)
}

// OperationProgress and OperationProgress are replaced by OperationProgress
// defined earlier in the file for consistency across all operations.

#[tauri::command]
fn enrich_all(app: tauri::AppHandle) -> Result<(), String> {
  // Reset cancellation flag
  ENRICH_CANCELLED.store(false, Ordering::SeqCst);
  // Spawn the enrichment in a background thread so UI stays responsive
  std::thread::spawn(move || {
    let _ = enrich_all_sync(&app);
  });
  Ok(())
}

#[tauri::command]
fn cancel_enrich() -> Result<(), String> {
  log::info!("Cancelling enrich operation");
  ENRICH_CANCELLED.store(true, Ordering::SeqCst);
  Ok(())
}

// EnrichStats is replaced by OperationStats for consistency

fn enrich_all_sync(app: &tauri::AppHandle) -> Result<OperationStats, String> {
  use tauri::Emitter;

  let conn = open_db(app)?;
  let now = chrono::Utc::now().timestamp_millis();

  // Find all items that need enrichment:
  // - No "real" cover (only generated text covers or no cover at all)
  // - OR missing published_year
  // - OR no authors
  let mut stmt = conn
    .prepare(
      "SELECT DISTINCT items.id, items.title, \
       GROUP_CONCAT(DISTINCT authors.name) as authors, \
       (SELECT value FROM identifiers WHERE item_id = items.id AND type IN ('ISBN13', 'ISBN10') LIMIT 1) as isbn, \
       (SELECT COUNT(*) FROM covers WHERE item_id = items.id AND source != 'generated') as real_cover_count, \
       (SELECT COUNT(*) FROM item_authors WHERE item_id = items.id) as author_count \
       FROM items \
       LEFT JOIN item_authors ON item_authors.item_id = items.id \
       LEFT JOIN authors ON authors.id = item_authors.author_id \
       LEFT JOIN files ON files.item_id = items.id AND files.status = 'active' \
       WHERE files.id IS NOT NULL \
       GROUP BY items.id \
       HAVING real_cover_count = 0 OR author_count = 0 OR items.published_year IS NULL"
    )
    .map_err(|err| err.to_string())?;

  let items: Vec<(String, Option<String>, Option<String>, Option<String>)> = stmt
    .query_map(params![], |row| {
      Ok((
        row.get::<_, String>(0)?,
        row.get::<_, Option<String>>(1)?,
        row.get::<_, Option<String>>(2)?,
        row.get::<_, Option<String>>(3)?,
      ))
    })
    .map_err(|err| err.to_string())?
    .filter_map(|r| r.ok())
    .collect();

  let total = items.len();
  let mut stats = OperationStats {
    total,
    processed: 0,
    skipped: 0,
    errors: 0,
  };

  log::info!("Starting batch enrichment for {} items", total);

  for (idx, (item_id, title, authors, isbn)) in items.into_iter().enumerate() {
    // Check for cancellation
    if ENRICH_CANCELLED.load(Ordering::SeqCst) {
      log::info!("Enrich operation cancelled at item {}/{}", idx + 1, total);
      let _ = app.emit("enrich-cancelled", stats.clone());
      return Ok(stats);
    }

    // Emit progress: searching
    let _ = app.emit("enrich-progress", OperationProgress {
      item_id: item_id.clone(),
      status: "processing".to_string(),
      message: Some("Searching...".to_string()),
      current: idx + 1,
      total,
    });

    // Try to find candidates
    let mut candidates: Vec<EnrichmentCandidate> = vec![];

    // First try ISBN if available
    if let Some(ref isbn_val) = isbn {
      candidates.extend(fetch_openlibrary_isbn(isbn_val));
      if candidates.is_empty() {
        candidates.extend(fetch_bol_isbn(isbn_val));
      }
      if candidates.is_empty() {
        candidates.extend(fetch_google_isbn(isbn_val));
      }
    }

    // If no ISBN results, try title search
    if candidates.is_empty() {
      if let Some(ref title_val) = title {
        let author = authors.as_ref().and_then(|a| a.split(',').next());
        candidates.extend(fetch_openlibrary_search(title_val, author));
        if candidates.is_empty() {
          candidates.extend(fetch_google_search(title_val, author));
        }
      }
    }

    // Score and sort candidates - prefer those with covers
    candidates.sort_by(|a, b| {
      // Prefer candidates with cover URLs
      let a_has_cover = a.cover_url.is_some() as i32;
      let b_has_cover = b.cover_url.is_some() as i32;
      if a_has_cover != b_has_cover {
        return b_has_cover.cmp(&a_has_cover);
      }
      // Then by confidence
      b.confidence.partial_cmp(&a.confidence).unwrap_or(std::cmp::Ordering::Equal)
    });

    // Take the best candidate
    let best = candidates.into_iter().next();

    match best {
      Some(candidate) => {
        // Emit progress: applying
        let _ = app.emit("enrich-progress", OperationProgress {
          item_id: item_id.clone(),
          status: "processing".to_string(),
          message: candidate.title.clone(),
          current: idx + 1,
          total,
        });

        // Apply the candidate
        match apply_enrichment_for_batch(app, &conn, &item_id, &candidate, now) {
          Ok(()) => {
            stats.processed += 1;
            let _ = app.emit("enrich-progress", OperationProgress {
              item_id: item_id.clone(),
              status: "done".to_string(),
              message: candidate.title,
              current: idx + 1,
              total,
            });
          }
          Err(err) => {
            stats.errors += 1;
            log::warn!("Failed to apply enrichment for {}: {}", item_id, err);
            let _ = app.emit("enrich-progress", OperationProgress {
              item_id: item_id.clone(),
              status: "error".to_string(),
              message: Some(err),
              current: idx + 1,
              total,
            });
          }
        }
      }
      None => {
        stats.skipped += 1;
        let _ = app.emit("enrich-progress", OperationProgress {
          item_id: item_id.clone(),
          status: "skipped".to_string(),
          message: Some("No matches found".to_string()),
          current: idx + 1,
          total,
        });
      }
    }

    // Small delay to avoid rate limiting
    std::thread::sleep(std::time::Duration::from_millis(200));
  }

  log::info!("Batch enrichment complete: {:?}", stats);
  let _ = app.emit("enrich-complete", stats.clone());
  Ok(stats)
}

fn apply_enrichment_for_batch(
  app: &tauri::AppHandle,
  conn: &Connection,
  item_id: &str,
  candidate: &EnrichmentCandidate,
  now: i64,
) -> Result<(), String> {
  apply_enrichment_candidate(app, conn, item_id, candidate, now)?;
  let _ = queue_epub_changes(conn, item_id, candidate, now);

  // Try to fetch cover
  let mut cover_fetched = false;
  if let Some(url) = candidate.cover_url.as_deref() {
    cover_fetched = fetch_cover_from_url(app, conn, item_id, url, now).unwrap_or(false);
  }
  if !cover_fetched {
    let _ = fetch_cover_fallback(app, conn, item_id, now);
  }

  conn.execute(
    "UPDATE issues SET resolved_at = ?1 WHERE item_id = ?2 AND type = 'missing_metadata' AND resolved_at IS NULL",
    params![now, item_id],
  )
  .map_err(|err| err.to_string())?;

  Ok(())
}

/// Progress payload for single-item metadata apply
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ApplyMetadataProgress {
  item_id: String,
  step: String,
  message: String,
  current: usize,
  total: usize,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ItemMetadata {
  title: Option<String>,
  authors: Vec<String>,
  published_year: Option<i64>,
  language: Option<String>,
  isbn: Option<String>,
  series: Option<String>,
  series_index: Option<f64>,
  description: Option<String>,
}

#[tauri::command]
fn apply_fix_candidate(
  app: tauri::AppHandle,
  item_id: String,
  candidate: EnrichmentCandidate,
) -> Result<(), String> {
  use tauri::Emitter;

  let conn = open_db(&app)?;
  let now = chrono::Utc::now().timestamp_millis();
  log::info!("applying fix candidate for item {}: {:?}", item_id, candidate.title);

  // Step 1: Update metadata
  let _ = app.emit("apply-metadata-progress", ApplyMetadataProgress {
    item_id: item_id.clone(),
    step: "metadata".to_string(),
    message: "Updating metadata...".to_string(),
    current: 1,
    total: 4,
  });
  apply_enrichment_candidate(&app, &conn, &item_id, &candidate, now)?;

  // Step 2: Queue file changes
  let _ = app.emit("apply-metadata-progress", ApplyMetadataProgress {
    item_id: item_id.clone(),
    step: "queue".to_string(),
    message: "Queueing file changes...".to_string(),
    current: 2,
    total: 4,
  });
  let queued = queue_epub_changes(&conn, &item_id, &candidate, now)?;
  log::info!("queued epub changes: {} for item {}", queued, item_id);
  conn.execute(
    "UPDATE issues SET resolved_at = ?1 WHERE item_id = ?2 AND type = 'missing_metadata' AND resolved_at IS NULL",
    params![now, item_id],
  )
  .map_err(|err| err.to_string())?;

  // Step 3: Fetch cover
  let _ = app.emit("apply-metadata-progress", ApplyMetadataProgress {
    item_id: item_id.clone(),
    step: "cover".to_string(),
    message: "Fetching cover...".to_string(),
    current: 3,
    total: 4,
  });
  let mut cover_fetched = false;
  if let Some(url) = candidate.cover_url.as_deref() {
    cover_fetched = fetch_cover_from_url(&app, &conn, &item_id, url, now)?;
  }

  // Step 4: Fallback cover if needed
  if !cover_fetched {
    let _ = app.emit("apply-metadata-progress", ApplyMetadataProgress {
      item_id: item_id.clone(),
      step: "cover-fallback".to_string(),
      message: "Trying alternative cover sources...".to_string(),
      current: 4,
      total: 4,
    });
    log::info!("trying cover fallback for item {}", item_id);
    let _ = fetch_cover_fallback(&app, &conn, &item_id, now);
  }

  if let Err(err) = embed_latest_cover_into_epub(&conn, &item_id) {
    log::warn!("failed to embed cover after applying candidate {}: {}", item_id, err);
  }

  // Done
  let _ = app.emit("apply-metadata-progress", ApplyMetadataProgress {
    item_id: item_id.clone(),
    step: "done".to_string(),
    message: "Complete".to_string(),
    current: 4,
    total: 4,
  });

  log::info!("fix candidate applied for item {}", item_id);
  Ok(())
}

#[tauri::command]
fn save_item_metadata(
  app: tauri::AppHandle,
  item_id: String,
  metadata: ItemMetadata,
) -> Result<(), String> {
  let conn = open_db(&app)?;
  let now = chrono::Utc::now().timestamp_millis();
  let description = normalize_optional_description(metadata.description.clone());
  log::info!("saving manual metadata for item {}: {:?}", item_id, metadata.title);

  // Update items table
  conn.execute(
    "UPDATE items SET title = ?1, published_year = ?2, language = ?3, series = ?4, series_index = ?5, description = ?6, updated_at = ?7 WHERE id = ?8",
    params![
      metadata.title,
      metadata.published_year,
      metadata.language,
      metadata.series,
      metadata.series_index,
      description,
      now,
      item_id
    ],
  )
  .map_err(|err| err.to_string())?;

  // Update authors
  if !metadata.authors.is_empty() {
    conn
      .execute("DELETE FROM item_authors WHERE item_id = ?1", params![item_id])
      .map_err(|err| err.to_string())?;

    for author in &metadata.authors {
      let author_id: Option<String> = conn
        .query_row(
          "SELECT id FROM authors WHERE name = ?1",
          params![author],
          |row| row.get(0),
        )
        .optional()
        .map_err(|err| err.to_string())?;

      let author_id = match author_id {
        Some(id) => id,
        None => {
          let new_id = uuid::Uuid::new_v4().to_string();
          conn
            .execute(
              "INSERT INTO authors (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
              params![new_id, author, now, now],
            )
            .map_err(|err| err.to_string())?;
          new_id
        }
      };

      conn
        .execute(
          "INSERT OR IGNORE INTO item_authors (item_id, author_id) VALUES (?1, ?2)",
          params![item_id, author_id],
        )
        .map_err(|err| err.to_string())?;
    }
  }

  // Update ISBN in identifiers table
  if let Some(isbn) = &metadata.isbn {
    let raw = isbn.trim();
    if !raw.is_empty() {
      let normalized = normalize_isbn(raw);

      // Remove old ISBN-ish identifiers
      conn
        .execute(
          "DELETE FROM identifiers WHERE item_id = ?1 AND type IN ('ISBN10','ISBN13','OTHER','isbn10','isbn13','other')",
          params![item_id],
        )
        .map_err(|err| err.to_string())?;

      // Add new ISBN (or store as OTHER if not valid length)
      let (isbn_type, value) = match normalized {
        Some(value) if value.len() == 13 => ("ISBN13", value),
        Some(value) if value.len() == 10 => ("ISBN10", value),
        Some(value) => ("OTHER", value),
        None => ("OTHER", raw.to_string()),
      };
      let identifier_id = uuid::Uuid::new_v4().to_string();
      conn
        .execute(
          "INSERT INTO identifiers (id, item_id, type, value, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
          params![identifier_id, item_id, isbn_type, value, now],
        )
        .map_err(|err| err.to_string())?;
    }
  }

  let queued_epub_changes = queue_epub_changes_for_item(
    &conn,
    &item_id,
    &EpubChangeSet {
      title: metadata.title.clone(),
      author: metadata.authors.first().cloned(),
      isbn: metadata
        .isbn
        .as_ref()
        .and_then(|raw| normalize_isbn(raw).or_else(|| Some(raw.trim().to_string())))
        .filter(|value| !value.is_empty()),
      description: Some(description.clone().unwrap_or_default()),
    },
    now,
  )?;
  if queued_epub_changes > 0 {
    log::info!(
      "queued epub metadata changes for {} files after manual save of item {}",
      queued_epub_changes,
      item_id
    );
  }

  if let Ok(false) = has_cover(&conn, &item_id) {
    let _ = fetch_cover_fallback(&app, &conn, &item_id, now);
  }

  if let Ok(false) = has_cover(&conn, &item_id) {
    let title: String = conn
      .query_row("SELECT title FROM items WHERE id = ?1", params![item_id], |row| row.get(0))
      .unwrap_or_else(|_| "Untitled".to_string());
    let author: String = conn
      .query_row(
        "SELECT GROUP_CONCAT(a.name, ', ') FROM authors a JOIN item_authors ia ON ia.author_id = a.id WHERE ia.item_id = ?1",
        params![item_id],
        |row| row.get::<_, Option<String>>(0),
      )
      .unwrap_or(None)
      .unwrap_or_else(|| "Unknown".to_string());
    if let Ok(bytes) = crate::generate_text_cover(&title, &author) {
      let _ = crate::save_cover(&app, &conn, &item_id, bytes, "png", now, "generated", None);
    }
  }

  if let Err(err) = embed_latest_cover_into_epub(&conn, &item_id) {
    log::warn!("failed to embed cover after manual save {}: {}", item_id, err);
  }

  let cover_count: i64 = conn
    .query_row(
      "SELECT COUNT(*) FROM covers WHERE item_id = ?1",
      params![item_id],
      |row| row.get(0),
    )
    .unwrap_or(0);
  let author_count: i64 = conn
    .query_row(
      "SELECT COUNT(*) FROM item_authors WHERE item_id = ?1",
      params![item_id],
      |row| row.get(0),
    )
    .unwrap_or(0);
  let isbn_count: i64 = conn
    .query_row(
      "SELECT COUNT(*) FROM identifiers WHERE item_id = ?1 AND type IN ('ISBN10','ISBN13','OTHER','isbn10','isbn13','other')",
      params![item_id],
      |row| row.get(0),
    )
    .unwrap_or(0);
  let title_missing: bool = conn
    .query_row(
      "SELECT title IS NULL FROM items WHERE id = ?1",
      params![item_id],
      |row| row.get(0),
    )
    .unwrap_or(false);
  log::info!(
    "post-save metadata snapshot item {}: title_missing={}, author_count={}, isbn_count={}, cover_count={}",
    item_id,
    title_missing,
    author_count,
    isbn_count,
    cover_count
  );

  // Mark issues as resolved
  conn.execute(
    "UPDATE issues SET resolved_at = ?1 WHERE item_id = ?2 AND type = 'missing_metadata' AND resolved_at IS NULL",
    params![now, item_id],
  )
  .map_err(|err| err.to_string())?;
  log::info!("resolved missing_metadata issues for item {}", item_id);

  Ok(())
}

fn normalize_title_snapshot(value: &str) -> String {
  value
    .split_whitespace()
    .collect::<Vec<_>>()
    .join(" ")
    .trim()
    .to_lowercase()
}

#[tauri::command]
fn get_title_cleanup_ignores(app: tauri::AppHandle) -> Result<Vec<TitleCleanupIgnore>, String> {
  let conn = open_db(&app)?;
  let mut stmt = conn
    .prepare("SELECT item_id, title_snapshot FROM title_cleanup_ignores")
    .map_err(|err| err.to_string())?;

  let rows = stmt
    .query_map([], |row| {
      Ok(TitleCleanupIgnore {
        item_id: row.get(0)?,
        title_snapshot: row.get(1)?,
      })
    })
    .map_err(|err| err.to_string())?;

  let mut ignores = Vec::new();
  for row in rows {
    ignores.push(row.map_err(|err| err.to_string())?);
  }
  Ok(ignores)
}

#[tauri::command]
fn set_title_cleanup_ignored(
  app: tauri::AppHandle,
  item_id: String,
  title_snapshot: String,
  ignored: bool,
) -> Result<(), String> {
  let conn = open_db(&app)?;
  if ignored {
    let snapshot = normalize_title_snapshot(&title_snapshot);
    if snapshot.is_empty() {
      return Err("Title snapshot is empty".to_string());
    }
    conn
      .execute(
        "INSERT INTO title_cleanup_ignores (item_id, title_snapshot, created_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(item_id) DO UPDATE SET title_snapshot = excluded.title_snapshot, created_at = excluded.created_at",
        params![item_id, snapshot, chrono::Utc::now().timestamp_millis()],
      )
      .map_err(|err| err.to_string())?;
    return Ok(());
  }

  conn
    .execute(
      "DELETE FROM title_cleanup_ignores WHERE item_id = ?1",
      params![item_id],
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
    let proposed_target = std::path::Path::new(&library_root).join(&relative);
    let proposed_target_str = proposed_target.to_string_lossy().to_string();
    let source_canon = std::fs::canonicalize(&source_path).ok();
    let target_canon = std::fs::canonicalize(&proposed_target).ok();
    let source_path_buf = std::path::Path::new(&source_path);
    let library_root_buf = std::path::Path::new(&library_root);
    let expected_parent = proposed_target.parent();
    let source_parent = source_path_buf.parent();
    let expected_stem = proposed_target.file_stem().and_then(|value| value.to_str());
    let source_stem = source_path_buf.file_stem().and_then(|value| value.to_str());
    let source_stem_base = source_stem.and_then(|value| {
      Regex::new(r"^(.*)\s\[(\d+)\]$")
        .ok()
        .and_then(|re| re.captures(value))
        .and_then(|caps| caps.get(1))
        .map(|m| m.as_str().to_string())
    });
    let same_under_root = source_path_buf
      .strip_prefix(library_root_buf)
      .ok()
      .and_then(|rel_path| {
        let expected_rel = std::path::Path::new(&relative);
        let rel_parent = rel_path.parent();
        let expected_parent = expected_rel.parent();
        let rel_stem = rel_path.file_stem().and_then(|value| value.to_str());
        let rel_stem_base = rel_stem.and_then(|value| {
          Regex::new(r"^(.*)\s\[(\d+)\]$")
            .ok()
            .and_then(|re| re.captures(value))
            .and_then(|caps| caps.get(1))
            .map(|m| m.as_str().to_string())
        });
        let expected_stem = expected_rel.file_stem().and_then(|value| value.to_str());
        if rel_parent == expected_parent {
          if rel_stem == expected_stem || rel_stem_base.as_deref() == expected_stem {
            return Some(true);
          }
        }
        None
      })
      .unwrap_or(false);
    let mut action = if mode == "reference" {
      "skip"
    } else if mode == "copy" {
      "copy"
    } else {
      "move"
    };
    let same_path = source_path == proposed_target_str
      || (source_canon.is_some() && source_canon == target_canon)
      || (expected_parent.is_some()
        && source_parent.is_some()
        && expected_parent == source_parent
        && expected_stem.is_some()
        && (source_stem == expected_stem
          || source_stem_base.as_deref() == expected_stem));
    let target = if same_path || same_under_root {
      action = "skip";
      proposed_target_str
    } else {
      resolve_collision(&library_root, &relative)
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
fn generate_pending_changes_from_organize(
  app: tauri::AppHandle,
  plan: OrganizePlan,
) -> Result<i64, String> {
  let conn = open_db(&app)?;
  let now = chrono::Utc::now().timestamp_millis();
  let mut created = 0i64;
  for entry in plan.entries {
    if entry.action == "skip" {
      continue;
    }
    let id = Uuid::new_v4().to_string();
    conn.execute(
      "INSERT INTO pending_changes (id, file_id, type, from_path, to_path, changes_json, status, created_at) \
       VALUES (?1, ?2, 'rename', ?3, ?4, NULL, 'pending', ?5)",
      params![id, entry.file_id, entry.source_path, entry.target_path, now],
    )
    .map_err(|err| err.to_string())?;
    created += 1;
  }
  Ok(created)
}

#[tauri::command]
fn apply_organize(app: tauri::AppHandle, plan: OrganizePlan) -> Result<String, String> {
  let conn = open_db(&app)?;
  let now = chrono::Utc::now().timestamp_millis();
  let mut log_entries: Vec<OrganizerLogEntry> = vec![];
  let mut errors = 0i64;
  let total = plan.entries.iter().filter(|entry| entry.action != "skip").count();
  let mut handled = 0usize;
  let mut stats = OperationStats {
    total,
    processed: 0,
    skipped: 0,
    errors: 0,
  };

  for entry in &plan.entries {
    if entry.action == "skip" {
      stats.skipped += 1;
      continue;
    }
    handled += 1;
    let _ = app.emit(
      "organize-progress",
      OperationProgress {
        item_id: entry.file_id.clone(),
        status: "processing".to_string(),
        message: Some(entry.source_path.clone()),
        current: handled,
        total,
      },
    );
    let source_path = std::path::Path::new(&entry.source_path);
    if !source_path.exists() {
      let target_path = std::path::Path::new(&entry.target_path);
      if target_path.exists() {
        let filename = target_path
          .file_name()
          .and_then(|value| value.to_str())
          .unwrap_or("file")
          .to_string();
        let extension = target_path
          .extension()
          .and_then(|value| value.to_str())
          .map(|value| format!(".{}", value.to_lowercase()))
          .unwrap_or_default();
        let _ = conn.execute(
          "UPDATE files SET path = ?1, filename = ?2, extension = ?3, updated_at = ?4, status = 'active' WHERE id = ?5",
          params![entry.target_path, filename, extension, now, entry.file_id],
        );
        stats.processed += 1;
        log_entries.push(OrganizerLogEntry {
          action: entry.action.clone(),
          from: entry.source_path.clone(),
          to: entry.target_path.clone(),
          timestamp: now,
          error: None,
        });
        let _ = app.emit(
          "organize-progress",
          OperationProgress {
            item_id: entry.file_id.clone(),
            status: "done".to_string(),
            message: Some("Already moved".to_string()),
            current: handled,
            total,
          },
        );
        continue;
      }
      errors += 1;
      stats.errors += 1;
      let _ = conn.execute(
        "UPDATE files SET status = 'missing', updated_at = ?1 WHERE id = ?2",
        params![now, entry.file_id],
      );
      log_entries.push(OrganizerLogEntry {
        action: entry.action.clone(),
        from: entry.source_path.clone(),
        to: entry.target_path.clone(),
        timestamp: now,
        error: Some("Source file missing".to_string()),
      });
      let _ = app.emit(
        "organize-progress",
        OperationProgress {
          item_id: entry.file_id.clone(),
          status: "error".to_string(),
          message: Some("Source file missing".to_string()),
          current: handled,
          total,
        },
      );
      continue;
    }
    let target_dir = std::path::Path::new(&entry.target_path)
      .parent()
      .ok_or("Invalid target path")?;
    if let Err(err) = std::fs::create_dir_all(target_dir) {
      errors += 1;
      stats.errors += 1;
      log_entries.push(OrganizerLogEntry {
        action: entry.action.clone(),
        from: entry.source_path.clone(),
        to: entry.target_path.clone(),
        timestamp: now,
        error: Some(format!("Failed to create target dir: {}", err)),
      });
      let _ = app.emit(
        "organize-progress",
        OperationProgress {
          item_id: entry.file_id.clone(),
          status: "error".to_string(),
          message: Some("Failed to create target dir".to_string()),
          current: handled,
          total,
        },
      );
      continue;
    }

    if entry.action == "copy" {
      if let Err(err) = std::fs::copy(&entry.source_path, &entry.target_path) {
        errors += 1;
        stats.errors += 1;
        log_entries.push(OrganizerLogEntry {
          action: entry.action.clone(),
          from: entry.source_path.clone(),
          to: entry.target_path.clone(),
          timestamp: now,
          error: Some(format!("Failed to copy: {}", err)),
        });
        let _ = app.emit(
          "organize-progress",
          OperationProgress {
            item_id: entry.file_id.clone(),
            status: "error".to_string(),
            message: Some("Failed to copy".to_string()),
            current: handled,
            total,
          },
        );
        continue;
      }
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
      // Move operation: try rename first, fall back to copy+delete for cross-filesystem moves
      let move_result = std::fs::rename(&entry.source_path, &entry.target_path);
      if move_result.is_err() {
        // Fallback: copy then delete original
        if let Err(err) = std::fs::copy(&entry.source_path, &entry.target_path) {
          errors += 1;
          stats.errors += 1;
          log_entries.push(OrganizerLogEntry {
            action: entry.action.clone(),
            from: entry.source_path.clone(),
            to: entry.target_path.clone(),
            timestamp: now,
            error: Some(format!("Failed to copy: {}", err)),
          });
          let _ = app.emit(
            "organize-progress",
            OperationProgress {
              item_id: entry.file_id.clone(),
              status: "error".to_string(),
              message: Some("Failed to copy".to_string()),
              current: handled,
              total,
            },
          );
          continue;
        }
        if let Err(err) = std::fs::remove_file(&entry.source_path) {
          errors += 1;
          stats.errors += 1;
          log_entries.push(OrganizerLogEntry {
            action: entry.action.clone(),
            from: entry.source_path.clone(),
            to: entry.target_path.clone(),
            timestamp: now,
            error: Some(format!("Failed to remove original: {}", err)),
          });
          let _ = app.emit(
            "organize-progress",
            OperationProgress {
              item_id: entry.file_id.clone(),
              status: "error".to_string(),
              message: Some("Failed to remove original".to_string()),
              current: handled,
              total,
            },
          );
          continue;
        }
      }
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

    log_entries.push(OrganizerLogEntry {
      action: entry.action.clone(),
      from: entry.source_path.clone(),
      to: entry.target_path.clone(),
      timestamp: now,
      error: None,
    });
    stats.processed += 1;
    let _ = app.emit(
      "organize-progress",
      OperationProgress {
        item_id: entry.file_id.clone(),
        status: "done".to_string(),
        message: Some(entry.target_path.clone()),
        current: handled,
        total,
      },
    );
  }

  let log_id = Uuid::new_v4().to_string();
  let entries_json = serde_json::to_string(&log_entries).map_err(|err| err.to_string())?;
  conn.execute(
    "INSERT INTO organizer_logs (id, created_at, processed, errors, entries_json) VALUES (?1, ?2, ?3, ?4, ?5)",
    params![log_id, now, stats.processed as i64, stats.errors as i64, entries_json],
  )
  .map_err(|err| err.to_string())?;

  if errors > 0 {
    log::warn!("organize completed with {} errors", errors);
  }
  let _ = app.emit("organize-complete", stats.clone());
  Ok(log_id)
}

#[tauri::command]
fn clear_library(app: tauri::AppHandle) -> Result<(), String> {
  let conn = open_db(&app)?;
  conn.execute_batch(
    "PRAGMA foreign_keys = OFF;\n\
     BEGIN IMMEDIATE;\n\
     DELETE FROM scan_entries;\n\
     DELETE FROM scan_sessions;\n\
     DELETE FROM issues;\n\
     DELETE FROM enrichment_results;\n\
     DELETE FROM enrichment_sources;\n\
     DELETE FROM identifiers;\n\
     DELETE FROM item_tags;\n\
     DELETE FROM tags;\n\
     DELETE FROM item_authors;\n\
     DELETE FROM authors;\n\
     DELETE FROM files;\n\
     DELETE FROM items;\n\
     COMMIT;\n\
     PRAGMA foreign_keys = ON;"
  )
  .map_err(|err| err.to_string())?;
  conn.execute_batch("VACUUM;").map_err(|err| err.to_string())?;
  Ok(())
}

#[tauri::command]
fn normalize_item_descriptions(app: tauri::AppHandle) -> Result<DescriptionCleanupResult, String> {
  let conn = open_db(&app)?;
  let now = chrono::Utc::now().timestamp_millis();
  let mut stmt = conn
    .prepare("SELECT id, description FROM items WHERE description IS NOT NULL")
    .map_err(|err| err.to_string())?;
  let rows = stmt
    .query_map(params![], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
    .map_err(|err| err.to_string())?;

  let mut updates: Vec<(String, Option<String>)> = Vec::new();
  for row in rows {
    let (item_id, description) = row.map_err(|err| err.to_string())?;
    let normalized = normalize_optional_description(Some(description.clone()));
    if normalized.as_deref() != Some(description.as_str()) {
      updates.push((item_id, normalized));
    }
  }

  let mut changed = 0i64;
  let mut queued = 0i64;
  for (item_id, description) in updates {
    conn.execute(
      "UPDATE items SET description = ?1, updated_at = ?2 WHERE id = ?3",
      params![description, now, item_id],
    )
    .map_err(|err| err.to_string())?;
    changed += 1;

    queued += queue_epub_changes_for_item(
      &conn,
      &item_id,
      &EpubChangeSet {
        title: None,
        author: None,
        isbn: None,
        description: Some(description.unwrap_or_default()),
      },
      now,
    )?;
  }

  Ok(DescriptionCleanupResult {
    items_updated: changed,
    files_queued: queued,
  })
}

#[tauri::command]
async fn scan_folder(app: tauri::AppHandle, root: String) -> Result<ScanStats, String> {
  let app_handle = app.clone();
  let result = tauri::async_runtime::spawn_blocking(move || scan_folder_sync(app_handle, root))
    .await
    .map_err(|err| err.to_string())?;

  match result {
    Ok(stats) => Ok(stats),
    Err(message) => {
      log::error!("scan failed: {}", message);
      let _ = app.emit("scan-error", &message);
      Err(message)
    }
  }
}

fn scan_folder_sync(app: tauri::AppHandle, root: String) -> Result<ScanStats, String> {
  let conn = open_db(&app)?;
  ensure_covers_table(&conn)?;
  let mut processed = 0usize;
  let mut stats = ScanStats {
    added: 0,
    updated: 0,
    moved: 0,
    unchanged: 0,
    missing: 0,
  };

  let _ = app.emit(
    "scan-progress",
    ScanProgressPayload {
      processed,
      total: 0,
      current: "Preparing scan...".to_string(),
    },
  );

  let total = count_scan_targets(&root) as usize;
  let _ = app.emit(
    "scan-progress",
    ScanProgressPayload {
      processed,
      total,
      current: "Starting scan...".to_string(),
    },
  );

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

    processed += 1;
    let filename = path
      .file_name()
      .and_then(|value| value.to_str())
      .unwrap_or("file")
      .to_string();
    let _ = app.emit(
      "scan-progress",
      ScanProgressPayload {
        processed,
        total,
        current: filename,
      },
    );

    let path_str = path.to_string_lossy().to_string();
    seen_paths.insert(path_str.clone());
    let metadata = entry.metadata().map_err(|err| err.to_string())?;
    let size_bytes = metadata.len() as i64;
    let modified_at = metadata
      .modified()
      .ok()
      .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
      .map(|value| value.as_millis() as i64);

    let existing_by_path: Option<(String, Option<i64>, Option<i64>, String)> = conn
      .query_row(
        "SELECT id, modified_at, size_bytes, status FROM files WHERE path = ?1 AND status != 'inactive'",
        params![path_str],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
      )
      .optional()
      .map_err(|err| err.to_string())?;

    if let Some((file_id, existing_mtime, existing_size, existing_status)) = existing_by_path.clone() {
      if existing_mtime == modified_at && existing_size == Some(size_bytes) {
        if existing_status == "missing" {
          conn.execute(
            "UPDATE files SET status = 'active', updated_at = ?1 WHERE id = ?2",
            params![now, file_id],
          )
          .map_err(|err| err.to_string())?;
        }
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
        "SELECT id, path FROM files \
         WHERE sha256 = ?1 AND hash_algo = 'sha256' AND status != 'inactive' \
         ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'missing' THEN 1 ELSE 2 END, updated_at DESC \
         LIMIT 1",
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

    if let Some((file_id, _, _, _)) = existing_by_path {
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
      if ext == ".epub" {
        match crate::extract_epub_cover(path) {
          Ok(Some((bytes, extension))) => {
            log::info!("epub cover found: {}", path_str);
            let _ = crate::save_cover(
              &app,
              &conn,
              &item_id,
              bytes,
              &extension,
              now,
              "embedded",
              None,
            );
          }
          Ok(None) => {
            log::info!("epub cover missing, generating text cover: {}", path_str);
            // Generate text-based cover as fallback
            let title: String = conn
              .query_row("SELECT title FROM items WHERE id = ?1", params![item_id], |row| row.get(0))
              .unwrap_or_else(|_| "Untitled".to_string());
            let author: String = conn
              .query_row(
                "SELECT GROUP_CONCAT(a.name, ', ') FROM authors a JOIN item_authors ia ON ia.author_id = a.id WHERE ia.item_id = ?1",
                params![item_id],
                |row| row.get::<_, Option<String>>(0),
              )
              .unwrap_or(None)
              .unwrap_or_else(|| "Unknown".to_string());
            if let Ok(bytes) = crate::generate_text_cover(&title, &author) {
              let _ = crate::save_cover(&app, &conn, &item_id, bytes, "png", now, "generated", None);
              log::info!("generated text cover for: {}", path_str);
            }
          }
          Err(error) => {
            log::warn!("epub cover error {}: {}", path_str, error);
          }
        }
      }
      if let Ok(false) = has_cover(&conn, &item_id) {
        let _ = fetch_cover_fallback(&app, &conn, &item_id, now);
      }
      // Final fallback: generate text cover if still no cover
      if let Ok(false) = has_cover(&conn, &item_id) {
        log::info!("generating text cover as final fallback for existing item: {}", path_str);
        let title: String = conn
          .query_row("SELECT title FROM items WHERE id = ?1", params![item_id], |row| row.get(0))
          .unwrap_or_else(|_| "Untitled".to_string());
        let author: String = conn
          .query_row(
            "SELECT GROUP_CONCAT(a.name, ', ') FROM authors a JOIN item_authors ia ON ia.author_id = a.id WHERE ia.item_id = ?1",
            params![item_id],
            |row| row.get::<_, Option<String>>(0),
          )
          .unwrap_or(None)
          .unwrap_or_else(|| "Unknown".to_string());
        if let Ok(bytes) = crate::generate_text_cover(&title, &author) {
          let _ = crate::save_cover(&app, &conn, &item_id, bytes, "png", now, "generated", None);
          log::info!("generated text cover for existing item: {}", path_str);
        }
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
      if ext == ".epub" {
        match crate::extract_epub_cover(path) {
          Ok(Some((bytes, extension))) => {
            log::info!("epub cover found: {}", path_str);
            let _ = crate::save_cover(
              &app,
              &conn,
              &item_id,
              bytes,
              &extension,
              now,
              "embedded",
              None,
            );
          }
          Ok(None) => {
            log::info!("epub cover missing, generating text cover: {}", path_str);
            // Generate text-based cover as fallback
            let title: String = conn
              .query_row("SELECT title FROM items WHERE id = ?1", params![item_id], |row| row.get(0))
              .unwrap_or_else(|_| "Untitled".to_string());
            let author: String = conn
              .query_row(
                "SELECT GROUP_CONCAT(a.name, ', ') FROM authors a JOIN item_authors ia ON ia.author_id = a.id WHERE ia.item_id = ?1",
                params![item_id],
                |row| row.get::<_, Option<String>>(0),
              )
              .unwrap_or(None)
              .unwrap_or_else(|| "Unknown".to_string());
            if let Ok(bytes) = crate::generate_text_cover(&title, &author) {
              let _ = crate::save_cover(&app, &conn, &item_id, bytes, "png", now, "generated", None);
              log::info!("generated text cover for: {}", path_str);
            }
          }
          Err(error) => {
            log::warn!("epub cover error {}: {}", path_str, error);
          }
        }
      }
    if let Ok(false) = has_cover(&conn, &item_id) {
      let _ = fetch_cover_fallback(&app, &conn, &item_id, now);
    }
    // Final fallback: generate text cover if still no cover
    if let Ok(false) = has_cover(&conn, &item_id) {
      log::info!("generating text cover as final fallback for new item: {}", path_str);
      let title: String = conn
        .query_row("SELECT title FROM items WHERE id = ?1", params![item_id], |row| row.get(0))
        .unwrap_or_else(|_| "Untitled".to_string());
      let author: String = conn
        .query_row(
          "SELECT GROUP_CONCAT(a.name, ', ') FROM authors a JOIN item_authors ia ON ia.author_id = a.id WHERE ia.item_id = ?1",
          params![item_id],
          |row| row.get::<_, Option<String>>(0),
        )
        .unwrap_or(None)
        .unwrap_or_else(|| "Unknown".to_string());
      if let Ok(bytes) = crate::generate_text_cover(&title, &author) {
        let _ = crate::save_cover(&app, &conn, &item_id, bytes, "png", now, "generated", None);
        log::info!("generated text cover for new item: {}", path_str);
      }
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

  let _ = app.emit("scan-complete", &stats);

  Ok(stats)
}

#[tauri::command]
fn close_splashscreen(app: tauri::AppHandle) -> Result<(), String> {
  // Close the splash screen
  if let Some(splash) = app.get_webview_window("splashscreen") {
    let _ = splash.close();
  }

  // Show the main window
  if let Some(main) = app.get_webview_window("main") {
    let _ = main.show();
    let _ = main.set_focus();
  }

  Ok(())
}

#[tauri::command]
fn upload_cover(
  app: tauri::AppHandle,
  item_id: String,
  path: String,
) -> Result<(), String> {
  let conn = open_db(&app)?;
  let now = chrono::Utc::now().timestamp_millis();
  let bytes = std::fs::read(&path).map_err(|err| err.to_string())?;
  let extension = std::path::Path::new(&path)
    .extension()
    .and_then(|ext| ext.to_str())
    .unwrap_or("png")
    .to_string();

  save_cover(&app, &conn, &item_id, bytes, &extension, now, "manual", None)?;
  if let Err(err) = embed_latest_cover_into_epub(&conn, &item_id) {
    log::warn!("failed to embed manual cover into epub {}: {}", item_id, err);
  }

  Ok(())
}

#[tauri::command]
fn get_organizer_settings(app: tauri::AppHandle) -> Result<OrganizerSettings, String> {
  let conn = open_db(&app)?;
  let row: Option<(Option<String>, Option<String>, Option<String>)> = conn
    .query_row(
      "SELECT library_root, mode, template FROM organizer_settings WHERE id = 1",
      [],
      |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .optional()
    .map_err(|err| err.to_string())?;
  let (library_root, mode, template) = match row {
    Some(value) => value,
    None => (None, None, None),
  };
  Ok(OrganizerSettings {
    library_root,
    mode: mode.unwrap_or_else(|| "copy".to_string()),
    template: template.unwrap_or_else(|| "{Author}/{Title} ({Year}) [{ISBN13}].{ext}".to_string()),
  })
}

#[tauri::command]
fn set_organizer_settings(app: tauri::AppHandle, settings: OrganizerSettings) -> Result<(), String> {
  let conn = open_db(&app)?;
  let now = chrono::Utc::now().timestamp_millis();
  conn.execute(
    "INSERT INTO organizer_settings (id, library_root, mode, template, updated_at) \
     VALUES (1, ?1, ?2, ?3, ?4) \
     ON CONFLICT(id) DO UPDATE SET library_root = excluded.library_root, mode = excluded.mode, template = excluded.template, updated_at = excluded.updated_at",
    params![settings.library_root, settings.mode, settings.template, now],
  )
  .map_err(|err| err.to_string())?;
  Ok(())
}

#[tauri::command]
fn get_latest_organizer_log(app: tauri::AppHandle) -> Result<Option<OrganizerLog>, String> {
  let conn = open_db(&app)?;
  let row: Option<(String, i64, i64, i64, String)> = conn
    .query_row(
      "SELECT id, created_at, processed, errors, entries_json FROM organizer_logs ORDER BY created_at DESC LIMIT 1",
      [],
      |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
    )
    .optional()
    .map_err(|err| err.to_string())?;
  let Some((id, created_at, processed, errors, entries_json)) = row else {
    return Ok(None);
  };
  let entries: Vec<OrganizerLogEntry> =
    serde_json::from_str(&entries_json).unwrap_or_default();
  Ok(Some(OrganizerLog {
    id,
    created_at,
    processed: processed as usize,
    errors: errors as usize,
    entries,
  }))
}

fn open_db(app: &tauri::AppHandle) -> Result<Connection, String> {
  let db_path = db_path(app)?;
  let conn = Connection::open(db_path).map_err(|err| err.to_string())?;
  conn.execute_batch(
    "CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY NOT NULL,
      applied_at INTEGER NOT NULL
    );",
  )
  .map_err(|err| err.to_string())?;

  apply_migration(&conn, "0000_nebulous_mysterio", MIGRATION_SQL)?;
  apply_migration(&conn, "0001_wandering_young_avengers", MIGRATION_COVERS_SQL)?;
  apply_migration(&conn, "0002_pending_changes", MIGRATION_PENDING_CHANGES_SQL)?;
  apply_migration(&conn, "0003_tag_colors", MIGRATION_TAG_COLORS_SQL)?;
  apply_migration(&conn, "0004_ereader", MIGRATION_EREADER_SQL)?;
  apply_migration(&conn, "0005_organizer_settings", MIGRATION_ORGANIZER_SETTINGS_SQL)?;
  apply_migration(&conn, "0006_organizer_logs", MIGRATION_ORGANIZER_LOGS_SQL)?;
  apply_migration(&conn, "0007_title_cleanup_ignores", MIGRATION_TITLE_CLEANUP_IGNORES_SQL)?;
  conn.execute_batch("PRAGMA foreign_keys = ON;")
    .map_err(|err| err.to_string())?;
  Ok(conn)
}

fn apply_migration(conn: &Connection, id: &str, sql: &str) -> Result<(), String> {
  let existing: Option<String> = conn
    .query_row(
      "SELECT id FROM schema_migrations WHERE id = ?1",
      params![id],
      |row| row.get(0),
    )
    .optional()
    .map_err(|err| err.to_string())?;
  if existing.is_some() {
    return Ok(());
  }
  conn.execute_batch(sql).map_err(|err| err.to_string())?;
  conn.execute(
    "INSERT INTO schema_migrations (id, applied_at) VALUES (?1, ?2)",
    params![id, chrono::Utc::now().timestamp_millis()],
  )
  .map_err(|err| err.to_string())?;
  Ok(())
}

fn ensure_covers_table(conn: &Connection) -> Result<(), String> {
  conn.execute_batch(
    "CREATE TABLE IF NOT EXISTS covers (
      id TEXT PRIMARY KEY NOT NULL,
      item_id TEXT NOT NULL,
      source TEXT NOT NULL,
      url TEXT,
      local_path TEXT,
      width INTEGER,
      height INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (item_id) REFERENCES items(id) ON UPDATE no action ON DELETE no action
    );",
  )
  .map_err(|err| err.to_string())?;
  Ok(())
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
    series: None,
    series_index: None,
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
    series: None,
    series_index: None,
  };

  parse_opf_metadata(&opf, &mut metadata)?;
  Ok(metadata)
}

fn extract_epub_cover(
  path: &std::path::Path,
) -> Result<Option<(Vec<u8>, String)>, String> {
  log::info!("epub cover check: {}", path.display());
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

  let cover = crate::parse_opf_cover(&opf);
  let cover = match cover {
    Some(value) => value,
    None => return Ok(None),
  };

  let opf_dir = std::path::Path::new(&rootfile)
    .parent()
    .map(|value| value.to_string_lossy().to_string())
    .unwrap_or_default();
  let cover_path = if opf_dir.is_empty() {
    cover.href.clone()
  } else {
    format!("{}/{}", opf_dir, cover.href)
  };

  let mut bytes = Vec::new();
  let mut found = false;
  let candidates = vec![
    cover_path.clone(),
    cover_path.replace("\\", "/"),
    cover.href.clone(),
    cover.href.trim_start_matches("./").to_string(),
  ];
  for candidate in candidates {
    let normalized = candidate.replace("\\", "/");
    if let Ok(mut entry) = archive.by_name(&normalized) {
      if entry.read_to_end(&mut bytes).is_ok() {
        found = true;
        break;
      }
    }
  }

  if !found {
    if let Ok(meta) = crate::parser::epub::parse_epub(path) {
      if let Some(cover_image) = meta.cover_image {
        let extension = if meta.cover_mime.unwrap_or_default().contains("png") {
          "png".to_string()
        } else {
          cover
            .extension
            .or_else(|| cover.href.split('.').last().map(|value| value.to_string()))
            .unwrap_or_else(|| "jpg".to_string())
        };
        return Ok(Some((cover_image, extension)));
      }
    }
    return Ok(None);
  }

  let extension = cover
    .extension
    .or_else(|| cover.href.split('.').last().map(|value: &str| value.to_string()))
    .unwrap_or_else(|| "jpg".to_string());

  Ok(Some((bytes, extension)))
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
    series: None,
    series_index: None,
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
        metadata.description = normalize_optional_description(Some(subject));
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

fn normalize_optional_description(value: Option<String>) -> Option<String> {
  let raw = value?;
  let decoded = quick_xml::escape::unescape(&raw)
    .map(|text| text.into_owned())
    .unwrap_or(raw)
    .replace('\u{00a0}', " ");

  let html_tag_re = Regex::new(r"(?is)<\s*/?\s*[a-z][^>]*>").expect("valid html tag regex");
  let mut normalized = if html_tag_re.is_match(&decoded) {
    let break_re = Regex::new(r"(?is)<br\s*/?>").expect("valid break regex");
    let block_end_re = Regex::new(r"(?is)</(p|div|li|ul|ol|h[1-6])>").expect("valid block-end regex");
    let block_start_re = Regex::new(r"(?is)<li[^>]*>").expect("valid list-item regex");
    let strip_re = Regex::new(r"(?is)<[^>]+>").expect("valid strip regex");

    let with_breaks = break_re.replace_all(&decoded, "\n");
    let with_block_breaks = block_end_re.replace_all(&with_breaks, "\n");
    let with_list_prefix = block_start_re.replace_all(&with_block_breaks, "- ");
    strip_re.replace_all(&with_list_prefix, "").into_owned()
  } else {
    decoded
  };

  normalized = normalized
    .replace("\r\n", "\n")
    .replace('\r', "\n");

  let lines: Vec<String> = normalized
    .lines()
    .map(|line| line.trim())
    .filter(|line| !line.is_empty())
    .map(|line| line.to_string())
    .collect();

  if lines.is_empty() {
    return None;
  }

  let collapsed = lines.join("\n");
  Some(collapsed)
}

fn apply_metadata(
  conn: &Connection,
  item_id: &str,
  metadata: &ExtractedMetadata,
  now: i64,
) -> Result<(), String> {
  let existing: (Option<String>, Option<String>, Option<i64>, Option<String>, Option<String>, Option<f64>) = conn
    .query_row(
      "SELECT title, language, published_year, description, series, series_index FROM items WHERE id = ?1",
      params![item_id],
      |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
    )
    .map_err(|err| err.to_string())?;

  let title = existing.0.or_else(|| metadata.title.clone());
  let language = existing.1.or_else(|| metadata.language.clone());
  let published_year = existing.2.or(metadata.published_year);
  let description = normalize_optional_description(existing.3.or_else(|| metadata.description.clone()));
  let series = existing.4.or_else(|| metadata.series.clone());
  let series_index = existing.5.or(metadata.series_index);

  conn.execute(
    "UPDATE items SET title = ?1, language = ?2, published_year = ?3, description = ?4, series = ?5, series_index = ?6, updated_at = ?7 WHERE id = ?8",
    params![title, language, published_year, description, series, series_index, now, item_id],
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
  if metadata.series.is_some() {
    insert_field_source(conn, item_id, "series", now)?;
  }
  if metadata.series_index.is_some() {
    insert_field_source(conn, item_id, "series_index", now)?;
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

/// Normalize a book title for matching purposes
/// - Lowercases
/// - Removes leading articles (The, A, An)
/// - Removes punctuation
/// - Removes subtitle after colon/dash
/// - Collapses whitespace
fn normalize_title_for_matching(title: &str) -> String {
  let mut result = title.to_lowercase();

  // Remove subtitle (everything after : or -)
  if let Some(pos) = result.find(':') {
    result = result[..pos].to_string();
  }
  if let Some(pos) = result.find(" - ") {
    result = result[..pos].to_string();
  }

  // Remove leading articles
  let articles = ["the ", "a ", "an ", "de ", "het ", "een "];
  for article in articles {
    if result.starts_with(article) {
      result = result[article.len()..].to_string();
      break;
    }
  }

  // Remove punctuation and normalize whitespace
  result = result
    .chars()
    .map(|c| if c.is_alphanumeric() || c.is_whitespace() { c } else { ' ' })
    .collect::<String>()
    .split_whitespace()
    .collect::<Vec<_>>()
    .join(" ");

  result
}

fn normalize_author_for_matching(author: &str) -> String {
  normalize_title_for_matching(author)
}

/// Extract the likely last name from an author string
/// Handles both "First Last" and "Last, First" formats
fn extract_author_last_name(author: &str) -> String {
  let author = author.trim().to_lowercase();

  // Handle "Last, First" format
  if let Some(pos) = author.find(',') {
    return author[..pos].trim().to_string();
  }

  // Handle "First Last" format - take last word
  author.split_whitespace().last().unwrap_or(&author).to_string()
}

/// Check if two author lists likely refer to the same author(s)
/// Uses last name matching for better accuracy
fn authors_match_fuzzy(lib_authors: &[String], book_authors: &[String]) -> bool {
  // If either list is empty, consider it a match (no author info)
  if lib_authors.is_empty() || book_authors.is_empty() {
    return true;
  }

  // Extract last names from both lists
  let lib_last_names: Vec<String> = lib_authors
    .iter()
    .map(|a| extract_author_last_name(a))
    .collect();

  let book_last_names: Vec<String> = book_authors
    .iter()
    .map(|a| extract_author_last_name(a))
    .collect();

  // Check if at least one last name matches
  for lib_name in &lib_last_names {
    for book_name in &book_last_names {
      // Exact last name match
      if lib_name == book_name {
        return true;
      }
      // One contains the other (handles partial names)
      if lib_name.contains(book_name.as_str()) || book_name.contains(lib_name.as_str()) {
        return true;
      }
    }
  }

  false
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
        // Also check for meta elements with attributes (for calibre:series)
        if current_tag == "meta" {
          parse_meta_element(&event, metadata);
        }
      }
      Ok(quick_xml::events::Event::Empty(event)) => {
        // Handle self-closing meta elements like <meta name="calibre:series" content="..."/>
        let tag_name = String::from_utf8_lossy(event.name().as_ref()).to_string();
        if tag_name == "meta" {
          parse_meta_element(&event, metadata);
        }
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
              metadata.description = normalize_optional_description(Some(text));
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

/// Parse a <meta> element for calibre:series and calibre:series_index
fn parse_meta_element(event: &quick_xml::events::BytesStart, metadata: &mut ExtractedMetadata) {
  let mut name = String::new();
  let mut content = String::new();

  for attr in event.attributes().flatten() {
    if attr.key.as_ref() == b"name" {
      name = String::from_utf8_lossy(&attr.value).to_string();
    }
    if attr.key.as_ref() == b"content" {
      content = String::from_utf8_lossy(&attr.value).to_string();
    }
  }

  if name == "calibre:series" && metadata.series.is_none() {
    metadata.series = Some(content);
  } else if name == "calibre:series_index" && metadata.series_index.is_none() {
    metadata.series_index = content.parse::<f64>().ok();
  }
}

struct CoverDescriptor {
  href: String,
  extension: Option<String>,
}

fn parse_opf_cover(opf: &str) -> Option<CoverDescriptor> {
  let mut reader = quick_xml::Reader::from_str(opf);
  reader.trim_text(true);
  let mut buf = Vec::new();
  let mut cover_id: Option<String> = None;
  let mut manifest: std::collections::HashMap<String, (String, Option<String>, Option<String>)> =
    std::collections::HashMap::new();

  let mut handle_meta = |event: &quick_xml::events::BytesStart| {
    let mut name: Option<String> = None;
    let mut content: Option<String> = None;
    for attr in event.attributes().flatten() {
      let key = attr.key.as_ref();
      let value = attr.unescape_value().ok()?.to_string();
      if key == b"name" {
        name = Some(value);
      } else if key == b"content" {
        content = Some(value);
      }
    }
    if let (Some(name), Some(content)) = (name, content) {
      if name == "cover" {
        cover_id = Some(content);
      }
    }
    Some(())
  };

  let mut handle_item = |event: &quick_xml::events::BytesStart| {
    let mut id: Option<String> = None;
    let mut href: Option<String> = None;
    let mut media_type: Option<String> = None;
    let mut properties: Option<String> = None;
    for attr in event.attributes().flatten() {
      let key = attr.key.as_ref();
      let value = attr.unescape_value().ok()?.to_string();
      if key == b"id" {
        id = Some(value);
      } else if key == b"href" {
        href = Some(value);
      } else if key == b"media-type" {
        media_type = Some(value);
      } else if key == b"properties" {
        properties = Some(value);
      }
    }
    if let (Some(id), Some(href)) = (id, href) {
      manifest.insert(id, (href, media_type, properties));
    }
    Some(())
  };

  loop {
    match reader.read_event_into(&mut buf) {
      Ok(quick_xml::events::Event::Start(event)) | Ok(quick_xml::events::Event::Empty(event)) => {
        let tag = String::from_utf8_lossy(event.name().as_ref()).to_string();
        if tag == "meta" || tag.ends_with(":meta") {
          handle_meta(&event)?;
        }
        if tag == "item" || tag.ends_with(":item") {
          handle_item(&event)?;
        }
      }
      Ok(quick_xml::events::Event::Eof) => break,
      Err(_) => break,
      _ => {}
    }
    buf.clear();
  }

  if let Some(ref id) = cover_id {
    log::info!("epub cover id meta: {}", id);
  }
  let cover_item = cover_id.and_then(|id| manifest.get(&id).cloned());
  let cover_item = cover_item.or_else(|| {
    manifest
      .values()
      .find(|(_, _, properties)| {
        properties
          .as_ref()
          .map(|value| value.contains("cover-image"))
          .unwrap_or(false)
      })
      .cloned()
  });
  let cover_item = cover_item.or_else(|| {
    manifest
      .iter()
      .find(|(id, (href, media_type, _))| {
        let media_ok = media_type
          .as_ref()
          .map(|value| value.starts_with("image/"))
          .unwrap_or(false);
        let name = format!("{} {}", id, href).to_lowercase();
        media_ok && name.contains("cover")
      })
      .map(|(_, value)| value.clone())
  });
  let cover_item = cover_item.or_else(|| {
    manifest
      .values()
      .find(|(_, media_type, _)| {
        media_type
          .as_ref()
          .map(|value| value.starts_with("image/"))
          .unwrap_or(false)
      })
      .cloned()
  });

  if let Some((href, media_type, _)) = cover_item {
    let extension = media_type
      .as_deref()
      .and_then(map_cover_extension)
      .map(|value| value.to_string());
    return Some(CoverDescriptor { href, extension });
  }

  None
}

fn map_cover_extension(mime: &str) -> Option<&'static str> {
  match mime {
    "image/jpeg" => Some("jpg"),
    "image/png" => Some("png"),
    "image/webp" => Some("webp"),
    _ => None,
  }
}

/// Generate a cover image from title and author text
/// Returns PNG bytes
pub fn generate_text_cover(title: &str, author: &str) -> Result<Vec<u8>, String> {
  // Cover dimensions (standard ebook cover aspect ratio ~2:3)
  let width: u32 = 400;
  let height: u32 = 600;

  // Create image with a warm beige/cream background
  let bg_color = Rgba([250u8, 245, 235, 255]);
  let mut img: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::from_pixel(width, height, bg_color);

  // Draw a subtle border
  let border_color = Rgba([180u8, 160, 140, 255]);
  let border_width = 8u32;
  for x in 0..width {
    for y in 0..height {
      if x < border_width || x >= width - border_width || y < border_width || y >= height - border_width {
        img.put_pixel(x, y, border_color);
      }
    }
  }

  // Draw inner border line
  let line_color = Rgba([160u8, 140, 120, 255]);
  let inner_margin = 20u32;
  for x in inner_margin..(width - inner_margin) {
    img.put_pixel(x, inner_margin, line_color);
    img.put_pixel(x, height - inner_margin - 1, line_color);
  }
  for y in inner_margin..(height - inner_margin) {
    img.put_pixel(inner_margin, y, line_color);
    img.put_pixel(width - inner_margin - 1, y, line_color);
  }

  // Load embedded font (use a simple built-in approach)
  // We'll use the default font from ab_glyph
  let font_data = include_bytes!("../fonts/DejaVuSans.ttf");
  let font = FontRef::try_from_slice(font_data).map_err(|e| format!("Font error: {}", e))?;

  let text_color = Rgba([60u8, 50, 40, 255]);
  let author_color = Rgba([100u8, 90, 80, 255]);

  // Draw author at top
  let author_scale = PxScale::from(22.0);
  let author_display = if author.len() > 35 {
    format!("{}...", &author[..32])
  } else {
    author.to_string()
  };
  draw_text_mut(&mut img, author_color, 40, 50, author_scale, &font, &author_display);

  // Draw title in the middle (wrap long titles)
  let title_scale = PxScale::from(32.0);
  let max_chars_per_line = 18;
  let words: Vec<&str> = title.split_whitespace().collect();
  let mut lines: Vec<String> = Vec::new();
  let mut current_line = String::new();

  for word in words {
    if current_line.is_empty() {
      current_line = word.to_string();
    } else if current_line.len() + 1 + word.len() <= max_chars_per_line {
      current_line.push(' ');
      current_line.push_str(word);
    } else {
      lines.push(current_line);
      current_line = word.to_string();
    }
  }
  if !current_line.is_empty() {
    lines.push(current_line);
  }

  // Limit to 6 lines max
  if lines.len() > 6 {
    lines.truncate(5);
    if let Some(last) = lines.last_mut() {
      if last.len() > 3 {
        last.truncate(last.len() - 3);
        last.push_str("...");
      }
    }
  }

  // Center title vertically
  let line_height = 42i32;
  let total_height = (lines.len() as i32) * line_height;
  let start_y = ((height as i32) - total_height) / 2;

  for (i, line) in lines.iter().enumerate() {
    let y = start_y + (i as i32) * line_height;
    draw_text_mut(&mut img, text_color, 40, y, title_scale, &font, line);
  }

  // Encode to PNG
  let mut png_bytes: Vec<u8> = Vec::new();
  let encoder = PngEncoder::new(&mut png_bytes);
  encoder
    .write_image(&img, width, height, image::ExtendedColorType::Rgba8)
    .map_err(|e| format!("PNG encode error: {}", e))?;

  Ok(png_bytes)
}

fn save_cover(
  app: &tauri::AppHandle,
  conn: &Connection,
  item_id: &str,
  bytes: Vec<u8>,
  extension: &str,
  now: i64,
  source: &str,
  url: Option<&str>,
) -> Result<(), String> {
  let app_dir = app
    .path()
    .app_data_dir()
    .map_err(|err| err.to_string())?;
  let covers_dir = app_dir.join("covers");
  std::fs::create_dir_all(&covers_dir).map_err(|err| err.to_string())?;
  let filename = format!("cover_{}.{}", item_id, extension);
  let cover_path = covers_dir.join(filename);
  std::fs::write(&cover_path, bytes).map_err(|err| err.to_string())?;
  log::info!("cover saved: {} ({})", cover_path.display(), source);

  conn.execute(
    "DELETE FROM covers WHERE item_id = ?1",
    params![item_id],
  )
  .map_err(|err| err.to_string())?;
  conn.execute(
    "INSERT INTO covers (id, item_id, source, url, local_path, width, height, created_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, ?6)",
    params![
      Uuid::new_v4().to_string(),
      item_id,
      source,
      url,
      cover_path.to_string_lossy(),
      now,
    ],
  )
  .map_err(|err| err.to_string())?;

  log::info!("cover record inserted for item {}", item_id);

  Ok(())
}

fn embed_latest_cover_into_epub(conn: &Connection, item_id: &str) -> Result<(), String> {
  let epub_path: Option<String> = conn
    .query_row(
      "SELECT path FROM files WHERE item_id = ?1 AND extension = '.epub' AND status = 'active' LIMIT 1",
      params![item_id],
      |row| row.get(0),
    )
    .optional()
    .map_err(|err| err.to_string())?;
  let Some(path) = epub_path else {
    return Ok(());
  };
  let cover_path: Option<String> = conn
    .query_row(
      "SELECT local_path FROM covers WHERE item_id = ?1 ORDER BY created_at DESC LIMIT 1",
      params![item_id],
      |row| row.get(0),
    )
    .optional()
    .map_err(|err| err.to_string())?;
  let Some(cover_path) = cover_path else {
    return Ok(());
  };
  let cover_bytes = std::fs::read(&cover_path).map_err(|err| err.to_string())?;
  let extension = std::path::Path::new(&cover_path)
    .extension()
    .and_then(|ext| ext.to_str())
    .unwrap_or("png");
  let epub_file = std::path::Path::new(&path);
  if epub_file.exists() {
    crate::parser::epub::write_epub_cover(epub_file, &cover_bytes, extension)?;
  }
  Ok(())
}

fn has_cover(conn: &Connection, item_id: &str) -> Result<bool, String> {
  let existing: Option<String> = conn
    .query_row(
      "SELECT id FROM covers WHERE item_id = ?1 LIMIT 1",
      params![item_id],
      |row| row.get(0),
    )
    .optional()
    .map_err(|err| err.to_string())?;
  Ok(existing.is_some())
}

fn fetch_cover_from_url(
  app: &tauri::AppHandle,
  conn: &Connection,
  item_id: &str,
  url: &str,
  now: i64,
) -> Result<bool, String> {
  log::info!("fetching cover from url: {} for item {}", url, item_id);
  let response = match reqwest::blocking::get(url) {
    Ok(resp) => resp,
    Err(err) => {
      log::warn!("cover fetch failed for {}: {}", url, err);
      return Ok(false);
    }
  };
  if !response.status().is_success() {
    log::warn!("cover fetch returned status {} for {}", response.status(), url);
    return Ok(false);
  }
  let content_type = response
    .headers()
    .get(reqwest::header::CONTENT_TYPE)
    .and_then(|value| value.to_str().ok())
    .unwrap_or("image/jpeg");
  let extension = map_cover_extension(content_type).unwrap_or("jpg");
  let bytes = response.bytes().map_err(|err| err.to_string())?.to_vec();

  // Check for empty or placeholder images (Open Library returns tiny placeholders)
  // A real cover image should be at least 1KB
  if bytes.len() < 1024 {
    log::info!("cover too small ({} bytes), likely a placeholder: {}", bytes.len(), url);
    return Ok(false);
  }

  save_cover(app, conn, item_id, bytes.clone(), extension, now, "candidate", Some(url))?;
  log::info!("cover saved successfully for item {}", item_id);

  // Also embed the cover into the EPUB file itself
  let epub_path: Option<String> = conn
    .query_row(
      "SELECT path FROM files WHERE item_id = ?1 AND extension = '.epub' AND status = 'active' LIMIT 1",
      params![item_id],
      |row| row.get(0),
    )
    .optional()
    .map_err(|err| err.to_string())?;

  if let Some(path) = epub_path {
    let epub_file = std::path::Path::new(&path);
    if epub_file.exists() {
      match crate::parser::epub::write_epub_cover(epub_file, &bytes, extension) {
        Ok(()) => log::info!("embedded cover into EPUB: {}", path),
        Err(err) => log::warn!("failed to embed cover into EPUB {}: {}", path, err),
      }
    }
  }

  Ok(true)
}

fn fetch_cover_fallback(
  app: &tauri::AppHandle,
  conn: &Connection,
  item_id: &str,
  now: i64,
) -> Result<bool, String> {
  if has_cover(conn, item_id)? {
    log::info!("cover fallback skipped (already has cover) for item {}", item_id);
    return Ok(false);
  }

  let isbn: Option<String> = conn
    .query_row(
      "SELECT value FROM identifiers WHERE item_id = ?1 AND (type = 'ISBN13' OR type = 'ISBN10') ORDER BY type = 'ISBN13' DESC LIMIT 1",
      params![item_id],
      |row| row.get(0),
    )
    .optional()
    .map_err(|err| err.to_string())?;
  let isbn = match isbn {
    Some(value) => value,
    None => {
      log::info!("cover fallback skipped (no isbn) for item {}", item_id);
      return Ok(false);
    }
  };

  let url = format!("https://covers.openlibrary.org/b/isbn/{}-L.jpg", isbn);
  log::info!("fetching cover fallback from Open Library: {}", url);
  let response = match reqwest::blocking::get(&url) {
    Ok(resp) => resp,
    Err(err) => {
      log::warn!("cover fallback fetch failed for {}: {}", url, err);
      return Ok(false);
    }
  };
  if !response.status().is_success() {
    log::warn!("cover fallback returned status {} for {}", response.status(), url);
    return Ok(false);
  }
  let content_type = response
    .headers()
    .get(reqwest::header::CONTENT_TYPE)
    .and_then(|value| value.to_str().ok())
    .unwrap_or("image/jpeg");
  let extension = map_cover_extension(content_type).unwrap_or("jpg");
  let bytes = response.bytes().map_err(|err| err.to_string())?.to_vec();

  // Check for empty or placeholder images (Open Library returns tiny placeholders)
  if bytes.len() < 1024 {
    log::info!("cover fallback too small ({} bytes), likely a placeholder: {}", bytes.len(), url);
    return Ok(false);
  }

  log::info!("cover fetched from Open Library: {} ({} bytes)", url, bytes.len());
  save_cover(app, conn, item_id, bytes.clone(), extension, now, "openlibrary", Some(&url))?;

  // Also embed the cover into the EPUB file itself
  let epub_path: Option<String> = conn
    .query_row(
      "SELECT path FROM files WHERE item_id = ?1 AND extension = '.epub' AND status = 'active' LIMIT 1",
      params![item_id],
      |row| row.get(0),
    )
    .optional()
    .map_err(|err| err.to_string())?;

  if let Some(path) = epub_path {
    let epub_file = std::path::Path::new(&path);
    if epub_file.exists() {
      match crate::parser::epub::write_epub_cover(epub_file, &bytes, extension) {
        Ok(()) => log::info!("embedded cover into EPUB: {}", path),
        Err(err) => log::warn!("failed to embed cover into EPUB {}: {}", path, err),
      }
    }
  }

  Ok(true)
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
    cover_url: Some(format!("https://covers.openlibrary.org/b/isbn/{}-M.jpg", isbn)),
    source: "Open Library".to_string(),
    confidence: 0.9,
  }]
}

fn fetch_bol_isbn(isbn: &str) -> Vec<EnrichmentCandidate> {
  let ean = match isbn_to_ean13(isbn) {
    Some(value) => value,
    None => return vec![],
  };

  let token = match get_bol_access_token() {
    Some(value) => value,
    None => return vec![],
  };

  let client = reqwest::blocking::Client::new();
  let url = format!("https://api.bol.com/marketing/catalog/v1/products/{}", ean);
  let response = match client
    .get(url)
    .bearer_auth(token)
    .header(reqwest::header::ACCEPT, "application/json")
    .send()
  {
    Ok(value) => value,
    Err(err) => {
      log::warn!("bol isbn request failed for {}: {}", ean, err);
      return vec![];
    }
  };
  if !response.status().is_success() {
    log::warn!("bol isbn request returned {} for {}", response.status(), ean);
    return vec![];
  }

  let data: serde_json::Value = match response.json() {
    Ok(value) => value,
    Err(err) => {
      log::warn!("bol isbn response parse failed for {}: {}", ean, err);
      return vec![];
    }
  };

  let title = json_find_string(&data, "title");
  let authors = json_collect_strings(&data, &["author", "authors"], 3);
  let published_year = json_find_string(&data, "releaseDate")
    .or_else(|| json_find_string(&data, "publicationDate"))
    .and_then(|value| extract_year(&value));
  let cover_url = json_find_first_image_url(&data);

  vec![EnrichmentCandidate {
    id: Uuid::new_v4().to_string(),
    title,
    authors,
    published_year,
    identifiers: vec![ean],
    cover_url,
    source: "Bol.com".to_string(),
    confidence: 0.82,
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
      let cover_url = info
        .get("imageLinks")
        .and_then(|value| value.get("thumbnail").or_else(|| value.get("smallThumbnail")))
        .and_then(|value| value.as_str())
        .map(|value| value.replace("http://", "https://"));

      EnrichmentCandidate {
        id: Uuid::new_v4().to_string(),
        title,
        authors,
        published_year,
        identifiers,
        cover_url,
        source: "Google Books".to_string(),
        confidence: if index == 0 { 0.85 } else { 0.7 },
      }
    })
    .collect()
}

fn get_bol_access_token() -> Option<String> {
  let now = chrono::Utc::now().timestamp_millis();
  let cache = BOL_TOKEN_CACHE.get_or_init(|| Mutex::new(None));
  if let Ok(guard) = cache.lock() {
    if let Some(token) = guard.clone() {
      // Refresh shortly before expiry to avoid edge race during requests.
      if token.expires_at > now + 15_000 {
        return Some(token.access_token);
      }
    }
  }

  let client_id = match std::env::var("BOL_CLIENT_ID") {
    Ok(value) if !value.trim().is_empty() => value,
    _ => return None,
  };
  let client_secret = match std::env::var("BOL_CLIENT_SECRET") {
    Ok(value) if !value.trim().is_empty() => value,
    _ => return None,
  };

  let client = reqwest::blocking::Client::new();
  let response = match client
    .post("https://login.bol.com/token?grant_type=client_credentials")
    .basic_auth(client_id, Some(client_secret))
    .header(reqwest::header::ACCEPT, "application/json")
    .send()
  {
    Ok(value) => value,
    Err(err) => {
      log::warn!("bol token request failed: {}", err);
      return None;
    }
  };
  if !response.status().is_success() {
    log::warn!("bol token request returned {}", response.status());
    return None;
  }

  let data: serde_json::Value = match response.json() {
    Ok(value) => value,
    Err(err) => {
      log::warn!("bol token parse failed: {}", err);
      return None;
    }
  };

  let access_token = match data.get("access_token").and_then(|value| value.as_str()) {
    Some(value) if !value.is_empty() => value.to_string(),
    _ => return None,
  };
  let expires_in = data
    .get("expires_in")
    .and_then(|value| value.as_i64())
    .unwrap_or(299);
  let token = BolAccessToken {
    access_token: access_token.clone(),
    expires_at: now + (expires_in * 1000),
  };

  if let Ok(mut guard) = cache.lock() {
    *guard = Some(token);
  }
  Some(access_token)
}

fn json_find_string(value: &serde_json::Value, key: &str) -> Option<String> {
  match value {
    serde_json::Value::Object(map) => {
      if let Some(found) = map.get(key).and_then(|entry| entry.as_str()) {
        let trimmed = found.trim();
        if !trimmed.is_empty() {
          return Some(trimmed.to_string());
        }
      }
      for entry in map.values() {
        if let Some(found) = json_find_string(entry, key) {
          return Some(found);
        }
      }
      None
    }
    serde_json::Value::Array(values) => values.iter().find_map(|entry| json_find_string(entry, key)),
    _ => None,
  }
}

fn json_collect_strings(value: &serde_json::Value, keys: &[&str], max_items: usize) -> Vec<String> {
  let mut values: Vec<String> = vec![];
  for key in keys {
    collect_strings_for_key(value, key, &mut values);
  }
  values.dedup();
  values.into_iter().take(max_items).collect()
}

fn collect_strings_for_key(value: &serde_json::Value, key: &str, out: &mut Vec<String>) {
  match value {
    serde_json::Value::Object(map) => {
      if let Some(found) = map.get(key) {
        match found {
          serde_json::Value::String(item) => {
            let trimmed = item.trim();
            if !trimmed.is_empty() {
              out.push(trimmed.to_string());
            }
          }
          serde_json::Value::Array(items) => {
            for item in items {
              if let Some(text) = item.as_str() {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                  out.push(trimmed.to_string());
                }
              }
            }
          }
          _ => {}
        }
      }
      for item in map.values() {
        collect_strings_for_key(item, key, out);
      }
    }
    serde_json::Value::Array(items) => {
      for item in items {
        collect_strings_for_key(item, key, out);
      }
    }
    _ => {}
  }
}

fn json_find_first_image_url(value: &serde_json::Value) -> Option<String> {
  let images = value.get("images").and_then(|entry| entry.as_array())?;
  for image in images {
    if let Some(url) = image.get("url").and_then(|entry| entry.as_str()) {
      if !url.trim().is_empty() {
        return Some(url.to_string());
      }
    }
    if let Some(url) = image.get("s").and_then(|entry| entry.as_str()) {
      if !url.trim().is_empty() {
        return Some(url.to_string());
      }
    }
  }
  None
}

fn isbn_to_ean13(value: &str) -> Option<String> {
  let normalized = normalize_isbn(value)?;
  if normalized.len() == 13 {
    return Some(normalized);
  }
  if normalized.len() != 10 {
    return None;
  }

  let base = format!("978{}", &normalized[..9]);
  let mut sum = 0u32;
  for (index, ch) in base.chars().enumerate() {
    let digit = ch.to_digit(10)?;
    let weight = if index % 2 == 0 { 1 } else { 3 };
    sum += digit * weight;
  }
  let check = (10 - (sum % 10)) % 10;
  Some(format!("{}{}", base, check))
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
      let cover_url = doc
        .get("cover_i")
        .and_then(|value| value.as_i64())
        .map(|value| format!("https://covers.openlibrary.org/b/id/{}-M.jpg", value))
        .or_else(|| {
          doc
            .get("cover_edition_key")
            .and_then(|value| value.as_str())
            .map(|value| format!("https://covers.openlibrary.org/b/olid/{}-M.jpg", value))
        });

      EnrichmentCandidate {
        id: Uuid::new_v4().to_string(),
        title,
        authors,
        published_year,
        identifiers,
        cover_url,
        source: "Open Library".to_string(),
        confidence: 0.7 - index as f64 * 0.05,
      }
    })
    .collect()
}

fn parse_search_query(query: &str) -> (String, Option<String>) {
  let lowered = query.to_lowercase();
  if let Some(result) = split_search_query(query, &lowered, " by ") {
    return result;
  }
  if let Some(result) = split_search_query(query, &lowered, " - ") {
    return result;
  }
  (query.to_string(), None)
}

fn split_search_query(
  original: &str,
  lowered: &str,
  needle: &str,
) -> Option<(String, Option<String>)> {
  let index = lowered.find(needle)?;
  let (title_part, author_part) = original.split_at(index);
  let author = author_part.get(needle.len()..).unwrap_or("").trim();
  let title = title_part.trim();
  if title.is_empty() {
    return None;
  }
  let author = if author.is_empty() {
    None
  } else {
    Some(author.to_string())
  };
  Some((title.to_string(), author))
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
      let cover_url = info
        .get("imageLinks")
        .and_then(|value| value.get("thumbnail").or_else(|| value.get("smallThumbnail")))
        .and_then(|value| value.as_str())
        .map(|value| value.replace("http://", "https://"));

      EnrichmentCandidate {
        id: Uuid::new_v4().to_string(),
        title,
        authors,
        published_year,
        identifiers,
        cover_url,
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
  _app: &tauri::AppHandle,
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

  let title = candidate.title.clone().or(existing.0);
  let published_year = candidate.published_year.or(existing.1);
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

  if !candidate.authors.is_empty() {
    conn
      .execute("DELETE FROM item_authors WHERE item_id = ?1", params![item_id])
      .map_err(|err| err.to_string())?;

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

  // Cover fetching is handled separately in apply_fix_candidate with proper error handling
  Ok(())
}

fn queue_epub_changes(
  conn: &Connection,
  item_id: &str,
  candidate: &EnrichmentCandidate,
  now: i64,
) -> Result<i64, String> {
  let isbn = candidate
    .identifiers
    .iter()
    .filter_map(|raw| normalize_isbn(raw).or_else(|| Some(raw.to_string())))
    .find(|value| value.len() == 10 || value.len() == 13);

  let changes = EpubChangeSet {
    title: candidate.title.clone(),
    author: candidate.authors.first().cloned(),
    isbn,
    description: None,
  };
  queue_epub_changes_for_item(conn, item_id, &changes, now)
}

fn queue_epub_changes_for_item(
  conn: &Connection,
  item_id: &str,
  changes: &EpubChangeSet,
  now: i64,
) -> Result<i64, String> {
  let has_changes = changes.title.is_some()
    || changes.author.is_some()
    || changes.isbn.is_some()
    || changes.description.is_some();
  if !has_changes {
    return Ok(0);
  }

  let mut stmt = conn
    .prepare(
      "SELECT id, path FROM files WHERE item_id = ?1 AND status = 'active' AND LOWER(extension) IN ('epub', '.epub')",
    )
    .map_err(|err| err.to_string())?;
  let rows = stmt
    .query_map(params![item_id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
    .map_err(|err| err.to_string())?;

  let changes_json = serde_json::to_string(changes).map_err(|err| err.to_string())?;

  let mut created = 0i64;
  for row in rows {
    let (file_id, path) = row.map_err(|err| err.to_string())?;
    conn.execute(
      "DELETE FROM pending_changes WHERE file_id = ?1 AND type = 'epub_meta' AND status = 'pending'",
      params![file_id],
    )
    .map_err(|err| err.to_string())?;
    let change_id = Uuid::new_v4().to_string();
    conn.execute(
      "INSERT INTO pending_changes (id, file_id, type, from_path, to_path, changes_json, status, created_at) \
       VALUES (?1, ?2, 'epub_meta', ?3, NULL, ?4, 'pending', ?5)",
      params![change_id, file_id, path, changes_json, now],
    )
    .map_err(|err| err.to_string())?;
    created += 1;
  }

  Ok(created)
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

fn count_scan_targets(root: &str) -> u64 {
  WalkDir::new(root)
    .into_iter()
    .filter_map(Result::ok)
    .filter(|entry| entry.file_type().is_file())
    .filter(|entry| {
      let ext = entry
        .path()
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase();
      ext == "epub" || ext == "pdf"
    })
    .count() as u64
}

// eReader device management commands

#[tauri::command]
fn add_ereader_device(
  app: tauri::AppHandle,
  name: String,
  mount_path: String,
) -> Result<EReaderDevice, String> {
  let conn = open_db(&app)?;
  let now = chrono::Utc::now().timestamp_millis();
  let id = Uuid::new_v4().to_string();
  let is_connected = std::path::Path::new(&mount_path).exists();

  conn.execute(
    "INSERT INTO ereader_devices (id, name, mount_path, device_type, books_subfolder, last_connected_at, created_at) VALUES (?1, ?2, ?3, 'generic', '', ?4, ?5)",
    params![id, name, mount_path, if is_connected { Some(now) } else { None }, now],
  ).map_err(|err| err.to_string())?;

  log::info!("added ereader device: {} at {}", name, mount_path);

  Ok(EReaderDevice {
    id,
    name,
    mount_path,
    device_type: "generic".to_string(),
    books_subfolder: String::new(),
    last_connected_at: if is_connected { Some(now) } else { None },
    is_connected,
  })
}

#[tauri::command]
fn list_ereader_devices(app: tauri::AppHandle) -> Result<Vec<EReaderDevice>, String> {
  let conn = open_db(&app)?;
  let mut stmt = conn
    .prepare("SELECT id, name, mount_path, device_type, books_subfolder, last_connected_at FROM ereader_devices ORDER BY name")
    .map_err(|err| err.to_string())?;

  let rows = stmt
    .query_map(params![], |row| {
      let mount_path: String = row.get(2)?;
      let path = std::path::Path::new(&mount_path);
      let is_connected = path.exists() && path.is_dir();
      Ok(EReaderDevice {
        id: row.get(0)?,
        name: row.get(1)?,
        mount_path,
        device_type: row.get(3)?,
        books_subfolder: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
        last_connected_at: row.get(5)?,
        is_connected,
      })
    })
    .map_err(|err| err.to_string())?;

  let mut devices = Vec::new();
  for row in rows {
    devices.push(row.map_err(|err| err.to_string())?);
  }
  Ok(devices)
}

#[tauri::command]
fn remove_ereader_device(app: tauri::AppHandle, device_id: String) -> Result<(), String> {
  let conn = open_db(&app)?;
  conn.execute("DELETE FROM ereader_sync_queue WHERE device_id = ?1", params![device_id])
    .map_err(|err| err.to_string())?;
  conn.execute("DELETE FROM ereader_devices WHERE id = ?1", params![device_id])
    .map_err(|err| err.to_string())?;
  log::info!("removed ereader device: {}", device_id);
  Ok(())
}

#[tauri::command]
fn check_device_connected(app: tauri::AppHandle, device_id: String) -> Result<bool, String> {
  let conn = open_db(&app)?;
  let mount_path: Option<String> = conn
    .query_row(
      "SELECT mount_path FROM ereader_devices WHERE id = ?1",
      params![device_id],
      |row| row.get(0),
    )
    .optional()
    .map_err(|err| err.to_string())?;

  match mount_path {
    Some(path) => {
      let connected = std::path::Path::new(&path).exists();
      if connected {
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
          "UPDATE ereader_devices SET last_connected_at = ?1 WHERE id = ?2",
          params![now, device_id],
        ).ok();
      }
      Ok(connected)
    }
    None => Err("Device not found".to_string()),
  }
}

#[tauri::command]
fn scan_ereader(app: tauri::AppHandle, device_id: String) -> Result<Vec<EReaderBook>, String> {
  let conn = open_db(&app)?;

  // Get device info
  let (mount_path, books_subfolder): (String, String) = conn
    .query_row(
      "SELECT mount_path, COALESCE(books_subfolder, '') FROM ereader_devices WHERE id = ?1",
      params![device_id],
      |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .map_err(|err| err.to_string())?;

  let scan_path = if books_subfolder.is_empty() {
    std::path::PathBuf::from(&mount_path)
  } else {
    std::path::PathBuf::from(&mount_path).join(&books_subfolder)
  };

  if !scan_path.exists() {
    return Err("Device folder does not exist".to_string());
  }

  log::info!("scanning ereader at: {}", scan_path.display());

  // Build maps for matching: hash, ISBN, and normalized title
  let mut hash_map: std::collections::HashMap<String, String> = std::collections::HashMap::new();
  let mut isbn_map: std::collections::HashMap<String, String> = std::collections::HashMap::new();
  let mut title_map: std::collections::HashMap<String, (String, Vec<String>)> = std::collections::HashMap::new();
  let mut normalized_title_map: std::collections::HashMap<String, (String, Vec<String>)> = std::collections::HashMap::new();

  // Query items with their files, authors, and identifiers (ISBNs)
  let mut stmt = conn
    .prepare("SELECT items.id, items.title, files.sha256, GROUP_CONCAT(DISTINCT authors.name) as authors, GROUP_CONCAT(DISTINCT identifiers.value) as isbns FROM items LEFT JOIN files ON files.item_id = items.id LEFT JOIN item_authors ON item_authors.item_id = items.id LEFT JOIN authors ON authors.id = item_authors.author_id LEFT JOIN identifiers ON identifiers.item_id = items.id WHERE files.sha256 IS NOT NULL GROUP BY items.id")
    .map_err(|err| err.to_string())?;

  let rows = stmt
    .query_map(params![], |row| {
      Ok((
        row.get::<_, String>(0)?,
        row.get::<_, Option<String>>(1)?,
        row.get::<_, Option<String>>(2)?,
        row.get::<_, Option<String>>(3)?,
        row.get::<_, Option<String>>(4)?,
      ))
    })
    .map_err(|err| err.to_string())?;

  for row in rows {
    let (item_id, title, hash, authors, isbns) = row.map_err(|err| err.to_string())?;

    // Hash map
    if let Some(h) = hash {
      hash_map.insert(h, item_id.clone());
    }

    // ISBN map - add all ISBNs for this item
    if let Some(isbn_str) = isbns {
      for isbn in isbn_str.split(',') {
        if let Some(normalized) = normalize_isbn(isbn.trim()) {
          isbn_map.insert(normalized, item_id.clone());
        }
      }
    }

    // Build author list
    let author_list: Vec<String> = authors
      .unwrap_or_default()
      .split(',')
      .filter(|s| !s.trim().is_empty())
      .map(|s| s.trim().to_string())
      .collect();

    // Title maps (exact and normalized)
    if let Some(t) = title {
      title_map.insert(t.to_lowercase(), (item_id.clone(), author_list.clone()));

      // Also add normalized title
      let normalized = normalize_title_for_matching(&t);
      if !normalized.is_empty() {
        normalized_title_map.insert(normalized, (item_id, author_list));
      }
    }
  }

  let mut books: Vec<EReaderBook> = Vec::new();

  for entry in WalkDir::new(&scan_path)
    .into_iter()
    .filter_map(Result::ok)
    .filter(|e| e.file_type().is_file())
  {
    let path = entry.path();
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();

    if ext != "epub" && ext != "pdf" {
      continue;
    }

    let filename = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
    let path_str = path.to_string_lossy().to_string();

    // Compute hash
    let file_hash = match hash_file(path) {
      Ok(h) => h,
      Err(_) => continue,
    };

    // Try to extract metadata, fall back to filename
    let filename_title = path.file_stem()
      .and_then(|s| s.to_str())
      .map(|s| {
        // Remove .kepub suffix if present (Kobo format)
        let cleaned = s.trim_end_matches(".kepub");
        // Clean up common filename patterns
        cleaned.replace('_', " ").replace('-', " ")
      });

    let (title, authors): (Option<String>, Vec<String>) = if ext == "epub" {
      match extract_epub_metadata(path) {
        Ok(meta) => {
          // Use metadata if available, otherwise fall back to filename
          let t = meta.title.or(filename_title);
          (t, meta.authors)
        }
        Err(e) => {
          log::debug!("Could not extract epub metadata from {}: {}", path.display(), e);
          (filename_title, vec![])
        }
      }
    } else {
      // For PDF, use filename as title
      (filename_title, vec![])
    };

    // Match against library in order of confidence:
    // 1. Hash match (exact file)
    // 2. ISBN match (very reliable)
    // 3. Exact title match + author check
    // 4. Normalized title match + author check

    let (matched_item_id, match_confidence) = if let Some(item_id) = hash_map.get(&file_hash) {
      // 1. Exact hash match
      (Some(item_id.clone()), Some("exact".to_string()))
    } else {
      // Try to extract ISBNs from the ebook for ISBN matching
      let ebook_isbns: Vec<String> = if ext == "epub" {
        extract_epub_metadata(path)
          .map(|meta| meta.identifiers)
          .unwrap_or_default()
          .iter()
          .filter_map(|id| normalize_isbn(id))
          .collect()
      } else {
        vec![]
      };

      // 2. ISBN match
      let isbn_match = ebook_isbns.iter().find_map(|isbn| isbn_map.get(isbn));
      if let Some(item_id) = isbn_match {
        (Some(item_id.clone()), Some("isbn".to_string()))
      } else if let Some(t) = &title {
        // 3. Exact title match (case-insensitive)
        let key = t.to_lowercase();
        if let Some((item_id, lib_authors)) = title_map.get(&key) {
          if authors_match_fuzzy(lib_authors, &authors) {
            (Some(item_id.clone()), Some("title".to_string()))
          } else {
            (None, None)
          }
        } else {
          // 4. Normalized title match
          let normalized_key = normalize_title_for_matching(t);
          if let Some((item_id, lib_authors)) = normalized_title_map.get(&normalized_key) {
            if authors_match_fuzzy(lib_authors, &authors) {
              (Some(item_id.clone()), Some("fuzzy".to_string()))
            } else {
              (None, None)
            }
          } else {
            (None, None)
          }
        }
      } else {
        (None, None)
      }
    };

    books.push(EReaderBook {
      path: path_str,
      filename,
      title,
      authors,
      file_hash,
      matched_item_id,
      match_confidence,
    });
  }

  log::info!("scanned {} books from ereader", books.len());

  // Update last connected timestamp
  let now = chrono::Utc::now().timestamp_millis();
  conn.execute(
    "UPDATE ereader_devices SET last_connected_at = ?1 WHERE id = ?2",
    params![now, device_id],
  ).ok();

  Ok(books)
}

// Sync queue management commands

#[tauri::command]
fn queue_sync_action(
  app: tauri::AppHandle,
  device_id: String,
  action: String,
  item_id: Option<String>,
  ereader_path: Option<String>,
) -> Result<SyncQueueItem, String> {
  let conn = open_db(&app)?;
  let now = chrono::Utc::now().timestamp_millis();
  let id = Uuid::new_v4().to_string();

  conn.execute(
    "INSERT INTO ereader_sync_queue (id, device_id, item_id, ereader_path, action, status, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6)",
    params![id, device_id, item_id, ereader_path, action, now],
  ).map_err(|err| err.to_string())?;

  log::info!("queued sync action: {} for device {}", action, device_id);

  Ok(SyncQueueItem {
    id,
    device_id,
    action,
    item_id,
    ereader_path,
    status: "pending".to_string(),
    created_at: now,
  })
}

#[tauri::command]
fn remove_from_sync_queue(app: tauri::AppHandle, queue_id: String) -> Result<(), String> {
  let conn = open_db(&app)?;
  conn.execute("DELETE FROM ereader_sync_queue WHERE id = ?1", params![queue_id])
    .map_err(|err| err.to_string())?;
  log::info!("removed from sync queue: {}", queue_id);
  Ok(())
}

#[tauri::command]
fn get_sync_queue(app: tauri::AppHandle, device_id: String) -> Result<Vec<SyncQueueItem>, String> {
  let conn = open_db(&app)?;
  let mut stmt = conn
    .prepare("SELECT id, device_id, action, item_id, ereader_path, status, created_at FROM ereader_sync_queue WHERE device_id = ?1 ORDER BY created_at")
    .map_err(|err| err.to_string())?;

  let rows = stmt
    .query_map(params![device_id], |row| {
      Ok(SyncQueueItem {
        id: row.get(0)?,
        device_id: row.get(1)?,
        action: row.get(2)?,
        item_id: row.get(3)?,
        ereader_path: row.get(4)?,
        status: row.get(5)?,
        created_at: row.get(6)?,
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
fn clear_sync_queue(app: tauri::AppHandle, device_id: String) -> Result<(), String> {
  let conn = open_db(&app)?;
  conn.execute("DELETE FROM ereader_sync_queue WHERE device_id = ?1", params![device_id])
    .map_err(|err| err.to_string())?;
  log::info!("cleared sync queue for device {}", device_id);
  Ok(())
}

#[tauri::command]
fn execute_sync(app: tauri::AppHandle, device_id: String) -> Result<SyncResult, String> {
  let conn = open_db(&app)?;

  // Get device info
  let (mount_path, books_subfolder): (String, String) = conn
    .query_row(
      "SELECT mount_path, COALESCE(books_subfolder, '') FROM ereader_devices WHERE id = ?1",
      params![device_id],
      |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .map_err(|err| err.to_string())?;

  let device_path = if books_subfolder.is_empty() {
    std::path::PathBuf::from(&mount_path)
  } else {
    std::path::PathBuf::from(&mount_path).join(&books_subfolder)
  };

  if !device_path.exists() {
    return Err("Device is not connected".to_string());
  }

  // Get pending queue items
  let mut stmt = conn
    .prepare("SELECT id, action, item_id, ereader_path FROM ereader_sync_queue WHERE device_id = ?1 AND status = 'pending'")
    .map_err(|err| err.to_string())?;

  let rows = stmt
    .query_map(params![device_id], |row| {
      Ok((
        row.get::<_, String>(0)?,
        row.get::<_, String>(1)?,
        row.get::<_, Option<String>>(2)?,
        row.get::<_, Option<String>>(3)?,
      ))
    })
    .map_err(|err| err.to_string())?;

  let queue_items: Vec<_> = rows.filter_map(|r| r.ok()).collect();
  let total = queue_items.len();

  let mut added = 0i64;
  let mut removed = 0i64;
  let mut imported = 0i64;
  let mut errors: Vec<String> = Vec::new();
  let mut processed = 0usize;

  for (queue_id, action, item_id, ereader_path) in queue_items {
    // Emit progress
    let current_name = ereader_path.as_deref()
      .or(item_id.as_deref())
      .unwrap_or("item")
      .to_string();
    log::info!("sync progress: {}/{} - {} ({})", processed + 1, total, current_name, action);
    let _ = app.emit("sync-progress", SyncProgressPayload {
      processed,
      total,
      current: current_name,
      action: action.clone(),
    });
    processed += 1;
    let result: Result<(), String> = match action.as_str() {
      "add" => {
        if let Some(item_id) = item_id {
          // Get file path from library
          let file_path: Option<String> = conn
            .query_row(
              "SELECT path FROM files WHERE item_id = ?1 AND status = 'active' LIMIT 1",
              params![item_id],
              |row| row.get(0),
            )
            .optional()
            .map_err(|err| err.to_string())?;

          if let Some(src) = file_path {
            let src_path = std::path::Path::new(&src);
            let filename = src_path.file_name().unwrap_or_default();
            let dest = resolve_sync_collision(&device_path, filename.to_str().unwrap_or("book.epub"));

            match std::fs::copy(&src, &dest) {
              Ok(_) => {
                added += 1;
                log::info!("copied {} to {}", src, dest.display());
                Ok(())
              }
              Err(e) => Err(format!("Failed to copy: {}", e)),
            }
          } else {
            Err("Library file not found".to_string())
          }
        } else {
          Err("No item_id for add action".to_string())
        }
      }
      "remove" => {
        if let Some(path) = ereader_path {
          match std::fs::remove_file(&path) {
            Ok(_) => {
              removed += 1;
              log::info!("removed {}", path);
              Ok(())
            }
            Err(e) => Err(format!("Failed to remove: {}", e)),
          }
        } else {
          Err("No path for remove action".to_string())
        }
      }
      "import" => {
        if let Some(src) = ereader_path {
          let src_path = std::path::Path::new(&src);
          if src_path.exists() {
            // Import to library imports folder
            let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
            let imports_dir = app_dir.join("imports");
            std::fs::create_dir_all(&imports_dir).map_err(|e| e.to_string())?;

            let filename = src_path.file_name().unwrap_or_default();
            let dest = imports_dir.join(filename);

            match std::fs::copy(&src, &dest) {
              Ok(_) => {
                imported += 1;
                log::info!("imported {} to {}", src, dest.display());
                Ok(())
              }
              Err(e) => Err(format!("Failed to import: {}", e)),
            }
          } else {
            Err("Source file not found".to_string())
          }
        } else {
          Err("No path for import action".to_string())
        }
      }
      _ => Err(format!("Unknown action: {}", action)),
    };

    match result {
      Ok(_) => {
        conn.execute(
          "UPDATE ereader_sync_queue SET status = 'completed' WHERE id = ?1",
          params![queue_id],
        ).ok();
      }
      Err(e) => {
        errors.push(e.clone());
        conn.execute(
          "UPDATE ereader_sync_queue SET status = 'error' WHERE id = ?1",
          params![queue_id],
        ).ok();
      }
    }
  }

  // Clean up completed items
  conn.execute(
    "DELETE FROM ereader_sync_queue WHERE device_id = ?1 AND status = 'completed'",
    params![device_id],
  ).ok();

  log::info!("sync complete: {} added, {} removed, {} imported, {} errors", added, removed, imported, errors.len());

  let result = SyncResult { added, removed, imported, errors };
  let _ = app.emit("sync-complete", &result);
  Ok(result)
}

fn resolve_sync_collision(dir: &std::path::Path, filename: &str) -> std::path::PathBuf {
  let base = dir.join(filename);
  if !base.exists() {
    return base;
  }

  let stem = std::path::Path::new(filename)
    .file_stem()
    .and_then(|s| s.to_str())
    .unwrap_or("file");
  let ext = std::path::Path::new(filename)
    .extension()
    .and_then(|s| s.to_str())
    .unwrap_or("");

  let mut index = 1;
  loop {
    let new_name = if ext.is_empty() {
      format!("{} ({})", stem, index)
    } else {
      format!("{} ({}).{}", stem, index, ext)
    };
    let candidate = dir.join(new_name);
    if !candidate.exists() {
      return candidate;
    }
    index += 1;
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let app_menu = |app: &tauri::App| {
    // Folio menu
    let scan_item = MenuItem::with_id(app, "scan_folder", "Scan Folder", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit Folio", true, None::<&str>)?;
    let folio_menu = Submenu::with_items(app, "Folio", true, &[&scan_item, &quit_item])?;

    // Edit menu with standard shortcuts (Cmd+C, Cmd+V, etc.)
    let edit_menu = Submenu::with_items(
      app,
      "Edit",
      true,
      &[
        &PredefinedMenuItem::undo(app, None)?,
        &PredefinedMenuItem::redo(app, None)?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::cut(app, None)?,
        &PredefinedMenuItem::copy(app, None)?,
        &PredefinedMenuItem::paste(app, None)?,
        &PredefinedMenuItem::select_all(app, None)?,
      ],
    )?;

    Menu::with_items(app, &[&folio_menu, &edit_menu])
  };

  tauri::Builder::default()
    .setup(move |app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      } else {
        // Only enable updater in release mode to avoid restart errors in dev
        app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
      }
      let menu = app_menu(app)?;
      app.set_menu(menu)?;

      // Configure main window (stays hidden until close_splashscreen is called)
      if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_title("Folio");
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
          width: 1360.0,
          height: 900.0,
        }));
        let _ = window.set_min_size(Some(tauri::Size::Logical(
          tauri::LogicalSize {
            width: 1100.0,
            height: 720.0,
          },
        )));
        let _ = window.center();
      }
      Ok(())
    })
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_process::init())
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
      list_tags,
      create_tag,
      add_tag_to_item,
      remove_tag_from_item,
      get_cover_blob,
      get_duplicate_groups,
      get_title_duplicate_groups,
      get_fuzzy_duplicate_groups,
      resolve_duplicate_group_by_files,
      get_pending_changes,
      apply_pending_changes,
      remove_pending_changes,
      generate_pending_changes_from_organize,
      resolve_duplicate_group,
      get_library_health,
      get_fix_candidates,
      search_candidates,
      apply_fix_candidate,
      save_item_metadata,
      get_title_cleanup_ignores,
      set_title_cleanup_ignored,
      enrich_all,
      cancel_enrich,
      plan_organize,
      apply_organize,
      clear_library,
      normalize_item_descriptions,
      scan_folder,
      scanner::scan_library,
      add_ereader_device,
      list_ereader_devices,
      remove_ereader_device,
      check_device_connected,
      scan_ereader,
      queue_sync_action,
      remove_from_sync_queue,
      get_sync_queue,
      clear_sync_queue,
      get_sync_queue,
      clear_sync_queue,
      execute_sync,
      get_item_files,
      get_sync_queue,
      clear_sync_queue,
      execute_sync,
      get_item_files,
      reveal_file,
      get_item_details,
      get_missing_files,
      relink_missing_file,
      remove_missing_file,
      upload_cover,
      get_organizer_settings,
      set_organizer_settings,
      get_latest_organizer_log,
      close_splashscreen
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
