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

const PROFILE_SCHEMA_VERSION = 1;

const PROFILE_SECTION_KEYS = Object.freeze([
  'ui',
  'primaryCards',
  'favoriteEntities',
  'customTabs',
  'activeTabId',
  'comparisonGraphs',
  'quickAccessTileOptions',
  'customEntityIcons',
  'opacity',
  'frostedGlass',
]);

// These ui fields describe this machine's session, not the shared look.
const LOCAL_ONLY_UI_KEYS = new Set([
  'personalizationSectionsCollapsed',
  'enableInteractionDebugLogs',
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
function normalizeProfileDocument(document) {
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

  const hasQuickAccess =
    'customTabs' in document || 'favoriteEntities' in document || 'activeTabId' in document;
  if (hasQuickAccess) {
    const quickAccess = normalizeQuickAccessConfig({
      customTabs: Array.isArray(document.customTabs) ? document.customTabs : [],
      favoriteEntities: normalizeStringArray(document.favoriteEntities),
      activeTabId: boundedString(document.activeTabId),
    });
    normalized.customTabs = quickAccess.customTabs;
    normalized.activeTabId = quickAccess.activeTabId;
    normalized.favoriteEntities = quickAccess.favoriteEntities;
  }

  if ('comparisonGraphs' in document) {
    // Graphs only exist as tiles inside tabs, so reconcile them against the
    // document's own (normalized) tabs; orphaned graphs are dropped here just
    // like they are in the renderer's config pipeline.
    const reconciled = normalizeComparisonGraphsConfig({
      comparisonGraphs: Array.isArray(document.comparisonGraphs) ? document.comparisonGraphs : [],
      customTabs: normalized.customTabs || [],
    });
    normalized.comparisonGraphs = reconciled.comparisonGraphs;
    if (normalized.customTabs) {
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

  if ('opacity' in document) {
    const opacity = Number(document.opacity);
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

  const document = normalizeProfileDocument(payload?.profile);
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

export {
  PROFILE_SCHEMA_VERSION,
  PROFILE_SECTION_KEYS,
  buildConfigPatchFromApplyPayload,
  normalizeProfileDocument,
};
