/** Main-process clocks keep tray timers current without waking hidden dashboard animations. */
function createTrayEntityTicker(onTick) {
  const clocks = new Map();
  function setActive(entityId, active) {
    if (!active) {
      globalThis.clearInterval(clocks.get(entityId));
      clocks.delete(entityId);
    } else if (!clocks.has(entityId) && entityId.startsWith('timer.')) {
      const clock = globalThis.setInterval(() => onTick(entityId), 1000);
      clock.unref?.();
      clocks.set(entityId, clock);
    }
  }
  function clear() {
    clocks.forEach(globalThis.clearInterval);
    clocks.clear();
  }
  function reconcile(entityIds) {
    const configured = new Set(entityIds);
    clocks.forEach((_clock, entityId) => {
      if (!configured.has(entityId)) setActive(entityId, false);
    });
  }
  return { setActive, clear, reconcile, hasActive: (entityId) => clocks.has(entityId) };
}
module.exports = { createTrayEntityTicker };
