-- Remembers which sign-ins have already had their free trial, so deleting an account and
-- signing in again does not start a new one. Only a keyed hash of the provider identity and
-- the day the trial began are kept; no email address and no provider user ID.
CREATE TABLE consumed_trials (
  identity_hash TEXT PRIMARY KEY,
  -- When the trial began (milliseconds), the original account's created_at.
  trial_started_at INTEGER NOT NULL
);
