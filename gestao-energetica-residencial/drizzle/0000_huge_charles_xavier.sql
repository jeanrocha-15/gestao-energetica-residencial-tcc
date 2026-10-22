CREATE TABLE `readings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`room` text NOT NULL,
	`circuit` text NOT NULL,
	`kwh` real NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_readings_user_date_room_circuit` ON `readings` (`user_id`,`date`,`room`,`circuit`);