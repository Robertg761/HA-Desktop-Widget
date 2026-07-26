// Production replacement for the development-only climate fixture.
// Vite selects this module for release builds, excluding all mock climate
// entities, controls, and service handlers from shipped renderer artifacts.
export const DEV_CLIMATE_DEMO_ENTITY_ID = '';

export function isClimateDemoConfig() {
  return false;
}

export function isClimateDemoOverlayConfig() {
  return false;
}

export function installClimateDemo() {
  return null;
}
