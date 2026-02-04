CREATE TABLE IF NOT EXISTS organizer_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  library_root TEXT,
  mode TEXT,
  template TEXT,
  updated_at INTEGER NOT NULL
);
