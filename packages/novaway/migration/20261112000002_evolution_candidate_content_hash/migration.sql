ALTER TABLE `evolution_candidate` ADD `content_hash` text;
--> statement-breakpoint
CREATE INDEX `evolution_candidate_content_idx` ON `evolution_candidate` (`content_hash`);
