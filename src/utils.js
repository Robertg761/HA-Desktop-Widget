const { STATES } = require('./state.js');

function getEntityDisplayName(entity) {
  try {
    if (!entity) return 'Unknown';
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
            case 'light': return state === 'on' ? '💡' : '⚫';
            case 'switch': return state === 'on' ? '🔌' : '➖';
            case 'fan': return state === 'on' ? '💨' : '➖';
            case 'sensor':
                if (attributes.device_class === 'temperature') return '🌡️';
                if (attributes.device_class === 'humidity') return '💧';
                if (attributes.device_class === 'pressure') return '📊';
                if (attributes.device_class === 'illuminance') return '☀️';
                return '📈';
            case 'binary_sensor':
                if (attributes.device_class === 'motion') return state === 'on' ? '🏃' : '🧍';
                if (attributes.device_class === 'door') return state === 'on' ? '🚪' : '닫';
                if (attributes.device_class === 'window') return state === 'on' ? '🪟' : '닫';
                return state === 'on' ? '✔️' : '❌';
            case 'climate': return '🌡️';
            case 'media_player': return '🎵';
            case 'scene': return '🎬';
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

module.exports = {
    getEntityDisplayName,
    getEntityTypeDescription,
    getEntityIcon,
    formatDuration,
    getTimerEnd,
    getSearchScore,
};