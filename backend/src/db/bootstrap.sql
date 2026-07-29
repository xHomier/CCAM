CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS cameras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  rtsp_port INTEGER NOT NULL DEFAULT 554,
  http_port INTEGER NOT NULL DEFAULT 80,
  username TEXT NOT NULL,
  password TEXT NOT NULL,
  channel INTEGER NOT NULL DEFAULT 0,
  continuous_stream TEXT NOT NULL DEFAULT 'sub',
  ai_types_enabled TEXT NOT NULL DEFAULT '["person","vehicle","pet"]',
  poll_interval_ms INTEGER NOT NULL DEFAULT 1500,
  event_cooldown_ms INTEGER NOT NULL DEFAULT 30000,
  retention_days INTEGER NOT NULL DEFAULT 14,
  event_retention_days INTEGER NOT NULL DEFAULT 30,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  camera_id INTEGER NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  clip_path TEXT,
  thumbnail_path TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS events_camera_id_idx ON events (camera_id);
CREATE INDEX IF NOT EXISTS events_started_at_idx ON events (started_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
