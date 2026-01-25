use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::Manager;

#[derive(Serialize)]
struct LibraryItem {
  id: String,
  title: Option<String>,
  published_year: Option<i64>,
  authors: Vec<String>,
  file_count: i64,
  formats: Vec<String>,
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

fn db_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, std::io::Error> {
  let app_dir = app.path().app_data_dir()?;
  std::fs::create_dir_all(&app_dir)?;
  Ok(app_dir.join("folio.db"))
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
    .invoke_handler(tauri::generate_handler![get_library_items])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
