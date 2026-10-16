# HA Desktop Widget 4.0 launch spot

A 62-second launch video for 4.0, built entirely from the real app. Every UI shot is the actual
renderer running in Electron against a mock Home Assistant; nothing in the widget is redrawn or
mocked up, except the Omarchy bar panel (a QML plugin that only runs inside the Omarchy shell),
which is a stylized recreation of its layout. The score and sound design are synthesized from
scratch, so the spot has no third-party music or stock footage.

The finished video is not tracked here (it is larger than the repository's 10 MiB file limit).
Re-render it with the steps below.

## How it is made

1. **Footage** (`shots/`, `rig/`). `rig/session.cjs` starts the unpacked app (`electron .`) at
   3x device scale against `rig/mock-ha.cjs`, a copy of
   `scripts/visual-snapshots/mock-home-assistant.cjs` that also applies service calls to its
   states (lights, scenes, locks, covers, climate, media, alarm, vacuum) and serves camera and
   artwork images. `rig/world.cjs` is the demo home. `rig/vt.js` is injected into the renderer
   and puts `requestAnimationFrame`, timers, `performance.now`, `Date`, `Math.random` and every
   CSS/Web animation on a virtual clock, so each frame is captured at an exact 1/60 s step with
   alpha (the frosted window is translucent). `shots/shots.cjs` scripts each take: cursor paths,
   clicks, typing, state changes on exact frames.
2. **Picture** (`comp/`). `comp/index.html` is a deterministic compositor: `render(t)` places the
   footage in a 3D camera over a generated mesh-gradient background, with a real blur behind the
   glass, kinetic type, cursor, keycaps, devices and the end card. `comp/render.cjs` drives
   headless Chromium frame by frame. `comp/final.sh` renders in parallel, blends 60 fps to
   30 fps (two-frame motion blur), grades, adds grain and muxes the soundtrack.
3. **Sound** (`audio/`). `audio/score.py` writes the score (120 BPM, Bm–G–D–A) with the synths
   in `audio/engine.py`; `audio/sfx.py` places switch clicks, keys, whooshes and pops on the
   picture's events; `audio/mix.py` balances and masters to −13.5 LUFS.

## Render

Linux, Node 22, Python 3 with `numpy scipy pedalboard soundfile pyloudnorm`, `ffmpeg`, `xvfb`,
`libfaketime`, `gnome-keyring` and `dbus-x11` (so the app finds a Secret Service and shows no
keyring warning), and a Chromium headless shell for the compositor (`CHROME=…`, Playwright's by
default).

```sh
npm ci && npm run build:renderer           # from the repository root
cd promo/launch-4.0
python3 assets/make-assets.py              # album art, porch camera frames, fonts and icon

# Footage. Later takes replace earlier ones of the same name, so keep this order.
shots/run.sh open hero status pages themes holidays palette settings rapid pins icons
shots/run.sh camlive hotkeys graph
XVFB_SCREEN=3200x4800 shots/run.sh halloweentall   # a 500x1500 window at 3x needs a tall screen

# Sound
python3 audio/score.py && python3 audio/sfx.py && python3 audio/mix.py

# Picture: resumable 4 s chunks, then blend, grade, grain and mux
comp/render_chunks.sh out/seg 4
SEG_DIR=out/seg comp/finish.sh             # → out/HA-Desktop-Widget-4.0.mp4
```

`shots/run.sh` runs each take under Xvfb in its own D-Bus session with an unlocked keyring. A few
capture-only accommodations, none of which change what the app draws:

- Seasonal takes keep the app's `software-rendering` class off. On a CPU-only capture machine the
  app holds holiday art still to save power; the spot shows it as it runs on a GPU.
- The graph take runs the app under `libfaketime` at the spot's date, so the history it fetches
  before virtual time takes over belongs to the same day.
- The Settings take shows `http://homeassistant.local:8123` in the address field; the mock itself
  listens on a loopback port.
- `comp/review_prep.py` writes a frame every 0.25 s and per-shot contact sheets for review.

The porch camera image is derived from a CC0 photo on Wikimedia Commons
("137 Marshall Avenue, Perry Hilltop, 2025-04-26, porch and front door.jpg").
