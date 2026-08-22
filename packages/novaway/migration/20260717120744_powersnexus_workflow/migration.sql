CREATE TABLE `powersnexus_change_binding` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`worktree` text NOT NULL,
	`change_name` text NOT NULL,
	`root_session_id` text,
	`powersnexus_version` text NOT NULL,
	`powersnexus_digest` text NOT NULL,
	`protocol_version` text NOT NULL,
	`level` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`todo_artifact_revision` integer DEFAULT 0 NOT NULL,
	`todo_session_revision` integer DEFAULT 0 NOT NULL,
	`todo_origin` text DEFAULT 'artifact' NOT NULL,
	`archive_action_id` text,
	`archive_request_digest` text,
	`archive_path` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_powersnexus_change_binding_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_powersnexus_change_binding_root_session_id_session_id_fk` FOREIGN KEY (`root_session_id`) REFERENCES `session`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `powersnexus_run` (
	`id` text PRIMARY KEY,
	`binding_id` text NOT NULL,
	`action` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempt` integer DEFAULT 1 NOT NULL,
	`snapshot_revision` integer NOT NULL,
	`fingerprint` text,
	`error_code` text,
	`log_directory` text NOT NULL,
	`recovery_policy` text NOT NULL,
	`evidence_files` text DEFAULT '[]' NOT NULL,
	`time_started` integer,
	`time_ended` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_powersnexus_run_binding_id_powersnexus_change_binding_id_fk` FOREIGN KEY (`binding_id`) REFERENCES `powersnexus_change_binding`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `powersnexus_run_step` (
	`id` text PRIMARY KEY,
	`run_id` text NOT NULL,
	`step_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`kind` text DEFAULT 'profile' NOT NULL,
	`profile_step_id` text NOT NULL,
	`argv` text NOT NULL,
	`cwd` text NOT NULL,
	`timeout_ms` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`exit_code` integer,
	`stdout_file` text,
	`stderr_file` text,
	`artifacts` text DEFAULT '[]' NOT NULL,
	`evidence_digest` text,
	`time_started` integer,
	`time_ended` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_powersnexus_run_step_run_id_powersnexus_run_id_fk` FOREIGN KEY (`run_id`) REFERENCES `powersnexus_run`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `powersnexus_binding_change_idx` ON `powersnexus_change_binding` (`project_id`,`worktree`,`change_name`);
--> statement-breakpoint
CREATE UNIQUE INDEX `powersnexus_binding_root_session_idx` ON `powersnexus_change_binding` (`root_session_id`);
--> statement-breakpoint
CREATE INDEX `powersnexus_binding_project_active_idx` ON `powersnexus_change_binding` (`project_id`,`active`);
--> statement-breakpoint
CREATE INDEX `powersnexus_binding_digest_idx` ON `powersnexus_change_binding` (`powersnexus_digest`);
--> statement-breakpoint
CREATE INDEX `powersnexus_run_binding_idx` ON `powersnexus_run` (`binding_id`);
--> statement-breakpoint
CREATE INDEX `powersnexus_run_status_idx` ON `powersnexus_run` (`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `powersnexus_run_step_identity_idx` ON `powersnexus_run_step` (`run_id`,`step_id`);
--> statement-breakpoint
CREATE INDEX `powersnexus_run_step_status_idx` ON `powersnexus_run_step` (`status`);
