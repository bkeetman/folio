-- Query indexes for large library performance in desktop views.
CREATE INDEX IF NOT EXISTS `idx_files_item_status` ON `files` (`item_id`, `status`);
CREATE INDEX IF NOT EXISTS `idx_files_status_item` ON `files` (`status`, `item_id`);

CREATE INDEX IF NOT EXISTS `idx_item_authors_item_ord` ON `item_authors` (`item_id`, `ord`);
CREATE INDEX IF NOT EXISTS `idx_item_authors_author_item` ON `item_authors` (`author_id`, `item_id`);

CREATE INDEX IF NOT EXISTS `idx_covers_item_created_at` ON `covers` (`item_id`, `created_at`);
CREATE INDEX IF NOT EXISTS `idx_identifiers_item_type` ON `identifiers` (`item_id`, `type`);

CREATE INDEX IF NOT EXISTS `idx_item_tags_tag_item` ON `item_tags` (`tag_id`, `item_id`);
CREATE INDEX IF NOT EXISTS `idx_items_created_at` ON `items` (`created_at`);
CREATE INDEX IF NOT EXISTS `idx_items_published_year` ON `items` (`published_year`);

CREATE INDEX IF NOT EXISTS `idx_tags_normalized` ON `tags` (`normalized`);
