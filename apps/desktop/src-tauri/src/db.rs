use rusqlite::{Connection, Result};
use std::fs;
use std::path::Path;
use tauri::AppHandle;
use tauri::Manager;

const CURRENT_DB_VERSION: u32 = 1;

pub fn init_db(app_handle: &AppHandle) -> Result<Connection> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .expect("failed to get app data dir");

    if !app_dir.exists() {
        fs::create_dir_all(&app_dir).expect("failed to create app data dir");
    }

    let db_path = app_dir.join("folio.db");
    let mut conn = Connection::open(db_path)?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT
        )",
        [],
    )?;

    // Here we can run migrations based on version
    // For now, we'll just ensure our new tables exist
    // In a real scenario, we'd use the existing migration system or build one
    
    conn.execute(
        "CREATE TABLE IF NOT EXISTS books (
            id TEXT PRIMARY KEY,
            file_path TEXT UNIQUE NOT NULL,
            file_hash TEXT,
            format TEXT NOT NULL,
            title TEXT,
            description TEXT,
            publisher TEXT,
            published_date TEXT,
            language TEXT,
            series TEXT,
            series_index REAL,
            isbn TEXT,
            cover_path TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )?;

    // Add updated_at column to existing books table if it doesn't exist
    conn.execute(
        "ALTER TABLE books ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP",
        [],
    ).ok(); // Ignore error if column already exists

    conn.execute(
        "CREATE TABLE IF NOT EXISTS authors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS book_authors (
            book_id TEXT,
            author_id INTEGER,
            PRIMARY KEY (book_id, author_id),
            FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE,
            FOREIGN KEY(author_id) REFERENCES authors(id) ON DELETE CASCADE
        )",
        [],
    )?;

    Ok(conn)
}
