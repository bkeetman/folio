-- pending changes for file operations
CREATE TABLE IF NOT EXISTS `pending_changes` (
  `id` text PRIMARY KEY NOT NULL,
  `file_id` text NOT NULL,
  `type` text NOT NULL,
  `from_path` text,
  `to_path` text,
  `changes_json` text,
  `status` text DEFAULT 'pending',
  `created_at` integer NOT NULL,
  `applied_at` integer,
  `error` text,
  FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE INDEX IF NOT EXISTS `pending_changes_status` ON `pending_changes` (`status`);
