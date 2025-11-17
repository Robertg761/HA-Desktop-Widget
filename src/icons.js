/**
 * SVG Icon System for HA Desktop Widget
 * Provides scalable, accessible icons to replace emoji
 */

/**
 * Create an SVG icon element
 * @param {string} pathData - SVG path data
 * @param {Object} options - Icon options
 * @param {number} options.size - Icon size in pixels (default: 24)
 * @param {string} options.className - Additional CSS classes
 * @param {string} options.color - Icon color (default: currentColor)
 * @param {string} options.ariaLabel - Accessibility label
 * @param {string} options.title - Tooltip title
 * @returns {SVGElement}
 */
function createIcon(pathData, options = {}) {
  const {
    size = 24,
    className = '',
    color = 'currentColor',
    ariaLabel = '',
    title = '',
    viewBox = '0 0 24 24'
  } = options;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('fill', color);
  svg.setAttribute('class', `icon ${className}`.trim());

  if (ariaLabel) {
    svg.setAttribute('aria-label', ariaLabel);
    svg.setAttribute('role', 'img');
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }

  if (title) {
    const titleElement = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    titleElement.textContent = title;
    svg.appendChild(titleElement);
  }

  // Support multiple paths
  const paths = Array.isArray(pathData) ? pathData : [pathData];
  paths.forEach(d => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  });

  return svg;
}

/**
 * Icon library - Material Design inspired
 */
