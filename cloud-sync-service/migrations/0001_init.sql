-- HA Desktop Widget Cloud Sync: initial schema.
-- Times are milliseconds since the Unix epoch unless the column says otherwise.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT,
  created_at INTEGER NOT NULL
);

-- One row per sign-in method. Signing in with Google and GitHub under the same
-- verified email address lands on the same user.
CREATE TABLE identities (
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, provider_user_id)
);
CREATE INDEX identities_user ON identities(user_id);

-- A browser sign-in in progress: `id` is the state sent to Google or GitHub, the
-- rest is what the desktop app asked for.
CREATE TABLE oauth_states (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  app_state TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- One-time codes handed to the desktop app's loopback callback, redeemed with
-- the PKCE verifier for a session token.
CREATE TABLE handoff_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_challenge TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Only a SHA-256 hash of each session token is stored.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_name TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- The sync file, stored exactly as the app wrote it (plaintext or encrypted).
CREATE TABLE profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  body TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE subscriptions (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT,
  status TEXT,
  -- Seconds, as Stripe reports it.
  current_period_end INTEGER,
  -- Creation time (seconds) of the newest Stripe event applied, so a late,
  -- older event cannot roll the status back.
  event_created INTEGER,
  updated_at INTEGER NOT NULL
);
