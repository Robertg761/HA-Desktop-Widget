// Shared by every page: nav state, scroll reveals, device detection and the
// latest GitHub release (version label and direct download links).

export const REPO = 'Robertg761/HA-Desktop-Widget';

const ASSET_PATTERNS = {
  'win-setup': /win-x64-Setup\.exe$/,
  'win-portable': /win-x64-Portable\.exe$/,
  'mac-dmg': /universal\.dmg$/,
  'mac-zip': /universal-mac\.zip$/,
  'linux-appimage': /x86_64\.AppImage$/,
  'linux-deb': /amd64\.deb$/,
};

/* The one build the download page recommends for each platform. */
const PLATFORMS = {
  windows: { label: 'Windows', primary: 'win-setup' },
  mac: { label: 'macOS', primary: 'mac-dmg' },
  linux: { label: 'Linux', primary: 'linux-appimage' },
};

/* What to do after downloading each file. The last step is the same everywhere. */
const CONNECT = 'Enter your Home Assistant address and approve it in your browser.';
const SMARTSCREEN = 'If Windows shows a SmartScreen warning, click <b>More info</b>, then <b>Run anyway</b>. The app isn’t code-signed yet.';
const GATEKEEPER = 'The first time, <b>Control-click</b> the app and choose <b>Open</b>. If macOS still blocks it, open <b>System Settings → Privacy &amp; Security</b> and choose <b>Open Anyway</b>. The build isn’t notarized yet.';
/* Signing in is stored in the system keyring, and a minimal desktop (i3, Sway, Hyprland) may not run one. */
const KEYRING = 'Remembering your sign-in needs a running keyring, such as <b>GNOME Keyring</b> or <b>KWallet</b>. Most desktops have one; on a minimal setup, install and start one first.';
/* Ubuntu 23.10 and later stop an AppImage from starting Chromium's sandbox, so a double-clicked one
   exits without a window. It goes with the double-click step, which is the one that fails, and the
   guide in docs/ has the ways around it. */
const APPIMAGE_SANDBOX = 'On Ubuntu 23.10 and later it closes without opening a window, so use the .deb instead, or <a href="https://github.com/Robertg761/HA-Desktop-Widget/blob/main/docs/linux-appimage.md" target="_blank" rel="noopener">start it once with <code>--no-sandbox</code></a>.';
/* What the download page says under its button once it knows the system. */
const REQUIREMENTS = {
  windows: 'Windows 10 or 11, 64-bit.',
  mac: 'macOS 13 Ventura or later, on Intel or Apple silicon.',
  linux: '64-bit Linux (x86_64).',
};
/* The step most likely to stop an install, said before the download rather than after it. */
const WARNINGS = {
  windows: 'The app isn’t code-signed yet, so Windows may show a SmartScreen warning. Click <b>More info</b>, then <b>Run anyway</b>.',
  mac: 'The app isn’t notarized yet. The first time, <b>Control-click</b> it and choose <b>Open</b>.',
};
const INSTALL_STEPS = {
  'win-setup': ['Run the installer from your Downloads folder.', SMARTSCREEN, CONNECT],
  'win-portable': ['Put the .exe wherever you like and double-click it. Nothing gets installed.', SMARTSCREEN, CONNECT],
  'mac-dmg': ['Open the .dmg and drag the app into <b>Applications</b>.', GATEKEEPER, CONNECT],
  'mac-zip': ['Unzip it and move the app into <b>Applications</b>.', GATEKEEPER, CONNECT],
  'linux-appimage': [
    'Right-click the AppImage, open <b>Properties</b> and allow it to run as a program.',
    `Double-click it to start. It keeps itself up to date. ${APPIMAGE_SANDBOX}`,
    KEYRING,
    CONNECT,
  ],
  'linux-deb': [
    'Open the .deb with your software installer, or run <code>sudo apt install ./</code> followed by the file name.',
    'Launch HA Desktop Widget from your app menu.',
    KEYRING,
    CONNECT,
  ],
};

