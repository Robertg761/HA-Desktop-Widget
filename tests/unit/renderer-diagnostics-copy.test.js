/**
 * @jest-environment jsdom
 */

const { createRendererHarness } = require('../helpers/renderer-harness');

describe('Show log file', () => {
  const harness = createRendererHarness();

  afterEach(() => harness.cleanup());

  const loadWithButton = async (openLogs) => {
    await harness.load({
      config: harness.tokenConfig(),
      bodyHtml: '<button id="view-logs-btn" type="button">Show log file</button>',
      configureApi(api) {
        api.openLogs = jest.fn(openLogs);
      },
    });
    document.getElementById('view-logs-btn').click();
    await harness.flushAsync();
  };

  const toasts = () => harness.uiUtils.showToast.mock.calls;

  it('says where the log file is once it has been shown', async () => {
    await loadWithButton(async () => ({ success: true, path: '/home/me/logs/main.log' }));

    expect(toasts()).toContainEqual([
      'Showing the log file: /home/me/logs/main.log',
      'info',
      expect.any(Number),
    ]);
    expect(harness.uiUtils.copyTextToClipboard).not.toHaveBeenCalled();
  });

  it('copies the path when no file manager opened, and says so', async () => {
    await loadWithButton(async () => ({
      success: false,
      path: '/home/me/logs/main.log',
      error: 'Failed to open path',
    }));

    expect(harness.uiUtils.copyTextToClipboard).toHaveBeenCalledWith('/home/me/logs/main.log');
    expect(toasts()).toContainEqual([
      'No file manager opened. The path of the log file was copied: /home/me/logs/main.log',
      'error',
      expect.any(Number),
    ]);
  });

  it('reports the failure itself when the path cannot be copied either', async () => {
    await harness.load({
      config: harness.tokenConfig(),
      bodyHtml: '<button id="view-logs-btn" type="button">Show log file</button>',
      uiUtils: { copyTextToClipboard: jest.fn(async () => false) },
      configureApi(api) {
        api.openLogs = jest.fn(async () => ({
          success: false,
          path: '/home/me/logs/main.log',
          error: 'Failed to open path',
        }));
      },
    });
    document.getElementById('view-logs-btn').click();
    await harness.flushAsync();

    expect(toasts()).toContainEqual([
      'Failed to open log file: Failed to open path',
      'error',
      expect.any(Number),
    ]);
  });
});
