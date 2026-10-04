/**
 * @jest-environment jsdom
 */

const { clearFieldError, clearFieldErrors, showFieldError } = require('../../src/field-errors.js');

describe('inline field errors', () => {
  let general, advanced, url, folder, chooseFolder;
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="modal-tabs">
        <button class="tab-link" data-tab="general"></button>
        <button class="tab-link" data-tab="advanced"></button>
      </div>
      <div id="general-tab" class="tab-content active">
        <div class="form-group">
          <label for="ha-url">Home Assistant URL</label>
          <input id="ha-url" aria-describedby="url-help" />
          <p id="url-help" class="form-help">Help</p>
        </div>
      </div>
      <div id="advanced-tab" class="tab-content">
        <details id="sync-details">
          <div class="form-group">
            <div class="row">
              <input id="folder" readonly />
              <button id="choose" type="button">Choose</button>
            </div>
          </div>
        </details>
      </div>`;
    general = document.getElementById('general-tab');
    advanced = document.getElementById('advanced-tab');
    url = document.getElementById('ha-url');
    folder = document.getElementById('folder');
    chooseFolder = document.getElementById('choose');
    // The tab buttons do what Settings' own do.
    document.querySelectorAll('.tab-link').forEach((tab) =>
      tab.addEventListener('click', () => {
        [general, advanced].forEach((panel) =>
          panel.classList.toggle('active', panel.id === `${tab.dataset.tab}-tab`)
        );
      })
    );
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('says what is wrong under the field and points the field at it', () => {
    showFieldError(url, 'URL must start with http:// or https://');

    const message = document.getElementById('ha-url-error');
    expect(message.textContent).toBe('URL must start with http:// or https://');
    expect(message.classList.contains('form-error')).toBe(true);
    // After the field's group, not between it and its own help
    expect(url.closest('.form-group').nextElementSibling).toBe(message);
    expect(url.getAttribute('aria-invalid')).toBe('true');
    // The help it already had is kept, and the message is read after it
    expect(url.getAttribute('aria-describedby')).toBe('url-help ha-url-error');
    expect(document.activeElement).toBe(url);
  });

  test('brings the page of the field forward, and opens the section around it', () => {
    expect(advanced.classList.contains('active')).toBe(false);

    showFieldError(folder, 'Choose a sync folder.', { focusTarget: chooseFolder });

    expect(advanced.classList.contains('active')).toBe(true);
    expect(general.classList.contains('active')).toBe(false);
    expect(document.getElementById('sync-details').open).toBe(true);
    expect(document.activeElement).toBe(chooseFolder);
    expect(folder.getAttribute('aria-invalid')).toBe('true');
  });

  test('puts the message after the anchor it is given', () => {
    const row = folder.closest('.row');
    showFieldError(folder, 'Choose a sync folder.', { anchor: row });
    expect(row.nextElementSibling.id).toBe('folder-error');
  });

  test('is cleared by editing the field, and by nothing less', () => {
    showFieldError(url, 'Bad');

    url.dispatchEvent(new Event('click', { bubbles: true }));
    url.dispatchEvent(new Event('focus'));
    expect(document.getElementById('ha-url-error')).not.toBeNull();

    url.dispatchEvent(new Event('input', { bubbles: true }));

    expect(document.getElementById('ha-url-error')).toBeNull();
    expect(url.hasAttribute('aria-invalid')).toBe(false);
    // Only the message goes from the description; the field's own help stays
    expect(url.getAttribute('aria-describedby')).toBe('url-help');
  });

  test('a button field is answered by pressing it', () => {
    showFieldError(chooseFolder, 'Press it.');
    expect(chooseFolder.getAttribute('aria-invalid')).toBe('true');
    chooseFolder.click();
    expect(chooseFolder.hasAttribute('aria-invalid')).toBe(false);
  });

  test('flagging a field again replaces the message instead of stacking another', () => {
    showFieldError(url, 'First');
    showFieldError(url, 'Second');

    const messages = document.querySelectorAll('[data-field-error-for="ha-url"]');
    expect(messages).toHaveLength(1);
    expect(messages[0].textContent).toBe('Second');
    expect(url.getAttribute('aria-describedby')).toBe('url-help ha-url-error');
  });

  test('is spoken as an alert when the field already has the caret, since focusing it says nothing', () => {
    url.focus();
    showFieldError(url, 'Bad');
    expect(document.getElementById('ha-url-error').getAttribute('role')).toBe('alert');

    clearFieldError(url);
    folder.focus();
    showFieldError(url, 'Bad again');
    expect(document.getElementById('ha-url-error').hasAttribute('role')).toBe(false);
  });

  test('can be cleared for a whole dialog, so the next visit does not open on an old error', () => {
    showFieldError(url, 'Bad');
    showFieldError(folder, 'Worse');

    clearFieldErrors(document.body);

    expect(document.querySelector('[data-field-error-for]')).toBeNull();
    expect(url.hasAttribute('aria-invalid')).toBe(false);
    expect(folder.hasAttribute('aria-invalid')).toBe(false);
    // Nothing left that would clear it later on an unrelated edit
    expect(() => url.dispatchEvent(new Event('input'))).not.toThrow();
  });

  test('does nothing for a field without an id, which could not be pointed at', () => {
    const anonymous = document.createElement('input');
    document.body.append(anonymous);
    expect(() => showFieldError(anonymous, 'No')).not.toThrow();
    expect(anonymous.hasAttribute('aria-invalid')).toBe(false);
  });
});
