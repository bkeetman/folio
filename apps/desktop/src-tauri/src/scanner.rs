use crate::db;
use crate::generate_text_cover;
// use crate::models::Book;
use rusqlite::{params, OptionalExtension};
use std::fs;
use std::path::Path;
use tauri::{AppHandle, Emitter, Manager};
use walkdir::WalkDir;

#[derive(Clone, serde::Serialize)]
struct ScanProgress {
    path: String,
    total: u64,
}

#[derive(Clone, serde::Serialize)]
struct ScanStats {
    added: u64,
    updated: u64,
    moved: u64,
    unchanged: u64,
    missing: u64,
}

#[tauri::command]
pub fn scan_library(app: AppHandle, root_path: String) -> Result<(), String> {
    let root = Path::new(&root_path);
    if !root.exists() {
        return Err(format!("Path does not exist: {}", root_path));
    }

    // Connect to DB
    let mut conn = db::init_db(&app).map_err(|e| e.to_string())?;
    
    // Start transaction
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let mut stats = ScanStats {
        added: 0,
        updated: 0,
        moved: 0,
        unchanged: 0,
        missing: 0,
    };


    
    // Count total for progress approximation (files only)
    // For large libraries, counting first might be slow, but useful for progress bar.
    // For now we just use a placeholder or dynamic update.
    // Or we can just count walkdir items.
    let total_files = 100; // Placeholder to avoid double scan for now, or just use 0.

    let walker = WalkDir::new(root).into_iter();
    
    for entry in walker.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_file() {
            let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
            if ext == "epub" || ext == "pdf" {
                // Determine format
                let format = ext.clone();
                let path_str = path.to_string_lossy().to_string();
                let file_name = path.file_stem().unwrap_or_default().to_string_lossy().to_string();
                
                // Simple upsert for now
                // In a real scan we would check hash, parse metadata, etc.
                // For MVP 1 step 2 (Scanner), we just find files and insert raw entries.
                // Metadata parsing comes next.
                
                let id = uuid::Uuid::new_v4().to_string();
                let mut title = file_name.clone();
                let mut author_name: Option<String> = None;
                let mut published_date: Option<String> = None;
                let mut language: Option<String> = None;
                let mut description: Option<String> = None;
                let mut publisher: Option<String> = None;
                let mut cover_path: Option<String> = None;

                if format == "epub" {
                     if let Ok(meta) = crate::parser::epub::parse_epub(&path) {
                         if let Some(t) = meta.title { title = t; }
                         author_name = meta.creator;
                         language = meta.language;
                         description = meta.description;
                         publisher = meta.publisher;

                         if let Some(bytes) = meta.cover_image {
                             // Save cover to app_data/covers
                             let app_dir = app.path().app_data_dir().unwrap_or(std::path::PathBuf::from("."));
                             let covers_dir = app_dir.join("covers");
                             if !covers_dir.exists() {
                                 let _ = fs::create_dir_all(&covers_dir);
                             }
                             let ext = if meta.cover_mime.unwrap_or_default().contains("png") { "png" } else { "jpg" };
                             let cover_filename = format!("{}.{}", id, ext);
                             let target_path = covers_dir.join(&cover_filename);
                             if fs::write(&target_path, bytes).is_ok() {
                                 cover_path = Some(target_path.to_string_lossy().to_string());
                             }
                         }
                     }
                }

                // Generate text cover if no cover was found
                if cover_path.is_none() {
                    let app_dir = app.path().app_data_dir().unwrap_or(std::path::PathBuf::from("."));
                    let covers_dir = app_dir.join("covers");
                    if !covers_dir.exists() {
                        let _ = fs::create_dir_all(&covers_dir);
                    }
                    let author_for_cover = author_name.as_deref().unwrap_or("Unknown");
                    if let Ok(bytes) = generate_text_cover(&title, author_for_cover) {
                        let cover_filename = format!("{}.png", id);
                        let target_path = covers_dir.join(&cover_filename);
                        if fs::write(&target_path, &bytes).is_ok() {
                            cover_path = Some(target_path.to_string_lossy().to_string());
                            log::info!("Generated text cover for: {}", title);
                        }
                    }
                }

                tx.execute(
                    "INSERT INTO books (id, file_path, format, title, description, publisher, published_date, language, cover_path) 
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                     ON CONFLICT(file_path) DO UPDATE SET 
                        updated_at = CURRENT_TIMESTAMP,
                        title = excluded.title,
                        description = excluded.description,
                        cover_path = excluded.cover_path
                    ",
                    params![id, path_str, format, title, description, publisher, published_date, language, cover_path],
                ).map_err(|e| e.to_string())?;

                if let Some(name) = author_name {
                    // Try to insert author
                    tx.execute("INSERT OR IGNORE INTO authors (name) VALUES (?1)", params![name]).ok();
                    let author_id: Option<i64> = tx.query_row("SELECT id FROM authors WHERE name = ?1", params![name], |row| row.get(0)).optional().unwrap_or(None);
                    
                    if let Some(aid) = author_id {
                         tx.execute("INSERT OR IGNORE INTO book_authors (book_id, author_id) VALUES (?1, ?2)", params![id, aid]).ok();
                    }
                }
                
                 stats.updated += 1;
                 app.emit("scan-progress", ScanProgress {
                    path: path_str,
                    total: 0 
                 }).ok();
            }
        }
    }

    app.emit("scan-complete", stats).ok();

    Ok(())
}
