use lopdf::{Document, Object};
use regex::Regex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::io::Write;
use tauri::{Emitter, Manager};
use tauri::menu::{Menu, MenuItem, Submenu};
use uuid::Uuid;
use walkdir::WalkDir;
use zip::ZipArchive;

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
  authors: Vec<String>,
  file_count: i64,
  formats: Vec<String>,
  cover_path: Option<String>,
  tags: Vec<Tag>,
  language: Option<String>,
  series: Option<String>,
  series_index: Option<f64>,
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
struct DuplicateGroup {
  id: String,
  title: String,
  files: Vec<String>,
  file_ids: Vec<String>,
  file_paths: Vec<String>,
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

#[derive(serde::Deserialize, serde::Serialize)]
struct EpubChangeSet {
  title: Option<String>,
  author: Option<String>,
  isbn: Option<String>,
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
       GROUP_CONCAT(DISTINCT files.extension) as formats, \
       MAX(covers.local_path) as cover_path, \
       tag_map.tags as tags, \
       items.language, items.series, items.series_index \
       FROM items \
       LEFT JOIN item_authors ON item_authors.item_id = items.id \
       LEFT JOIN authors ON authors.id = item_authors.author_id \
       LEFT JOIN files ON files.item_id = items.id \
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
       GROUP BY items.id"
    )
    .map_err(|err| err.to_string())?;

  let rows = stmt
    .query_map(params![], |row| {
      let authors: Option<String> = row.get(3)?;
      let formats: Option<String> = row.get(5)?;
      let cover_path: Option<String> = row.get(6)?;
      let tags: Option<String> = row.get(7)?;
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
        cover_path,
        tags: parse_tags(tags),
        language: row.get(8)?,
        series: row.get(9)?,
        series_index: row.get(10)?,
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
       GROUP_CONCAT(files.path, '|') as file_paths \
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
      Ok(DuplicateGroup {
        id: row.get(0)?,
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
  let conn = open_db(&app)?;
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

  for change in changes {
    let result = match change.change_type.as_str() {
      "rename" => apply_rename_change(&conn, &change, now),
      "epub_meta" => apply_epub_change(&change, now),
      "delete" => apply_delete_change(&conn, &change, now),
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
      }
    }
  }

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
  let _ = std::fs::remove_file(path);
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

  if let Some(isbn) = normalize_isbn(trimmed) {
    let mut candidates: Vec<EnrichmentCandidate> = vec![];
    candidates.extend(fetch_openlibrary_isbn(&isbn));
    candidates.extend(fetch_google_isbn(&isbn));
    candidates
      .sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap_or(std::cmp::Ordering::Equal));
    candidates.truncate(5);
    return Ok(candidates);
  }

  let (title, author) = parse_search_query(trimmed);
  let mut candidates: Vec<EnrichmentCandidate> = vec![];
  candidates.extend(fetch_openlibrary_search(&title, author.as_deref()));
  candidates.extend(fetch_google_search(&title, author.as_deref()));
  candidates = score_candidates(candidates, &title, author.as_deref());
  candidates.truncate(5);
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
  log::info!("applying fix candidate for item {}: {:?}", item_id, candidate.title);

  apply_enrichment_candidate(&app, &conn, &item_id, &candidate, now)?;
  let queued = queue_epub_changes(&conn, &item_id, &candidate, now)?;
  log::info!("queued epub changes: {} for item {}", queued, item_id);
  conn.execute(
    "UPDATE issues SET resolved_at = ?1 WHERE item_id = ?2 AND type = 'missing_metadata' AND resolved_at IS NULL",
    params![now, item_id],
  )
  .map_err(|err| err.to_string())?;

  // Try to fetch cover from candidate URL first
  let mut cover_fetched = false;
  if let Some(url) = candidate.cover_url.as_deref() {
    cover_fetched = fetch_cover_from_url(&app, &conn, &item_id, url, now)?;
  }

  // If candidate cover failed or wasn't available, try fallback using ISBN
  if !cover_fetched {
    log::info!("trying cover fallback for item {}", item_id);
    let _ = fetch_cover_fallback(&app, &conn, &item_id, now);
  }

  log::info!("fix candidate applied for item {}", item_id);
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
            log::info!("epub cover missing: {}", path_str);
          }
          Err(error) => {
            log::warn!("epub cover error {}: {}", path_str, error);
          }
        }
      }
      if let Ok(false) = has_cover(&conn, &item_id) {
        let _ = fetch_cover_fallback(&app, &conn, &item_id, now);
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
            log::info!("epub cover missing: {}", path_str);
          }
          Err(error) => {
            log::warn!("epub cover error {}: {}", path_str, error);
          }
        }
      }
    if let Ok(false) = has_cover(&conn, &item_id) {
      let _ = fetch_cover_fallback(&app, &conn, &item_id, now);
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
  archive
    .by_name(&cover_path)
    .map_err(|err| err.to_string())?
    .read_to_end(&mut bytes)
    .map_err(|err| err.to_string())?;

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

  loop {
    match reader.read_event_into(&mut buf) {
      Ok(quick_xml::events::Event::Start(event)) => {
        let tag = String::from_utf8_lossy(event.name().as_ref()).to_string();
        if tag == "meta" || tag.ends_with(":meta") {
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
        }

        if tag == "item" || tag.ends_with(":item") {
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

  save_cover(app, conn, item_id, bytes, extension, now, "candidate", Some(url))?;
  log::info!("cover saved successfully for item {}", item_id);
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
  save_cover(app, conn, item_id, bytes, extension, now, "openlibrary", Some(&url))?;
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
  let mut stmt = conn
    .prepare(
      "SELECT id, path FROM files WHERE item_id = ?1 AND status = 'active' AND LOWER(extension) IN ('epub', '.epub')",
    )
    .map_err(|err| err.to_string())?;
  let rows = stmt
    .query_map(params![item_id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
    .map_err(|err| err.to_string())?;

  let isbn = candidate
    .identifiers
    .iter()
    .filter_map(|raw| normalize_isbn(raw).or_else(|| Some(raw.to_string())))
    .find(|value| value.len() == 10 || value.len() == 13);

  let changes = EpubChangeSet {
    title: candidate.title.clone(),
    author: candidate.authors.first().cloned(),
    isbn,
  };
  let changes_json = serde_json::to_string(&changes).map_err(|err| err.to_string())?;

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
      let main_window = app.get_webview_window("main");
      if let Some(window) = main_window {
        let _ = window.set_focus();
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
    .plugin(tauri_plugin_updater::Builder::new().build())
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
      get_pending_changes,
      apply_pending_changes,
      generate_pending_changes_from_organize,
      resolve_duplicate_group,
      get_library_health,
      get_fix_candidates,
      search_candidates,
      apply_fix_candidate,
      plan_organize,
      apply_organize,
      clear_library,
      scan_folder
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
