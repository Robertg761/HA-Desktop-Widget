-- One account per verified email address. Two first sign-ins with the same address
-- (Google and GitHub at once, or a double-clicked sign-in) could otherwise each create a
-- user, splitting the synced settings and the subscription between them.
CREATE UNIQUE INDEX users_email ON users(email) WHERE email IS NOT NULL;
