# BUGS.md - Home Assistant Desktop Widget

## Overview
This document catalogs all identified bugs, issues, and potential problems in the Home Assistant Desktop Widget project. Issues are categorized by severity and include detailed information for reproduction and resolution.

**Last Updated:** 2025-10-24  
**Version:** 2.3.6  
**Reviewed Files:** All source files in `src/`, `main.js`, `renderer.js`, `styles.css`, `index.html`

---

## Critical Bugs

### 1. Undefined Variable Reference in Camera Error Handler
- **File:** `src/camera.js`
- **Line:** 42
- **Severity:** Critical
- **Description:** The HLS error handler references an undefined `img` variable that doesn't exist in the current scope.
- **Current Behavior:** When an HLS stream encounters a fatal error, the app crashes with `ReferenceError: img is not defined`.
- **Expected Behavior:** Should gracefully fall back to MJPEG stream or snapshot display.
- **Code Snippet:**
```javascript
hls.on(Hls.Events.ERROR, (_evt, data) => {
  console.warn('HLS error', data?.details || data);
  if (data?.fatal) {
    try { hls.destroy(); } catch (_error) {}
    state.ACTIVE_HLS.delete(entityId);
    video.style.display = 'none';
    img.style.display = 'block';  // ❌ img is undefined here
    img.src = `ha://camera_stream/${entityId}?t=${Date.now()}`;
  }
});
```
- **Potential Fix:** The `img` variable should be passed as a parameter or retrieved from the DOM within the error handler scope.
- **Steps to Reproduce:**
  1. Open camera viewer for a camera entity
  2. Start HLS live stream
  3. Force an HLS error (e.g., disconnect camera, invalid stream URL)
  4. Observe console error and potential crash

### 2. Missing Drag Listeners Cleanup Function
- **File:** `src/ui.js`
- **Lines:** 31, 231
- **Severity:** Critical
- **Description:** The function `removeDragAndDropListeners()` is called but never defined, causing an uncaught reference error.
- **Current Behavior:** When exiting reorganize mode, the app throws `ReferenceError: removeDragAndDropListeners is not defined`.
- **Expected Behavior:** Should cleanly remove all drag-and-drop event listeners when exiting reorganize mode.
- **Code Snippet:**
```javascript
// Line 31 in toggleReorganizeMode()
removeDragAndDropListeners();  // ❌ Function not defined