const Icons = {
  // Window Controls
  close: (options) => createIcon(
    'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    { ...options, ariaLabel: options?.ariaLabel || 'Close' }
  ),

  minimize: (options) => createIcon(
    'M19 13H5v-2h14v2z',
    { ...options, ariaLabel: options?.ariaLabel || 'Minimize' }
  ),

  // Navigation & Actions
  settings: (options) => createIcon(
    'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
    { ...options, ariaLabel: options?.ariaLabel || 'Settings' }
  ),

  add: (options) => createIcon(
    'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
    { ...options, ariaLabel: options?.ariaLabel || 'Add' }
  ),

  remove: (options) => createIcon(
    'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    { ...options, ariaLabel: options?.ariaLabel || 'Remove' }
  ),

  edit: (options) => createIcon(
    'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
    { ...options, ariaLabel: options?.ariaLabel || 'Edit' }
  ),

  menu: (options) => createIcon(
    'M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z',
    { ...options, ariaLabel: options?.ariaLabel || 'Menu' }
  ),

  dragHandle: (options) => createIcon(
    'M9 3h2v2H9V3zm0 4h2v2H9V7zm0 4h2v2H9v-2zm0 4h2v2H9v-2zm0 4h2v2H9v-2zm4-16h2v2h-2V3zm0 4h2v2h-2V7zm0 4h2v2h-2v-2zm0 4h2v2h-2v-2zm0 4h2v2h-2v-2z',
    { ...options, ariaLabel: options?.ariaLabel || 'Drag to reorder' }
  ),

  // Media Controls
  play: (options) => createIcon(
    'M8 5v14l11-7z',
    { ...options, ariaLabel: options?.ariaLabel || 'Play' }
  ),

  pause: (options) => createIcon(
    'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
    { ...options, ariaLabel: options?.ariaLabel || 'Pause' }
  ),

  skipNext: (options) => createIcon(
    'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z',
    { ...options, ariaLabel: options?.ariaLabel || 'Next' }
  ),

  skipPrevious: (options) => createIcon(
    'M6 6h2v12H6zm3.5 6l8.5 6V6z',
    { ...options, ariaLabel: options?.ariaLabel || 'Previous' }
  ),

  volumeUp: (options) => createIcon(
    'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
    { ...options, ariaLabel: options?.ariaLabel || 'Volume' }
  ),

  // State Icons
  lightbulb: (options) => createIcon(
    'M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z',
    { ...options, ariaLabel: options?.ariaLabel || 'Light' }
  ),

  power: (options) => createIcon(
    'M13 3h-2v10h2V3zm4.83 2.17l-1.42 1.42C17.99 7.86 19 9.81 19 12c0 3.87-3.13 7-7 7s-7-3.13-7-7c0-2.19 1.01-4.14 2.58-5.42L6.17 5.17C4.23 6.82 3 9.26 3 12c0 4.97 4.03 9 9 9s9-4.03 9-9c0-2.74-1.23-5.18-3.17-6.83z',
    { ...options, ariaLabel: options?.ariaLabel || 'Power' }
  ),

  brightness: (options) => createIcon(
    'M20 8.69V4h-4.69L12 .69 8.69 4H4v4.69L.69 12 4 15.31V20h4.69L12 23.31 15.31 20H20v-4.69L23.31 12 20 8.69zM12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6zm0-10c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4z',
    { ...options, ariaLabel: options?.ariaLabel || 'Brightness' }
  ),

  // Weather Icons
  weatherSunny: (options) => createIcon(
    'M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.79 1.42-1.41zM4 10.5H1v2h3v-2zm9-9.95h-2V3.5h2V.55zm7.45 3.91l-1.41-1.41-1.79 1.79 1.41 1.41 1.79-1.79zm-3.21 13.7l1.79 1.8 1.41-1.41-1.8-1.79-1.4 1.4zM20 10.5v2h3v-2h-3zm-8-5c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm-1 16.95h2V19.5h-2v2.95zm-7.45-3.91l1.41 1.41 1.79-1.8-1.41-1.41-1.79 1.8z',
    { ...options, ariaLabel: options?.ariaLabel || 'Sunny' }
  ),

  weatherCloudy: (options) => createIcon(
    'M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z',
    { ...options, ariaLabel: options?.ariaLabel || 'Cloudy' }
  ),

  weatherRainy: (options) => createIcon(
    [
      'M12 2c-5.33 4.55-8 8.48-8 11.8 0 4.98 3.8 8.2 8 8.2s8-3.22 8-8.2c0-3.32-2.67-7.25-8-11.8z',
    ],
    { ...options, viewBox: '0 0 24 24', ariaLabel: options?.ariaLabel || 'Rainy' }
  ),

  weatherSnowy: (options) => createIcon(
    'M22 11h-4.17l3.24-3.24-1.41-1.42L15 11h-2V9l4.66-4.66-1.42-1.41L13 6.17V2h-2v4.17L7.76 2.93 6.34 4.34 11 9v2H9L4.34 6.34 2.93 7.76 6.17 11H2v2h4.17l-3.24 3.24 1.41 1.42L9 13h2v2l-4.66 4.66 1.42 1.41L11 17.83V22h2v-4.17l3.24 3.24 1.42-1.41L13 15v-2h2l4.66 4.66 1.41-1.42L17.83 13H22z',
    { ...options, ariaLabel: options?.ariaLabel || 'Snowy' }
  ),

  // Camera & Video
  camera: (options) => createIcon(
    'M9.4 10.5l4.77-8.26C13.47 2.09 12.75 2 12 2c-2.4 0-4.6.85-6.32 2.25l3.66 6.35.06-.1zM21.54 9c-.92-2.92-3.15-5.26-6-6.34L11.88 9h9.66zm.26 1h-7.49l.29.5 4.76 8.25C21 16.97 22 14.61 22 12c0-.69-.07-1.35-.2-2zM8.54 12l-3.9-6.75C3.01 7.03 2 9.39 2 12c0 .69.07 1.35.2 2h7.49l-1.15-2zm-6.08 3c.92 2.92 3.15 5.26 6 6.34L12.12 15H2.46zm11.27 0l-3.9 6.76c.7.15 1.42.24 2.17.24 2.4 0 4.6-.85 6.32-2.25l-3.66-6.35-.93 1.6z',
    { ...options, ariaLabel: options?.ariaLabel || 'Camera' }
  ),

  videocam: (options) => createIcon(
    'M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z',
    { ...options, ariaLabel: options?.ariaLabel || 'Video' }
  ),

  // Alerts & Notifications
  warning: (options) => createIcon(
    'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z',
    { ...options, ariaLabel: options?.ariaLabel || 'Warning' }
  ),

  error: (options) => createIcon(
    'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z',
    { ...options, ariaLabel: options?.ariaLabel || 'Error' }
  ),

  checkCircle: (options) => createIcon(
    'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z',
    { ...options, ariaLabel: options?.ariaLabel || 'Success' }
  ),

  info: (options) => createIcon(
    'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z',
    { ...options, ariaLabel: options?.ariaLabel || 'Information' }
  ),

  // Miscellaneous
  refresh: (options) => createIcon(
    'M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
    { ...options, ariaLabel: options?.ariaLabel || 'Refresh' }
  ),

  search: (options) => createIcon(
    'M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
    { ...options, ariaLabel: options?.ariaLabel || 'Search' }
  ),

  expandMore: (options) => createIcon(
    'M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z',
    { ...options, ariaLabel: options?.ariaLabel || 'Expand' }
  ),

  expandLess: (options) => createIcon(
    'M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z',
    { ...options, ariaLabel: options?.ariaLabel || 'Collapse' }
  ),

  check: (options) => createIcon(
    'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
    { ...options, ariaLabel: options?.ariaLabel || 'Check' }
  ),
};

/**
 * Helper function to replace an element with an icon
 * @param {HTMLElement} element - Element to replace
 * @param {string} iconName - Name of the icon from Icons object
 * @param {Object} options - Icon options
 */
function replaceWithIcon(element, iconName, options = {}) {
  if (!element || !Icons[iconName]) return;

  const icon = Icons[iconName](options);
  element.replaceWith(icon);
  return icon;
}

/**
 * Helper function to set icon content of an element
 * @param {HTMLElement} element - Element to update
 * @param {string} iconName - Name of the icon from Icons object
 * @param {Object} options - Icon options
 */
function setIconContent(element, iconName, options = {}) {
  if (!element || !Icons[iconName]) return;

  element.innerHTML = '';
  const icon = Icons[iconName](options);
  element.appendChild(icon);
  return icon;
}

module.exports = {
  createIcon,
  Icons,
  replaceWithIcon,
  setIconContent
};
