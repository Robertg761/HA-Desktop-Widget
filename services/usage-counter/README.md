# Usage counter

A Cloudflare Worker that counts how many HA Desktop Widget installs are in use.
GitHub release downloads can't do this: every update downloads again, so the
same person shows up once per release.

## What the app sends

Once per UTC day, packaged builds `POST` this to `https://usage.hadesktopwidget.com/v1/ping`
(see [`src/usage-ping.cjs`](../../src/usage-ping.cjs)):

```json
{ "id": "6f1c2a9e-3b7d-4f0a-9c55-2e8d1b4a7f60", "version": "4.0.0", "os": "win32" }
```

- `id` is a random UUID made the first time the app runs. It is stored in
  `usage-ping.json` in the app's profile folder, outside `config.json`, so
  profile sync and settings export never copy it to another computer.
- Nothing else is sent: no Home Assistant URL, entities, settings, hostname or
  usage events.
- The Worker never reads or stores IP addresses or user agents, and Workers
  Logs are off in `wrangler.toml`.

It is off by default: users opt in with **Settings → Updates → Count this
install**. Setting `DO_NOT_TRACK=1` or `HA_WIDGET_DISABLE_USAGE_PING=1` in the
environment stops it even when the setting is on. Development, demo and smoke-test runs never send it.

## Deploying

The counter is live at `usage.hadesktopwidget.com`, and `wrangler.toml` holds
its database id. To ship a change to the Worker, run `npx wrangler deploy` from
this folder. The steps below set it up from scratch on a Cloudflare account
(the free plan is enough).

```bash
cd services/usage-counter
npx wrangler login
npx wrangler d1 create ha-desktop-widget-usage     # paste the database_id into wrangler.toml
npx wrangler d1 execute ha-desktop-widget-usage --remote --file=schema.sql
npx wrangler secret put STATS_TOKEN                # a long random string, e.g. `openssl rand -hex 32`
npx wrangler deploy
```

The `[[routes]]` block in `wrangler.toml` serves the Worker on
`usage.hadesktopwidget.com`, which needs the `hadesktopwidget.com` zone on
Cloudflare. If the domain stays elsewhere, delete that block, deploy, and set
`USAGE_PING_URL` in `src/usage-ping.cjs` to the `*.workers.dev` URL that
`wrangler deploy` prints, followed by `/v1/ping`. Either way the app only sends
pings from the release that includes this code onward.

## Reading the numbers

```bash
curl -H "Authorization: Bearer $STATS_TOKEN" https://usage.hadesktopwidget.com/v1/stats
```

```json
{
  "generated_for_day": "2026-10-02",
  "total_installs": 1840,
  "active_today": 612,
  "active_7_days": 1103,
  "active_30_days": 1377,
  "active_30_days_by_version": [{ "version": "4.0.1", "installs": 1201 }, "..."],
  "active_30_days_by_os": [{ "os": "win32", "installs": 1015 }, "..."],
  "daily": [{ "day": "2026-10-02", "active": 612, "new_installs": 14 }, "..."]
}
```

- `active_30_days` is the best answer to "how many people use it": installs
  that pinged at least once in the last 30 days.
- `total_installs` counts every install ever seen, including ones since
  removed. A reinstall that wipes the profile folder counts as a new install.
- `daily` keeps per-day totals for the last 90 days.

Anyone can send pings, so a determined person could inflate the count. Turn on
a Cloudflare rate-limiting rule for `/v1/ping` if that ever happens.
