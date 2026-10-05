/** @jest-environment node */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

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

// The alpha of every pixel of an 8-bit RGBA PNG that is not interlaced, which is what the icons are.
function pngAlpha(file) {
  const png = fs.readFileSync(file);
  let offset = 8;
  let header;
  const data = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('latin1', offset + 4, offset + 8);
    const body = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') header = body;
    if (type === 'IDAT') data.push(body);
    offset += 12 + length;
  }
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  expect([header[8], header[9], header[12]]).toEqual([8, 6, 0]);
  const raw = zlib.inflateSync(Buffer.concat(data));
  const stride = width * 4;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const row = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    const above = rows[y - 1] || Buffer.alloc(stride);
    for (let i = 0; i < stride; i += 1) {
      const left = i >= 4 ? row[i - 4] : 0;
      const up = above[i];
      const upLeft = i >= 4 ? above[i - 4] : 0;
      const p = left + up - upLeft;
      const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
      const paeth = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      row[i] = (row[i] + [0, left, up, (left + up) >> 1, paeth][filter]) & 255;
    }
    rows.push(row);
  }
  return { width, height, alphaAt: (x, y) => rows[y][x * 4 + 3] };
}

describe('the facts under the home page buttons', () => {
  const css = read('styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const declarations = (selector) =>
    css.match(
      new RegExp(`(?:^|\\})\\s*${selector.replace(/[.()[\]]/g, '\\$&')}\\s*\\{([^}]*)\\}`)
    )?.[1] ?? '';

  // The longest fact wraps on a phone. As a flex item its text filled the row and was centred in
  // it, while the check mark, the other flex item, stayed at the row's edge, far from the words.
  it('keep the check mark of a fact that wraps beside its first word', () => {
    expect(html.index).toContain('<ul class="facts"');
    expect(declarations('.facts li')).not.toMatch(/display:\s*flex/);
    expect(declarations('.facts li::before')).toMatch(/display:\s*inline-block/);
  });
});

describe('the website images', () => {
  const shareImages = (page) => [
    html[page].match(/property="og:image" content="([^"]+)"/)?.[1],
    html[page].match(/name="twitter:image" content="([^"]+)"/)?.[1],
  ];

  it.each(pages)(
    '%s names its share card with a version, so cached link previews refresh',
    (page) => {
      // The card was redrawn at the same address; Slack, X and other link previews keep an image they
      // have seen for a long time, so the address changes whenever the picture does.
      const [openGraph, twitter] = shareImages(page);
      expect(openGraph).toMatch(/^https:\/\/hadesktopwidget\.com\/assets\/og\.png\?v=\d{8}$/);
      expect(twitter).toBe(openGraph);
    }
  );

  it('shows the app icon of the packages, not the old square one', () => {
    const packaged = path.resolve(__dirname, '../../build/icons/64x64.png');
    expect(fs.readFileSync(path.join(site, 'assets/icon.png'))).toEqual(fs.readFileSync(packaged));
    for (const file of ['assets/icon.png', 'assets/icon-180.png']) {
      const icon = pngAlpha(path.join(site, file));
      const { width, height, alphaAt } = icon;
      // Rounded with a margin: transparent in the corners, opaque in the middle.
      expect([alphaAt(0, 0), alphaAt(width - 1, height - 1)]).toEqual([0, 0]);
      expect(alphaAt(width >> 1, height >> 1)).toBe(255);
    }
    expect(pngAlpha(path.join(site, 'assets/icon-180.png')).width).toBe(180);
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
