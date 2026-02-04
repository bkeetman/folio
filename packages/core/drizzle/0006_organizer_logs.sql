CREATE TABLE IF NOT EXISTS organizer_logs (
  id TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL,
  processed INTEGER NOT NULL,
  errors INTEGER NOT NULL,
  entries_json TEXT NOT NULL
);
