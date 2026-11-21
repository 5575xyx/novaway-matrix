ALTER TABLE `super_agent_run` ADD `run_lease_until` integer;
--> statement-breakpoint
CREATE INDEX `super_agent_run_lease_idx` ON `super_agent_run` (`run_lease_until`);
