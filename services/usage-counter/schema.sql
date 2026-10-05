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

-- Per-day totals, so the history survives installs that later go quiet. The
-- triggers below keep them in step with installs inside the same statement, so
-- overlapping pings from one install are counted once.
CREATE TABLE IF NOT EXISTS daily_totals (
  day TEXT PRIMARY KEY,
  active INTEGER NOT NULL DEFAULT 0,
  new_installs INTEGER NOT NULL DEFAULT 0
);

CREATE TRIGGER IF NOT EXISTS installs_count_new AFTER INSERT ON installs
BEGIN
  INSERT INTO daily_totals (day, active, new_installs) VALUES (NEW.last_seen, 1, 1)
  ON CONFLICT (day) DO UPDATE SET active = active + 1, new_installs = new_installs + 1;
END;

CREATE TRIGGER IF NOT EXISTS installs_count_returning AFTER UPDATE OF last_seen ON installs
WHEN NEW.last_seen > OLD.last_seen
BEGIN
  INSERT INTO daily_totals (day, active, new_installs) VALUES (NEW.last_seen, 1, 0)
  ON CONFLICT (day) DO UPDATE SET active = active + 1;
END;
