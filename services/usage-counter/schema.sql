-- One row per install. Only the random install ID, the UTC days it was first
-- and last seen, and its latest app version and OS family. No IP addresses,
-- user agents or anything else about the person or computer.
CREATE TABLE IF NOT EXISTS installs (
  id TEXT PRIMARY KEY,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  version TEXT NOT NULL,
  os TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS installs_last_seen ON installs (last_seen);

-- Per-day totals, so the history survives installs that later go quiet.
CREATE TABLE IF NOT EXISTS daily_totals (
  day TEXT PRIMARY KEY,
  active INTEGER NOT NULL DEFAULT 0,
  new_installs INTEGER NOT NULL DEFAULT 0
);
