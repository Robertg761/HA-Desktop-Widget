// Shared by every page: nav state, scroll reveals, device detection and the
// latest GitHub release (version label and direct download links).

export const REPO = 'Robertg761/HA-Desktop-Widget';
const FALLBACK_TAG = 'v3.10.0';

const ASSET_PATTERNS = {
  'win-setup': /win-x64-Setup\.exe$/,
  'win-portable': /win-x64-Portable\.exe$/,
  'mac-dmg': /universal\.dmg$/,
  'mac-zip': /universal-mac\.zip$/,
  'linux-appimage': /x86_64\.AppImage$/,
  'linux-deb': /amd64\.deb$/,
};

/* What the download page recommends for each platform. */
const PLATFORMS = {
  windows: {
    label: 'Windows',
    device: 'Windows PC',
    title: 'Windows installer',
    meta: 'x64 · updates itself',
    primary: 'win-setup',
    primaryLabel: 'Download installer',
    alt: 'win-portable',
    altLabel: 'Prefer no install? Get the portable .exe',
    note: 'The app isn’t code-signed yet, so SmartScreen may warn on first launch. Choose More info, then Run anyway.',
  },
  mac: {
    label: 'macOS',
    device: 'Mac',
    title: 'macOS disk image',
    meta: 'Universal · Intel and Apple Silicon',
    primary: 'mac-dmg',
    primaryLabel: 'Download .dmg',
    alt: 'mac-zip',
    altLabel: 'Or get the .zip archive',
    note: 'Not yet Developer ID signed. On first launch, Control-click the app and choose Open, or allow it under System Settings › Privacy & Security.',
  },
  linux: {
    label: 'Linux',
    device: 'Linux PC',
    title: 'Linux AppImage',
    meta: 'x64 · updates itself · runs on most distros',
    primary: 'linux-appimage',
    primaryLabel: 'Download AppImage',
    alt: 'linux-deb',
    altLabel: 'On Debian or Ubuntu? Get the .deb package',
    note: 'Make it executable (chmod +x, or Properties › Allow executing) and run it.',
  },
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

export const release = fetch(`https://api.github.com/repos/${REPO}/releases/latest`)
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
  .catch(() => null);

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
    document.querySelectorAll(`[data-size="${key}"]`).forEach((el) => {
      el.textContent = `${Math.round(asset.size / 1048576)} MB`;
    });
  }
  const date = document.getElementById('release-date');
  if (date && rel.published_at) {
    date.textContent = new Date(rel.published_at).toLocaleDateString([], {
      month: 'long', day: 'numeric', year: 'numeric',
    });
    date.parentElement.hidden = false;
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
if (rec) {
  if (info) {
    const set = (id, text) => { document.getElementById(id).textContent = text; };
    set('rec-device', info.device);
    set('rec-title', info.title);
    set('rec-meta', info.meta);
    set('rec-note', info.note);
    set('rec-primary-label', info.primaryLabel);
    set('rec-alt', info.altLabel);
    document.getElementById('rec-primary').dataset.asset = info.primary;
    document.getElementById('rec-alt').dataset.asset = info.alt;
    document.getElementById('rec-size').dataset.size = info.primary;
    rec.hidden = false;
    // The recommended platform already has its card up top.
    document.querySelector(`.os-card[data-os="${platform.os}"]`)?.remove();
    document.getElementById('others-title').textContent = 'Other platforms';

    detectArm().then((arm) => {
      if (!arm) return;
      const extra = {
        windows: 'On Windows on Arm, the x64 build runs through Windows’ built-in emulation.',
        linux: 'There’s no ARM build for Linux yet. The AppImage and .deb are x64 only.',
      }[platform.os];
      if (extra) document.getElementById('rec-arch').textContent = extra;
    });
  } else {
    document.getElementById('no-detect').hidden = false;
    if (!platform.mobile) {
      document.getElementById('no-detect').textContent =
        'We couldn’t tell which computer you’re on. Pick your platform below.';
    }
  }
  // Re-run link upgrades now that the recommended buttons have asset keys.
  release.then((rel) => {
    if (!rel) return;
    for (const el of rec.querySelectorAll('[data-asset]')) {
      const asset = rel.assets?.find((a) => ASSET_PATTERNS[el.dataset.asset]?.test(a.name));
      if (asset) el.href = asset.browser_download_url;
    }
    const size = document.getElementById('rec-size');
    const sized = rel.assets?.find((a) => ASSET_PATTERNS[size.dataset.size]?.test(a.name));
    if (sized) size.textContent = ` · ${Math.round(sized.size / 1048576)} MB`;
  });
}
