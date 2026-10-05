// What a press inside a drag handle still belongs to: the controls, and anything a script made into
// one, such as the connection dot in the header (a focusable role=button). Capturing the pointer on
// the handle retargets the click to the handle, so a control under it would never hear it.
const HANDLE_CONTROLS =
  'button, input, select, a, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';

// Layer surfaces use explicit placement. Pointer capture keeps release events
// reaching the handle even while the compositor animates the surface away.
export function installLayerDrag() {
  let active = null;
  document.addEventListener('pointerdown', async (event) => {
    if (event.button !== 0 || !document.body.classList.contains('layer-drag-enabled')) return;
    const handle = event.target.closest(
      '.widget-header, .drag-area, .drag-region, body.desktop-pin-edit-mode .desktop-pin-shell'
    );
    if (!handle) return;
    // Only a control inside the handle; a focusable handle is still dragged by itself.
    const control = event.target.closest(HANDLE_CONTROLS);
    if (control && control !== handle && handle.contains(control)) return;
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
