/**
 * Counts HA Desktop Widget installs from the app's anonymous daily ping
 * (src/usage-ping.cjs in the app). Stores the random install ID, the UTC days
 * it was first and last seen, and its latest version and OS family. It never
 * reads or stores the caller's IP address or user agent.
 *
 *   POST /v1/ping   {"id": "<uuid v4>", "version": "4.0.0", "os": "win32"}  -> 204
 *   GET  /v1/stats  Authorization: Bearer <STATS_TOKEN>                    -> JSON
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const VERSION_PATTERN = /^[0-9A-Za-z.+-]{1,32}$/;
const KNOWN_OS = new Set(['win32', 'darwin', 'linux', 'other']);
const MAX_BODY_BYTES = 1024;
const HISTORY_DAYS = 90;

export function utcDay(date) {
  return date.toISOString().slice(0, 10);
}

function daysBefore(day, days) {
  return utcDay(new Date(Date.parse(`${day}T00:00:00Z`) - days * 24 * 60 * 60 * 1000));
}

/** Returns the ping fields, or null when the body is not a well-formed ping. */
export function parsePing(body) {
  if (!body || typeof body !== 'object') return null;
  const { id, version, os } = body;
  if (typeof id !== 'string' || !UUID_PATTERN.test(id)) return null;
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) return null;
  if (typeof os !== 'string' || !KNOWN_OS.has(os)) return null;
  return { id, version, os };
}

/** Records one ping. Returns 'new', 'returning', or 'duplicate' (already counted today). */
export async function recordPing(db, { id, version, os }, day) {
  const existing = await db
    .prepare('SELECT last_seen FROM installs WHERE id = ?1')
    .bind(id)
    .first();
  if (existing && existing.last_seen >= day) return 'duplicate';

  const isNew = existing ? 0 : 1;
  await db.batch([
    db
      .prepare(
        `INSERT INTO installs (id, first_seen, last_seen, version, os) VALUES (?1, ?2, ?2, ?3, ?4)
         ON CONFLICT (id) DO UPDATE SET last_seen = excluded.last_seen,
           version = excluded.version, os = excluded.os`
      )
      .bind(id, day, version, os),
    db
      .prepare(
        `INSERT INTO daily_totals (day, active, new_installs) VALUES (?1, 1, ?2)
         ON CONFLICT (day) DO UPDATE SET active = active + 1,
           new_installs = new_installs + excluded.new_installs`
      )
      .bind(day, isNew),
  ]);
  return isNew ? 'new' : 'returning';
}

export async function readStats(db, today) {
  const since = (days) => daysBefore(today, days - 1);
  const [totals, byVersion, byOs, history] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS total_installs,
           SUM(last_seen >= ?1) AS active_today,
           SUM(last_seen >= ?2) AS active_7_days,
           SUM(last_seen >= ?3) AS active_30_days
         FROM installs`
      )
      .bind(today, since(7), since(30))
      .first(),
    db
      .prepare(
        `SELECT version, COUNT(*) AS installs FROM installs WHERE last_seen >= ?1
         GROUP BY version ORDER BY installs DESC`
      )
      .bind(since(30))
      .all(),
    db
      .prepare(
        `SELECT os, COUNT(*) AS installs FROM installs WHERE last_seen >= ?1
         GROUP BY os ORDER BY installs DESC`
      )
      .bind(since(30))
      .all(),
    db
      .prepare(
        `SELECT day, active, new_installs FROM daily_totals WHERE day >= ?1 ORDER BY day DESC`
      )
      .bind(since(HISTORY_DAYS))
      .all(),
  ]);

  return {
    generated_for_day: today,
    total_installs: totals?.total_installs ?? 0,
    active_today: totals?.active_today ?? 0,
    active_7_days: totals?.active_7_days ?? 0,
    active_30_days: totals?.active_30_days ?? 0,
    active_30_days_by_version: byVersion.results,
    active_30_days_by_os: byOs.results,
    daily: history.results,
  };
}

function isAuthorized(request, env) {
  const expected = env.STATS_TOKEN;
  if (typeof expected !== 'string' || expected.length < 16) return false;
  const header = request.headers.get('Authorization') || '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (supplied.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= supplied.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

const json = (status, body) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export async function handleRequest(request, env, now = new Date()) {
  const { pathname } = new URL(request.url);

  if (pathname === '/v1/ping') {
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return new Response(null, { status: 413 });
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return new Response(null, { status: 400 });
    }
    const ping = parsePing(body);
    if (!ping) return new Response(null, { status: 400 });
    await recordPing(env.DB, ping, utcDay(now));
    return new Response(null, { status: 204 });
  }

  if (pathname === '/v1/stats') {
    if (request.method !== 'GET') return new Response(null, { status: 405 });
    if (!isAuthorized(request, env)) return new Response(null, { status: 401 });
    return json(200, await readStats(env.DB, utcDay(now)));
  }

  return new Response(null, { status: 404 });
}

export default {
  fetch: (request, env) => handleRequest(request, env),
};
