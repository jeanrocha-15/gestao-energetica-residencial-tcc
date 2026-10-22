-- Acrescenta tarifas e autenticação local, sem modificar as medições existentes.
CREATE TABLE tariffs (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  config TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (start_date <= end_date)
);
CREATE INDEX idx_tariffs_user_period ON tariffs(user_id, start_date, end_date);
-- A validação no banco também protege contra cadastros concorrentes e intervalos inclusivos.
CREATE TRIGGER tariffs_no_overlap_insert BEFORE INSERT ON tariffs
WHEN EXISTS (SELECT 1 FROM tariffs WHERE user_id=NEW.user_id AND start_date<=NEW.end_date AND end_date>=NEW.start_date)
BEGIN SELECT RAISE(ABORT, 'TARIFF_OVERLAP'); END;
CREATE TRIGGER tariffs_no_overlap_update BEFORE UPDATE ON tariffs
WHEN EXISTS (SELECT 1 FROM tariffs WHERE user_id=NEW.user_id AND id<>NEW.id AND start_date<=NEW.end_date AND end_date>=NEW.start_date)
BEGIN SELECT RAISE(ABORT, 'TARIFF_OVERLAP'); END;
CREATE TABLE local_users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL
);
CREATE TABLE local_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES local_users(id),
  expires_at INTEGER NOT NULL
);
