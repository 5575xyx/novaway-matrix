ALTER TABLE `evolution_candidate` ADD `content_format` text DEFAULT 'content' NOT NULL;
--> statement-breakpoint
UPDATE `evolution_candidate`
SET `content_format` = 'unified_diff'
WHERE substr(trim(`content`), 1, 4) = '--- '
	AND instr(trim(`content`), char(10) || '+++ ') > 0
	AND instr(trim(`content`), char(10) || '@@') > 0;
