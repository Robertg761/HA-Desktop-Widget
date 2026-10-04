const MAIN_LOG_FORMAT = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';

function isBrokenPipeError(error) {
  return Boolean(error && error.code === 'EPIPE');
}

function rethrowAsync(error) {
  setImmediate(() => {
    throw error;
  });
}

function attachBrokenPipeHandlers(streams = [], onUnhandledError = rethrowAsync) {
  streams.forEach((stream) => {
    if (!stream || typeof stream.on !== 'function') return;
    stream.on('error', (error) => {
      if (isBrokenPipeError(error)) return;
      onUnhandledError(error);
    });
  });
}

function configureMainLogging(log, options = {}) {
  const {
    isPackaged = false,
    streams = [process.stdout, process.stderr],
    onStreamError = rethrowAsync,
  } = options;

  attachBrokenPipeHandlers(streams, onStreamError);

  if (log?.transports?.file) {
    log.transports.file.format = MAIN_LOG_FORMAT;
    log.transports.file.level = 'info';
  }

  if (log?.transports?.console) {
    log.transports.console.level = isPackaged ? false : 'warn';
  }

  const previousInternalErrorFn = log?.processInternalErrorFn;
  if (log && typeof previousInternalErrorFn === 'function') {
    log.processInternalErrorFn = (error) => {
      if (isBrokenPipeError(error)) return;
      previousInternalErrorFn(error);
    };
  }

  if (log?.errorHandler && typeof log.errorHandler.startCatching === 'function') {
    log.errorHandler.startCatching({
      // The default is a blocking native error box with a stack trace, which freezes the main
      // process (saves, IPC) until it is dismissed. The error is already logged.
      showDialog: false,
      onError({ error }) {
        if (isBrokenPipeError(error)) return false;
        return undefined;
      },
    });
  }
}

module.exports = {
  MAIN_LOG_FORMAT,
  attachBrokenPipeHandlers,
  configureMainLogging,
  isBrokenPipeError,
};