// Line 231 - another call site
removeDragAndDropListeners();
```
- **Potential Fix:** Implement the missing function to remove drag event listeners from control items:
```javascript
function removeDragAndDropListeners() {
  const items = document.querySelectorAll('#quick-controls .control-item');
  items.forEach(item => {
    item.draggable = false;
    item.removeEventListener('dragstart', handleDragStart);
    item.removeEventListener('dragend', handleDragEnd);
    item.removeEventListener('dragover', handleDragOver);
    item.removeEventListener('drop', handleDrop);
    item.removeEventListener('dragenter', handleDragEnter);
    item.removeEventListener('dragleave', handleDragLeave);
  });
}
```
- **Steps to Reproduce:**
  1. Click the reorganize button (⋮⋮) in Quick Access
  2. Make any changes or don't
  3. Click the save button (✓) to exit reorganize mode
  4. Check console for ReferenceError

---

## High Priority Bugs

### 3. Memory Leak - Camera Streams Not Cleaned Up
- **File:** `src/camera.js`, `src/state.js`
- **Lines:** Various (Maps: `LIVE_SNAPSHOT_INTERVALS`, `ACTIVE_HLS`)
- **Severity:** High
- **Description:** Camera stream cleanup is incomplete. The Maps `LIVE_SNAPSHOT_INTERVALS` and `ACTIVE_HLS` accumulate entries that are never removed when modals are closed via clicking outside or pressing ESC.
- **Current Behavior:** Memory usage grows with each camera view, intervals continue running, and HLS instances persist in memory.
- **Expected Behavior:** All intervals, timeouts, and HLS instances should be destroyed when camera modal is closed by any method.
- **Code Analysis:**
  - In `openCamera()` (line 274-279), clicking outside closes the modal and calls `stopLive()`, which does clean up
  - However, the modal close button handler (line 268-272) calls `stopLive()` correctly
  - But when user presses ESC or uses other close methods, cleanup may not occur
- **Potential Fix:** 
  - Add a cleanup function that's called on modal destruction
  - Use MutationObserver or ensure all modal close paths call cleanup
  - Implement a modal lifecycle manager
- **Steps to Reproduce:**
  1. Open DevTools Memory panel
  2. Take heap snapshot
  3. Open and close camera viewer 10 times (use different methods: close button, click outside, ESC key)
  4. Take another heap snapshot
  5. Compare - you'll see detached DOM nodes and unreleased intervals

### 4. Race Condition with Loading Overlay
- **File:** `renderer.js`
- **Lines:** 131, 141, 162, 170, 175
- **Severity:** High
- **Description:** Multiple `showLoading(false)` calls in the init function can cause flickering or leave the loading overlay in an incorrect state.
- **Current Behavior:** Loading overlay may flicker or remain visible/hidden incorrectly when multiple async operations complete in different orders.
- **Expected Behavior:** Loading state should be centrally managed with reference counting or a state machine.
- **Code Snippet:**
```javascript
async function init() {
  try {
    uiUtils.showLoading(true);
    
    // ... config loading ...
    uiUtils.showLoading(false);  // Line 131
    
    // ... more logic ...
    uiUtils.showLoading(false);  // Line 141
    
    // ... even more ...
    uiUtils.showLoading(false);  // Line 162
    
    // Connection in background
    websocket.connect();
    
    // Backup timeout
    setTimeout(() => {
      uiUtils.showLoading(false);  // Line 170
    }, 5000);
    
  } catch (error) {
    uiUtils.showLoading(false);  // Line 175
  }
}
```
- **Potential Fix:** Implement loading state with reference counting or use a proper loading state manager.
- **Steps to Reproduce:**
  1. Slow down network connection
  2. Reload the app
  3. Observe loading overlay behavior during initialization

### 5. Timer Detection Logic Flaw
- **Files:** `src/utils.js` (lines 150-173, 216-291), `src/ui.js` (lines 353-378)
- **Severity:** High
- **Description:** Numeric sensor values can be misidentified as timestamps despite timestamp detection logic. The regex check `/[T\\-:]/` can match Unix epoch timestamps or other numeric formats.
- **Current Behavior:** Power sensors showing "150" watts could potentially be parsed as timestamps if the state format changes.
- **Expected Behavior:** Only valid ISO 8601 timestamps should be treated as timer end times.
- **Code Example:**
```javascript
// Line 164-169 in utils.js
const looksLikeTimestamp = /[T\\-:]/.test(entity.state);
if (looksLikeTimestamp) {
  const stateTime = new Date(entity.state).getTime();
  if (!isNaN(stateTime) && stateTime > Date.now()) {
    stateIsTimestamp = true;
  }
}
// ⚠️ Problem: new Date("150") or new Date("2025") can parse successfully
```
- **Potential Fix:** Use more strict ISO 8601 validation or explicit format checking.
- **Steps to Reproduce:**
  1. Create a sensor with numeric state values
  2. Add to Quick Access
  3. Monitor if it gets misclassified as a timer

### 6. Modal Event Listener Memory Leaks
- **File:** `src/ui.js`
- **Lines:** Throughout modal creation functions (showRenameModal, showBrightnessSlider, etc.)
- **Severity:** High
- **Description:** Modal creation attaches event listeners that are never explicitly removed when modals are destroyed.
- **Current Behavior:** Each modal open/close cycle leaks event listeners, causing memory growth and potential performance degradation.
- **Expected Behavior:** All event listeners should be removed when modal is destroyed.
- **Code Example:**
```javascript
// Line 125-218 in showRenameModal()
const modal = document.createElement('div');
// ... modal setup ...
document.body.appendChild(modal);

