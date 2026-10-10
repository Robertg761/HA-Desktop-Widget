-- Keep pending Checkout sessions so retries reuse the payment page and account
-- deletion can expire it. Locks serialize checkout creation and deletion.
CREATE TABLE billing_checkouts (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  request_key TEXT NOT NULL,
  stripe_params TEXT NOT NULL,
  stripe_session_id TEXT,
  url TEXT,
  expires_at INTEGER NOT NULL
);

CREATE TABLE billing_operations (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
