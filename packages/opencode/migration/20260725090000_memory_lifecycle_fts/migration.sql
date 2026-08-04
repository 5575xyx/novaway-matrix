ALTER TABLE `memory_entry` ADD `domain` text DEFAULT 'general' NOT NULL;
--> statement-breakpoint
ALTER TABLE `memory_entry` ADD `fact_key` text;
--> statement-breakpoint
ALTER TABLE `memory_entry` ADD `confidence` real DEFAULT 0.7 NOT NULL;
--> statement-breakpoint
ALTER TABLE `memory_entry` ADD `version` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `memory_entry` ADD `supersedes_id` text;
--> statement-breakpoint
ALTER TABLE `memory_entry` ADD `valid_from` integer;
--> statement-breakpoint
ALTER TABLE `memory_entry` ADD `valid_to` integer;
--> statement-breakpoint
ALTER TABLE `memory_entry` ADD `last_confirmed_at` integer;
--> statement-breakpoint
CREATE INDEX `memory_entry_domain_idx` ON `memory_entry` (`domain`);
--> statement-breakpoint
CREATE INDEX `memory_entry_fact_key_idx` ON `memory_entry` (`fact_key`);
--> statement-breakpoint
CREATE INDEX `memory_entry_valid_to_idx` ON `memory_entry` (`valid_to`);
--> statement-breakpoint
ALTER TABLE `memory_review_candidate` ADD `domain` text DEFAULT 'general' NOT NULL;
--> statement-breakpoint
ALTER TABLE `memory_review_candidate` ADD `fact_key` text;
--> statement-breakpoint
ALTER TABLE `memory_review_candidate` ADD `operation` text DEFAULT 'add' NOT NULL;
--> statement-breakpoint
ALTER TABLE `memory_review_candidate` ADD `confidence` real DEFAULT 0.7 NOT NULL;
--> statement-breakpoint
CREATE INDEX `memory_review_candidate_domain_idx` ON `memory_review_candidate` (`domain`);
--> statement-breakpoint
CREATE INDEX `memory_review_candidate_operation_idx` ON `memory_review_candidate` (`operation`);
--> statement-breakpoint
ALTER TABLE `evolution_candidate` ADD `domain` text DEFAULT 'general' NOT NULL;
--> statement-breakpoint
ALTER TABLE `evolution_candidate` ADD `validation_status` text DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
ALTER TABLE `evolution_candidate` ADD `validation_note` text;
--> statement-breakpoint
CREATE INDEX `evolution_candidate_domain_idx` ON `evolution_candidate` (`domain`);
--> statement-breakpoint
CREATE INDEX `evolution_candidate_validation_status_idx` ON `evolution_candidate` (`validation_status`);
--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS `memory_entry_fts` USING fts5(
  `id` UNINDEXED,
  `content`,
  `summary`,
  `tags`,
  `domain` UNINDEXED,
  tokenize = 'trigram'
);
--> statement-breakpoint
INSERT INTO `memory_entry_fts`(`id`, `content`, `summary`, `tags`, `domain`)
SELECT `id`, `content`, COALESCE(`summary`, ''), COALESCE(`tags`, '[]'), COALESCE(`domain`, 'general')
FROM `memory_entry`;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `memory_entry_ai` AFTER INSERT ON `memory_entry` BEGIN
  INSERT INTO `memory_entry_fts`(`id`, `content`, `summary`, `tags`, `domain`)
  VALUES (new.`id`, new.`content`, COALESCE(new.`summary`, ''), COALESCE(new.`tags`, '[]'), COALESCE(new.`domain`, 'general'));
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `memory_entry_ad` AFTER DELETE ON `memory_entry` BEGIN
  DELETE FROM `memory_entry_fts` WHERE `id` = old.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `memory_entry_au` AFTER UPDATE ON `memory_entry` BEGIN
  DELETE FROM `memory_entry_fts` WHERE `id` = old.`id`;
  INSERT INTO `memory_entry_fts`(`id`, `content`, `summary`, `tags`, `domain`)
  VALUES (new.`id`, new.`content`, COALESCE(new.`summary`, ''), COALESCE(new.`tags`, '[]'), COALESCE(new.`domain`, 'general'));
END;
