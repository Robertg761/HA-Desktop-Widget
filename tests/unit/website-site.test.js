/**
 * @jest-environment jsdom
 */

// website/site.js runs on every page of the live site. The site deploys when main changes, which is
// before 4.0.0 is published, so what it shows has to be right before and after that release: the
// version comes from GitHub or is left out, and the beta line only offers a newer minor or major.

const CHROME_ON_LINUX =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36';
const CHROMEBOOK =
  'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36';

const asset = (name) => ({ name, browser_download_url: `https://example.test/${name}` });
const release = (tag, extra = {}) => ({
  tag_name: tag,
  html_url: `https://example.test/releases/${tag}`,
  prerelease: false,
  draft: false,
  assets: [asset(`HA Desktop Widget-${tag.slice(1)}-linux-x86_64.AppImage`)],
  body: 'x'.repeat(5000),
  ...extra,
});

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

function setUserAgent(userAgent) {
  Object.defineProperty(window.navigator, 'userAgent', { value: userAgent, configurable: true });
}

// Loads site.js into a fresh module registry, as a page load would.
async function loadPage(html, { userAgent = CHROME_ON_LINUX, answers } = {}) {
  document.body.innerHTML = html;
  setUserAgent(userAgent);
  const requests = [];
  global.fetch = jest.fn((url) => {
    requests.push(url);
    const answer = answers ? answers(url) : null;
    return answer
      ? Promise.resolve({ ok: true, json: () => Promise.resolve(answer) })
      : Promise.resolve({ ok: false, status: 403 });
  });
  let site;
  jest.isolateModules(() => {
    site = require('../../website/site.js');
  });
  await flush();
  return { site, requests };
}

const FOOTER = '<span class="footer-version" data-version hidden></span>';
const DOWNLOAD = `
  <div id="recommend"><a id="rec-primary" href="#all"><span data-download-label>Choose</span></a>
    <p data-version data-version-prefix="Version " hidden></p>
    <p id="beta-line" hidden><a id="beta-link" href="#"></a></p>
    <p id="rec-arch" hidden></p>
    <details id="install-help"><summary id="install-summary"></summary>
      <p id="install-started" hidden></p><ol id="install-steps"><li>generic</li></ol>
      <p id="install-foot" hidden><a id="install-retry" href="#"></a></p></details></div>
  <p id="no-detect" hidden>computers</p>
  <main><a data-asset="linux-appimage" href="https://github.com/latest">AppImage</a></main>
  ${FOOTER}`;

const LATEST = '/releases/latest';
const LIST = '/releases?per_page=10';
const answersFor =
  ({ stable, list }) =>
  (url) =>
    url.endsWith(LATEST) ? stable : url.endsWith(LIST) ? list : null;

beforeEach(() => {
  sessionStorage.clear();
  document.documentElement.className = '';
});

describe('device detection', () => {
  const detect = async (userAgent, extra = {}) => {
    setUserAgent(userAgent);
    Object.defineProperty(window.navigator, 'maxTouchPoints', {
      value: 0,
      configurable: true,
      ...extra,
    });
    let site;
    jest.isolateModules(() => {
      global.fetch = jest.fn(() => Promise.resolve({ ok: false }));
      site = require('../../website/site.js');
    });
    await flush();
    return site.detectPlatform();
  };

  it('offers Linux builds to Linux and nothing to a Chromebook', async () => {
    expect(await detect(CHROME_ON_LINUX)).toEqual({ os: 'linux', mobile: false });
    // A Chromebook says "X11; CrOS", which the Linux test used to match, but no build runs there.
    expect(await detect(CHROMEBOOK)).toEqual({ os: null, mobile: false, chromeos: true });
  });

  it('keeps Windows, macOS and phones as they were', async () => {
    expect((await detect('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/150')).os).toBe(
      'windows'
    );
    expect((await detect('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605')).os).toBe(
      'mac'
    );
    expect((await detect('Mozilla/5.0 (Linux; Android 14) Chrome/150 Mobile')).mobile).toBe(true);
  });
});

