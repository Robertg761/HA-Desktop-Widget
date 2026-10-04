/**
 * Canonical schema for Home Assistant companion profiles.
 *
 * A profile is the shareable slice of config authored in Home Assistant and
 * pushed to desktops through the companion protocol's `apply_profile` command.
 * Home Assistant only enforces structural bounds (size, depth, top-level
 * sections); this module owns the semantic normalization of section contents,
 * so the desktop and the future HA panel agree on what a profile means.
 * Machine-local sections (window geometry, credentials, hotkeys, pins,
 * profileSync, updates) are intentionally not part of a profile.
 */

import { normalizeQuickAccessConfig } from './quick-access-tabs.js';
import { normalizeComparisonGraphsConfig } from './comparison-graphs.js';
import pageNames from '../../../src/page-names.cjs';

const { toStoredPages } = pageNames;

const PROFILE_SCHEMA_VERSION = 1;

const PROFILE_SECTION_KEYS = Object.freeze([
  'ui',
  'primaryCards',
  'selectedWeatherEntity',
  'primaryMediaPlayer',
  'tileSpans',
  'favoriteEntities',
  'customTabs',
  'activeTabId',
  'comparisonGraphs',
  'quickAccessTileOptions',
  'customEntityIcons',
  'customEntityNames',
  'opacity',
  'frostedGlass',
]);

// These ui fields describe this machine's session, not the shared look. Profile sync keeps the
// same list in profile-sync-core.js (a test keeps the two equal).
const LOCAL_ONLY_UI_KEYS = new Set([
  'personalizationSectionsCollapsed',
  'enableInteractionDebugLogs',
  'scale',
  'followOmarchy',
]);

const MAX_PRIMARY_CARDS = 2;
const MIN_OPACITY = 0.5;
const MAX_OPACITY = 1;

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function boundedString(value, maximum = 128) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function normalizeStringArray(value, { maximumItems = 500 } = {}) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => boundedString(item))
    .filter(Boolean)
    .slice(0, maximumItems);
}

function normalizeObjectMap(value, normalizeEntry) {
  if (!isPlainObject(value)) return {};
  return Object.entries(value).reduce((acc, [key, entry]) => {
    const cleanKey = boundedString(key);
    if (!cleanKey) return acc;
    const cleanEntry = normalizeEntry(entry);
    if (cleanEntry !== undefined) acc[cleanKey] = cleanEntry;
    return acc;
  }, {});
}

/**
 * Reduce an untrusted profile document to its known sections with sane shapes.
 * Sections absent from the document stay absent, so partial profiles only
 * overwrite what they mention. Throws when the document is not an object.
 */
