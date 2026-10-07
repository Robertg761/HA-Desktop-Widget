// Electron work areas are in logical pixels. Keep the preferred position relative to the
// work area so rearranging monitors or temporarily undocking does not erase it.
function connectedDisplays(screen) {
  return screen
    .getAllDisplays()
    .filter(
      (display) =>
        Number.isFinite(display.id) &&
        display.id !== -1 &&
        display.id !== -10 &&
        display.workArea?.width > 0 &&
        display.workArea?.height > 0
    );
}

function preference(config) {
  const value = config?.windowDisplay;
  return value &&
    typeof value.id === 'string' &&
    value.id &&
    Number.isFinite(value.offset?.x) &&
    Number.isFinite(value.offset?.y)
    ? value
    : null;
}

// Windows runtime display IDs change when an adapter restarts. Prefer the OS
// monitor device path when available, and never fall back to a reused runtime ID.
function findPreferredWindowDisplay(config, screen) {
  const saved = preference(config);
  if (!saved) return null;
  const matches = connectedDisplays(screen).filter((display) =>
    saved.persistentId
      ? display.persistentId === saved.persistentId
      : String(display.id) === saved.id
  );
  return matches.length === 1 ? matches[0] : null;
}

function createDisplayIdentityScreen(screen, getIdentities) {
  const decorate = (display) => {
    const persistentId = getIdentities()[String(display.id)];
    return persistentId ? { ...display, persistentId } : display;
  };
  return new Proxy(screen, {
    get(target, key) {
      if (key === 'getAllDisplays') return () => target.getAllDisplays().map(decorate);
      if (key === 'getPrimaryDisplay') return () => decorate(target.getPrimaryDisplay());
      if (key === 'getDisplayMatching')
        return (bounds) => decorate(target.getDisplayMatching(bounds));
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function positionOnDisplay(display, offset, size) {
  const area = display.workArea;
  return {
    x: Math.round(area.x + Math.max(0, Math.min(offset.x, area.width - size.width))),
    y: Math.round(area.y + Math.max(0, Math.min(offset.y, area.height - size.height))),
  };
}

function getWindowDisplayState(config, screen, supported) {
  if (!supported) return { supported: false, selectedId: '', displays: [] };
  const saved = preference(config);
  const primaryId = screen.getPrimaryDisplay().id;
  const displays = connectedDisplays(screen).map((display, index) => ({
    id: String(display.id),
    label: display.label || '',
    index: index + 1,
    width: display.workArea.width,
    height: display.workArea.height,
    primary: display.id === primaryId,
    available: true,
  }));
  const target = findPreferredWindowDisplay(config, screen);
  const selectedId = target
    ? String(target.id)
    : saved
      ? saved.persistentId
        ? `disconnected:${saved.persistentId}`
        : saved.id
      : '';
  if (saved && !target) {
    displays.push({ id: selectedId, label: saved.label || saved.id, available: false });
  }
  return { supported: true, selectedId, displays };
}

function resolveWindowDisplayPosition(config, screen, size = config.windowSize) {
  const saved = preference(config);
  if (!saved) return null;
  const displays = connectedDisplays(screen);
  const target =
    findPreferredWindowDisplay(config, screen) ||
    displays.find((display) => display.id === screen.getPrimaryDisplay().id) ||
    displays[0];
  return target ? positionOnDisplay(target, saved.offset, size) : null;
}

function prepareWindowDisplayChoice(
  id,
  config,
  screen,
  bounds = { ...config.windowPosition, ...config.windowSize }
) {
  if (id === '') return { windowDisplay: null };
  if (typeof id !== 'string') throw new Error('Invalid display selection');
  const target = connectedDisplays(screen).find((display) => String(display.id) === id);
  if (
    !target &&
    getWindowDisplayState(config, screen, true).selectedId === id &&
    preference(config)
  )
    return { windowDisplay: config.windowDisplay };
  if (!target) throw new Error('The selected display is no longer connected');
  const source = screen.getDisplayMatching(bounds).workArea;
  const offset = { x: bounds.x - source.x, y: bounds.y - source.y };
  const windowPosition = positionOnDisplay(target, offset, bounds);
  return {
    windowDisplay: {
      id,
      ...(target.persistentId ? { persistentId: target.persistentId } : {}),
      label: target.label || '',
      offset: {
        x: windowPosition.x - target.workArea.x,
        y: windowPosition.y - target.workArea.y,
      },
    },
    windowPosition,
  };
}

function rememberWindowDisplayPosition(config, screen, bounds) {
  const saved = preference(config);
  if (!saved || !findPreferredWindowDisplay(config, screen)) {
    return saved;
  }
  const target = screen.getDisplayMatching(bounds);
  if (!connectedDisplays(screen).some((display) => display.id === target.id)) return saved;
  return {
    id: String(target.id),
    ...(target.persistentId ? { persistentId: target.persistentId } : {}),
    label: target.label || '',
    offset: {
      x: bounds.x - target.workArea.x,
      y: bounds.y - target.workArea.y,
    },
  };
}

function formatWindowDisplayLabel(display, t) {
  const name = display.label
    ? display.index
      ? `${display.index}. ${display.label}`
      : display.label
    : t('Display {{number}}', { number: display.index });
  if (!display.available) return t('{{display}} (disconnected)', { display: name });
  const detail = `${name} · ${display.width} × ${display.height}`;
  return display.primary ? t('{{display}} (primary)', { display: detail }) : detail;
}

module.exports = {
  createDisplayIdentityScreen,
  findPreferredWindowDisplay,
  getWindowDisplayState,
  resolveWindowDisplayPosition,
  prepareWindowDisplayChoice,
  rememberWindowDisplayPosition,
  formatWindowDisplayLabel,
};
