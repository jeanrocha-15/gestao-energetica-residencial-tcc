-- Mantém os dados automáticos separados dos lançamentos manuais.
CREATE TABLE tuya_counters (user_id TEXT NOT NULL, device_id TEXT NOT NULL, total REAL NOT NULL, date TEXT NOT NULL, mapping TEXT NOT NULL, checked_at TEXT NOT NULL, PRIMARY KEY(user_id, device_id));
CREATE TABLE tuya_readings (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, device_id TEXT NOT NULL, date TEXT NOT NULL, room TEXT NOT NULL, circuit TEXT NOT NULL, kwh REAL NOT NULL, UNIQUE(user_id, device_id, date, room, circuit));
CREATE TABLE tuya_locks (user_id TEXT PRIMARY KEY NOT NULL, token TEXT NOT NULL, expires_at INTEGER NOT NULL);
