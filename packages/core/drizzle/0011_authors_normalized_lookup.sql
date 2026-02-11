ALTER TABLE authors ADD COLUMN normalized_name TEXT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_authors_normalized_name ON authors (normalized_name);
