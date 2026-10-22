CREATE TABLE `tuya_connections` (
	`user_id` text PRIMARY KEY NOT NULL,
	`account_key` text NOT NULL,
	`connected_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tuya_energy_events` (
	`user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`event_key` text NOT NULL,
	`date` text NOT NULL,
	`room` text NOT NULL,
	`circuit` text NOT NULL,
	`kwh` real NOT NULL,
	`event_time` integer NOT NULL,
	PRIMARY KEY(`user_id`, `device_id`, `event_key`)
);
--> statement-breakpoint
CREATE TABLE `tuya_mappings` (
	`user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`account_key` text NOT NULL,
	`room` text NOT NULL,
	`circuit` text NOT NULL,
	`energy_code` text,
	`energy_mode` text NOT NULL,
	`since` integer NOT NULL,
	`last_log_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `device_id`)
);
--> statement-breakpoint
-- O evento e o consumo diário são atômicos. Eventos já recebidos não disparam este trigger.
CREATE TRIGGER tuya_energy_event_to_reading AFTER INSERT ON tuya_energy_events
BEGIN
  INSERT INTO tuya_readings(id,user_id,device_id,date,room,circuit,kwh)
  VALUES(lower(hex(randomblob(16))),NEW.user_id,NEW.device_id,NEW.date,NEW.room,NEW.circuit,NEW.kwh)
  ON CONFLICT(user_id,device_id,date,room,circuit) DO UPDATE SET kwh=tuya_readings.kwh+excluded.kwh;
END;
