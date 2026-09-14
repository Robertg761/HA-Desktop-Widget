const { execFile, execFileSync } = require('child_process');

function readHyprlandMonitors(run = execFileSync) {
  try {
    const monitors = JSON.parse(
      run('hyprctl', ['-j', 'monitors'], { encoding: 'utf8', timeout: 2000 })
    );
    return monitors
      .filter((m) => m.name && m.width > 0 && m.height > 0)
      .map((m) => {
        const scale = Number(m.scale) || 1;
        const rotated = [1, 3, 5, 7].includes(m.transform);
        const width = Math.round((rotated ? m.height : m.width) / scale);
        const height = Math.round((rotated ? m.width : m.height) / scale);
        const [left = 0, top = 0, right = 0, bottom = 0] = m.reserved || [];
        return {
          name: m.name,
          focused: !!m.focused,
          x: m.x,
          y: m.y,
          width,
          height,
          workArea: { x: left, y: top, width: width - left - right, height: height - top - bottom },
        };
      });
  } catch {
    return [];
  }
}

function chooseLayerMonitor(monitors, preferred) {
  return (
    monitors.find((m) => m.name === preferred) || monitors.find((m) => m.focused) || monitors[0]
  );
}

function clampLayerPosition(position, size, monitor) {
  const area = monitor?.workArea || { x: 0, y: 0, width: 1280, height: 720 };
  const bound = (v, min, max) =>
    Math.min(Math.max(min, max), Math.max(min, Math.round(Number(v) || 0)));
  return {
    x: bound(
      position?.x ?? area.x + area.width - size.width - 20,
      area.x,
      area.x + area.width - size.width
    ),
    y: bound(
      position?.y ?? area.y + area.height - size.height - 20,
      area.y,
      area.y + area.height - size.height
    ),
  };
}

function readHyprlandCursor(run = execFile) {
  return new Promise((resolve) =>
    run('hyprctl', ['-j', 'cursorpos'], { encoding: 'utf8', timeout: 1000 }, (error, output) => {
      try {
        const p = JSON.parse(output);
        resolve(!error && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null);
      } catch {
        resolve(null);
      }
    })
  );
}

module.exports = {
  readHyprlandMonitors,
  chooseLayerMonitor,
  clampLayerPosition,
  readHyprlandCursor,
};
