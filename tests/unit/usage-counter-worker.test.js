/**
 * @jest-environment node
 */

const {
  default: worker,
  handleRequest,
  parsePing,
  readStats,
  recordPing,
} = require('../../services/usage-counter/src/index.js');

const fs = require('fs');
const path = require('path');

// node:sqlite (Node 22+) runs the real schema and SQL. CI on Node 20 skips
// the database tests and still checks validation and auth.
let DatabaseSync = null;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}

/** The subset of the D1 binding API the Worker uses, backed by SQLite. */
function createD1(database) {
  const prepare = (sql) => {
    const statement = {
      params: [],
      bind(...params) {
        return { ...statement, params };
      },
      async first() {
        return database.prepare(sql).get(...this.params) ?? null;
      },
      async all() {
        return { results: database.prepare(sql).all(...this.params) };
      },
      run() {
        database.prepare(sql).run(...this.params);
      },
    };
    return statement;
  };
  return {
    prepare,
    async batch(statements) {
      database.exec('BEGIN');
      try {
        statements.forEach((statement) => statement.run());
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

const ID_A = '6f1c2a9e-3b7d-4f0a-9c55-2e8d1b4a7f60';
const ID_B = '0b8e5d2c-1a4f-4e7b-8d3c-9f6a2b1c4e5d';
const TOKEN = 'a'.repeat(32);

const pingRequest = (body) =>
  new Request('https://usage.example/v1/ping', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('usage counter worker: validation', () => {
  test('accepts a well-formed ping', () => {
    expect(parsePing({ id: ID_A, version: '4.0.1-beta.2', os: 'linux', extra: 1 })).toEqual({
      id: ID_A,
      version: '4.0.1-beta.2',
      os: 'linux',
    });
  });

  test.each([
    [null],
    [{ id: 'not-a-uuid', version: '4.0.1', os: 'linux' }],
    [{ id: ID_A.toUpperCase(), version: '4.0.1', os: 'linux' }],
    [{ id: ID_A, version: '<script>', os: 'linux' }],
    [{ id: ID_A, version: '4.0.1', os: 'beos' }],
  ])('rejects %j', (body) => {
    expect(parsePing(body)).toBeNull();
  });

  test('rejects malformed requests before touching the database', async () => {
    const env = { DB: { prepare: jest.fn() } };
    expect((await handleRequest(pingRequest('{oops'), env)).status).toBe(400);
    expect((await handleRequest(pingRequest({ id: 'x' }), env)).status).toBe(400);
    expect((await handleRequest(pingRequest('x'.repeat(2000)), env)).status).toBe(413);
    expect((await handleRequest(new Request('https://usage.example/v1/ping'), env)).status).toBe(
      405
    );
    expect((await handleRequest(new Request('https://usage.example/'), env)).status).toBe(404);
    expect(env.DB.prepare).not.toHaveBeenCalled();
  });

  test('stats need the bearer token', async () => {
    const env = { DB: { prepare: jest.fn() }, STATS_TOKEN: TOKEN };
    const stats = (headers) =>
      handleRequest(new Request('https://usage.example/v1/stats', { headers }), env);

    expect((await stats({})).status).toBe(401);
    expect((await stats({ Authorization: `Bearer ${'b'.repeat(32)}` })).status).toBe(401);
    expect((await stats({ Authorization: TOKEN })).status).toBe(401);
    // A missing or short secret never opens the endpoint.
    expect(
      (
        await handleRequest(
          new Request('https://usage.example/v1/stats', { headers: { Authorization: 'Bearer ' } }),
          { DB: env.DB }
        )
      ).status
    ).toBe(401);
    expect(env.DB.prepare).not.toHaveBeenCalled();
  });

  test('exports a fetch handler', () => {
    expect(typeof worker.fetch).toBe('function');
  });
});

(DatabaseSync ? describe : describe.skip)('usage counter worker: counting', () => {
  let db;

  beforeEach(() => {
    const database = new DatabaseSync(':memory:');
    database.exec(
      fs.readFileSync(path.resolve(__dirname, '../../services/usage-counter/schema.sql'), 'utf8')
    );
    db = createD1(database);
  });

  test('counts each install once per day and tracks new vs returning', async () => {
    const ping = { id: ID_A, version: '4.0.0', os: 'win32' };
    await expect(recordPing(db, ping, '2026-10-01')).resolves.toBe('new');
    await expect(recordPing(db, ping, '2026-10-01')).resolves.toBe('duplicate');
    await expect(recordPing(db, { ...ping, version: '4.0.1' }, '2026-10-02')).resolves.toBe(
      'returning'
    );
    await recordPing(db, { id: ID_B, version: '4.0.1', os: 'linux' }, '2026-10-02');

    const stats = await readStats(db, '2026-10-02');
    expect(stats).toMatchObject({
      total_installs: 2,
      active_today: 2,
      active_7_days: 2,
      active_30_days: 2,
      active_30_days_by_version: [{ version: '4.0.1', installs: 2 }],
      daily: [
        { day: '2026-10-02', active: 2, new_installs: 1 },
        { day: '2026-10-01', active: 1, new_installs: 1 },
      ],
    });
  });

  test('installs drop out of the active windows when they stop pinging', async () => {
    await recordPing(db, { id: ID_A, version: '4.0.0', os: 'win32' }, '2026-08-01');
    await recordPing(db, { id: ID_B, version: '4.0.1', os: 'darwin' }, '2026-09-28');

    const stats = await readStats(db, '2026-10-02');
    expect(stats).toMatchObject({
      total_installs: 2,
      active_today: 0,
      active_7_days: 1,
      active_30_days: 1,
      active_30_days_by_os: [{ os: 'darwin', installs: 1 }],
    });
  });

  test('a ping over HTTP is recorded and readable through /v1/stats', async () => {
    const env = { DB: db, STATS_TOKEN: TOKEN };
    const now = new Date('2026-10-02T08:00:00Z');
    const response = await handleRequest(
      pingRequest({ id: ID_A, version: '4.0.1', os: 'win32' }),
      env,
      now
    );
    expect(response.status).toBe(204);

    const statsResponse = await handleRequest(
      new Request('https://usage.example/v1/stats', {
        headers: { Authorization: `Bearer ${TOKEN}` },
      }),
      env,
      now
    );
    expect(statsResponse.status).toBe(200);
    expect(await statsResponse.json()).toMatchObject({ total_installs: 1, active_today: 1 });
  });
});