export function detectPlatform() {
  const ua = navigator.userAgent;
  // Android UAs contain "Linux" and desktop-mode iPads say "Macintosh".
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return { os: null, mobile: true };
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return { os: null, mobile: true };
  // A Chromebook says "X11; CrOS", but there is no build for it, so it must not match Linux below.
  if (/CrOS/.test(ua)) return { os: null, mobile: false, chromeos: true };
  if (/Windows/i.test(ua)) return { os: 'windows', mobile: false };
  if (/Macintosh|Mac OS X/i.test(ua)) return { os: 'mac', mobile: false };
  if (/Linux|X11/i.test(ua)) return { os: 'linux', mobile: false };
  return { os: null, mobile: false };
}

/* Chromium can tell us the CPU; other browsers can't, and that's fine. */
async function detectArm() {
  try {
    const data = await navigator.userAgentData?.getHighEntropyValues?.(['architecture']);
    if (data?.architecture) return data.architecture === 'arm';
  } catch { /* not exposed */ }
  return /aarch64|arm64/i.test(navigator.userAgent);
}

/* GitHub answers 60 unauthenticated requests an hour per IP, so a page only asks for what it
   shows, and a reply is kept for the rest of the session: moving between pages costs nothing. */
const CACHE_MS = 10 * 60 * 1000;
const slim = (release) => release && {
  tag_name: release.tag_name,
  html_url: release.html_url,
  published_at: release.published_at,
  prerelease: release.prerelease,
  draft: release.draft,
  assets: (release.assets || []).map(({ name, browser_download_url, size }) => ({ name, browser_download_url, size })),
};
const slimAll = (data) => (Array.isArray(data) ? data.map(slim) : slim(data));

