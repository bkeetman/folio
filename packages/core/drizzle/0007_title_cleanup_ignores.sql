CREATE TABLE IF NOT EXISTS title_cleanup_ignores (
  item_id TEXT PRIMARY KEY NOT NULL,
  title_snapshot TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
);
