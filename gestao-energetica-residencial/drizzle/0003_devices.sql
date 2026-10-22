CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`manufacturer` text NOT NULL,
	`model` text NOT NULL,
	`room` text NOT NULL,
	`circuit` text NOT NULL,
	`identifier` text NOT NULL,
	`data_source` text NOT NULL,
	`integration_status` text DEFAULT 'Integração não configurada' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
