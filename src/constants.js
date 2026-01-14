/**
 * Application-wide constants
 * Extracted from various files to centralize configuration values
 */

// WebSocket
const WS_REQUEST_TIMEOUT_MS = 15000;
const WS_INITIAL_ID = 1000;

// Reconnection
const BASE_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;

// HTTP Agents
const AGENT_TIMEOUT_MS = 60000;
const AGENT_MAX_SOCKETS = 100;
const AGENT_MAX_FREE_SOCKETS = 10;
const AGENT_KEEPALIVE_MS = 1000;

// Window Defaults
const DEFAULT_WINDOW_X = 100;
const DEFAULT_WINDOW_Y = 100;
const DEFAULT_WINDOW_WIDTH = 500;
const DEFAULT_WINDOW_HEIGHT = 600;
const DEFAULT_OPACITY = 0.95;
const MIN_OPACITY = 0.5;
const MAX_OPACITY = 1.0;

// Update Interval
const DEFAULT_UPDATE_INTERVAL_MS = 5000;

module.exports = {
    // WebSocket
    WS_REQUEST_TIMEOUT_MS,
    WS_INITIAL_ID,

    // Reconnection
    BASE_RECONNECT_DELAY_MS,
    MAX_RECONNECT_DELAY_MS,

    // HTTP Agents
    AGENT_TIMEOUT_MS,
    AGENT_MAX_SOCKETS,
    AGENT_MAX_FREE_SOCKETS,
    AGENT_KEEPALIVE_MS,

    // Window Defaults
    DEFAULT_WINDOW_X,
    DEFAULT_WINDOW_Y,
    DEFAULT_WINDOW_WIDTH,
    DEFAULT_WINDOW_HEIGHT,
    DEFAULT_OPACITY,
    MIN_OPACITY,
    MAX_OPACITY,

    // Update Interval
    DEFAULT_UPDATE_INTERVAL_MS,
};