describe('the beta to offer', () => {
  it('offers a beta that starts a newer minor or major, and only that', async () => {
    const { site } = await loadPage('');
    const stable = release('v3.11.0');
    const beta = release('v4.0.0-beta.12', { prerelease: true });
    expect(site.pickBeta(stable, [release('v3.11.1-beta.2', { prerelease: true }), beta])).toBe(
      beta
    );
    // The day 4.0.0 ships, the nightly build is 4.0.1-beta.1: the next fix, not news.
    expect(
      site.pickBeta(release('v4.0.0'), [release('v4.0.1-beta.1', { prerelease: true })])
    ).toBeNull();
    const next = release('v4.1.0-beta.1', { prerelease: true });
    expect(
      site.pickBeta(release('v4.0.0'), [release('v4.0.1-beta.1', { prerelease: true }), next])
    ).toBe(next);
  });

  it('ignores drafts and stable releases, and offers nothing without a stable release to compare', async () => {
    const { site } = await loadPage('');
    const draft = release('v5.0.0-beta.1', { prerelease: true, draft: true });
    expect(site.pickBeta(release('v4.0.0'), [draft, release('v4.2.0')])).toBeNull();
    expect(site.pickBeta(null, [release('v4.0.0-beta.1', { prerelease: true })])).toBeNull();
  });
});

describe('the version label', () => {
  it('shows the latest release from GitHub, and unhides the label', async () => {
    await loadPage(FOOTER, { answers: answersFor({ stable: release('v4.0.0') }) });
    const label = document.querySelector('[data-version]');
    expect(label.textContent).toBe('v4.0.0');
    expect(label.hidden).toBe(false);
  });

  it('shows no version at all, instead of a stale one, when GitHub cannot be reached', async () => {
    await loadPage(FOOTER);
    const label = document.querySelector('[data-version]');
    expect(label.textContent).toBe('');
    expect(label.hidden).toBe(true);
  });

  it('names no version in the page source, so a deploy before a release cannot go stale', () => {
    const fs = require('fs');
    const path = require('path');
    const site = path.resolve(__dirname, '../../website');
    for (const file of ['site.js', 'index.html', 'download.html', 'companion.html']) {
      expect(fs.readFileSync(path.join(site, file), 'utf8')).not.toMatch(/\bv\d+\.\d+\.\d+\b/);
    }
  });
});

describe('requests to GitHub', () => {
  const answers = answersFor({
    stable: release('v3.11.0'),
    list: [release('v4.0.0-beta.12', { prerelease: true })],
  });

  it('asks once on a page that only shows the version, and not at all on the next page', async () => {
    const first = await loadPage(FOOTER, { answers });
    expect(first.requests).toEqual([expect.stringContaining(LATEST)]);
    // Moving to another page of the site in the same tab.
    const second = await loadPage(FOOTER, { answers });
    expect(second.requests).toEqual([]);
    expect(document.querySelector('[data-version]').textContent).toBe('v3.11.0');
  });

  it('asks for the release list only on the download page', async () => {
    const { requests } = await loadPage(DOWNLOAD, { answers });
    expect(requests.filter((url) => url.endsWith(LATEST))).toHaveLength(1);
    expect(requests.filter((url) => url.endsWith(LIST))).toHaveLength(1);
  });

  it('keeps only what the pages read, so the stored answer stays small', async () => {
    await loadPage(FOOTER, { answers });
    const kept = JSON.parse(sessionStorage.getItem(`hdw-gh:releases/latest`));
    expect(kept.data.body).toBeUndefined();
    expect(kept.data.assets[0]).toEqual(asset('HA Desktop Widget-3.11.0-linux-x86_64.AppImage'));
  });
});

