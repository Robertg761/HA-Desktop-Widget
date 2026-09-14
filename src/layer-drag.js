// Layer surfaces use explicit placement. Pointer capture keeps release events
// reaching the handle even while the compositor animates the surface away.
export function installLayerDrag() {
  let active = null;
  document.addEventListener('pointerdown', async (event) => {
    if (event.button !== 0 || !document.body.classList.contains('layer-drag-enabled')) return;
    const handle = event.target.closest(
      '.drag-area, .drag-region, .desktop-pin-drag-region, .header, body.desktop-pin-edit-mode .desktop-pin-shell'
    );
    if (!handle || event.target.closest('button, input, select, a, textarea')) return;
    event.preventDefault();
    active = { handle, pointerId: event.pointerId };
    handle.setPointerCapture(event.pointerId);
    const result = await window.electronAPI.beginLayerDrag();
    if (!result?.success || !active) await window.electronAPI.endLayerDrag();
  });
  const finish = () => {
    if (!active) return;
    active = null;
    void window.electronAPI.endLayerDrag();
  };
  document.addEventListener('pointerup', finish);
  document.addEventListener('pointercancel', finish);
  document.addEventListener('lostpointercapture', finish);
  window.addEventListener('blur', finish);
}
