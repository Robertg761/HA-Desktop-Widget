// Inline validation for form fields. A message that lives only in a toast is gone in seconds, is
// tied to no field and says nothing to a screen reader about which one is wrong. Here the message
// sits with the field, the field says it is invalid and points at the message, the page that holds
// the field comes forward, and the error clears as soon as the value is edited.

const ERROR_ATTRIBUTE = 'data-field-error-for';

function describedByTokens(field) {
  return (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
}

function findErrorNode(field) {
  return field.id ? document.querySelector(`[${ERROR_ATTRIBUTE}="${field.id}"]`) : null;
}

/** Removes the inline error of a field and everything it set on the field. */
function clearFieldError(field) {
  if (!field) return;
  const node = findErrorNode(field);
  if (node) {
    const remaining = describedByTokens(field).filter((token) => token !== node.id);
    if (remaining.length) field.setAttribute('aria-describedby', remaining.join(' '));
    else field.removeAttribute('aria-describedby');
    node.remove();
  }
  field.removeAttribute('aria-invalid');
  field._fieldErrorClear?.();
}

/** Removes every inline error under a container, such as when a dialog opens. */
function clearFieldErrors(root = document) {
  root.querySelectorAll(`[${ERROR_ATTRIBUTE}]`).forEach((node) => {
    clearFieldError(document.getElementById(node.getAttribute(ERROR_ATTRIBUTE)));
    node.remove();
  });
}

// Brings the page that holds the field to the front: its tab (the same click a person would make,
// so the page's own hooks run) and any collapsed section it sits in.
function revealField(field) {
  const panel = field.closest('.tab-content');
  const tab = panel?.id.replace(/-tab$/, '');
  if (panel && !panel.classList.contains('active') && tab) {
    document.querySelector(`.modal-tabs .tab-link[data-tab="${tab}"]`)?.click();
  }
  for (let node = field.parentElement; node; node = node.parentElement) {
    if (node.tagName === 'DETAILS') node.open = true;
  }
}

/**
 * Marks a field invalid, says why under it and takes the person there.
 * @param {HTMLElement|null} field - The control to flag; it needs an id.
 * @param {string} message - What is wrong and how to fix it, already translated.
 * @param {Object} [options]
 * @param {boolean} [options.focus=true] - Scroll to the field and focus it.
 * @param {HTMLElement} [options.focusTarget] - What to focus instead of the field, for a read-only
 *   field whose button is the thing to press.
 * @param {HTMLElement} [options.anchor] - What the message goes after. Defaults to the field's
 *   form group, so a field inside a flex row does not gain a stray flex item.
 */
function showFieldError(field, message, { focus = true, anchor = null, focusTarget = null } = {}) {
  if (!field?.id) return;
  clearFieldError(field);
  revealField(field);

  const node = document.createElement('p');
  node.id = `${field.id}-error`;
  node.className = 'form-help form-error field-error';
  node.setAttribute(ERROR_ATTRIBUTE, field.id);
  node.textContent = message;
  // A field that already has the caret is not announced again by focusing it, so the message is
  // spoken as an alert instead.
  if (document.activeElement === field) node.setAttribute('role', 'alert');
  (anchor || field.closest('.form-group') || field).after(node);

  field.setAttribute('aria-invalid', 'true');
  field.setAttribute('aria-describedby', [...describedByTokens(field), node.id].join(' '));

  // Editing the value answers the error (pressing a button, for a field that is one). Clicking into
  // a text field to place the caret does not. Re-flagging replaces this listener.
  const clear = () => clearFieldError(field);
  const events = field.matches('button') ? ['click'] : ['input', 'change'];
  events.forEach((type) => field.addEventListener(type, clear, { once: true }));
  field._fieldErrorClear = () => {
    events.forEach((type) => field.removeEventListener(type, clear));
    field._fieldErrorClear = null;
  };

  if (focus) {
    const target = focusTarget || field;
    target.scrollIntoView?.({ block: 'center' });
    target.focus?.();
  }
}

export { clearFieldError, clearFieldErrors, showFieldError };