const input = modal.querySelector('#rename-input');
const saveBtn = modal.querySelector('#save-rename-btn');

// Event listeners added but never explicitly removed
saveBtn.onclick = async () => { /* ... */ };
cancelBtn.onclick = () => modal.remove();
modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
```
- **Potential Fix:** 
  - Use AbortController for event listeners
  - Or explicitly remove listeners in a cleanup function before `modal.remove()`
  - Use event delegation where possible
- **Steps to Reproduce:**
  1. Open rename modal 20 times in reorganize mode
  2. Check memory profiler for listener count growth
  3. Use Chrome DevTools: `getEventListeners(document.body)`

### 7. Missing CSS Variable Definition
- **File:** `styles.css`
- **Lines:** Multiple references (222, 363, 379, 1099, 1485, 1549, etc.)
- **Severity:** High
- **Description:** The CSS variable `--surface-hover` is referenced throughout the stylesheet but never defined in `:root` or theme classes.
- **Current Behavior:** Hover states that use `--surface-hover` fall back to invalid value, causing visual glitches or no hover effect.
- **Expected Behavior:** Variable should be properly defined with theme-appropriate values.
- **Code References:**
```css
/* Used but never defined: */
.section-btn:hover {
  background: var(--surface-hover);  /* Line 222 */
}

.entity-selector-item:hover {
  background: var(--surface-hover);  /* Line 363 */
}

/* ... 20+ more references ... */
```
- **Potential Fix:** Add to `:root` and theme classes:
```css
:root {
  /* ... existing vars ... */
  --surface-hover: rgba(45, 45, 50, 1);
}

.theme-light {
  /* ... existing vars ... */
  --surface-hover: rgba(240, 240, 245, 1);
}
```
- **Steps to Reproduce:**
  1. Hover over any element using `--surface-hover`
  2. Inspect computed styles in DevTools
  3. Observe invalid value or missing background color

---

## Medium Priority Issues

### 8. Opacity Slider Lacks Bounds Validation
- **File:** `renderer.js`
- **Lines:** 206-209
- **Severity:** Medium
- **Description:** The opacity slider event listener doesn't validate bounds, though the IPC handler does have safety checks.
- **Current Behavior:** While main.js clamps the value, the renderer doesn't prevent invalid inputs from being sent.
- **Expected Behavior:** Renderer should validate before sending to main process.
- **Code Snippet:**
```javascript
// Lines 206-209
opacitySlider.addEventListener('input', (e) => {
  opacityValue.textContent = `${Math.round(e.target.value * 100)}%`;
  // ⚠️ No validation before display update
});
```
- **Potential Fix:** Add input validation:
```javascript
opacitySlider.addEventListener('input', (e) => {
  const value = Math.max(0.2, Math.min(1, parseFloat(e.target.value) || 0.95));
  opacityValue.textContent = `${Math.round(value * 100)}%`;
});
```
- **Steps to Reproduce:**
  1. Open DevTools
  2. Find opacity slider element
  3. Manually set value to -1 or 100 via JS: `document.querySelector('#opacity-slider').value = -1`
  4. Trigger input event

### 9. WebSocket Reconnection Without Backoff
- **File:** `renderer.js`
- **Line:** 80
- **Severity:** Medium
- **Description:** WebSocket reconnection uses a fixed 5-second delay without exponential backoff, potentially causing network spam during extended outages.
- **Current Behavior:** Reconnects every 5 seconds indefinitely.
- **Expected Behavior:** Should implement exponential backoff with jitter and max retry limit.
- **Code Snippet:**
```javascript
// Line 80
websocket.on('close', () => {
  try {
    uiUtils.setStatus(false);
    uiUtils.showLoading(false);
    setTimeout(() => websocket.connect(), 5000);  // ⚠️ Fixed delay
  } catch (error) {
    console.error('Error handling WebSocket close:', error);
  }
});
```
- **Potential Fix:** Implement exponential backoff:
```javascript
let reconnectAttempts = 0;
const MAX_DELAY = 60000; // 60 seconds
const BASE_DELAY = 1000; // 1 second

