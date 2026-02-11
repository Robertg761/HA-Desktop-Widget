import state from './state.js';
const graphemeSegmenter = (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function')
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

function countGraphemes(value) {
    if (!value || typeof value !== 'string') return 0;
    if (graphemeSegmenter) {
        let count = 0;
        for (const _segment of graphemeSegmenter.segment(value)) {
            count += 1;
            if (count > 1) break;
        }
        return count;
    }
    return Array.from(value).length;
}

function normalizeEntityIconGlyph(icon) {
    if (typeof icon !== 'string') return null;
    const trimmed = icon.trim();
    if (!trimmed) return null;
    return countGraphemes(trimmed) === 1 ? trimmed : null;
}

function getEntityDisplayName(entity) {
    try {
        if (!entity) return 'Unknown';

        // Check for custom name first
        const customName = state.CONFIG?.customEntityNames?.[entity.entity_id];
        if (customName) return customName;

        // Fall back to friendly_name or entity_id
        return entity.attributes?.friendly_name || entity.entity_id;
    } catch (error) {
        console.error('Error getting entity display name:', error);
        return 'Unknown';
    }
}

function getEntityTypeDescription(entity) {
    try {
        if (!entity) return 'Unknown';
        const domain = entity.entity_id.split('.')[0];
        return domain.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    } catch (error) {
        console.error('Error getting entity type description:', error);
        return 'Unknown';
    }
}

function getEntityIcon(entity, options = {}) {
    try {
        if (!entity) return '❓';
        const ignoreCustomIcon = !!options.ignoreCustomIcon;
        if (!ignoreCustomIcon) {
            const customIcon = normalizeEntityIconGlyph(state.CONFIG?.customEntityIcons?.[entity.entity_id]);
            if (customIcon) return customIcon;
        }

        const domain = entity.entity_id.split('.')[0];
        const entityState = entity.state;
        const attributes = entity.attributes || {};

        switch (domain) {
            case 'light': return '💡';
            case 'switch': return entityState === 'on' ? '🔌' : '➖';
            case 'fan': return entityState === 'on' ? '💨' : '➖';
            case 'sensor':
                if (attributes.device_class === 'temperature') return '🌡️';
                if (attributes.device_class === 'humidity') return '💧';
                if (attributes.device_class === 'pressure') return '📊';
                if (attributes.device_class === 'illuminance') return '☀️';
                if (attributes.device_class === 'battery') return '🔋';
                if (attributes.device_class === 'power') return '⚡';
                if (attributes.device_class === 'energy') return '⚡';
                // Check for timer sensors (has timer-related attributes or timer in name)
                if (attributes.finishes_at || attributes.end_time || attributes.finish_time ||
                    attributes.duration || entity.entity_id.toLowerCase().includes('timer')) return '⏲️';
                if (entity.entity_id.includes('battery')) return '🔋';
                if (entity.entity_id.includes('temperature') || entity.entity_id.includes('temp')) return '🌡️';
                return '📈';
            case 'binary_sensor':
                if (attributes.device_class === 'motion') return entityState === 'on' ? '🏃' : '🧍';
                if (attributes.device_class === 'door') return entityState === 'on' ? '🚪' : '🚪';
                if (attributes.device_class === 'window') return entityState === 'on' ? '🪟' : '🪟';
                return entityState === 'on' ? '✔️' : '❌';
            case 'climate': return '🌡️';
            case 'media_player': return '🎵';
            case 'scene': return '✨';
            case 'automation': return '🤖';
            case 'camera': return '📷';
            case 'lock': return entityState === 'locked' ? '🔒' : '🔓';
            case 'cover': return '🪟';
            case 'person': return entityState === 'home' ? '🏠' : '✈️';
            case 'device_tracker': return entityState === 'home' ? '🏠' : '✈️';
            case 'alarm_control_panel': return '🛡️';
            case 'vacuum': return '🧹';
            case 'timer': return '⏲️';
            default: return '❓';
        }
    } catch (error) {
        console.error('Error getting entity icon:', error);
        return '❓';
    }
}

function formatDuration(ms) {
    try {
        if (ms < 0) ms = 0;
        const s = Math.floor(ms / 1000);
        const hh = Math.floor(s / 3600);
        const mm = Math.floor((s % 3600) / 60);
        const ss = s % 60;
        if (hh > 0) return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
        return `${mm}:${String(ss).padStart(2, '0')}`;
    } catch (error) {
        console.error('Error formatting duration:', error);
        return '0:00';
    }
}

function getTimerEnd(entity) {
    try {
        const fin = entity.attributes?.finishes_at;
        if (fin) {
            const t = new Date(fin).getTime();
            if (!isNaN(t)) return t;
        }
        const rem = entity.attributes?.remaining;
        if (rem) {
            const parts = rem.split(':').map(n => parseInt(n, 10));
            if (parts.length === 3 && parts.every(x => !isNaN(x))) {
                const ms = ((parts[0] * 3600) + (parts[1] * 60) + parts[2]) * 1000;
                return Date.now() + ms;
            }
        }
        return null;
    } catch (error) {
        console.error('Error getting timer end:', error);
        return null;
    }
}

function getSearchScore(text, query) {
    try {
        // Normalize text by removing special characters, apostrophes, underscores, and extra spaces
        const normalizeText = (str) => {
            return str
                .toLowerCase()
                .replace(/[''`]/g, '')  // Remove apostrophes and backticks
                .replace(/[_-]/g, ' ')  // Replace underscores and hyphens with spaces
                .replace(/[^\w\s]/g, '') // Remove other special characters
                .replace(/\s+/g, ' ')   // Normalize multiple spaces to single space
                .trim();
        };

        const normalizedText = normalizeText(text);
        const normalizedQuery = normalizeText(query);

        if (normalizedText.includes(normalizedQuery)) {
            if (normalizedText.startsWith(normalizedQuery)) {
                return 2;
            }
            return 1;
        }
        return 0;
    } catch (error) {
        console.error('Error getting search score:', error);
        return 0;
    }
}

function getEntityDisplayState(entity) {
    try {
        if (!entity) return 'Unknown';

        // Check if sensor is a timer (has timer-related attributes, timer in name, or timestamp as state)
        const hasTimerAttributes = entity.attributes && (
            entity.attributes.finishes_at ||
            entity.attributes.end_time ||
            entity.attributes.finish_time ||
            entity.attributes.duration
        );
        const hasTimerInName = entity.entity_id.toLowerCase().includes('timer');

        // Check if state is a valid future timestamp
        let stateIsTimestamp = false;
        if (entity.state && entity.state !== 'unavailable' && entity.state !== 'unknown') {
            // Only treat as timestamp if it looks like a full ISO 8601 date-time string with time component
            // Require time component (YYYY-MM-DDTHH:mm or YYYY-MM-DD HH:mm) to avoid matching date-only sensors
            // This prevents matching calendar/date sensors showing "2025-12-25" and other date-only values
            const iso8601Pattern = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?/;
            const looksLikeTimestamp = iso8601Pattern.test(entity.state);
            if (looksLikeTimestamp) {
                const stateTime = new Date(entity.state).getTime();
                if (!isNaN(stateTime) && stateTime > Date.now()) {
                    stateIsTimestamp = true;
                }
            }
        }

        const isTimerSensor = entity.entity_id.startsWith('sensor.') && (hasTimerAttributes || hasTimerInName || stateIsTimestamp);

        // For timers (both timer.* and sensor.* with timer attributes)
        if (entity.entity_id.startsWith('timer.') || isTimerSensor) {
            return getTimerDisplay(entity);
        }

        // For sensors, return the actual value with unit
        if (entity.entity_id.startsWith('sensor.')) {
            const unit = entity.attributes?.unit_of_measurement || '';
            return unit ? `${entity.state} ${unit}` : entity.state;
        }

        // For binary sensors
        if (entity.entity_id.startsWith('binary_sensor.')) {
            return entity.state === 'on' ? 'Detected' : 'Clear';
        }

        // For scenes - just show "Ready" or hide the state
        if (entity.entity_id.startsWith('scene.')) {
            return 'Ready';
        }

        // For lights with brightness
        if (entity.entity_id.startsWith('light.') && entity.state === 'on' && entity.attributes?.brightness) {
            const brightness = Math.round((entity.attributes.brightness / 255) * 100);
            return `${brightness}%`;
        }

        // For climate
        if (entity.entity_id.startsWith('climate.')) {
            const temp = entity.attributes?.current_temperature || entity.attributes?.temperature;
            if (temp) return `${temp}°`;
        }

        // Default: capitalize first letter
        return entity.state.charAt(0).toUpperCase() + entity.state.slice(1);
    } catch (error) {
        console.error('Error getting entity display state:', error);
        return 'Unknown';
    }
}

function getTimerDisplay(entity) {
    try {
        if (!entity) return '--:--';

        // Handle sensor-based timers (like Google Kitchen Timer)
        if (entity.entity_id.startsWith('sensor.')) {
            // Check for various timer end time attributes
            let finishesAt = entity.attributes?.finishes_at ||
                entity.attributes?.end_time ||
                entity.attributes?.finish_time;

            // If no attribute, check if state is a timestamp (Google Kitchen Timer uses state as timestamp)
            if (!finishesAt && entity.state && entity.state !== 'unavailable' && entity.state !== 'unknown') {
                // Only treat as timestamp if it looks like a full ISO 8601 date-time string with time component
                // Require time component (YYYY-MM-DDTHH:mm or YYYY-MM-DD HH:mm) to avoid matching date-only sensors
                // This prevents matching calendar/date sensors showing "2025-12-25" and other date-only values
                const iso8601Pattern = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?/;
                const looksLikeTimestamp = iso8601Pattern.test(entity.state);
                if (looksLikeTimestamp) {
                    const stateTime = new Date(entity.state).getTime();
                    if (!isNaN(stateTime)) {
                        finishesAt = entity.state;
                    }
                }
            }

            if (finishesAt) {
                const endTime = new Date(finishesAt).getTime();
                const now = Date.now();

                if (endTime <= now) {
                    return 'Finished';
                }

                const remaining = Math.max(0, Math.floor((endTime - now) / 1000));
                const hours = Math.floor(remaining / 3600);
                const minutes = Math.floor((remaining % 3600) / 60);
                const seconds = remaining % 60;

                if (hours > 0) {
                    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
                }
                return `${minutes}:${String(seconds).padStart(2, '0')}`;
            }

            // If no end time found, just return the state
            return entity.state;
        }

        // Handle timer.* entities
        if (entity.state === 'idle') {
            return 'Idle';
        }

        if (entity.state === 'paused') {
            const remaining = entity.attributes?.remaining || '00:00:00';
            return `⏸ ${remaining.substring(0, 5)}`; // Show HH:MM
        }

        if (entity.state === 'active') {
            const remaining = entity.attributes?.remaining || '00:00:00';
            // Parse and format as mm:ss or hh:mm:ss
            const parts = remaining.split(':').map(p => parseInt(p, 10));
            if (parts.length === 3) {
                const [h, m, s] = parts;
                if (h > 0) {
                    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
                }
                return `${m}:${String(s).padStart(2, '0')}`;
            }
            return remaining.substring(0, 5); // Fallback to HH:MM
        }

        return entity.state.charAt(0).toUpperCase() + entity.state.slice(1);
    } catch (error) {
        console.error('Error getting timer display:', error);
        return '--:--';
    }
}

/**
 * Escapes HTML special characters to prevent XSS attacks
 * @param {string} text - The text to escape
 * @returns {string} - HTML-safe text
 */
function escapeHtml(text) {
    if (typeof text !== 'string') return text;
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Base64-encode a string using UTF-8 bytes (safe for Unicode).
 * @param {string} input - The string to encode.
 * @returns {string} - Base64 encoded string.
 */
function base64Encode(input) {
    try {
        const text = input == null ? '' : String(input);
        const bytes = new TextEncoder().encode(text);
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }
        return btoa(binary);
    } catch (error) {
        console.error('Error base64 encoding string:', error);
        return '';
    }
}

/**
 * Normalize an entity ID candidate for fuzzy matching.
 * This does not guarantee a valid Home Assistant entity ID.
 * @param {string} entityId
 * @returns {string}
 */
function normalizeEntityIdCandidate(entityId) {
    if (typeof entityId !== 'string') return '';
    const trimmed = entityId.trim().toLowerCase();
    if (!trimmed) return '';

    const dotIndex = trimmed.indexOf('.');
    if (dotIndex < 0) {
        return trimmed.replace(/\s+/g, '_');
    }

    const domain = trimmed.slice(0, dotIndex).replace(/\s+/g, '_');
    const objectId = trimmed.slice(dotIndex + 1).replace(/\s+/g, '_');
    return `${domain}.${objectId}`;
}

/**
 * Resolve a potentially malformed entity ID to an actual ID present in the current state map.
 * Returns null when no safe mapping is found.
 * @param {string} entityId
 * @param {Object.<string, any>} [states]
 * @returns {string|null}
 */
function resolveEntityId(entityId, states = state.STATES) {
    if (typeof entityId !== 'string') return null;
    if (!states || typeof states !== 'object') return null;

    if (Object.prototype.hasOwnProperty.call(states, entityId)) {
        return entityId;
    }

    const trimmed = entityId.trim();
    if (trimmed && Object.prototype.hasOwnProperty.call(states, trimmed)) {
        return trimmed;
    }

    const directLower = trimmed.toLowerCase();
    if (directLower) {
        const caseInsensitiveMatch = Object.keys(states).find(key => key.toLowerCase() === directLower);
        if (caseInsensitiveMatch) return caseInsensitiveMatch;
    }

    const normalized = normalizeEntityIdCandidate(trimmed);
    if (normalized && Object.prototype.hasOwnProperty.call(states, normalized)) {
        return normalized;
    }

    if (normalized) {
        const normalizedLower = normalized.toLowerCase();
        const normalizedMatch = Object.keys(states).find(key => key.toLowerCase() === normalizedLower);
        if (normalizedMatch) return normalizedMatch;
    }

    return null;
}

/**
 * Reconcile entity IDs stored in local config against live Home Assistant states.
 * IDs are only rewritten when a concrete matching entity exists in `states`.
 * @param {Object} config
 * @param {Object.<string, any>} [states]
 * @returns {{ config: Object, changed: boolean }}
 */
function reconcileConfigEntityIds(config, states = state.STATES) {
    if (!config || typeof config !== 'object' || !states || typeof states !== 'object') {
        return { config, changed: false };
    }

    const sameArray = (a, b) =>
        Array.isArray(a) && Array.isArray(b) &&
        a.length === b.length &&
        a.every((value, index) => value === b[index]);

    const remapEntityId = (value) => {
        if (typeof value !== 'string') return value;
        return resolveEntityId(value, states) || value;
    };

    const remapArray = (list, options = {}) => {
        if (!Array.isArray(list)) return { value: list, changed: false };
        const specialValues = options.specialValues || null;
        const dedupe = !!options.dedupe;
        const seen = new Set();
        let localChanged = false;

        const next = list.reduce((acc, item) => {
            const preserveSpecial = typeof item === 'string' && specialValues && specialValues.has(item);
            const mapped = preserveSpecial ? item : remapEntityId(item);
            if (mapped !== item) localChanged = true;

            if (dedupe && typeof mapped === 'string') {
                if (seen.has(mapped)) {
                    localChanged = true;
                    return acc;
                }
                seen.add(mapped);
            }

            acc.push(mapped);
            return acc;
        }, []);

        if (!localChanged && sameArray(list, next)) {
            return { value: list, changed: false };
        }
        return { value: next, changed: true };
    };

    const remapObjectKeys = (input) => {
        if (!input || typeof input !== 'object' || Array.isArray(input)) {
            return { value: input, changed: false };
        }

        let localChanged = false;
        const next = {};

        Object.entries(input).forEach(([key, value]) => {
            const mappedKey = remapEntityId(key);
            if (mappedKey !== key) localChanged = true;

            if (Object.prototype.hasOwnProperty.call(next, mappedKey)) {
                // Prefer exact keys when both malformed and corrected forms exist.
                if (mappedKey === key) {
                    next[mappedKey] = value;
                } else {
                    localChanged = true;
                }
                return;
            }

            next[mappedKey] = value;
        });

        return localChanged ? { value: next, changed: true } : { value: input, changed: false };
    };

    let changed = false;
    let nextConfig = config;
    const ensureConfigClone = () => {
        if (nextConfig === config) nextConfig = { ...config };
    };

    if (typeof config.primaryMediaPlayer === 'string') {
        const mapped = remapEntityId(config.primaryMediaPlayer);
        if (mapped !== config.primaryMediaPlayer) {
            ensureConfigClone();
            nextConfig.primaryMediaPlayer = mapped;
            changed = true;
        }
    }

    if (typeof config.selectedWeatherEntity === 'string') {
        const mapped = remapEntityId(config.selectedWeatherEntity);
        if (mapped !== config.selectedWeatherEntity) {
            ensureConfigClone();
            nextConfig.selectedWeatherEntity = mapped;
            changed = true;
        }
    }

    const favoritesResult = remapArray(config.favoriteEntities, { dedupe: true });
    if (favoritesResult.changed) {
        ensureConfigClone();
        nextConfig.favoriteEntities = favoritesResult.value;
        changed = true;
    }

    const primaryCardSpecial = new Set(['weather', 'time', 'none']);
    const primaryCardsResult = remapArray(config.primaryCards, { specialValues: primaryCardSpecial });
    if (primaryCardsResult.changed) {
        ensureConfigClone();
        nextConfig.primaryCards = primaryCardsResult.value;
        changed = true;
    }

    const customNamesResult = remapObjectKeys(config.customEntityNames);
    if (customNamesResult.changed) {
        ensureConfigClone();
        nextConfig.customEntityNames = customNamesResult.value;
        changed = true;
    }

    const customIconsResult = remapObjectKeys(config.customEntityIcons);
    if (customIconsResult.changed) {
        ensureConfigClone();
        nextConfig.customEntityIcons = customIconsResult.value;
        changed = true;
    }

    const tileSpansResult = remapObjectKeys(config.tileSpans);
    if (tileSpansResult.changed) {
        ensureConfigClone();
        nextConfig.tileSpans = tileSpansResult.value;
        changed = true;
    }

    if (config.globalHotkeys && typeof config.globalHotkeys === 'object') {
        const hotkeysResult = remapObjectKeys(config.globalHotkeys.hotkeys);
        if (hotkeysResult.changed) {
            ensureConfigClone();
            nextConfig.globalHotkeys = { ...config.globalHotkeys, hotkeys: hotkeysResult.value };
            changed = true;
        }
    }

    if (config.entityAlerts && typeof config.entityAlerts === 'object') {
        const alertsResult = remapObjectKeys(config.entityAlerts.alerts);
        if (alertsResult.changed) {
            ensureConfigClone();
            nextConfig.entityAlerts = { ...config.entityAlerts, alerts: alertsResult.value };
            changed = true;
        }
    }

    return { config: nextConfig, changed };
}

export {
    getEntityDisplayName,
    getEntityTypeDescription,
    getEntityIcon,
    formatDuration,
    getTimerEnd,
    getSearchScore,
    getEntityDisplayState,
    getTimerDisplay,
    escapeHtml,
    base64Encode,
    resolveEntityId,
    reconcileConfigEntityIds,
};
