CREATE TABLE `tuya_oauth_accounts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`account_key` text NOT NULL,
	`app_uid` text NOT NULL,
	`tokens` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tuya_oauth_accounts_account_key_unique` ON `tuya_oauth_accounts` (`account_key`);--> statement-breakpoint
CREATE TABLE `tuya_oauth_states` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_hash` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tuya_sync_state` (
	`user_id` text PRIMARY KEY NOT NULL,
	`next_run_at` integer DEFAULT 0 NOT NULL,
	`last_attempt_at` integer,
	`last_success_at` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`message` text DEFAULT 'Aguardando coleta.' NOT NULL
);
