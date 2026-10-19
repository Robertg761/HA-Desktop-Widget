# HA Desktop Widget 4.0 launch spot

An 86-second launch video for 4.0, built entirely from the real app. Every UI shot is the actual
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
   headless Chromium frame by frame. `comp/scenes.js` is written in the times of a 62 s edit;
   `comp/warp.json` retimes it to 86 s (each section a whole number of beats, most shots at 1.5x,
   the montages at 2x), and the renderer draws each frame at its mapped time. For motion blur,
   each 30 fps frame averages 2 to 48 renders spread across a 180° shutter, as many as the motion
   at that moment needs (`comp/motion_schedule.py` measures it in a plain 60 fps pass of the edit
   and writes `comp/samples.json`). `comp/finish.sh` converts to BT.709, grades with a contrast
   curve that keeps legal black and white, adds grain and muxes the soundtrack.
3. **Sound** (`audio/`). The spot uses the `minimal` cue (`audio/options/minimal.py`: piano motif,
   pulse, marimba, strings in the lift; E major on the 120 BPM grid of `audio/cues.py`), built from
   the synths in `audio/engine.py` and `audio/instruments.py`. `audio/sfx.py` places switch
   clicks, keys, pops and sparkles on the picture's events through the same retime
   (`audio/warp.py`), with no whooshes on camera moves. `audio/master.py` mixes the two and
   masters to about −14 LUFS, with the impacts on a stem of their own.

## Render

Linux, Node 22, Python 3 with `numpy scipy pillow pedalboard soundfile pyloudnorm`, `ffmpeg`, `xvfb`,
`gnome-keyring` and `dbus-x11` (so the app finds a Secret Service and shows no keyring warning),
and a Chromium headless shell for the compositor: set `CHROME` to one, or install Playwright's with
`npx playwright install chromium-headless-shell` and `comp/render.cjs` finds it.

```sh
npm ci && npm run build:renderer           # from the repository root
cd promo/launch-4.0
python3 assets/make-assets.py              # album art, porch camera frames, fonts and icon

# Footage. Later takes replace earlier ones of the same name, so keep this order.
shots/run.sh open hero status pages themes holidays palette settings rapid pins icons
shots/run.sh camlive hotkeys exportfiles
# Halloween and Christmas use a 500x2200 window, so the moon and the sleigh's lane sit below the
# tiles; at 3x that needs a tall screen. Only the top 800 px, all the camera sees, is captured.
XVFB_SCREEN=3200x7000 shots/run.sh halloweentall christmastall

# Sound
python3 audio/sfx.py && python3 audio/options/minimal.py && python3 audio/master.py minimal

# Picture: 4 s chunks with motion blur, then grade, grain and mux. Chunks already marked .done are
# kept, so rerunning render_chunks.sh resumes an interrupted render; after changing anything the
# picture uses, start again from an empty out/seg.
rm -rf out/seg
comp/render_chunks.sh out/seg 4
SEG_DIR=out/seg comp/finish.sh             # → out/HA-Desktop-Widget-4.0.mp4
```

`comp/samples.json` is checked in. After changing camera moves, measure them again from a plain
60 fps pass of the edit: `rm -rf out/seg60 && NOWARP=1 MODE=video comp/render_chunks.sh out/seg60 4`,
join the chunks into one file and run `python3 comp/motion_schedule.py <that file>`. Then render the
picture again from an empty `out/seg`.

## Soundtrack options

Four cues fit the 86 s edit on its 120 BPM grid, each written against the cue sheet in
`audio/cues.py`; the spot uses `minimal`. (`audio/score.py` and `audio/mix.py` are the first,
EDM-style score.)

| Option | Style |
|---|---|
| `cinematic` | Hybrid orchestral: spiccato strings, horns, choir, taiko; D major |
| `indie` | Feel-good indie pop: strummed acoustic guitars, stomp and claps, whistle hook; G major |
| `lofi` | Lo-fi chillhop: Rhodes, half-time boom-bap, vibes, vinyl; F major |
| `minimal` | Modern minimal: piano motif, pulse, marimba, strings in the lift; E major |

```sh
python3 audio/sfx.py                       # the shared UI sounds
python3 audio/options/lofi.py && python3 audio/master.py lofi && python3 audio/check_option.py lofi
comp/preview.sh lofi                       # → out/previews/HA-Desktop-Widget-4.0_lofi.mp4 (720p)
```

`comp/finish.sh` muxes `audio/out/soundtrack_minimal.wav`; to try another cue in the final file,
run it with `SOUNDTRACK=audio/out/soundtrack_<option>.wav`.

`shots/run.sh` runs each take under Xvfb in its own D-Bus session with an unlocked keyring. A few
capture-only accommodations, none of which change what the app draws:

- Seasonal takes keep the app's `software-rendering` class off. On a CPU-only capture machine the
  app holds holiday art still to save power; the spot shows it as it runs on a GPU.
- The Settings take shows `http://homeassistant.local:8123` in the address field; the mock itself
  listens on a loopback port.
- The live camera take reports the camera as `streaming` and clears keyboard focus after
  pressing Live, so no focus ring is left on a toolbar button.
- `comp/review_prep.py` writes a frame every 0.25 s and per-shot contact sheets for review.

The porch camera image is derived from a CC0 photo on Wikimedia Commons
("137 Marshall Avenue, Perry Hilltop, 2025-04-26, porch and front door.jpg").
