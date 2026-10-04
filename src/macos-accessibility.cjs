/* global process */

/**
 * The macOS Accessibility permission the popup hotkey needs.
 *
 * Popup hold/release detection listens to the keyboard through uiohook, and macOS only lets an app
 * do that once it is allowed under System Settings > Privacy & Security > Accessibility. uiohook
 * asks for the permission itself every time it starts, and throws when it is missing, so a denied
 * app would meet the system prompt at every launch and show a raw "Failed to enable access for
 * assistive devices." as the reason. Checking first, without prompting, keeps launches quiet and
 * lets the widget say what to do. The prompt is raised only when the user sets a hotkey.
 */

/**
 * Whether the popup hotkey may listen to the keyboard. Always true off macOS, and true when the
 * check itself is unavailable (uiohook then reports its own failure).
 *
 * `prompt` shows the system dialog that offers to open the Accessibility settings and lists the app
 * there; leave it off for anything the user did not just ask for.
 */
function isAccessibilityGranted({
  platform = process.platform,
  systemPreferences,
  prompt = false,
} = {}) {
  if (platform !== 'darwin') return true;
  if (typeof systemPreferences?.isTrustedAccessibilityClient !== 'function') return true;
  try {
    return systemPreferences.isTrustedAccessibilityClient(prompt === true) === true;
  } catch {
    return true;
  }
}

module.exports = { isAccessibilityGranted };
