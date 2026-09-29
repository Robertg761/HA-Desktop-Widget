/* global console, process */

// Linux has no WM_QUERYENDSESSION: a logout, shutdown or restart reaches the app as a
// logind PrepareForShutdown signal and, once logind stops waiting, as SIGTERM from systemd.
// Left alone, the tray keeps the process alive through both, so the session sits waiting
// on it until systemd's stop timeout expires and it is killed.
const SHUTDOWN_SIGNALS = Object.freeze(['SIGTERM', 'SIGINT', 'SIGHUP']);

function installSystemShutdownHandlers({
  platform = process.platform,
  processRef = process,
  powerMonitor,
  onShutdownRequested,
  onForceExit,
  log = console,
}) {
  // Windows already ends the session through Electron's query-session-end path.
  if (platform === 'win32') return { installed: false };

  let requested = false;

  function request(reason) {
    if (requested) return;
    requested = true;
    onShutdownRequested(reason);
  }

  SHUTDOWN_SIGNALS.forEach((signal) => {
    processRef.on(signal, () => {
      // A repeated signal means whoever sent the first gave up waiting on the clean quit.
      if (requested) {
        log.warn(`Received ${signal} again during shutdown; exiting now`);
        onForceExit(signal);
        return;
      }
      log.info(`Received ${signal}; quitting`);
      request(signal);
    });
  });

  // Listening for 'shutdown' is what makes Electron take a logind delay inhibitor, and
  // preventDefault() holds it until this process exits (logind caps the wait at
  // InhibitDelayMaxSec, 5 s by default). That gives the config flush a head start on the
  // SIGTERM that follows.
  if (platform === 'linux' && powerMonitor) {
    powerMonitor.on('shutdown', (event) => {
      event?.preventDefault?.();
      log.info('System is shutting down; quitting');
      request('shutdown');
    });
  }

  return { installed: true };
}

module.exports = {
  SHUTDOWN_SIGNALS,
  installSystemShutdownHandlers,
};
