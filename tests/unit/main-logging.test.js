const {
  MAIN_LOG_FORMAT,
  attachBrokenPipeHandlers,
  configureMainLogging,
  isBrokenPipeError,
} = require('../../src/main-logging.cjs');

function createMockLogger() {
  return {
    processInternalErrorFn: jest.fn(),
    transports: {
      file: {},
      console: {},
    },
    errorHandler: {
      startCatching: jest.fn(),
    },
  };
}

describe('main logging setup', () => {
  test('identifies broken stdout and stderr pipe errors', () => {
    expect(isBrokenPipeError({ code: 'EPIPE' })).toBe(true);
    expect(isBrokenPipeError(new Error('write EPIPE'))).toBe(false);
    expect(isBrokenPipeError(null)).toBe(false);
  });

  test('suppresses EPIPE stream errors and forwards other stream errors', () => {
    const stream = { on: jest.fn() };
    const onUnhandledError = jest.fn();

    attachBrokenPipeHandlers([stream], onUnhandledError);
    const handler = stream.on.mock.calls[0][1];

    handler({ code: 'EPIPE' });
    expect(onUnhandledError).not.toHaveBeenCalled();

    const error = new Error('stream failed');
    handler(error);
    expect(onUnhandledError).toHaveBeenCalledWith(error);
  });

  test('disables console transport for packaged builds and ignores EPIPE dialogs', () => {
    const logger = createMockLogger();
    const previousInternalErrorFn = logger.processInternalErrorFn;

    configureMainLogging(logger, {
      isPackaged: true,
      streams: [],
    });

    expect(logger.transports.file.format).toBe(MAIN_LOG_FORMAT);
    expect(logger.transports.file.level).toBe('info');
    expect(logger.transports.console.level).toBe(false);
    expect(logger.errorHandler.startCatching).toHaveBeenCalledTimes(1);

    const [{ onError }] = logger.errorHandler.startCatching.mock.calls[0];
    expect(onError({ error: { code: 'EPIPE' } })).toBe(false);
    expect(onError({ error: new Error('real failure') })).toBeUndefined();

    logger.processInternalErrorFn({ code: 'EPIPE' });
    const internalError = new Error('log transport failed');
    logger.processInternalErrorFn(internalError);
    expect(previousInternalErrorFn).toHaveBeenCalledWith(internalError);
  });

  test('keeps warning console output for development builds', () => {
    const logger = createMockLogger();
    const previousInternalErrorFn = logger.processInternalErrorFn;
    const error = new Error('log transport failed');

    configureMainLogging(logger, {
      isPackaged: false,
      streams: [],
    });

    expect(logger.transports.console.level).toBe('warn');
    logger.processInternalErrorFn(error);
    expect(previousInternalErrorFn).toHaveBeenCalledWith(error);
  });
});
