CREATE TABLE `covers` (
CREATE TABLE `covers` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`source` text NOT NULL,
	`url` text,
	`local_path` text,
	`width` integer,
	`height` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action
);