describe('the download page', () => {
  const stable = release('v3.11.0');

  it('offers a beta of a newer minor under a label that names it', async () => {
    const list = [release('v4.0.0-beta.12', { prerelease: true })];
    await loadPage(DOWNLOAD, { answers: answersFor({ stable, list }) });
    expect(document.getElementById('beta-line').hidden).toBe(false);
    expect(document.getElementById('beta-link').textContent).toBe('Try 4.0.0-beta.12');
  });

  it('says nothing about a beta once the stable release has caught up with it', async () => {
    const list = [release('v4.0.1-beta.1', { prerelease: true })];
    await loadPage(DOWNLOAD, { answers: answersFor({ stable: release('v4.0.0'), list }) });
    expect(document.getElementById('beta-line').hidden).toBe(true);
  });

  it('tells a Chromebook there is no build, instead of offering the Linux one', async () => {
    await loadPage(DOWNLOAD, {
      userAgent: CHROMEBOOK,
      answers: answersFor({ stable }),
    });
    expect(document.getElementById('recommend').hidden).toBe(true);
    const message = document.getElementById('no-detect');
    expect(message.hidden).toBe(false);
    expect(message.textContent).toMatch(/ChromeOS/);
  });

  it('adds the keyring requirement to the Linux steps', async () => {
    await loadPage(DOWNLOAD, { answers: answersFor({ stable }) });
    expect(document.getElementById('install-steps').textContent).toMatch(/keyring/i);
  });

  // A double-clicked AppImage exits without a window on Ubuntu 23.10 and later, and these steps
  // replace the page's own for every Linux visitor, so they are where the way around it has to be.
  // It belongs to the step that tells them to double-click, not to a step of its own after it.
  it('tells Ubuntu users what to do when the AppImage will not start', async () => {
    await loadPage(DOWNLOAD, { answers: answersFor({ stable }) });
    const start = [...document.querySelectorAll('#install-steps li')].find((step) =>
      /Double-click it to start/.test(step.textContent)
    );
    expect(start.textContent).toMatch(/Ubuntu 23\.10 and later.*\.deb.*--no-sandbox/);
    expect(start.querySelector('a').href).toBe(
      'https://github.com/Robertg761/HA-Desktop-Widget/blob/main/docs/linux-appimage.md'
    );
  });

  it('points the download button at the release page while GitHub cannot be reached', async () => {
    await loadPage(DOWNLOAD);
    expect(document.getElementById('rec-primary').href).toBe(
      'https://github.com/Robertg761/HA-Desktop-Widget/releases/latest'
    );
    expect(document.getElementById('beta-line').hidden).toBe(true);
  });
});

describe('scroll reveals', () => {
  it('reveals everything at once where the browser has no IntersectionObserver', async () => {
    await loadPage('<section><div class="reveal"></div><div class="reveal"></div></section>');
    expect(
      [...document.querySelectorAll('.reveal')].every((el) => el.classList.contains('in'))
    ).toBe(true);
  });

  it('keeps content the stylesheet fallback already showed when the script arrives late', async () => {
    global.IntersectionObserver = class {
      observe() {}
      unobserve() {}
    };
    try {
      await loadPage(
        '<section><div id="shown" class="reveal" style="opacity: 1"></div>' +
          '<div id="fading" class="reveal" style="opacity: 0.4"></div>' +
          '<div id="waiting" class="reveal" style="opacity: 0"></div></section>'
      );
    } finally {
      delete global.IntersectionObserver;
    }
    const revealed = (id) => document.getElementById(id).classList.contains('in');
    expect(revealed('shown')).toBe(true);
    expect(revealed('fading')).toBe(true);
    expect(revealed('waiting')).toBe(false);
  });

  it('marks the page script-driven, which ends the stylesheet fallback for blocked scripts', async () => {
    await loadPage('');
    expect(document.documentElement.classList.contains('js-ready')).toBe(true);
  });
});

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Version/19.0 Mobile/15E148 Safari/604.1';
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 Version/19.0 Safari/605.1.15';

describe('proof of use on the home page', () => {
  const pkg = (name, count) => ({ ...asset(name), download_count: count });
  const listed = (n, count) =>
    Array.from({ length: n }, (_, i) =>
      release(`v1.0.${i}`, { assets: [pkg('HA-x64-Setup.exe', count), pkg('latest.yml', 9999)] })
    );

  it('names the release, how long ago it came out, and the package downloads, rounded down', async () => {
    const answers = (url) =>
      url.endsWith(LATEST)
        ? release('v4.1.0', { published_at: new Date(Date.now() - 13 * 86400000).toISOString() })
        : url.endsWith('&page=1')
          ? listed(3, 2397)
          : null;
    const { requests } = await loadPage('<p id="proof"></p>', { answers });
    const text = document.getElementById('proof').textContent;
    expect(text).toBe('Latest v4.1.0, released 13 days ago · 7,100+ downloads');
    // Update metadata (latest.yml) is not a download of the app; three releases fit one page.
    expect(requests.filter((url) => url.includes('per_page=100'))).toHaveLength(1);
  });

  it('reads the next page only while a page comes back full', async () => {
    const answers = (url) =>
      url.endsWith(LATEST)
        ? release('v4.1.0')
        : url.endsWith('&page=1')
          ? listed(100, 10)
          : url.endsWith('&page=2')
            ? listed(18, 10)
            : null;
    const { requests } = await loadPage('<p id="proof"></p>', { answers });
    expect(requests.filter((url) => url.includes('per_page=100'))).toHaveLength(2);
    expect(document.getElementById('proof').textContent).toContain('1,100+ downloads');
  });

  it('leaves out a count it could not finish, rather than showing a low one', async () => {
    const answers = (url) =>
      url.endsWith(LATEST) ? release('v4.1.0') : url.endsWith('&page=1') ? listed(100, 10) : null;
    await loadPage('<p id="proof"></p>', { answers });
    expect(document.getElementById('proof').textContent).toBe('Latest v4.1.0');
  });

  it('shows the star count on the GitHub button once GitHub answers', async () => {
    const answers = (url) => (url.endsWith(REPO_PATH) ? { stargazers_count: 1234 } : null);
    await loadPage('<span data-stars hidden></span>', { answers });
    const stars = document.querySelector('[data-stars]');
    expect(stars.hidden).toBe(false);
    expect(stars.textContent).toBe('1,234 stars');
  });
});

