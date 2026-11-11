CREATE TABLE `dwf_run` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_session_id` text,
	`cwd` text NOT NULL,
	`name` text,
	`script_text` text NOT NULL,
	`script_hash` text NOT NULL,
	`script_path` text,
	`args_json` text,
	`tool_call_id` text,
	`resumed_from` text,
	`caps_max_concurrency` integer NOT NULL,
	`spent_tokens` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`stop_reason` text,
	`result_json` text,
	`failure_json` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `dwf_run_cwd_idx` ON `dwf_run` (`cwd`,`time_updated`);
--> statement-breakpoint
CREATE INDEX `dwf_run_session_idx` ON `dwf_run` (`parent_session_id`,`time_updated`);
--> statement-breakpoint
CREATE TABLE `dwf_actor` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`site_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`name` text,
	`persona_json` text,
	`session_id` text,
	`resolved_model` text,
	`time_created` integer NOT NULL,
	CONSTRAINT `fk_dwf_actor_run_id_dwf_run_id_fk` FOREIGN KEY (`run_id`) REFERENCES `dwf_run`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dwf_actor_site_idx` ON `dwf_actor` (`run_id`,`site_id`,`ordinal`);
--> statement-breakpoint
CREATE TABLE `dwf_node` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`site_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`kind` text NOT NULL,
	`actor_site_id` text,
	`actor_ordinal` integer,
	`actor_seq` integer,
	`phase_name` text,
	`input_hash` text NOT NULL,
	`input_json` text,
	`status` text NOT NULL,
	`result_json` text,
	`error_json` text,
	`stats_json` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_dwf_node_run_id_dwf_run_id_fk` FOREIGN KEY (`run_id`) REFERENCES `dwf_run`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dwf_node_instance_idx` ON `dwf_node` (`run_id`,`site_id`,`ordinal`);
--> statement-breakpoint
CREATE INDEX `dwf_node_kind_idx` ON `dwf_node` (`run_id`,`kind`);
--> statement-breakpoint
CREATE TABLE `dwf_event` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	`time_created` integer NOT NULL,
	CONSTRAINT `fk_dwf_event_run_id_dwf_run_id_fk` FOREIGN KEY (`run_id`) REFERENCES `dwf_run`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dwf_event_seq_idx` ON `dwf_event` (`run_id`,`sequence`);
