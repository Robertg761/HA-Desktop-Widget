# Connection recovery release checks

Run these checks on Windows, macOS, and Linux before a release. For Linux, include
both an X11 desktop and the supported Wayland desktop/layer configuration. Record
the OS, desktop, app version, Home Assistant version, and outcome in the release
checklist. Automated tests do not establish hardware sleep or compositor behavior.

Prepare a dashboard containing a sensor and a controllable light, pin both to the
desktop, and add the sensor to the system tray. Keep Settings reachable. Use a test
light whose repeated operation is safe.

| Scenario                                                                  | Expected result                                                                                                                                                                                                    |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sleep for at least two minutes, then wake                                 | The widget reconnects automatically; widget and pins show a connection fallback while refreshing; tray readings remain marked stale until a new state snapshot arrives.                                            |
| Disable Wi-Fi, then restore it or switch networks                         | The widget indicates disconnection, pending commands settle with errors, and live values return automatically.                                                                                                     |
| Drop traffic to HA without closing TCP (for example a test firewall rule) | Within approximately 45 seconds while the app is running, the application heartbeat detects the silent connection loss. Recovery continues with the existing backoff. Remove the rule and verify a fresh snapshot. |
| Restart HA                                                                | All surfaces recover without restarting the widget; change a light after recovery and verify ongoing state updates.                                                                                                |
| Revoke the current token                                                  | The widget and pins show an authentication failure with a path back to Settings. Automatic reconnection stops. Reauthorize in Settings or replace the token and retry.                                             |
| Delay or fail the initial state snapshot                                  | Cached readings never become live merely because authentication succeeded. Snapshot failure reconnects automatically.                                                                                              |
| Disconnect immediately after changing a light                             | The pending operation settles; it is never automatically replayed after reconnect. Verify the actual HA state after recovery.                                                                                      |
| Change monitor layout while asleep                                        | On wake, verify widget/pin visibility, placement, scale, and tray interaction on each screen.                                                                                                                      |

Automated coverage: WebSocket health timeouts, matched pong handling, socket
replacement/cleanup, rejection of pending commands, fresh-snapshot readiness,
authentication failure preservation, pin runtime status, and preload IPC wiring.
The heartbeat runs every 30 seconds after authentication and allows 15 seconds
for a pong; connection/authentication establishment also has a 15-second timeout.
Timer throttling or system suspension can delay these checks; the existing native
resume event also requests immediate reconnection.

Protocol reference: [Home Assistant WebSocket API](https://developers.home-assistant.io/docs/api/websocket/#pings-and-pongs).

Also repeat sleep/wake with no tray values configured. Reload the main renderer
while pins are visible, then simulate a renderer crash in a development build:
pins must immediately show a connection fallback rather than cached controls.
After restarting/reloading the main renderer, pins become live only after the
fresh snapshot is published.