const REPO_PATH = '/repos/Robertg761/HA-Desktop-Widget';

describe('dates and numbers in the proof line', () => {
  it('rounds down to a floor that stays true', async () => {
    const { site } = await loadPage('');
    expect(site.roundDown(7190)).toBe(7100);
    expect(site.roundDown(12345)).toBe(12000);
    expect(site.roundDown(987)).toBe(980);
  });

  it('says how long ago a release came out in words', async () => {
    const { site } = await loadPage('');
    const now = Date.parse('2026-11-15T12:00:00Z');
    expect(site.releasedAgo('2026-11-15T01:00:00Z', now)).toBe('today');
    expect(site.releasedAgo('2026-11-14T01:00:00Z', now)).toBe('yesterday');
    expect(site.releasedAgo('2026-11-02T12:00:00Z', now)).toBe('13 days ago');
    expect(site.releasedAgo('2026-08-01T12:00:00Z', now)).toBe('4 months ago');
  });
});

describe('phones and keyboards', () => {
  const BUTTON =
    '<a href="/download"><svg><use href="/assets/icons.svg#i-download"/></svg><span data-download-label>Download</span></a>';

  it('turns a phone’s Download buttons into sending the link to a computer', async () => {
    await loadPage(BUTTON, { userAgent: IPHONE });
    expect(document.querySelector('[data-download-label]').textContent).toBe(
      'Send to your computer'
    );
    expect(document.querySelector('use').getAttribute('href')).toContain('#i-send');
    navigator.share = jest.fn(() => Promise.resolve());
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.querySelector('a').dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(navigator.share).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://hadesktopwidget.com/download' })
    );
    delete navigator.share;
  });

  it('leaves a computer’s Download buttons alone', async () => {
    await loadPage(BUTTON, { userAgent: CHROME_ON_LINUX });
    expect(document.querySelector('[data-download-label]').textContent).toBe('Download for Linux');
  });

  it('prints the search shortcut as a Mac keyboard does', async () => {
    await loadPage('<kbd data-mod-key>Ctrl</kbd>', { userAgent: MAC });
    expect(document.querySelector('kbd').textContent).toBe('⌘');
  });
});

describe('the download page for one system', () => {
  it('names that system’s requirement and the warning to expect, and the size of each file', async () => {
    const html = DOWNLOAD.replace(
      '<p id="beta-line"',
      '<p id="rec-req">all</p><p id="rec-warn" hidden><span data-warn-text></span></p><p id="beta-line"'
    ).replace('>AppImage</a>', '>AppImage<span data-size hidden></span></a>');
    const big = { ...asset('HA Desktop Widget-3.11.0-linux-x86_64.AppImage'), size: 131 * 1048576 };
    const answers = (url) => (url.endsWith(LATEST) ? release('v3.11.0', { assets: [big] }) : null);
    await loadPage(html, { answers });
    expect(document.getElementById('rec-req').textContent).toBe('64-bit Linux (x86_64).');
    // Linux has no unsigned-app prompt to warn about.
    expect(document.getElementById('rec-warn').hidden).toBe(true);
    const size = document.querySelector('main [data-size]');
    expect(size.hidden).toBe(false);
    expect(size.textContent).toBe('131 MB');
  });
});
