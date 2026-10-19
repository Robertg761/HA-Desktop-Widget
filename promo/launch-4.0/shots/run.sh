#!/bin/bash
# Run shots under Xvfb with a dbus session and an unlocked Secret Service keyring.
cd "$(dirname "$0")/.."
exec xvfb-run -a -s "-screen 0 ${XVFB_SCREEN:-3200x2400}x24" dbus-run-session -- bash -c 'echo -n promo | gnome-keyring-daemon --unlock --replace --components=secrets >/dev/null 2>&1; sleep 1; node shots/shots.cjs "$@"' _ "$@"
