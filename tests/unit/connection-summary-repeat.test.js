/**
 * @jest-environment jsdom
 */

const { createMockElectronAPI } = require('../mocks/electron.js');

window.electronAPI = createMockElectronAPI();
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: jest.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  })),
});

const { stripSummaryPrefix } = require('../../src/connection-status.js');
const uiUtils = require('../../src/ui-utils.js');

describe('stripSummaryPrefix', () => {
  it('drops a summary the detail begins with, and the punctuation after it', () => {
    expect(
      stripSummaryPrefix(
        'Disconnected from Home Assistant',
        'Disconnected from Home Assistant. Retrying automatically.'
      )
    ).toBe('Retrying automatically.');
    expect(
      stripSummaryPrefix('Authentication failed', 'Authentication failed: check the token')
    ).toBe('check the token');
  });

  it('knows the full stops of Chinese, Hindi and Arabic text', () => {
    expect(
      stripSummaryPrefix('与 Home Assistant 断开连接', '与 Home Assistant 断开连接。将自动重试。')
    ).toBe('将自动重试。');
    expect(stripSummaryPrefix('कनेक्शन टूट गया', 'कनेक्शन टूट गया। अपने आप फिर कोशिश होगी।')).toBe(
      'अपने आप फिर कोशिश होगी।'
    );
    expect(stripSummaryPrefix('انقطع الاتصال', 'انقطع الاتصال؛ ستتم إعادة المحاولة تلقائيًا')).toBe(
      'ستتم إعادة المحاولة تلقائيًا'
    );
  });

  it('returns a detail that does not begin with the summary as it is', () => {
    expect(stripSummaryPrefix('Disconnected', 'Retrying automatically.')).toBe(
      'Retrying automatically.'
    );
    // A longer word that merely starts the same is not a repeat.
    expect(stripSummaryPrefix('Authentication failed', 'Authentication failedness')).toBe(
      'Authentication failedness'
    );
  });

  it('returns nothing when the detail is only the summary', () => {
    expect(stripSummaryPrefix('Connected', 'Connected.')).toBe('');
    expect(stripSummaryPrefix('Connected', 'Connected')).toBe('');
  });

  it('copes with empty and missing input', () => {
    expect(stripSummaryPrefix('', 'Retrying')).toBe('Retrying');
    expect(stripSummaryPrefix('Connected', '')).toBe('');
    expect(stripSummaryPrefix(undefined, undefined)).toBe('');
  });
});

describe('the connection indicator names the outage once', () => {
  let status;

  beforeEach(() => {
    document.body.innerHTML = '';
    status = document.createElement('div');
    status.id = 'connection-status';
    document.body.appendChild(status);
  });

  it('reads "Disconnected from Home Assistant. Retrying automatically." as one sentence each', () => {
    uiUtils.setStatus(false, 'Disconnected from Home Assistant. Retrying automatically.');

    expect(status.getAttribute('aria-label')).toBe(
      'Disconnected from Home Assistant. Retrying automatically.'
    );
    // The dot's own tooltip carries the words; a title attribute would add Chromium's after it.
    expect(status.hasAttribute('title')).toBe(false);
  });

  it('keeps a detail that adds something else whole', () => {
    uiUtils.setStatus(
      false,
      'Unable to reach Home Assistant. Check your network or Home Assistant URL.'
    );

    expect(status.getAttribute('aria-label')).toBe(
      'Disconnected from Home Assistant. Unable to reach Home Assistant. Check your network or Home Assistant URL.'
    );
  });

  it('falls back to the summary alone when the detail is only a repeat of it', () => {
    uiUtils.setStatus(false, 'Disconnected from Home Assistant');

    expect(status.getAttribute('aria-label')).toBe('Disconnected from Home Assistant');
    expect(status.hasAttribute('title')).toBe(false);
  });

  it('does not repeat it in the tooltip either, including the default detail', () => {
    uiUtils.initializeConnectionStatusTooltip();
    uiUtils.setStatus(false);
    status.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));

    const tooltip = document.getElementById('connection-status-tooltip');
    expect(tooltip.querySelector('.connection-status-tooltip-title').textContent).toBe(
      'Disconnected from Home Assistant'
    );
    expect(tooltip.querySelector('.connection-status-tooltip-detail').textContent).toBe(
      'Retrying automatically.'
    );
  });
});
