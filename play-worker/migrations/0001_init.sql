-- Play app: users + finished session ledger (Cloudflare D1)

CREATE TABLE IF NOT EXISTS play_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS play_sessions (
  id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL,
  host_user_id TEXT NOT NULL,
  config_json TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  duration_hours REAL NOT NULL,
  settlement_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_play_sessions_host ON play_sessions(host_user_id);
CREATE INDEX IF NOT EXISTS idx_play_sessions_ended ON play_sessions(ended_at);
