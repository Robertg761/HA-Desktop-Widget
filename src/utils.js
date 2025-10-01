const state = require('./state.js');

function getEntityDisplayName(entity) {
  try {
    if (!entity) return 'Unknown';
    
    // Check for custom name first
    const customName = state.CONFIG?.customEntityNames?.[entity.entity_id];
    if (customName) return customName;
    
    // Fall back to friendly_name or entity_id
    return entity.attributes.friendly_name || entity.entity_id;
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
                // Check entity_id for common patterns
                if (entity.entity_id.includes('timer')) return '⏲️';
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
    if (hh > 0) return `${hh}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
    return `${mm}:${String(ss).padStart(2,'0')}`;
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
        const ms = ((parts[0]*3600)+(parts[1]*60)+parts[2]) * 1000;
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
        const lowerText = text.toLowerCase();
        const lowerQuery = query.toLowerCase();

        if (lowerText.includes(lowerQuery)) {
            if (lowerText.startsWith(lowerQuery)) {
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
        
        // For sensors, return the actual value with unit
        if (entity.entity_id.startsWith('sensor.')) {
            const unit = entity.attributes?.unit_of_measurement || '';
            return unit ? `${entity.state} ${unit}` : entity.state;
        }
        
        // For binary sensors
        if (entity.entity_id.startsWith('binary_sensor.')) {
            return entity.state === 'on' ? 'Detected' : 'Clear';
        }
        
        // For timers
        if (entity.entity_id.startsWith('timer.')) {
            return getTimerDisplay(entity);
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

module.exports = {
    getEntityDisplayName,
    getEntityTypeDescription,
    getEntityIcon,
    formatDuration,
    getTimerEnd,
    getSearchScore,
    getEntityDisplayState,
    getTimerDisplay,
};