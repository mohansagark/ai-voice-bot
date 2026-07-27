CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  name TEXT,
  question TEXT NOT NULL,
  session_id TEXT,
  source TEXT NOT NULL DEFAULT 'agent',
  user_agent TEXT,
  referer TEXT,
  preferred_time TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_email      ON leads(email);
