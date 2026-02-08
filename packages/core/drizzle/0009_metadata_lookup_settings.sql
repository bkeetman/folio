CREATE TABLE IF NOT EXISTS metadata_lookup_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  sources_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
