CREATE TABLE `plugin_state` (
	`plugin_id` text NOT NULL,
	`scope` text NOT NULL,
	`source` text NOT NULL,
	`root` text,
	`version` text,
	`fingerprint` text,
	`enabled` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'installed' NOT NULL,
	`install_order` integer,
	`overrides` text,
	`permissions` text,
	`last_error` text,
	`activated_at` integer,
	`installed_at` integer,
	`updated_at` integer NOT NULL,
	CONSTRAINT `plugin_state_pk` PRIMARY KEY(`plugin_id`, `scope`)
);
--> statement-breakpoint
CREATE INDEX `plugin_state_status_idx` ON `plugin_state` (`status`);
--> statement-breakpoint
CREATE TABLE `plugin_kv` (
	`plugin_id` text NOT NULL,
	`namespace` text DEFAULT 'default' NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `plugin_kv_pk` PRIMARY KEY(`plugin_id`, `namespace`, `key`)
);
--> statement-breakpoint
CREATE TABLE `plugin_migration` (
	`plugin_id` text NOT NULL,
	`namespace` text NOT NULL,
	`version` integer NOT NULL,
	`applied_at` integer NOT NULL,
	CONSTRAINT `plugin_migration_pk` PRIMARY KEY(`plugin_id`, `namespace`, `version`)
);
