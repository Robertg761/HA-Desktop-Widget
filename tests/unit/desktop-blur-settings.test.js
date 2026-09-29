/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('desktop blur retry control', () => {
  it('retries the widget exception instead of disabling blur after an enable failure', async () => {
    document.body.innerHTML = `
      <input id="frosted-glass" type="checkbox" checked>
      <div id="desktop-blur-row">
        <span id="desktop-blur-status"></span>
        <button id="desktop-blur-toggle"></button>
      </div>`;
    const ready = {
      supported: true,
      enabled: true,
      canManage: true,
      managed: true,
      widgetRuleFailed: false,
    };
    const change = jest.fn().mockResolvedValue({ success: true, status: ready });
    const source = fs.readFileSync(path.join(__dirname, '../../src/settings.js'), 'utf8');
    const render = source.slice(
      source.indexOf('function renderDesktopBlur('),
      source.indexOf('async function refreshDesktopIntegration(')
    );
    const context = vm.createContext({
      document,
      window: { electronAPI: { setDesktopBlur: change } },
      t: (text) => text,
      showToast: jest.fn(),
      status: { ...ready, widgetRuleFailed: true },
    });
    vm.runInContext(`${render}\nrenderDesktopBlur(status);`, context);
    const button = document.getElementById('desktop-blur-toggle');
    expect(document.getElementById('desktop-blur-row').hidden).toBe(false);
    expect(document.getElementById('desktop-blur-status').textContent).toBe(
      "Could not change Hyprland's blur."
    );
    expect(button.textContent).toBe('Turn on blur for the widget');
    await button.onclick();
    expect(change).toHaveBeenCalledWith(true);
    expect(button.textContent).toBe('Turn off widget blur');
    expect(button.disabled).toBe(false);
    expect(document.getElementById('desktop-blur-status').textContent).toBe(
      'Hyprland blurs the widget. Other windows are not blurred.'
    );
  });
});
