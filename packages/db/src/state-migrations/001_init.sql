CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  user_id TEXT,
  thread_id TEXT,
  session_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_active_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_session_key ON sessions(session_key);
CREATE INDEX IF NOT EXISTS idx_sessions_platform_chat ON sessions(platform, chat_id);

CREATE TABLE IF NOT EXISTS turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT,
  tool_calls TEXT,
  tool_call_id TEXT,
  exit_reason TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id, created_at);

CREATE TABLE IF NOT EXISTS platform_state (
  platform TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
