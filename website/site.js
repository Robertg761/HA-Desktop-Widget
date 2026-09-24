// Shared by every page: nav state, scroll reveals, device detection and the
// latest GitHub release (version label and direct download links).

export const REPO = 'Robertg761/HA-Desktop-Widget';
const FALLBACK_TAG = 'v3.11.0';

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
const GATEKEEPER = 'The first time, <b>Control-click</b> the app and choose <b>Open</b>. macOS asks because the app isn’t signed yet.';
const INSTALL_STEPS = {
  'win-setup': ['Run the installer from your Downloads folder.', SMARTSCREEN, CONNECT],
  'win-portable': ['Put the .exe wherever you like and double-click it. Nothing gets installed.', SMARTSCREEN, CONNECT],
  'mac-dmg': ['Open the .dmg and drag the app into <b>Applications</b>.', GATEKEEPER, CONNECT],
  'mac-zip': ['Unzip it and move the app into <b>Applications</b>.', GATEKEEPER, CONNECT],
  'linux-appimage': [
    'Right-click the AppImage, open <b>Properties</b> and allow it to run as a program.',
    'Double-click it to start. It keeps itself up to date.',
    CONNECT,
  ],
  'linux-deb': [
    'Open the .deb with your software installer, or run <code>sudo apt install ./</code> followed by the file name.',
    'Launch HA Desktop Widget from your app menu.',
    CONNECT,
  ],
};

export function detectPlatform() {
  const ua = navigator.userAgent;
  // Android UAs contain "Linux" and desktop-mode iPads say "Macintosh".
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return { os: null, mobile: true };
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return { os: null, mobile: true };
  if (/Windows/i.test(ua)) return { os: 'windows', mobile: false };
  if (/Macintosh|Mac OS X/i.test(ua)) return { os: 'mac', mobile: false };
  if (/Linux|X11|CrOS/i.test(ua)) return { os: 'linux', mobile: false };
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

const getJson = (path) => fetch(`https://api.github.com/repos/${REPO}/${path}`)
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
  .catch(() => null);

export const release = getJson('releases/latest');

/* A published beta that's newer than the latest stable release, if any. */
const coreVersion = (tag) => (tag || '').replace(/^v/, '').split('-')[0].split('.').map(Number);
const isNewer = (a, b) => {
  const [x, y] = [coreVersion(a), coreVersion(b)];
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};
export const beta = Promise.all([release, getJson('releases?per_page=10')]).then(([stable, list]) =>
  (list || []).find((r) => r.prerelease && !r.draft && isNewer(r.tag_name, stable?.tag_name)) || null
);

const platform = detectPlatform();
const info = platform.os ? PLATFORMS[platform.os] : null;

/* ---------------- Every page ---------------- */

document.querySelectorAll('[data-download-label]').forEach((el) => {
  if (info) el.textContent = `Download for ${info.label}`;
});

release.then((rel) => {
  const tag = rel?.tag_name || FALLBACK_TAG;
  document.querySelectorAll('[data-version]').forEach((el) => { el.textContent = tag; });
  if (!rel) return;
  for (const [key, pattern] of Object.entries(ASSET_PATTERNS)) {
    const asset = (rel.assets || []).find((a) => pattern.test(a.name));
    if (!asset) continue;
    document.querySelectorAll(`[data-asset="${key}"]`).forEach((el) => {
      el.href = asset.browser_download_url;
    });
  }
});

const nav = document.querySelector('.nav');
const onScroll = () => nav?.classList.toggle('scrolled', scrollY > 8);
addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* Fade content in as it arrives. Siblings in the same row stagger slightly. */
const revealer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    entry.target.classList.add('in');
    revealer.unobserve(entry.target);
  }
}, { rootMargin: '0px 0px -8% 0px' });
document.querySelectorAll('.reveal').forEach((el) => {
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

function showSteps(assetKey) {
  const steps = INSTALL_STEPS[assetKey];
  if (steps) document.getElementById('install-steps').innerHTML = steps.map((t) => `<li>${t}</li>`).join('');
}

if (rec) {
  const help = document.getElementById('install-help');
  if (info) {
    const button = document.getElementById('rec-primary');
    button.dataset.asset = info.primary;
    button.href = `https://github.com/${REPO}/releases/latest`;
    showSteps(info.primary);
    release.then((rel) => {
      const asset = rel?.assets?.find((a) => ASSET_PATTERNS[info.primary].test(a.name));
      if (asset) button.href = asset.browser_download_url;
    });
    detectArm().then((arm) => {
      const text = arm && {
        windows: 'Runs on Windows on Arm through emulation.',
        linux: 'There’s no ARM build for Linux yet.',
      }[platform.os];
      if (!text) return;
      const el = document.getElementById('rec-arch');
      el.textContent = text;
      el.hidden = false;
    });
  } else {
    rec.hidden = true;
    if (platform.mobile) document.getElementById('no-detect').hidden = false;
  }

  /* Offer a newer beta, quietly, for the visitor's own platform. */
  beta.then((rel) => {
    if (!rel || !info) return;
    const asset = rel.assets?.find((a) => ASSET_PATTERNS[info.primary].test(a.name));
    const link = document.getElementById('beta-link');
    const [major, minor] = coreVersion(rel.tag_name);
    link.textContent = `Try the ${major}.${minor} beta`;
    link.href = asset?.browser_download_url || rel.html_url;
    link.dataset.betaAsset = info.primary;
    document.getElementById('beta-line').hidden = false;
  });

  /* Any download on the page opens the matching next steps up top. */
  document.querySelectorAll('main [data-asset], #beta-link').forEach((link) => {
    link.addEventListener('click', () => {
      rec.hidden = false;
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
