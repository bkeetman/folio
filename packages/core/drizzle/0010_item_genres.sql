CREATE TABLE IF NOT EXISTS item_genres (
  id TEXT PRIMARY KEY NOT NULL,
  item_id TEXT NOT NULL,
  genre TEXT NOT NULL,
  raw_value TEXT,
  source TEXT NOT NULL,
  confidence REAL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (item_id) REFERENCES items(id) ON UPDATE no action ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS item_genres_item_genre_source
  ON item_genres (item_id, genre, source);
