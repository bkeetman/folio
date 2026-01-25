CREATE TABLE `authors` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sort_name` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `enrichment_results` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`source_id` text NOT NULL,
	`query_type` text NOT NULL,
	`query` text NOT NULL,
	`response_json` text NOT NULL,
	`confidence` real DEFAULT 0,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`) REFERENCES `enrichment_sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `enrichment_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`rate_limit_per_min` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text,
	`path` text NOT NULL,
	`filename` text NOT NULL,
	`extension` text NOT NULL,
	`mime_type` text,
	`size_bytes` integer,
	`sha256` text,
	`hash_algo` text DEFAULT 'sha256',
	`modified_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`status` text DEFAULT 'active',
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `identifiers` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`type` text NOT NULL,
	`value` text NOT NULL,
	`source` text,
	`confidence` real DEFAULT 0,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `identifiers_type_value` ON `identifiers` (`type`,`value`);--> statement-breakpoint
CREATE TABLE `issues` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text,
	`file_id` text,
	`type` text NOT NULL,
	`message` text,
	`severity` text DEFAULT 'info',
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `item_authors` (
	`item_id` text NOT NULL,
	`author_id` text NOT NULL,
	`role` text DEFAULT 'author',
	`ord` integer DEFAULT 0,
	PRIMARY KEY(`item_id`, `author_id`, `role`),
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `authors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `item_field_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`field` text NOT NULL,
	`source` text NOT NULL,
	`confidence` real DEFAULT 0,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `item_tags` (
	`item_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`source` text,
	`confidence` real DEFAULT 0,
	PRIMARY KEY(`item_id`, `tag_id`),
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text,
	`subtitle` text,
	`description` text,
	`language` text,
	`published_year` integer,
	`series` text,
	`series_index` real,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scan_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`path` text NOT NULL,
	`modified_at` integer,
	`size_bytes` integer,
	`sha256` text,
	`action` text NOT NULL,
	`file_id` text,
	FOREIGN KEY (`session_id`) REFERENCES `scan_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `scan_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`root_path` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized` text NOT NULL,
	`created_at` integer NOT NULL
);
