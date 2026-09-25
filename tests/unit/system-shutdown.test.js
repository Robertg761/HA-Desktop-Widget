const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const {
  SHUTDOWN_SIGNALS,
  installSystemShutdownHandlers,
} = require('../../src/system-shutdown.cjs');

function install(platform) {
  const processRef = new EventEmitter();
  const powerMonitor = new EventEmitter();
  const onShutdownRequested = jest.fn();
  const onForceExit = jest.fn();
  const result = installSystemShutdownHandlers({
    platform,
    processRef,
    powerMonitor,
    onShutdownRequested,
    onForceExit,
    log: { info: jest.fn(), warn: jest.fn() },
  });
  return { processRef, powerMonitor, onShutdownRequested, onForceExit, result };
}

describe('system shutdown handlers', () => {
  it.each(SHUTDOWN_SIGNALS)('quits cleanly on %s', (signal) => {
    const { processRef, onShutdownRequested, onForceExit } = install('linux');
    processRef.emit(signal);
    expect(onShutdownRequested).toHaveBeenCalledWith(signal);
    expect(onForceExit).not.toHaveBeenCalled();
  });

  it('exits immediately on a repeated signal', () => {
    const { processRef, onShutdownRequested, onForceExit } = install('linux');
    processRef.emit('SIGTERM');
    processRef.emit('SIGTERM');
    expect(onShutdownRequested).toHaveBeenCalledTimes(1);
    expect(onForceExit).toHaveBeenCalledWith('SIGTERM');
  });

  it('holds the logind shutdown delay and quits on PrepareForShutdown', () => {
    const { powerMonitor, onShutdownRequested } = install('linux');
    const event = { preventDefault: jest.fn() };
    powerMonitor.emit('shutdown', event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(onShutdownRequested).toHaveBeenCalledWith('shutdown');
  });

  it('requests the quit once when SIGTERM follows the logind notice', () => {
    const { processRef, powerMonitor, onShutdownRequested, onForceExit } = install('linux');
    powerMonitor.emit('shutdown', { preventDefault: jest.fn() });
    processRef.emit('SIGTERM');
    expect(onShutdownRequested).toHaveBeenCalledTimes(1);
    expect(onForceExit).toHaveBeenCalledWith('SIGTERM');
  });

  it('handles signals but leaves the shutdown event alone on macOS', () => {
    const { processRef, powerMonitor, result } = install('darwin');
    expect(result.installed).toBe(true);
    expect(processRef.listenerCount('SIGTERM')).toBe(1);
    expect(powerMonitor.listenerCount('shutdown')).toBe(0);
  });

  it('installs nothing on Windows', () => {
    const { processRef, powerMonitor, result } = install('win32');
    expect(result.installed).toBe(false);
    expect(processRef.eventNames()).toEqual([]);
    expect(powerMonitor.eventNames()).toEqual([]);
  });

  it('is wired into main so a shutdown skips the save-failure dialog', () => {
    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');
    expect(mainSource).toMatch(
      /installSystemShutdownHandlers\(\{[\s\S]*?onShutdownRequested: quitForSystemShutdown/
    );
    const beforeQuit = mainSource.slice(mainSource.indexOf("app.on('before-quit'"));
    expect(beforeQuit.indexOf('systemShutdownRequested')).toBeLessThan(
      beforeQuit.indexOf('dialog.showErrorBox')
    );
  });
});
