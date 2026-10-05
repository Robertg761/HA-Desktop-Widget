/** @jest-environment jsdom */
// A desktop layer on Hyprland is dragged by the app itself: a press on the header captures the
// pointer and starts a compositor drag. What is a control inside the header must keep its press.

let installLayerDrag;

beforeAll(() => {
  // jsdom has no pointer capture.
  HTMLElement.prototype.setPointerCapture = jest.fn();
  window.electronAPI = {
    beginLayerDrag: jest.fn(async () => ({ success: true })),
    endLayerDrag: jest.fn(async () => ({ success: true })),
  };
  ({ installLayerDrag } = require('../../src/layer-drag.js'));
  installLayerDrag();
});

beforeEach(() => {
  jest.clearAllMocks();
  document.body.className = 'layer-drag-enabled';
  // The header as index.html has it, with the connection dot as ui-utils makes it.
  document.body.innerHTML = `
    <div class="widget-header">
      <div class="drag-area">
        <h1 class="widget-title" id="title">Home Assistant</h1>
        <div class="connection-indicator" id="connection-status" role="button" tabindex="0"></div>
      </div>
      <div class="header-controls"><button type="button" id="settings">S</button></div>
    </div>`;
});

function press(id) {
  const target = document.getElementById(id);
  const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 });
  target.dispatchEvent(event);
  return event;
}

it('drags the widget from the title', () => {
  const event = press('title');

  expect(window.electronAPI.beginLayerDrag).toHaveBeenCalledTimes(1);
  expect(event.defaultPrevented).toBe(true);
});

it('leaves a press on the connection dot to the dot, so its click opens the details', () => {
  const event = press('connection-status');

  expect(window.electronAPI.beginLayerDrag).not.toHaveBeenCalled();
  expect(HTMLElement.prototype.setPointerCapture).not.toHaveBeenCalled();
  expect(event.defaultPrevented).toBe(false);
});

it('leaves buttons in the header alone', () => {
  press('settings');

  expect(window.electronAPI.beginLayerDrag).not.toHaveBeenCalled();
});

it('still drags a pin in edit mode by its focusable shell', () => {
  document.body.className = 'layer-drag-enabled desktop-pin-edit-mode';
  document.body.innerHTML = `
    <div class="desktop-pin-shell" id="shell" tabindex="0">
      <div class="desktop-pin-content" id="content"></div>
    </div>`;

  press('content');
  expect(window.electronAPI.beginLayerDrag).toHaveBeenCalledTimes(1);
});

it('does nothing outside a desktop layer', () => {
  document.body.className = '';

  press('title');
  expect(window.electronAPI.beginLayerDrag).not.toHaveBeenCalled();
});
