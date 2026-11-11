CREATE TABLE `__new_plugin_state` (
	`plugin_id` text NOT NULL,
	`scope` text NOT NULL,
	`instance_key` text DEFAULT '' NOT NULL,
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
	CONSTRAINT `plugin_state_pk` PRIMARY KEY(`plugin_id`, `scope`, `instance_key`)
);
--> statement-breakpoint
INSERT INTO `__new_plugin_state` (
	`plugin_id`, `scope`, `instance_key`, `source`, `root`, `version`, `fingerprint`,
	`enabled`, `status`, `install_order`, `overrides`, `permissions`, `last_error`,
	`activated_at`, `installed_at`, `updated_at`
) SELECT
	`plugin_id`, `scope`, '', `source`, `root`, `version`, `fingerprint`,
	`enabled`, `status`, `install_order`, `overrides`, `permissions`, `last_error`,
	`activated_at`, `installed_at`, `updated_at`
FROM `plugin_state`;
--> statement-breakpoint
DROP TABLE `plugin_state`;
--> statement-breakpoint
ALTER TABLE `__new_plugin_state` RENAME TO `plugin_state`;
--> statement-breakpoint
CREATE INDEX `plugin_state_status_idx` ON `plugin_state` (`status`);