function normalizeProfileDocument(document, currentConfig = {}) {
  if (!isPlainObject(document)) {
    throw new Error('Profile document must be an object');
  }
  const normalized = {};

  if (isPlainObject(document.ui)) {
    normalized.ui = Object.fromEntries(
      Object.entries(document.ui).filter(([key]) => !LOCAL_ONLY_UI_KEYS.has(key))
    );
  }

  if ('primaryCards' in document) {
    normalized.primaryCards = normalizeStringArray(document.primaryCards, {
      maximumItems: MAX_PRIMARY_CARDS,
    });
  }

  for (const [key, domain] of [
    ['selectedWeatherEntity', 'weather'],
    ['primaryMediaPlayer', 'media_player'],
  ]) {
    if (!(key in document)) continue;
    const entityId = boundedString(document[key]);
    normalized[key] = entityId.startsWith(`${domain}.`) ? entityId : null;
  }

  if ('tileSpans' in document) {
    normalized.tileSpans = normalizeObjectMap(document.tileSpans, (value) =>
      Number.isInteger(value) && value >= 1 && value <= 4 ? value : undefined
    );
  }

  // A key is only read as present when it holds the right kind of value: a null, a string or an
  // object where a list belongs would otherwise read as "clear this" and empty the layout.
  const quickAccessDocument = Object.fromEntries(
    ['customTabs', 'favoriteEntities', 'comparisonGraphs']
      .filter((key) => Array.isArray(document[key]))
      .map((key) => [key, document[key]])
  );
  if (typeof document.activeTabId === 'string') {
    quickAccessDocument.activeTabId = document.activeTabId;
  }
  if (Object.keys(quickAccessDocument).length > 0) {
    const source = { ...currentConfig, ...quickAccessDocument };
    if ('activeTabId' in quickAccessDocument) {
      source.activeTabId = boundedString(quickAccessDocument.activeTabId);
    }
    if ('customTabs' in quickAccessDocument && !('favoriteEntities' in quickAccessDocument)) {
      source.favoriteEntities = [];
    }
    // A legacy favorites-only edit changes one page, not every page on the desktop: the page the
    // profile selects when it names an existing one, otherwise the current active page.
    if (
      'favoriteEntities' in quickAccessDocument &&
      !('customTabs' in quickAccessDocument) &&
      source.customTabs?.length
    ) {
      const current = normalizeQuickAccessConfig(currentConfig);
      const requestedTabId = boundedString(quickAccessDocument.activeTabId);
      const targetTabId = current.customTabs.some((tab) => tab.id === requestedTabId)
        ? requestedTabId
        : current.activeTabId;
      // The page that received the favorites is the one to show.
      source.activeTabId = targetTabId;
      source.customTabs = current.customTabs.map((tab) =>
        tab.id === targetTabId
          ? { ...tab, entityIds: normalizeStringArray(quickAccessDocument.favoriteEntities) }
          : tab
      );
    }
    const quickAccess = normalizeQuickAccessConfig(source);
    normalized.customTabs = quickAccess.customTabs;
    normalized.activeTabId = quickAccess.activeTabId;
    normalized.favoriteEntities = quickAccess.favoriteEntities;
    if ('comparisonGraphs' in quickAccessDocument || 'comparisonGraphs' in currentConfig) {
      const reconciled = normalizeComparisonGraphsConfig({
        ...quickAccess,
        comparisonGraphs: source.comparisonGraphs,
      });
      normalized.comparisonGraphs = reconciled.comparisonGraphs;
      normalized.customTabs = reconciled.customTabs;
      normalized.favoriteEntities = reconciled.favoriteEntities;
    }
  }

  if ('quickAccessTileOptions' in document) {
    normalized.quickAccessTileOptions = normalizeObjectMap(
      document.quickAccessTileOptions,
      (entry) => (isPlainObject(entry) ? entry : undefined)
    );
  }

  if ('customEntityIcons' in document) {
    normalized.customEntityIcons = normalizeObjectMap(document.customEntityIcons, (entry) => {
      const icon = boundedString(entry);
      return icon || undefined;
    });
  }

  if ('customEntityNames' in document) {
    normalized.customEntityNames = normalizeObjectMap(document.customEntityNames, (entry) => {
      const name = boundedString(entry);
      return name || undefined;
    });
  }

  if ('opacity' in document) {
    // Number(null), Number('') and Number(false) are 0, which would clamp to the minimum and
    // make the whole widget half transparent: only a number, or text holding one, counts.
    const raw = document.opacity;
    const opacity =
      typeof raw === 'number' || (typeof raw === 'string' && raw.trim() !== '')
        ? Number(raw)
        : Number.NaN;
    if (Number.isFinite(opacity)) {
      normalized.opacity = Math.max(MIN_OPACITY, Math.min(MAX_OPACITY, opacity));
    }
  }

  if ('frostedGlass' in document) {
    normalized.frostedGlass = document.frostedGlass === true;
  }

  return normalized;
}

/**
 * Turn an `apply_profile` command payload into an updateConfig patch.
 * Validates the payload's schema version and identity, and merges the profile's
 * `ui` section over the current one so local-only ui fields survive the apply.
 */
function buildConfigPatchFromApplyPayload(payload, currentConfig = {}) {
  const schemaVersion = Number(payload?.schema_version);
  if (schemaVersion !== PROFILE_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported profile schema version ${payload?.schema_version ?? 'unknown'}; ` +
        `this desktop understands version ${PROFILE_SCHEMA_VERSION}`
    );
  }
  const profileId = boundedString(payload?.profile_id, 64);
  const revision = Number(payload?.revision);
  if (!profileId || !Number.isInteger(revision) || revision < 0) {
    throw new Error('Profile payload is missing a valid profile identity');
  }

  const document = normalizeProfileDocument(payload?.profile, currentConfig);
  const patch = { ...document };
  if (document.ui) {
    patch.ui = { ...(isPlainObject(currentConfig?.ui) ? currentConfig.ui : {}), ...document.ui };
  }
  patch.haProfile = {
    activeProfileId: profileId,
    revision,
    appliedAt: new Date().toISOString(),
  };
  return patch;
}

/**
 * Project a full desktop config down to its shareable profile sections, so the
 * desktop can report its current layout to Home Assistant as a snapshot.
 */
function buildProfileDocumentFromConfig(config) {
  const source = isPlainObject(config) ? config : {};
  const document = {};
  for (const key of PROFILE_SECTION_KEYS) {
    if (key in source) document[key] = source[key];
  }
  const profile = normalizeProfileDocument(document);
  // The document goes to Home Assistant and from there to other desktops, which may speak another
  // language. An unnamed page stays unnamed, as in the saved config, so each desktop names it for
  // itself; Home Assistant only checks the structure of a profile, so an empty name is accepted.
  if (Array.isArray(profile.customTabs)) profile.customTabs = toStoredPages(profile.customTabs);
  return profile;
}

export {
  PROFILE_SCHEMA_VERSION,
  PROFILE_SECTION_KEYS,
  LOCAL_ONLY_UI_KEYS,
  buildConfigPatchFromApplyPayload,
  buildProfileDocumentFromConfig,
  normalizeProfileDocument,
};
