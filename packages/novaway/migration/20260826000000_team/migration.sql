CREATE TABLE `team` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`root_session_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `team_root_session_idx` ON `team` (`root_session_id`);
--> statement-breakpoint
CREATE TABLE `team_member` (
	`team_id` text NOT NULL,
	`session_id` text NOT NULL,
	`name` text NOT NULL,
	`agent` text NOT NULL,
	`role` text DEFAULT 'worker' NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`current_task_id` text,
	`worktree_path` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `team_member_team_idx` ON `team_member` (`team_id`);
--> statement-breakpoint
CREATE TABLE `agent_task` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`subject` text NOT NULL,
	`description` text NOT NULL,
	`active_form` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`owner_session_id` text,
	`blocks` text DEFAULT '[]' NOT NULL,
	`blocked_by` text DEFAULT '[]' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_task_team_idx` ON `agent_task` (`team_id`);
--> statement-breakpoint
CREATE INDEX `agent_task_owner_idx` ON `agent_task` (`owner_session_id`);
--> statement-breakpoint
CREATE TABLE `agent_message` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`from_session_id` text NOT NULL,
	`to_session_id` text,
	`broadcast` integer DEFAULT 0 NOT NULL,
	`summary` text,
	`content` text NOT NULL,
	`read_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_message_to_idx` ON `agent_message` (`to_session_id`);
--> statement-breakpoint
CREATE INDEX `agent_message_team_idx` ON `agent_message` (`team_id`);