websocket.on('close', () => {
  const delay = Math.min(BASE_DELAY * Math.pow(2, reconnectAttempts), MAX_DELAY);
  const jitter = Math.random() * 1000;
  reconnectAttempts++;
  
  setTimeout(() => websocket.connect(), delay + jitter);
});

websocket.on('open', () => {
  reconnectAttempts = 0; // Reset on successful connection
});
```
- **Steps to Reproduce:**
  1. Monitor network traffic
  2. Disconnect from Home Assistant or shut down the server
  3. Observe reconnection attempts every 5 seconds

### 10. Hotkey Listener Potential Duplication
- **File:** `src/hotkeys.js`
- **Lines:** 243-287
- **Severity:** Medium
- **Description:** The `setupHotkeyEventListenersInternal()` function has a flag to prevent duplicates, but the event delegation pattern on the container may still allow multiple registrations if the flag is somehow reset.
- **Current Behavior:** Flag prevents obvious duplicates, but edge cases exist.
- **Expected Behavior:** Guaranteed single registration with proper cleanup.
- **Code Analysis:**
```javascript
// Lines 243-248
let listenersSetUp = false;

function setupHotkeyEventListenersInternal() {
  try {
    if (listenersSetUp) return;  // ✓ Guard present
    
    const container = document.getElementById('hotkeys-list');
    if (!container) return;

    // Event delegation (good!)
    container.addEventListener('change', async (e) => { /* ... */ });
    
    listenersSetUp = true;
  } catch (error) {
    console.error('Error setting up hotkey event listeners:', error);
  }
}
```
- **Potential Fix:** Store the listener function reference and remove before re-adding, or use AbortController.
- **Steps to Reproduce:**
  1. Open settings, go to Hotkeys tab
  2. Close settings
  3. Open settings again, go to Hotkeys tab
  4. Check if change events fire multiple times (use console.log)

### 11. Inconsistent State - Reorganize Mode vs Settings
- **Files:** `src/ui.js`, `src/settings.js`
- **Severity:** Medium
- **Description:** Settings modal can be opened while reorganize mode is active, causing UI state conflicts.
- **Current Behavior:** Both modes can be active simultaneously, leading to confusing UI behavior.
- **Expected Behavior:** Opening settings should exit reorganize mode, or settings should be disabled during reorganize.
- **Potential Fix:** Add state check in `openSettings()`:
```javascript
function openSettings(uiHooks) {
  if (isReorganizeMode) {
    toggleReorganizeMode(); // Exit reorganize mode first
  }
  // ... rest of function
}
```
- **Steps to Reproduce:**
  1. Enable reorganize mode (click ⋮⋮)
  2. Click settings button (⚙️)
  3. Observe both modes active simultaneously

### 12. Timer Update Performance Issue
- **File:** `src/ui.js`
- **Lines:** 754-854 (updateTimerDisplays function)
- **Severity:** Medium
- **Description:** Timer update function runs every second and queries/updates ALL timer entities regardless of visibility, causing unnecessary CPU usage.
- **Current Behavior:** Updates all timers every second, even those off-screen or in hidden tabs.
- **Expected Behavior:** Should only update visible timers, use IntersectionObserver, or implement throttling.
- **Code Analysis:**
```javascript
// Line 754
function updateTimerDisplays() {
  try {
    // Queries ALL timer entities
    const timerElements = document.querySelectorAll('.control-item.timer-entity');
    
    timerElements.forEach(timerEl => {
      // Updates even if not visible
      // ...
    });
  } catch (error) {
    // Silent fail
  }
}

