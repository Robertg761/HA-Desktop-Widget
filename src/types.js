/**
 * JSDoc Type Definitions for HA Desktop Widget
 *
 * This file provides type definitions for the main data structures
 * used throughout the application. Import and use with JSDoc annotations.
 *
 * @example
 * // In another file:
 * // @ts-check
 * const types = require('./types.js');
 *
 * // Use @type annotations:
 * /** @type {types.AppConfig} *\/
 * const config = { ... };
 */

/**
 * Home Assistant connection configuration
 * @typedef {Object} HomeAssistantConfig
 * @property {string} url - Home Assistant server URL (e.g., "http://homeassistant.local:8123")
 * @property {string} token - Long-lived access token for authentication
 * @property {boolean} [tokenEncrypted] - Whether the token is encrypted at rest
 */

/**
 * Window position coordinates
 * @typedef {Object} WindowPosition
 * @property {number} x - X coordinate on screen
 * @property {number} y - Y coordinate on screen
 */

/**
 * Window size dimensions
 * @typedef {Object} WindowSize
 * @property {number} width - Window width in pixels
 * @property {number} height - Window height in pixels
 */

/**
 * Global hotkeys configuration
 * @typedef {Object} GlobalHotkeysConfig
 * @property {boolean} enabled - Whether global hotkeys are enabled
 * @property {Object.<string, HotkeyBinding>} hotkeys - Map of entity ID to hotkey binding
 */

/**
 * Individual hotkey binding
 * @typedef {Object} HotkeyBinding
 * @property {string} hotkey - Key combination (e.g., "Ctrl+Shift+L")
 * @property {string} action - Action to perform ("toggle", "turn_on", "turn_off")
 */

/**
 * Entity alerts configuration
 * @typedef {Object} EntityAlertsConfig
 * @property {boolean} enabled - Whether entity alerts are enabled
 * @property {Object.<string, AlertConfig>} alerts - Map of entity ID to alert config
 */

/**
 * Individual alert configuration
 * @typedef {Object} AlertConfig
 * @property {string} type - Alert type ("state-change" or "specific-state")
 * @property {string} [targetState] - Target state for specific-state alerts
 */

/**
 * Main application configuration
 * @typedef {Object} AppConfig
 * @property {WindowPosition} windowPosition - Saved window position
 * @property {WindowSize} windowSize - Saved window size
 * @property {boolean} alwaysOnTop - Whether window stays on top
 * @property {number} opacity - Window opacity (0.5 to 1.0)
 * @property {boolean} [frostedGlass] - Enable frosted glass window background
 * @property {HomeAssistantConfig} homeAssistant - HA connection settings
 * @property {GlobalHotkeysConfig} globalHotkeys - Global hotkeys configuration
 * @property {EntityAlertsConfig} entityAlerts - Entity alerts configuration
 * @property {string} [popupHotkey] - Hotkey to bring window to front
 * @property {boolean} [popupHotkeyHideOnRelease] - Hide window when hotkey released
 * @property {boolean} [popupHotkeyToggleMode] - Toggle mode for popup hotkey
 * @property {string} [primaryMediaPlayer] - Primary media player entity ID
 * @property {string[]} [primaryCards] - Primary status cards (e.g., ["weather", "time"] or entity IDs)
 * @property {string} [selectedWeatherEntity] - Selected weather entity ID
 * @property {string[]} [favoriteEntities] - List of favorited entity IDs
 * @property {Object.<string, string>} [customEntityNames] - Custom display names
 * @property {Object} [customTabs] - Custom tab configurations
 * @property {Object} [ui] - UI preferences (theme, accent, background, etc.)
 */

/**
 * Home Assistant entity object
 * @typedef {Object} HAEntity
 * @property {string} entity_id - Unique entity identifier (e.g., "light.living_room")
 * @property {string} state - Current state value
 * @property {HAEntityAttributes} attributes - Entity attributes
 * @property {string} [last_changed] - ISO timestamp of last state change
 * @property {string} [last_updated] - ISO timestamp of last update
 * @property {Object} [context] - Context information
 */

/**
 * Home Assistant entity attributes
 * @typedef {Object} HAEntityAttributes
 * @property {string} [friendly_name] - Human-readable name
 * @property {string} [device_class] - Device classification
 * @property {string} [unit_of_measurement] - Unit for sensor values
 * @property {number} [brightness] - Light brightness (0-255)
 * @property {number} [temperature] - Climate temperature
 * @property {number} [current_temperature] - Current temperature reading
 * @property {string} [media_title] - Media player track title
 * @property {string} [media_artist] - Media player artist
 * @property {string} [entity_picture] - Entity picture URL
 * @property {string} [icon] - Entity icon
 */

/**
 * WebSocket message from Home Assistant
 * @typedef {Object} HAWebSocketMessage
 * @property {string} type - Message type ("auth_ok", "auth_invalid", "result", "event")
 * @property {number} [id] - Request ID for result messages
 * @property {boolean} [success] - Whether request succeeded
 * @property {*} [result] - Result data
 * @property {HAEvent} [event] - Event data for event messages
 */

/**
 * Home Assistant event object
 * @typedef {Object} HAEvent
 * @property {string} event_type - Event type (e.g., "state_changed")
 * @property {HAStateChangedData} [data] - Event data
 */

/**
 * State changed event data
 * @typedef {Object} HAStateChangedData
 * @property {string} entity_id - Changed entity ID
 * @property {HAEntity} [old_state] - Previous state
 * @property {HAEntity} [new_state] - New state
 */

// Export empty object - this file is for JSDoc type definitions only
export default {};
