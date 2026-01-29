-- eReader device configurations
CREATE TABLE IF NOT EXISTS ereader_devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mount_path TEXT NOT NULL,
  device_type TEXT DEFAULT 'generic',
  books_subfolder TEXT DEFAULT '',
  last_connected_at INTEGER,
  created_at INTEGER NOT NULL
);

-- Sync queue for pending operations
CREATE TABLE IF NOT EXISTS ereader_sync_queue (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  item_id TEXT,
  ereader_path TEXT,
  action TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (device_id) REFERENCES ereader_devices(id) ON DELETE CASCADE
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_sync_queue_device ON ereader_sync_queue(device_id);
CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON ereader_sync_queue(status);