// Line 155 - called every second
setInterval(() => ui.updateTimerDisplays(), 1000);
```
- **Potential Fix:** Use IntersectionObserver to track visibility:
```javascript
const timerObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.dataset.visible = 'true';
    } else {
      entry.target.dataset.visible = 'false';
    }
  });
});

function updateTimerDisplays() {
  const timerElements = document.querySelectorAll('.control-item.timer-entity[data-visible="true"]');
  // Only update visible timers
  timerElements.forEach(updateTimer);
}
```
- **Steps to Reproduce:**
  1. Add 5+ timer entities to Quick Access
  2. Open DevTools Performance panel
  3. Record for 10 seconds
  4. Observe CPU usage from timer updates

---

## Low Priority Issues

### 13. Missing Null Checks for DOM Elements
- **Files:** Multiple (renderer.js, src/ui.js, src/settings.js, etc.)
- **Severity:** Low
- **Description:** Many DOM queries don't check for null before accessing properties, which could cause crashes if elements are missing.
- **Examples:**
  - `renderer.js` line 182: `settingsBtn.onclick = () => {` - no null check
  - `renderer.js` line 194: `closeSettingsBtn.onclick = ...` - assumes element exists
  - `src/ui.js` line 312: `container.innerHTML = ''` - no null check for container
- **Current Behavior:** If DOM elements are unexpectedly missing, crashes occur.
- **Expected Behavior:** Graceful handling with null checks and appropriate fallbacks.
- **Potential Fix:** Add defensive checks:
```javascript
const settingsBtn = document.getElementById('settings-btn');
if (settingsBtn) {
  settingsBtn.onclick = () => { /* ... */ };
}
```
- **Steps to Reproduce:**
  1. Manually remove a DOM element that's expected to exist
  2. Trigger code path that references it
  3. Observe TypeError

### 14. Auto-Update Error Handling
- **File:** `main.js`
- **Lines:** 566-598 (setupAutoUpdates function)
- **Severity:** Low
- **Description:** Minimal error handling for auto-update failures. Errors are sent to renderer but may not have user-friendly messages.
- **Current Behavior:** Update errors are logged but user feedback is minimal.
- **Expected Behavior:** Clear user-facing error messages with actionable steps.
- **Code Analysis:**
```javascript
// Line 589-591
autoUpdater.on('error', (err) => {
  mainWindow?.webContents.send('auto-update', { status: 'error', error: err?.message });
  // ⚠️ No additional logging or user notification beyond the event
});
```
- **Potential Fix:** Enhance error handling with categorization and user guidance.
- **Steps to Reproduce:**
  1. Simulate update server unavailable
  2. Observe error handling behavior

### 15. Weather Entity Attribute Validation
- **File:** `src/ui.js`
- **Lines:** 647-702 (updateWeatherFromHA function)
- **Severity:** Low
- **Description:** Weather entity update doesn't validate that required attributes exist before accessing them.
- **Current Behavior:** If weather entity lacks expected attributes, undefined values are displayed or errors occur.
- **Expected Behavior:** Validate attributes exist and provide sensible defaults.
- **Code Snippet:**
```javascript
// Line 658-661
if (tempEl) tempEl.textContent = `${Math.round(weatherEntity.attributes.temperature || 0)}°`;
if (conditionEl) conditionEl.textContent = weatherEntity.state || '--';
if (humidityEl) humidityEl.textContent = `${weatherEntity.attributes.humidity || 0}%`;
// ✓ Has fallbacks, but doesn't validate entity structure
```
- **Potential Fix:** Add validation:
```javascript
function updateWeatherFromHA() {
  const weatherEntity = state.STATES[state.CONFIG.selectedWeatherEntity] || 
                       Object.values(state.STATES).find(e => e.entity_id.startsWith('weather.'));
  
  if (!weatherEntity || !weatherEntity.attributes) {
    console.warn('Weather entity not found or invalid');
    return;
  }
  
  const attrs = weatherEntity.attributes;
  if (!attrs.temperature || !attrs.humidity || !attrs.wind_speed) {
    console.warn('Weather entity missing required attributes');
  }
  
  // ... rest of function
}
```
- **Steps to Reproduce:**
  1. Create a weather entity with missing attributes
  2. Select it as the weather source
  3. Observe display behavior

---

## Security Considerations

### 16. Electron Security Best Practices
- **File:** `main.js`
- **Lines:** 173-177
- **Severity:** Medium (Security)
- **Description:** The app uses `nodeIntegration: true` and `contextIsolation: false`, which are security anti-patterns in Electron.
- **Current Settings:**
```javascript
webPreferences: {
  nodeIntegration: true,        // ⚠️ Security risk
  contextIsolation: false,      // ⚠️ Security risk
  webSecurity: false            // ⚠️ Security risk
}
```
- **Recommendation:** 
  - Set `contextIsolation: true`
  - Set `nodeIntegration: false`
  - Use preload scripts with `contextBridge` for secure IPC
  - Enable `webSecurity: true` and handle CORS properly
- **Impact:** Current setup exposes Node.js APIs to renderer, increasing XSS attack surface.
- **Note:** This would require significant refactoring but should be considered for future security hardening.

---

## Testing Recommendations

1. **Unit Tests Needed:**
   - Timer detection logic in `utils.js`
   - Entity state parsing
   - Search score calculation
   - Hotkey accelerator string generation

2. **Integration Tests Needed:**
   - WebSocket connection and reconnection
   - Camera stream lifecycle
   - Modal lifecycle and cleanup
   - Drag and drop functionality
   - Settings persistence

3. **Performance Tests:**
   - Memory usage over extended runtime
   - Timer update performance with many entities
   - Camera stream switching
   - Large entity lists (100+ entities)

4. **Accessibility Tests:**
   - Keyboard navigation
   - Screen reader support
   - Focus management in modals
   - Color contrast ratios

---

## Contributing

When fixing bugs from this document:

1. **Reference the bug number** in your commit message (e.g., "Fix #3: Add camera stream cleanup")
2. **Add tests** that verify the fix and prevent regression
3. **Update this document** to mark the bug as fixed with the commit hash
4. **Consider related bugs** that might be affected by your fix

## Bug Fix Tracking

| Bug # | Status | Fixed In | PR/Commit | Notes |
|-------|--------|----------|-----------|-------|
| 1 | Fixed | camera.js | 2025-10-24 | Added imgElement parameter to HLS error handler |
| 2 | Not a Bug | ui.js | 2025-10-24 | Function exists at line 1283 |
| 3 | Open | - | - | High: Memory leak |
| 4 | Open | - | - | High: Race condition |
| 5 | Fixed | utils.js, ui.js | 2025-10-24 | Improved ISO 8601 validation pattern |
| 6 | Open | - | - | High: Modal leaks |
| 7 | Fixed | styles.css | 2025-10-24 | Added --surface-hover to :root and .theme-light |
| 8 | Fixed | renderer.js | 2025-10-24 | Added bounds validation to opacity slider |
| 9 | Fixed | renderer.js | 2025-10-24 | Implemented exponential backoff with jitter |
| 10 | Open | - | - | Medium: Hotkey duplication |
| 11 | Fixed | settings.js, renderer.js | 2025-10-24 | Exit reorganize mode when opening settings |
| 12 | Open | - | - | Medium: Timer performance |
| 13 | Open | - | - | Low: Null checks |
| 14 | Open | - | - | Low: Update errors |
| 15 | Open | - | - | Low: Weather validation |
| 16 | Open | - | - | Security: Electron config |

---

**Note:** This document should be treated as a living document and updated as bugs are fixed or new issues are discovered.
