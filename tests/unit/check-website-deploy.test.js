/** @jest-environment node */
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const {
  compareDeployment,
  expectedHeaders,
  listFiles,
  servedPath,
} = require('../../scripts/check-website-deploy.cjs');

const HEADERS = [{ key: 'X-Content-Type-Options', value: 'nosniff' }];
const ASSET_CACHE = 'public, max-age=86400';
// The site-wide rule, and one for a part of the site only, as website/vercel.json has.
const WITH_ASSET_RULE = JSON.stringify({
  headers: [
    { source: '/(.*)', headers: HEADERS },
    { source: '/assets/(.*)', headers: [{ key: 'Cache-Control', value: ASSET_CACHE }] },
  ],
});

function makeSite(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-widget-site-'));
  const all = {
    'index.html': '<h1>home</h1>',
    'privacy.html': '<h1>privacy</h1>',
    'site.js': 'export {};',
    'assets/icon.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    'vercel.json': JSON.stringify({ headers: [{ source: '/(.*)', headers: HEADERS }] }),
    '.gitignore': '.vercel',
    ...files,
  };
  for (const [file, content] of Object.entries(all)) {
    const target = path.join(dir, ...file.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return dir;
}

// Serves a directory the way the host does: clean URLs, and the configured headers.
function serve(dir, { headers = true, assetCache = true } = {}) {
  const server = http.createServer((request, response) => {
    let pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/') pathname = '/index';
    const candidates = [pathname, `${pathname}.html`].map((entry) =>
      path.join(dir, ...entry.split('/'))
    );
    const file = candidates.find((entry) => fs.existsSync(entry) && fs.statSync(entry).isFile());
    if (!file || /vercel\.json$/.test(file)) {
      response.writeHead(404);
      response.end('not found');
      return;
    }
    const sent = headers ? { 'x-content-type-options': 'nosniff' } : {};
    if (assetCache && pathname.startsWith('/assets/')) sent['cache-control'] = ASSET_CACHE;
    response.writeHead(200, sent);
    response.end(fs.readFileSync(file));
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` })
    )
  );
}

describe('check-website-deploy', () => {
  let servers = [];
  afterEach(async () => {
    await Promise.all(servers.map(({ server }) => new Promise((resolve) => server.close(resolve))));
    servers = [];
  });
  const start = async (...args) => {
    const started = await serve(...args);
    servers.push(started);
    return started.baseUrl;
  };

  it('maps files to the paths the host serves', () => {
    expect(servedPath('index.html')).toBe('/');
    expect(servedPath('privacy.html')).toBe('/privacy');
    expect(servedPath('site.js')).toBe('/site.js');
    expect(servedPath('assets/icon.png')).toBe('/assets/icon.png');
  });

  it('lists what the host serves, with forward slashes, and not its configuration', () => {
    expect(listFiles(makeSite())).toEqual([
      'assets/icon.png',
      'index.html',
      'privacy.html',
      'site.js',
    ]);
  });

  it('reads the headers every page must carry from vercel.json', () => {
    expect(expectedHeaders(makeSite())).toEqual({ 'x-content-type-options': 'nosniff' });
  });

  it('finds nothing wrong with a deployment that matches', async () => {
    const dir = makeSite();
    expect(await compareDeployment({ baseUrl: await start(dir), siteDir: dir })).toEqual([]);
  });

  it('names a page that is out of date, and one that is missing', async () => {
    const deployed = makeSite();
    const checkout = makeSite({
      'index.html': '<h1>new home</h1>',
      'terms.html': '<h1>terms</h1>',
    });
    const problems = await compareDeployment({
      baseUrl: await start(deployed),
      siteDir: checkout,
    });
    expect(problems).toEqual([
      expect.stringMatching(/\/: differs from website\/index\.html/),
      expect.stringMatching(/\/terms: HTTP 404/),
    ]);
  });

  it('notices a deployment that dropped the configured headers', async () => {
    const dir = makeSite();
    const problems = await compareDeployment({
      baseUrl: await start(dir, { headers: false }),
      siteDir: dir,
    });
    expect(problems).toEqual([expect.stringMatching(/x-content-type-options/)]);
  });

  it('holds each path to the header rules that cover it, not only the site-wide one', async () => {
    const dir = makeSite({ 'vercel.json': WITH_ASSET_RULE });
    expect(expectedHeaders(dir, '/assets/icon.png')).toEqual({
      'x-content-type-options': 'nosniff',
      'cache-control': ASSET_CACHE,
    });
    expect(expectedHeaders(dir, '/privacy')).toEqual({ 'x-content-type-options': 'nosniff' });

    expect(await compareDeployment({ baseUrl: await start(dir), siteDir: dir })).toEqual([]);
    // A deployment that kept the site-wide headers but lost the asset cache rule is caught.
    const problems = await compareDeployment({
      baseUrl: await start(dir, { assetCache: false }),
      siteDir: dir,
    });
    expect(problems).toEqual([expect.stringMatching(/cache-control .* on \/assets\/icon\.png$/)]);
  });

  it('reports a body that fails part way as a problem to retry, not an error', async () => {
    const dir = makeSite();
    const problems = await compareDeployment({
      baseUrl: 'http://example.test',
      siteDir: dir,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'x-content-type-options': 'nosniff' }),
        arrayBuffer: () => Promise.reject(new Error('socket hang up')),
      }),
    });
    expect(problems).toHaveLength(listFiles(dir).length);
    expect(problems.every((problem) => problem.endsWith('socket hang up'))).toBe(true);
  });

  it('reports a site that cannot be reached instead of throwing', async () => {
    const dir = makeSite();
    const problems = await compareDeployment({
      baseUrl: 'http://127.0.0.1:1',
      siteDir: dir,
      fetchImpl: () => Promise.reject(new Error('connect ECONNREFUSED')),
    });
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0]).toMatch(/ECONNREFUSED/);
  });

  it('checks the repository website against its own configuration', () => {
    const site = path.resolve(__dirname, '../../website');
    expect(listFiles(site)).toEqual(
      expect.arrayContaining(['index.html', 'site.js', 'robots.txt'])
    );
    expect(expectedHeaders(site)['content-security-policy']).toContain("script-src 'self'");
  });
});
