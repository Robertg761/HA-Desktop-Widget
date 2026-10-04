/** @jest-environment node */
const fs = require('fs');
const path = require('path');

const site = path.resolve(__dirname, '../../website');
const read = (file) => fs.readFileSync(path.join(site, file), 'utf8');
const pages = ['index', 'download', 'companion', 'privacy', 'terms'];
const html = Object.fromEntries(pages.map((page) => [page, read(`${page}.html`)]));
const vercel = JSON.parse(read('vercel.json'));
const headerValue = (key, source = '/(.*)') =>
  vercel.headers.find((rule) => rule.source === source).headers.find((h) => h.key === key)?.value;

describe('the website pages', () => {
  it.each(pages)(
    '%s has no inline script or style, which its content security policy forbids',
    (page) => {
      expect(html[page]).not.toMatch(/<script(?![^>]*\bsrc=)/);
      expect(html[page]).not.toMatch(/<style[\s>]/);
      expect(html[page]).not.toMatch(/\sstyle="/);
    }
  );

  it('sets a policy that allows what the pages load and nothing else', () => {
    const policy = headerValue('Content-Security-Policy');
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("style-src 'self'");
    expect(policy).toContain("connect-src 'self' https://api.github.com");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toContain('unsafe-inline');
    expect(headerValue('X-Content-Type-Options')).toBe('nosniff');
    expect(headerValue('Referrer-Policy')).toBeTruthy();
  });

  it('keeps the long cache on assets next to the headers for everything', () => {
    expect(headerValue('Cache-Control', '/assets/(.*)')).toMatch(/max-age/);
  });

  it.each(pages)('%s starts with a skip link to its main landmark', (page) => {
    expect(html[page]).toMatch(/<body>\s*<a class="skip-link" href="#main">/);
    expect(html[page]).toMatch(/<main[^>]* id="main"/);
  });

  it.each(pages)('%s carries the same navigation, footer links and share tags', (page) => {
    expect(html[page]).toContain('<a href="/#features">Features</a>');
    expect(html[page]).toContain('<a href="/#screenshots">Screenshots</a>');
    expect(html[page]).toContain('<a href="/companion"');
    expect(html[page]).not.toContain('href="/#cloud-sync"');
    for (const link of ['/download', '/privacy', '/terms', '/licenses.txt']) {
      expect(html[page]).toContain(`href="${link}"`);
    }
    expect(html[page]).toContain('property="og:title"');
    expect(html[page]).toContain('name="twitter:title"');
  });

  it('answers robots.txt and lists every page in the sitemap', () => {
    expect(read('robots.txt')).toContain('Sitemap: https://hadesktopwidget.com/sitemap.xml');
    const sitemap = read('sitemap.xml');
    for (const page of pages) {
      const url =
        page === 'index' ? 'https://hadesktopwidget.com/' : `https://hadesktopwidget.com/${page}`;
      expect(sitemap).toContain(`<loc>${url}</loc>`);
    }
  });

  it('gives the companion page a heading level for its tiles, and no mislabelled elements', () => {
    expect(html.companion).toContain('<h2 class="visually-hidden">');
    // aria-label is only valid on an element with a role, which a bare div or span has not.
    const labelled = html.companion
      .match(/<(?:div|span)\b[^>]*>/g)
      .filter((tag) => /\baria-label=/.test(tag));
    expect(labelled.filter((tag) => !/\brole=/.test(tag))).toEqual([]);
    expect(html.companion).not.toContain('Connected<span class="v on">Connected</span>');
  });
});

describe('the legal pages', () => {
  it('present Cloud Sync as the draft of a service that does not exist yet', () => {
    expect(html.terms).toMatch(/<title>Draft Cloud Sync terms/);
    expect(html.terms).toMatch(/<h1>[^<]*\(draft\)<\/h1>/);
    expect(html.terms).toMatch(/name="description" content="Draft terms/);
    expect(html.privacy).toMatch(/<h2>Planned Cloud Sync service \(draft\)<\/h2>/);
    expect(html.privacy).not.toMatch(
      /name="description" content="How HA Desktop Widget Cloud Sync handles/
    );
  });

  it('keeps the subscription price and trial off the home page', () => {
    expect(html.index).not.toMatch(/USD|14 day|per year|\/year/);
  });

  it('describes the requests the app and the site make, which the old page left out', () => {
    const privacy = html.privacy;
    for (const fact of [
      'api.github.com',
      'raw.githubusercontent.com',
      'about every six hours',
      'Receive beta updates',
      'local storage',
      'hdw-',
      'Vercel',
      'secure storage',
    ]) {
      expect(privacy).toContain(fact);
    }
    expect(privacy).not.toMatch(/does not describe features available in the 4\.0/);
  });

  it('never says 4.0 in a way that goes stale after the release', () => {
    for (const page of ['privacy', 'terms']) {
      expect(html[page]).not.toMatch(/4\.0 desktop app/);
    }
  });
});

describe('the licence notices', () => {
  const root = fs.readFileSync(path.resolve(__dirname, '../../THIRD-PARTY-NOTICES.txt'), 'utf8');
  // The licence texts themselves: the app's file has its own introductions and goes on to its libraries.
  const licenceText = (text) => {
    const ofl = text.slice(
      text.indexOf('SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007'),
      text.indexOf('FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE')
    );
    const isc = text.slice(
      text.indexOf('Permission to use, copy, modify'),
      text.indexOf('PERFORMANCE OF THIS SOFTWARE.')
    );
    return [ofl, isc].map((part) => part.replace(/\s+/g, ' ').trim());
  };

  it('ships the OFL text with each font copyright and the ISC text for Lucide, on the site as in the app', () => {
    const served = read('licenses.txt');
    for (const text of [root, served]) {
      expect(text).toContain('Copyright 2016 The Inter Project Authors');
      expect(text).toContain('Copyright 2020 The Plus Jakarta Sans Project Authors');
      expect(text).toContain('SIL OPEN FONT LICENSE Version 1.1');
      expect(text).toContain('ISC License');
    }
  });

  it('keeps the font and icon licence texts of the site equal to the app notices', () => {
    const [ofl, isc] = licenceText(read('licenses.txt'));
    expect(ofl.length).toBeGreaterThan(3000);
    expect(isc.length).toBeGreaterThan(500);
    expect([ofl, isc]).toEqual(licenceText(root));
  });
});
