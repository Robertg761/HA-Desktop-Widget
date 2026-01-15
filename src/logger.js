/**
 * Browser-compatible logger for renderer process
 * Replaces electron-log when contextIsolation is enabled
 */

const LOG_LEVELS = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
};

let currentLevel = LOG_LEVELS.warn;

/**
 * Set the current log level
 * @param {'error' | 'warn' | 'info' | 'debug'} level
 */
export function setLevel(level) {
    if (LOG_LEVELS[level] !== undefined) {
        currentLevel = LOG_LEVELS[level];
    }
}

/**
 * Format log message with timestamp
 * @param {string} level
 * @param {any[]} args
 */
function formatLog(level, args) {
    const timestamp = new Date().toISOString();
    return [`[${timestamp}] [${level.toUpperCase()}]`, ...args];
}

const log = {
    error: (...args) => {
        if (currentLevel >= LOG_LEVELS.error) {
            console.error(...formatLog('error', args));
        }
    },
    warn: (...args) => {
        if (currentLevel >= LOG_LEVELS.warn) {
            console.warn(...formatLog('warn', args));
        }
    },
    info: (...args) => {
        if (currentLevel >= LOG_LEVELS.info) {
            console.info(...formatLog('info', args));
        }
    },
    debug: (...args) => {
        if (currentLevel >= LOG_LEVELS.debug) {
            console.debug(...formatLog('debug', args));
        }
    },
    // Compatibility with electron-log API
    transports: {
        console: {
            level: 'warn',
        },
    },
    errorHandler: {
        startCatching: () => {
            window.addEventListener('error', (event) => {
                log.error('Uncaught error:', event.error);
            });
            window.addEventListener('unhandledrejection', (event) => {
                log.error('Unhandled rejection:', event.reason);
            });
        },
    },
    setLevel,
};

export default log;
