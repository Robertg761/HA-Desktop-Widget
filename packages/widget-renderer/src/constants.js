/**
 * Application-wide constants
 * Extracted from various files to centralize configuration values
 */

// WebSocket
export const WS_REQUEST_TIMEOUT_MS = 15000;
// The first get_states of a connection has Home Assistant serialise every entity at once, which
// takes well over a request's usual time on a large install or a slow link. A dead connection is
// still caught by the ping/pong heartbeat, so this only has to outlast a slow reply.
export const WS_INITIAL_STATES_TIMEOUT_MS = 90000;
export const WS_INITIAL_ID = 1000;

// Reconnection
export const BASE_RECONNECT_DELAY_MS = 1000;
export const MAX_RECONNECT_DELAY_MS = 30000;

// HTTP Agents
export const AGENT_TIMEOUT_MS = 60000;
export const AGENT_MAX_SOCKETS = 100;
export const AGENT_MAX_FREE_SOCKETS = 10;
export const AGENT_KEEPALIVE_MS = 1000;

// Window Defaults
export const DEFAULT_WINDOW_X = 100;
export const DEFAULT_WINDOW_Y = 100;
export const DEFAULT_WINDOW_WIDTH = 500;
export const DEFAULT_WINDOW_HEIGHT = 600;
export const DEFAULT_OPACITY = 0.95;
export const MIN_OPACITY = 0.5;
export const MAX_OPACITY = 1.0;
