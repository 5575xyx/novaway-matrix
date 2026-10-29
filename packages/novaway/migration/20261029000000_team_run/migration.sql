CREATE TABLE `employee` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`job` text NOT NULL,
	`model` text,
	`skills` text,
	`prompt` text,
	`tier` text,
	`archived_at` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `employee_job_idx` ON `employee` (`job`);
--> statement-breakpoint
CREATE INDEX `employee_archived_idx` ON `employee` (`archived_at`);
--> statement-breakpoint
CREATE TABLE `team_profile` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`captain_member` text NOT NULL,
	`policy` text,
	`auto_eligible` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `team_profile_member` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`employee_id` text NOT NULL,
	`role` text DEFAULT 'worker' NOT NULL,
	`duty` text,
	`can_auto_dispatch` integer DEFAULT 1 NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`overrides` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `team_profile_member_profile_idx` ON `team_profile_member` (`profile_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_profile_member_unique` ON `team_profile_member` (`profile_id`,`employee_id`);
--> statement-breakpoint
CREATE TABLE `team_run` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`directory` text NOT NULL,
	`mode` text DEFAULT 'team' NOT NULL,
	`goal` text NOT NULL,
	`brief` text,
	`acceptance` text,
	`plan` text,
	`plan_version` integer DEFAULT 0 NOT NULL,
	`approval` text,
	`state` text DEFAULT 'planning' NOT NULL,
	`phase` text,
	`round_main` integer DEFAULT 0 NOT NULL,
	`attempts` text DEFAULT '{"business":0,"formatRetry":0}' NOT NULL,
	`budget` text,
	`usage` text,
	`merged_verification` text,
	`started_at` integer,
	`ended_at` integer,
	`error` text,
	`terminal_reason` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `team_run_session_idx` ON `team_run` (`session_id`);
--> statement-breakpoint
CREATE INDEX `team_run_state_idx` ON `team_run` (`state`);
--> statement-breakpoint
CREATE TABLE `team_run_team` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`profile_id` text,
	`profile_version` integer,
	`phase` text DEFAULT 'queued' NOT NULL,
	`round_captain` integer DEFAULT 0 NOT NULL,
	`report` text,
	`verdict` text,
	`worktree` text,
	`roster_snapshot` text,
	`depends_on` text,
	`artifacts_out` text,
	`usage` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `team_run_team_run_idx` ON `team_run_team` (`run_id`);
--> statement-breakpoint
CREATE TABLE `team_run_event` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`seq` integer NOT NULL,
	`at` integer NOT NULL,
	`kind` text NOT NULL,
	`payload` text,
	`lease_epoch` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_run_event_seq` ON `team_run_event` (`run_id`,`seq`);
--> statement-breakpoint
CREATE TABLE `team_acceptance` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`task_id` text,
	`spec_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`text` text NOT NULL,
	`kind` text NOT NULL,
	`expected` text,
	`verifier` text,
	`owner` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `team_acceptance_run_idx` ON `team_acceptance` (`run_id`);
--> statement-breakpoint
CREATE TABLE `team_verification` (
	`id` text PRIMARY KEY NOT NULL,
	`acceptance_id` text NOT NULL,
	`run_id` text NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`snapshot_id` text NOT NULL,
	`verifier_version` text NOT NULL,
	`outcome` text NOT NULL,
	`measured` text,
	`evidence_ref` text,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `team_verification_acceptance_idx` ON `team_verification` (`acceptance_id`);
--> statement-breakpoint
CREATE INDEX `team_verification_run_idx` ON `team_verification` (`run_id`);
--> statement-breakpoint
CREATE TABLE `team_run_op` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`task_id` text,
	`session_id` text,
	`tool` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`outcome` text DEFAULT 'unknown' NOT NULL,
	`effect` text,
	`lease_epoch` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_run_op_key` ON `team_run_op` (`run_id`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `team_run_op_run_idx` ON `team_run_op` (`run_id`);
--> statement-breakpoint
CREATE TABLE `team_run_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`actor` text NOT NULL,
	`reserved_tokens` integer DEFAULT 0 NOT NULL,
	`reserved_cost` text,
	`settled_tokens` integer DEFAULT 0 NOT NULL,
	`settled_cost` text,
	`state` text DEFAULT 'reserved' NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `team_run_ledger_run_idx` ON `team_run_ledger` (`run_id`);
--> statement-breakpoint
CREATE INDEX `team_run_ledger_state_idx` ON `team_run_ledger` (`state`);