function getJson(path, trim = slimAll) {
  const key = `hdw-gh:${path}`;
  try {
    const kept = JSON.parse(sessionStorage.getItem(key));
    if (kept && Date.now() - kept.at < CACHE_MS) return Promise.resolve(kept.data);
  } catch { /* no storage, or not ours */ }
  return fetch(`https://api.github.com/repos/${REPO}${path ? `/${path}` : ''}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((data) => {
      const trimmed = trim(data);
      try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data: trimmed })); } catch { /* full or blocked */ }
      return trimmed;
    })
    .catch(() => null);
}

/* Null when the lookup fails (offline, blocked, rate-limited): the pages then show no version at
   all rather than one that was true when the site was last edited. */
let releaseRequest;
export const getRelease = () => (releaseRequest ||= getJson('releases/latest'));

/* A published beta worth pointing at: one that starts a newer minor or major than the latest
   stable release. A patch beta (the nightly after 4.0.0 is 4.0.1-beta.1) is just the next fix. */
export const coreVersion = (tag) => (tag || '').replace(/^v/, '').split('-')[0].split('.').map(Number);
export function pickBeta(stable, releases) {
  if (!stable?.tag_name) return null;
  const [major = 0, minor = 0] = coreVersion(stable.tag_name);
  return (releases || []).find((r) => {
    if (!r.prerelease || r.draft) return false;
    const [m = 0, n = 0] = coreVersion(r.tag_name);
    return m > major || (m === major && n > minor);
  }) || null;
}
let betaRequest;
export const getBeta = () => (betaRequest ||= Promise.all([getRelease(), getJson('releases?per_page=10')])
  .then(([stable, list]) => pickBeta(stable, list)));

/* Downloads of the app's own packages, across every release. Update checks fetch the Windows
   installer and the AppImage too, so this counts updates as well as first installs. */
const PACKAGE = /(Setup\.exe|Portable\.exe|\.dmg|-mac\.zip|\.AppImage|\.deb)$/;
const countPage = (list) => ({
  releases: Array.isArray(list) ? list.length : 0,
  downloads: (Array.isArray(list) ? list : [])
    .filter((r) => !r.draft)
    .flatMap((r) => r.assets || [])
    .filter((a) => PACKAGE.test(a.name))
    .reduce((sum, a) => sum + (a.download_count || 0), 0),
});
export async function getDownloadCount() {
  let total = 0;
  // GitHub lists 100 releases a page; the project has a little over that.
  for (let page = 1; page <= 5; page += 1) {
    const counted = await getJson(`releases?per_page=100&page=${page}`, countPage);
    if (!counted) return null;
    total += counted.downloads;
    if (counted.releases < 100) break;
  }
  return total;
}
export const getStars = () => getJson('', (repo) => ({ stars: repo?.stargazers_count ?? null }));

/* 7,190 reads "7,100+": a floor that stays true until the next fetch. */
export function roundDown(n) {
  const step = n >= 10000 ? 1000 : n >= 1000 ? 100 : 10;
  return Math.floor(n / step) * step;
}
export function releasedAgo(iso, now = Date.now()) {
  const days = Math.floor((now - Date.parse(iso)) / 86400000);
  if (!Number.isFinite(days) || days < 0) return '';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 45) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months < 2 ? 'a month ago' : `${months} months ago`;
}
const escapeHtml = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const formatMB = (bytes) => `${Math.round(bytes / 1048576)} MB`;

const platform = detectPlatform();
const info = platform.os ? PLATFORMS[platform.os] : null;

/* ---------------- Every page ---------------- */

// If this script was late enough for the stylesheet's fallback to start showing the page, keep what
// it showed: ending the fallback below would otherwise hide that content again until the observer
// reached it.
document.querySelectorAll('.reveal').forEach((el) => {
  if (Number.parseFloat(getComputedStyle(el).opacity) > 0) el.classList.add('in');
});

// From here the page is script-driven: the reveal styles take over from their no-script fallback.
document.documentElement.classList.add('js-ready');

document.querySelectorAll('[data-download-label]').forEach((el) => {
  if (info) el.textContent = `Download for ${info.label}`;
});

/* The search shortcut, as this computer's keyboard prints it. The app takes Ctrl or Cmd. */
if (platform.os === 'mac') {
  document.querySelectorAll('[data-mod-key]').forEach((el) => {
    el.textContent = '⌘';
    el.setAttribute('aria-label', 'Command');
  });
}

/* A phone can't run the app, so its Download buttons send the link to a computer instead:
   the share sheet where there is one, the clipboard where not, the download page otherwise. */
const SHARE_URL = 'https://hadesktopwidget.com/download';
async function sendToComputer(label) {
  if (navigator.share) {
    try {
      await navigator.share({ title: 'HA Desktop Widget', text: 'Home Assistant on your desktop, for Windows, macOS and Linux.', url: SHARE_URL });
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(SHARE_URL);
    if (label) {
      const was = label.textContent;
      label.textContent = 'Link copied';
      setTimeout(() => { label.textContent = was; }, 2000);
    }
  } catch {
    location.href = '/download';
  }
}
if (platform.mobile) {
  document.querySelectorAll('a[href="/download"] [data-download-label]').forEach((label) => {
    const link = label.closest('a');
    label.textContent = 'Send to your computer';
    link.querySelector('use')?.setAttribute('href', '/assets/icons.svg#i-send');
    link.addEventListener('click', (ev) => {
      ev.preventDefault();
      sendToComputer(label);
    });
  });
  document.querySelectorAll('[data-share-download]').forEach((button) => {
    button.hidden = false;
    button.addEventListener('click', () => sendToComputer(button.querySelector('[data-share-label]')));
  });
}

/* The narrow-screen menu is a details element: close it after a pick, on Escape, on a click
   outside and when the keyboard tabs out of it, as a menu does. */
const menu = document.querySelector('.nav-menu');
if (menu) {
  menu.addEventListener('click', (ev) => {
    if (ev.target.closest('.nav-menu-panel a')) menu.open = false;
  });
  document.addEventListener('click', (ev) => {
    if (menu.open && !menu.contains(ev.target)) menu.open = false;
  });
  menu.addEventListener('focusout', (ev) => {
    if (menu.open && ev.relatedTarget && !menu.contains(ev.relatedTarget)) menu.open = false;
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && menu.open) {
      menu.open = false;
      menu.querySelector('summary')?.focus();
    }
  });
}

/* Proof of use under the home page buttons: the release, how recent it is, and downloads. */
const proof = document.getElementById('proof');
if (proof) {
  Promise.all([getRelease(), getDownloadCount()]).then(([rel, downloads]) => {
    const parts = [];
    if (rel?.tag_name) {
      const ago = rel.published_at ? releasedAgo(rel.published_at) : '';
      parts.push(`Latest <b>${escapeHtml(rel.tag_name)}</b>${ago ? `, released ${ago}` : ''}`);
    }
    if (downloads) parts.push(`<b>${roundDown(downloads).toLocaleString('en-US')}+</b> downloads`);
    proof.innerHTML = parts.join(' · ');
  });
}
const stars = document.querySelectorAll('[data-stars]');
if (stars.length) {
  getStars().then((repo) => {
    if (!repo?.stars) return;
    stars.forEach((el) => {
      el.textContent = repo.stars.toLocaleString('en-US');
      const unit = document.createElement('span');
      unit.className = 'visually-hidden';
      unit.textContent = ' stars';
      el.append(unit);
      el.hidden = false;
    });
  });
}

/* The gallery video plays while it is on screen, unless the visitor paused it or asks for less
   motion; the button pauses and plays it either way. */
const video = document.getElementById('demo-video');
const videoToggle = document.getElementById('video-toggle');
if (video && videoToggle) {
  let pausedByVisitor = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let inView = false;
  const paint = () => {
    const playing = !video.paused;
    videoToggle.classList.toggle('is-playing', playing);
    videoToggle.setAttribute('aria-label', playing ? 'Pause video' : 'Play video');
  };
  const sync = () => {
    if (inView && !pausedByVisitor && !document.hidden) video.play().catch(() => {});
    else video.pause();
  };
  video.addEventListener('play', paint);
  video.addEventListener('pause', paint);
  videoToggle.hidden = false;
  videoToggle.addEventListener('click', () => {
    pausedByVisitor = !video.paused;
    if (pausedByVisitor) video.pause();
    else { inView = true; video.play().catch(() => {}); }
  });
  document.addEventListener('visibilitychange', sync);
  if (typeof IntersectionObserver === 'function') {
    new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      sync();
    }, { threshold: 0.4 }).observe(video);
  }
  paint();
}

if (document.querySelector('[data-version], [data-asset]')) {
  getRelease().then((rel) => {
    if (!rel) return;
    document.querySelectorAll('[data-version]').forEach((el) => {
      el.textContent = rel.tag_name;
      el.hidden = false;
    });
    for (const [key, pattern] of Object.entries(ASSET_PATTERNS)) {
      const asset = (rel.assets || []).find((a) => pattern.test(a.name));
      if (!asset) continue;
      document.querySelectorAll(`[data-asset="${key}"]`).forEach((el) => {
        el.href = asset.browser_download_url;
        const size = el.querySelector('[data-size]');
        if (size && asset.size) {
          size.textContent = formatMB(asset.size);
          size.hidden = false;
        }
      });
    }
  });
}

const nav = document.querySelector('.nav');
const onScroll = () => nav?.classList.toggle('scrolled', scrollY > 8);
addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* Fade content in as it arrives. Siblings in the same row stagger slightly. */
const revealer = typeof IntersectionObserver === 'function'
  ? new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('in');
      revealer.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -8% 0px' })
  : null;
document.querySelectorAll('.reveal').forEach((el) => {
  if (!revealer) { el.classList.add('in'); return; }
  const siblings = [...el.parentElement.children].filter((c) => c.classList.contains('reveal'));
  el.style.setProperty('--d', `${Math.min(siblings.indexOf(el), 5) * 70}ms`);
  revealer.observe(el);
});

/* Copy buttons on code blocks (companion page). */
document.querySelectorAll('[data-copy]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const code = document.getElementById(btn.dataset.copy)?.innerText ?? '';
    try {
      await navigator.clipboard.writeText(code);
      btn.dataset.state = 'done';
      btn.setAttribute('aria-label', 'Copied');
      setTimeout(() => { delete btn.dataset.state; btn.setAttribute('aria-label', 'Copy'); }, 1600);
    } catch { /* clipboard blocked; the text is still selectable */ }
  });
});

/* ---------------- Download page ---------------- */

const rec = document.getElementById('recommend');

/* The page ships generic steps for every system; this swaps in the ones for the file picked. */
function showSteps(assetKey) {
  const steps = INSTALL_STEPS[assetKey];
  if (steps) document.getElementById('install-steps').innerHTML = steps.map((t) => `<li>${t}</li>`).join('');
}

if (rec) {
  const help = document.getElementById('install-help');
  // Resolves true when there's no build for this CPU, so nothing is offered.
  const noBuild = info
    ? detectArm().then((arm) => {
      const text = arm && {
        windows: 'Runs on Windows on Arm through emulation.',
        linux: 'There’s no ARM build for Linux yet. The files below are for x86_64 PCs.',
      }[platform.os];
      if (text) {
        const el = document.getElementById('rec-arch');
        el.textContent = text;
        el.hidden = false;
      }
      return arm && platform.os === 'linux';
    })
    : Promise.resolve(true);

  if (info) {
    const req = document.getElementById('rec-req');
    if (req) req.textContent = REQUIREMENTS[platform.os];
    const warn = document.getElementById('rec-warn');
    if (warn && WARNINGS[platform.os]) {
      warn.querySelector('[data-warn-text]').innerHTML = WARNINGS[platform.os];
      warn.hidden = false;
    }
    const button = document.getElementById('rec-primary');
    button.dataset.asset = info.primary;
    button.href = `https://github.com/${REPO}/releases/latest`;
    showSteps(info.primary);
    noBuild.then((none) => {
      if (!none) return;
      button.hidden = true;
      help.hidden = true;
    });
    Promise.all([getRelease(), noBuild]).then(([rel, none]) => {
      const asset = rel?.assets?.find((a) => ASSET_PATTERNS[info.primary].test(a.name));
      if (asset && !none) button.href = asset.browser_download_url;
    });
  } else {
    rec.hidden = true;
    const noDetect = document.getElementById('no-detect');
    const noDetectText = document.getElementById('no-detect-text') || noDetect;
    if (platform.chromeos) noDetectText.textContent = 'There’s no ChromeOS build. HA Desktop Widget runs on Windows, macOS and Linux computers.';
    if (platform.mobile || platform.chromeos) noDetect.hidden = false;
  }

  /* Offer a newer beta, quietly, for the visitor's own platform. */
  Promise.all([getBeta(), noBuild]).then(([rel, none]) => {
    if (!rel || none || !info) return;
    const asset = rel.assets?.find((a) => ASSET_PATTERNS[info.primary].test(a.name));
    const link = document.getElementById('beta-link');
    link.textContent = `Try ${rel.tag_name.replace(/^v/, '')}`;
    link.href = asset?.browser_download_url || rel.html_url;
    link.dataset.betaAsset = info.primary;
    document.getElementById('beta-line').hidden = false;
  });

  /* Any download on the page opens the matching next steps up top. */
  document.querySelectorAll('main [data-asset], #beta-link').forEach((link) => {
    link.addEventListener('click', () => {
      rec.hidden = false;
      help.hidden = false;
      showSteps(link.dataset.asset || link.dataset.betaAsset);
      document.getElementById('install-started').hidden = false;
      document.getElementById('install-foot').hidden = false;
      document.getElementById('install-retry').href = link.href;
      document.getElementById('install-summary').textContent = 'Next steps';
      help.open = true;
      if (link.id !== 'rec-primary') help.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });
}
