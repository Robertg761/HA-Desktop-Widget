import state from './state.js';

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

function getEntityIcon(entity) {
    try {
        if (!entity) return '❓';
        const domain = entity.entity_id.split('.')[0];
        const state = entity.state;
        const attributes = entity.attributes || {};

        switch (domain) {
            case 'light': return '💡';
            case 'switch': return state === 'on' ? '🔌' : '➖';
            case 'fan': return state === 'on' ? '💨' : '➖';
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
                if (attributes.device_class === 'motion') return state === 'on' ? '🏃' : '🧍';
                if (attributes.device_class === 'door') return state === 'on' ? '🚪' : '닫';
                if (attributes.device_class === 'window') return state === 'on' ? '🪟' : '닫';
                return state === 'on' ? '✔️' : '❌';
            case 'climate': return '🌡️';
            case 'media_player': return '🎵';
            case 'scene': return '✨';
            case 'automation': return '🤖';
            case 'camera': return '📷';
            case 'lock': return state === 'locked' ? '🔒' : '🔓';
            case 'cover': return '🪟';
            case 'person': return state === 'home' ? '🏠' : '✈️';
            case 'device_tracker': return state === 'home' ? '🏠' : '✈️';
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
};