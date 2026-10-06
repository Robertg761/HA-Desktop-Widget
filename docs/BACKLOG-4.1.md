# After 4.0

Work the 4.0 release audit decided to leave until after 4.0.0. Each item says what it costs today, why it waited, and how to do it.

## A smaller renderer for desktop pins

Every desktop pin is a window of its own that loads the whole app. `main.js` opens `index.html` for a pin with `?mode=desktop-pin`, and `vite.config.js` builds a single renderer entry, `renderer.js`. Its static imports bring in Settings, hotkeys, the command palette, update status and the weather and seasonal effects, none of which a pin shows.

**Measured cost.** On Linux x64, with the unpacked 4.0.0 app at `3b02099f` under Xvfb (software rendering) and five pins from the visual snapshot fixture (a light, a climate entity, a sensor, a fan and a cover), opened one at a time:

| Pins           | 0      | 1      | 2      | 3      | 4      | 5      |
| -------------- | ------ | ------ | ------ | ------ | ------ | ------ |
| Whole app, PSS | 269 MB | 321 MB | 379 MB | 412 MB | 488 MB | 533 MB |

PSS (proportional set size) counts a page that several processes share once in all, so it is what the pins really add: about 50 MB each, 260 MB for five. Each pin's renderer process took 41 to 49 MB of PSS and about 138 MB of RSS. RSS counts in full the Chromium code that every renderer shares, which is where the audit's figure of about 120 MB per pin came from. A pin's JavaScript heap was 3.8 to 3.9 MB used, of 8 to 9 MB allocated. Two more runs gave pin renderers of 38 to 61 MB of PSS, and the whole app's figure differed by up to 80 MB from run to run as the share of the browser process moved.

Most of a pin's cost is Chromium's own renderer process, which a smaller bundle does not change. Its JavaScript heap is under 4 MB of the roughly 45 MB. What a pin could save is part of that heap, the time it spends parsing and running code it never uses, and, with a page of its own, the main window's markup: every pin builds all 145 kB of `index.html`, its dialogs included, and hides it. That is likely a few megabytes per pin, not tens.

**Why it waited.** The change touches how every pin starts, for a saving of a few megabytes per pin, which was too much risk at the end of the release.

**How.** Either of these:

- A pin entry of its own: a second Vite input (a `pin.js` built to `pin.bundle.js`, say) that imports only what a pin needs, which is the shared renderer package, the pin's controls and i18n, loaded by a page of its own (`pin.html`) that the pin window opens instead of `index.html`.
- One entry, with the app-only modules (Settings, hotkeys, the command palette, update status, the weather and seasonal effects) loaded by dynamic `import()` only when `IS_DESKTOP_PIN_MODE` is false.

The first draws a clearer line between the two; the second is the smaller change. Take the same five-pin measurement before and after, and use the pin scenes of the visual snapshots to check that no pin looks different.
