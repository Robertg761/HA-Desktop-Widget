/**
 * Global application state
 * Uses a singleton pattern with getters for reactive access
 */

let CONFIG = null;
let WS = null;
export const PENDING_WS = new Map();
let WS_ID = 1000;
let STATES = {};
let SERVICES = {};
let AREAS = {};
export let CAMERA_REFRESH_INTERVAL = null;
export const LIVE_CAMERAS = new Set();
export const LIVE_SNAPSHOT_INTERVALS = new Map();
export const ACTIVE_HLS = new Map();
let TAB_LAYOUTS = {};
let DRAG_PLACEHOLDER = null;
let EDIT_SNAPSHOT_LAYOUTS = {};
export const DASHBOARD_CAMERA_EXPANDED = new Set();
export const TIMER_MAP = new Map();
let TIMER_TICK = null;
export const TIMER_SENSOR_MAP = new Map();
let TIMER_SENSOR_TICK = null;
let TIMER_SENSOR_SYNC_TICK = null;
let MOTION_POPUP = null;
let MOTION_POPUP_TIMER = null;
let MOTION_POPUP_CAMERA = null;
export const MOTION_LAST_TRIGGER = new Map();
let EDIT_MODE_TAB_ID = null;
let FILTERS = {
  domains: ['light', 'switch', 'sensor', 'climate', 'media_player', 'scene', 'automation', 'camera'],
  areas: [],
  favorites: [],
  hidden: []
};
let THEME_MEDIA_QUERY = null;
let UNIT_SYSTEM = {
  temperature: '°C',
  length: 'km',
  wind_speed: 'm/s',
  pressure: 'hPa',
  precipitation: 'mm',
  volume: 'L',
  mass: 'kg'
};

// Setter functions
export function setConfig(newConfig) {
  try { CONFIG = newConfig; }
  catch (error) { console.error('Error setting config:', error); }
}
export function setWs(newWs) {
  try { WS = newWs; }
  catch (error) { console.error('Error setting WebSocket:', error); }
}
export function setStates(newStates) {
  try { STATES = newStates; }
  catch (error) { console.error('Error setting states:', error); }
}
export function setServices(newServices) {
  try { SERVICES = newServices; }
  catch (error) { console.error('Error setting services:', error); }
}
export function setAreas(newAreas) {
  try { AREAS = newAreas; }
  catch (error) { console.error('Error setting areas:', error); }
}
export function setTimerTick(newTick) {
  try { TIMER_TICK = newTick; }
  catch (error) { console.error('Error setting timer tick:', error); }
}
export function setTimerSensorTick(newTick) {
  try { TIMER_SENSOR_TICK = newTick; }
  catch (error) { console.error('Error setting timer sensor tick:', error); }
}
export function setTimerSensorSyncTick(newTick) {
  try { TIMER_SENSOR_SYNC_TICK = newTick; }
  catch (error) { console.error('Error setting timer sensor sync tick:', error); }
}
export function setMotionPopup(newPopup) {
  try { MOTION_POPUP = newPopup; }
  catch (error) { console.error('Error setting motion popup:', error); }
}
export function setMotionPopupTimer(newTimer) {
  try { MOTION_POPUP_TIMER = newTimer; }
  catch (error) { console.error('Error setting motion popup timer:', error); }
}
export function setMotionPopupCamera(newCamera) {
  try { MOTION_POPUP_CAMERA = newCamera; }
  catch (error) { console.error('Error setting motion popup camera:', error); }
}
export function setEditModeTabId(newTabId) {
  try { EDIT_MODE_TAB_ID = newTabId; }
  catch (error) { console.error('Error setting edit mode tab ID:', error); }
}
export function setFilters(newFilters) {
  try { FILTERS = newFilters; }
  catch (error) { console.error('Error setting filters:', error); }
}
export function setThemeMediaQuery(newQuery) {
  try { THEME_MEDIA_QUERY = newQuery; }
  catch (error) { console.error('Error setting theme media query:', error); }
}
export function setDragPlaceholder(newPlaceholder) {
  try { DRAG_PLACEHOLDER = newPlaceholder; }
  catch (error) { console.error('Error setting drag placeholder:', error); }
}
export function setEditSnapshotLayouts(newLayouts) {
  try { EDIT_SNAPSHOT_LAYOUTS = newLayouts; }
  catch (error) { console.error('Error setting edit snapshot layouts:', error); }
}
export function setUnitSystem(newUnitSystem) {
  try { UNIT_SYSTEM = newUnitSystem; }
  catch (error) { console.error('Error setting unit system:', error); }
}

// State object with getters for reactive access
// This pattern allows other modules to always get the current value
const state = {
  get CONFIG() { return CONFIG; },
  get WS() { return WS; },
  PENDING_WS,
  get WS_ID() { return WS_ID; },
  get STATES() { return STATES; },
  get SERVICES() { return SERVICES; },
  get AREAS() { return AREAS; },
  CAMERA_REFRESH_INTERVAL,
  LIVE_CAMERAS,
  LIVE_SNAPSHOT_INTERVALS,
  ACTIVE_HLS,
  get TAB_LAYOUTS() { return TAB_LAYOUTS; },
  get DRAG_PLACEHOLDER() { return DRAG_PLACEHOLDER; },
  get EDIT_SNAPSHOT_LAYOUTS() { return EDIT_SNAPSHOT_LAYOUTS; },
  DASHBOARD_CAMERA_EXPANDED,
  TIMER_MAP,
  get TIMER_TICK() { return TIMER_TICK; },
  TIMER_SENSOR_MAP,
  get TIMER_SENSOR_TICK() { return TIMER_SENSOR_TICK; },
  get TIMER_SENSOR_SYNC_TICK() { return TIMER_SENSOR_SYNC_TICK; },
  get MOTION_POPUP() { return MOTION_POPUP; },
  get MOTION_POPUP_TIMER() { return MOTION_POPUP_TIMER; },
  get MOTION_POPUP_CAMERA() { return MOTION_POPUP_CAMERA; },
  MOTION_LAST_TRIGGER,
  get EDIT_MODE_TAB_ID() { return EDIT_MODE_TAB_ID; },
  get FILTERS() { return FILTERS; },
  get THEME_MEDIA_QUERY() { return THEME_MEDIA_QUERY; },
  get UNIT_SYSTEM() { return UNIT_SYSTEM; },
  setConfig,
  setWs,
  setStates,
  setServices,
  setAreas,
  setTimerTick,
  setTimerSensorTick,
  setTimerSensorSyncTick,
  setMotionPopup,
  setMotionPopupTimer,
  setMotionPopupCamera,
  setEditModeTabId,
  setFilters,
  setThemeMediaQuery,
  setDragPlaceholder,
  setEditSnapshotLayouts,
  setUnitSystem,
};

export default state;