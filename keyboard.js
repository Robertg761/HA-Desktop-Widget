function shouldIgnoreShortcut(target) {
  if (!target) return false;
  const tag = (target.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  try {
    if (typeof target.closest === 'function') {
      const ce = target.closest('[contenteditable="true"]');
      if (ce) return true;
    }
  } catch {
    // Ignore errors when checking for contenteditable elements
  }
  // ARIA textbox roles (e.g., div[role=textbox])
  const role = (target.getAttribute && target.getAttribute('role')) || '';
  if (role.toLowerCase() === 'textbox') return true;
  return false;
}

module.exports = { shouldIgnoreShortcut };

