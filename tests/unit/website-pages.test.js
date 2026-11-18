/** @jest-environment node */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const site = path.resolve(__dirname, '../../website');
const read = (file) => fs.readFileSync(path.join(site, file), 'utf8');
const pages = ['index', 'download', 'faq', 'companion', 'privacy', 'terms'];
const html = Object.fromEntries(pages.map((page) => [page, read(`${page}.html`)]));
const vercel = JSON.parse(read('vercel.json'));
const headerValue = (key, source = '/(.*)') =>
  vercel.headers.find((rule) => rule.source === source).headers.find((h) => h.key === key)?.value;

describe('the website pages', () => {
  it.each(pages)(
    '%s has no inline script or style, which its content security policy forbids',
    (page) => {
      // Structured data is the one exception: browsers never run a JSON-LD block, so the policy
      // does not apply to it.
      expect(html[page]).not.toMatch(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/ld\+json")/);
      expect(html[page]).not.toMatch(/<style[\s>]/);
      expect(html[page]).not.toMatch(/\sstyle="/);
    }
  );

  it('sets a policy that allows what the pages load and nothing else', () => {
    const policy = headerValue('Content-Security-Policy');
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("style-src 'self'");
    expect(policy).toContain("connect-src 'self' https://api.github.com");
    expect(policy).toContain("media-src 'self'");
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
    for (const link of ['/download', '/faq', '/privacy', '/terms', '/licenses.txt']) {
      expect(html[page]).toContain(`href="${link}"`);
    }
    expect(html[page]).toContain('property="og:title"');
    expect(html[page]).toContain('name="twitter:title"');
  });

  it('redirects www to the bare domain, so search engines index one copy of each page', () => {
    expect(vercel.redirects).toContainEqual({
      // (.*) matches the home page too; /:path* left www.hadesktopwidget.com/ serving a copy.
      source: '/(.*)',
      has: [{ type: 'host', value: 'www.hadesktopwidget.com' }],
      destination: 'https://hadesktopwidget.com/$1',
      permanent: true,
    });
  });

  it('describes the app to search engines in structured data that parses', () => {
    const blocks = [
      ...html.index.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
    ];
    expect(blocks).toHaveLength(1);
    const graph = JSON.parse(blocks[0][1])['@graph'];
    const app = graph.find((node) => node['@type'] === 'SoftwareApplication');
    expect(app.offers).toEqual({ '@type': 'Offer', price: '0', priceCurrency: 'USD' });
    expect(app.operatingSystem).toMatch(/Windows.*macOS.*Linux/);
    for (const url of [app.image, ...app.screenshot]) {
      const file = url.replace('https://hadesktopwidget.com/', '');
      expect(fs.existsSync(path.join(site, file))).toBe(true);
    }
  });

  it.each(pages)('%s has its own title, description and canonical address', (page) => {
    const url =
      page === 'index' ? 'https://hadesktopwidget.com/' : `https://hadesktopwidget.com/${page}`;
    expect(html[page]).toContain(`<link rel="canonical" href="${url}">`);
    expect(html[page]).toContain(`<meta property="og:url" content="${url}">`);
    expect(html[page]).toMatch(/<meta name="description" content="[^"]{50,}">/);
    expect(html[page]).toContain('name="twitter:image:alt"');
  });

  it('answers a missing address with a page that links back and is kept out of search', () => {
    const notFound = read('404.html');
    expect(notFound).toContain('<meta name="robots" content="noindex">');
    expect(notFound).not.toContain('rel="canonical"');
    expect(notFound).toMatch(/<body>\s*<a class="skip-link" href="#main">/);
    expect(notFound).toContain('href="/download"');
  });

  it('answers robots.txt and lists every page in the sitemap', () => {
    expect(read('robots.txt')).toContain('Sitemap: https://hadesktopwidget.com/sitemap.xml');
    const sitemap = read('sitemap.xml');
    for (const page of pages) {
      const url =
        page === 'index' ? 'https://hadesktopwidget.com/' : `https://hadesktopwidget.com/${page}`;
      expect(sitemap).toMatch(
        new RegExp(`<loc>${url}</loc><lastmod>\\d{4}-\\d{2}-\\d{2}</lastmod>`)
      );
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
  it('present Cloud Sync as a live service', () => {
    expect(html.terms).toMatch(/<title>Cloud Sync terms/);
    expect(html.terms).not.toMatch(/<title>Draft Cloud Sync terms/);
    expect(html.terms).toMatch(/<h1>Cloud Sync subscription terms<\/h1>/);
    expect(html.terms).not.toMatch(/name="description" content="Draft terms/);
    expect(html.privacy).toMatch(/<h2>Cloud Sync service<\/h2>/);
    expect(html.privacy).not.toMatch(/<h2>Planned Cloud Sync service \(draft\)<\/h2>/);
  });

  it('presents Cloud Sync on the home page as available, not planned', () => {
    expect(html.index).toContain('Cloud Sync');
    expect(html.index).not.toMatch(/planned separately|proposed (hosted )?service|not final/);
    expect(html.index).not.toMatch(/the draft <a href="\/(privacy|terms)"/);
  });

  // The price was kept off the home page while it was only proposed. Now the service is live, the
  // home page names it, so the one rule is that it says what the terms say.
  it('names the same Cloud Sync price and trial on the home page as the terms', () => {
    const [, price] = html.terms.match(/subscription is USD (\d+) per year/) || [];
    expect(price).toBeTruthy();
    expect(html.index).toContain(`USD ${price} <span>a year</span>`);
    expect(html.terms).toMatch(/for 14 days without a subscription or payment card/);
    expect(html.index).toContain('14-day free trial, no card needed');
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

describe('the narrow and the keyboard-only views', () => {
  const css = read('styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const media = (query) =>
    css.match(new RegExp(`@media \\(${query}\\) \\{\\n([\\s\\S]*?)\\n\\}`))?.[1] ?? '';

  // At 420px and under the header shows the icon without the name, so the first paragraph is the
  // only place on a phone's first screen that says what the product is called.
  it('names the product in the first paragraph of the home page', () => {
    expect(media('max-width: 420px')).toMatch(/\.brand span \{ display: none; \}/);
    expect(html.index).toMatch(/<p class="lede">\s*HA Desktop Widget is /);
  });

  // Hung from its button the 200px panel started 21px off the left of a 320px screen.
  it('hangs the menu from the header, inside both edges, on the narrowest screens', () => {
    const narrow = media('max-width: 420px');
    expect(narrow).toMatch(/\.nav-menu \{ position: static; \}/);
    expect(narrow).toMatch(/\.nav-menu-panel \{[^}]*left: 12px; right: 12px; min-width: 0; \}/);
  });

  // Each card of the gallery fades in when it is first seen. In the sideways strip that meant a
  // swipe showed empty cards for a moment.
  it('shows the cards of the gallery strip without a fade', () => {
    const strip = media('max-width: 1020px');
    expect(strip).toMatch(/\.gallery \{[^}]*overflow-x: auto/);
    expect(strip).toMatch(
      /\.gallery \.shot\.reveal \{ opacity: 1; transform: none; transition: none;/
    );
  });

  // An 820px column of 16px text ran to about 100 characters a line.
  it('keeps the text pages to a readable line', () => {
    const width = Number(css.match(/\.legal-page \{ max-width: (\d+)px;/)?.[1]);
    expect(width).toBeGreaterThanOrEqual(560);
    expect(width).toBeLessThanOrEqual(680);
  });

  // A linked section brings its own top padding; adding the page's scroll padding to it put the
  // heading a quarter of the way down the screen.
  it('lands a linked section with its heading under the header', () => {
    const padding = Number(css.match(/html \{[^}]*scroll-padding-top: (\d+)px/)?.[1]);
    expect(css).toContain(`.section[id] { scroll-margin-top: -${padding}px; }`);
  });

  // The demo has about thirty controls between the hero buttons and the rest of the page.
  it('lets a keyboard step over the demo, and names each pin button after its tile', () => {
    expect(html.index).toMatch(
      /<div class="stage-wrap">\s*<a class="skip-link skip-demo" href="#features">Skip the demo<\/a>/
    );
    expect(html.index).toContain('<section id="features"');
    const demo = read('script.js');
    expect(demo).toContain('`Pin ${e.name} to the desktop`');
    expect(demo).toContain('`Unpin ${e.name}`');
  });

  it('keeps the no-script screenshot in proportion', () => {
    expect(css).toMatch(/\.noscript-shot img \{[^}]*width: 100%; height: auto;/);
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

  // The screenshots are WebP, which every browser that runs on a system the app supports shows
  // (Safari has since macOS 11; the app needs macOS 13). The no-script hero keeps a PNG fallback.
  it('shows screenshots that exist, as WebP, and keeps the PNG fallback for the no-script hero', () => {
    const media = [...html.index.matchAll(/(?:src|poster|href)="\/assets\/app\/([\w.-]+)"/g)].map(
      (m) => m[1]
    );
    expect(media.length).toBeGreaterThanOrEqual(10);
    for (const name of media) {
      expect(name).toMatch(/\.(webp|mp4)$/);
      expect(fs.existsSync(path.join(site, 'assets/app', name))).toBe(true);
    }
    expect(html.index).toContain(
      '<picture><source srcset="/assets/Main_View.webp" type="image/webp"><img src="/assets/Main_View.png"'
    );
  });

  it('gives every new screenshot its size and words for a screen reader', () => {
    for (const [tag] of html.index.matchAll(/<img [^>]*src="\/assets\/app\/[^>]*>/g)) {
      expect(tag).toMatch(/ alt="[^"]{12,}"/);
      expect(tag).toMatch(/ width="\d+" height="\d+"/);
    }
    expect(html.index).toMatch(/<video [^>]*muted[^>]*loop[^>]*playsinline/);
  });

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
