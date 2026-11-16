# Website captures

The pictures and the demo video in `website/assets/app/` come from the real app, driven by the
launch-4.0 capture rig (`promo/launch-4.0/rig`) against its mock Home Assistant. To redo them:

1. Install dev dependencies (`NODE_ENV=development npm ci --include=dev`) and make the rig's
   assets as `promo/launch-4.0/README.md` describes (`make-assets.py`, which needs `porch.jpg`).
2. Stills, at device scale 2. The graph wants an evening clock, so set the time zone:

   ```sh
   TZ=America/Los_Angeles xvfb-run -a dbus-run-session node promo/website-shots/stills.cjs <work>/out
   ```

3. The video loop (9 s at 30 fps; it ends on the state it starts with, so it loops cleanly):

   ```sh
   xvfb-run -a dbus-run-session node promo/website-shots/loop.cjs <work>/loop
   ```

4. Put the windows on a wallpaper, crop the feature images and write WebP files to `<work>/site`:

   ```sh
   python3 promo/website-shots/compose.py <work>/out <work>/site
   python3 promo/website-shots/vid.py <work>
   ffmpeg -framerate 30 -i <work>/vframes/%05d.png -vf crop=760:978:0:0 -c:v libx264 \
     -pix_fmt yuv420p -crf 26 -preset slow -movflags +faststart -an <work>/site/demo-loop.mp4
   ```

5. Copy `<work>/site/*` into `website/assets/app/`.

Needs Python with Pillow and NumPy, and ffmpeg. As root, Electron needs `--no-sandbox`, which the
rig already passes.
