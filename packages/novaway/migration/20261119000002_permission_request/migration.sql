CREATE TABLE `permission_request` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `session_id` text NOT NULL,
  `permission` text NOT NULL,
  `patterns` text NOT NULL,
  `metadata` text NOT NULL,
  `always` text NOT NULL,
  `tool` text,
  `status` text DEFAULT 'pending' NOT NULL,
  `reply` text,
  `message` text,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `project` (`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `permission_request_project_status_idx` ON `permission_request` (`project_id`,`status`,`time_updated`);
--> statement-breakpoint
CREATE INDEX `permission_request_session_idx` ON `permission_request` (`session_id`,`time_updated`);
