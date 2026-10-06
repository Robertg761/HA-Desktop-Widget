# After 4.0

Work the 4.0 release audit decided to leave until after 4.0.0. Each item says what it costs today, why it waited, and how to do it.

## A smaller renderer for desktop pins

Every desktop pin is a window of its own that loads the whole app. `main.js` opens `index.html` for a pin with `?mode=desktop-pin`, and `vite.config.js` builds a single renderer entry, `renderer.js`. Its static imports bring in Settings, hotkeys, the command palette, update status and the weather and seasonal effects, none of which a pin shows.

**Measured cost.** These figures come from the unpacked 4.0.0 app at `3b02099f` on Linux x64, under Xvfb, which renders in software. Five pins from the visual snapshot fixture were opened one at a time: a light, a climate entity, a sensor, a fan and a cover.

| Pins           | 0      | 1      | 2      | 3      | 4      | 5      |
| -------------- | ------ | ------ | ------ | ------ | ------ | ------ |
| Whole app, PSS | 269 MB | 321 MB | 379 MB | 412 MB | 488 MB | 533 MB |

PSS, the proportional set size, counts a page that several processes share once in all. So it is what the pins really add, about 50 MB each and 260 MB for five. Each pin's renderer process took 41 to 49 MB of PSS and about 138 MB of RSS. RSS counts the Chromium code that every renderer shares in full, and that is where the audit's figure of about 120 MB per pin came from. A pin's JavaScript heap was 3.8 to 3.9 MB used, of 8 to 9 MB allocated. Two more runs gave pin renderers of 38 to 61 MB of PSS. The whole app's figure differed by up to 80 MB from run to run, as the browser process's share moved.

Most of a pin's cost is Chromium's own renderer process, and a smaller bundle does not change that. The JavaScript heap is under 4 MB of the roughly 45 MB. A pin could save part of that heap and the time it spends parsing and running code it never uses. With a page of its own it would also skip the main window's markup, since every pin builds all 145 kB of `index.html`, dialogs included, and hides it. That is likely a few megabytes per pin, not tens.

**Why it waited.** The change touches how every pin starts. For a few megabytes per pin, that was too much risk at the end of the release.

**How.** Either of these:

- A pin entry of its own. A second Vite input, say `pin.js` built to `pin.bundle.js`, imports only what a pin needs: the shared renderer package, the pin's controls and i18n. A page of its own, `pin.html`, loads it, and the pin window opens that page instead of `index.html`.
- One entry, where the app-only modules load by dynamic `import()` only when `IS_DESKTOP_PIN_MODE` is false. Those are Settings, hotkeys, the command palette, update status and the weather and seasonal effects.

The first draws a clearer line between pin and app. The second is the smaller change. Take the same five-pin measurement before and after, and use the pin scenes of the visual snapshots to check that no pin looks different.
