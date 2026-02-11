/**
 * Sample Home Assistant Data for Testing
 *
 * This module provides realistic sample data that matches the structure
 * of data received from Home Assistant, including entity states, services,
 * config, areas, and WebSocket messages.
 */

/**
 * Sample CONFIG object
 */
const sampleConfig = {
  windowPosition: { x: 100, y: 100 },
  windowSize: { width: 500, height: 600 },
  alwaysOnTop: true,
  opacity: 0.95,
  homeAssistant: {
    url: 'http://homeassistant.local:8123',
    token: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.mock_token',
    tokenEncrypted: false
  },
  globalHotkeys: {
    enabled: true,
    hotkeys: {
      'light.living_room': { hotkey: 'CommandOrControl+Shift+L', action: 'toggle' },
      'switch.bedroom': { hotkey: 'CommandOrControl+Shift+B', action: 'toggle' }
    }
  },
  entityAlerts: {
    enabled: true,
    alerts: {
      'sensor.temperature': {
        condition: 'greater_than',
        value: 25,
        message: 'Temperature is too high!'
      },
      'binary_sensor.motion': {
        condition: 'equals',
        value: 'on',
        message: 'Motion detected!'
      }
    }
  },
  popupHotkey: 'F9',
  favoriteEntities: [
    'light.living_room',
    'light.bedroom',
    'switch.bedroom',
    'sensor.temperature',
    'binary_sensor.motion',
    'weather.home',
    'media_player.spotify'
  ],
  customEntityNames: {
    'light.living_room': 'Main Light',
    'sensor.temperature': 'Room Temp'
  },
  customEntityIcons: {},
  selectedWeatherEntity: 'weather.home',
  primaryMediaPlayer: 'media_player.spotify',
  ui: {
    theme: 'dark',
    highContrast: false,
    opaquePanels: false,
    density: 'comfortable',
    customColors: [],
    personalizationSectionsCollapsed: {},
    enableInteractionDebugLogs: false
  },
  customTabs: [
    {
      id: 'lights',
      name: 'Lights',
      icon: '💡',
      entities: ['light.living_room', 'light.bedroom']
    }
  ]
};

/**
 * Sample STATES object (entity states)
 */
const sampleStates = {
  'light.living_room': {
    entity_id: 'light.living_room',
    state: 'on',
    attributes: {
      friendly_name: 'Living Room Light',
      brightness: 200,
      color_mode: 'brightness',
      supported_color_modes: ['brightness'],
      supported_features: 40
    },
    last_changed: '2025-01-15T10:30:00.000Z',
    last_updated: '2025-01-15T10:30:00.000Z',
    context: { id: 'context_1', parent_id: null, user_id: null }
  },
  'light.bedroom': {
    entity_id: 'light.bedroom',
    state: 'off',
    attributes: {
      friendly_name: 'Bedroom Light',
      supported_color_modes: ['brightness', 'color_temp'],
      supported_features: 44
    },
    last_changed: '2025-01-15T08:00:00.000Z',
    last_updated: '2025-01-15T08:00:00.000Z',
    context: { id: 'context_2', parent_id: null, user_id: null }
  },
  'switch.bedroom': {
    entity_id: 'switch.bedroom',
    state: 'on',
    attributes: {
      friendly_name: 'Bedroom Switch',
      icon: 'mdi:power-socket'
    },
    last_changed: '2025-01-15T09:00:00.000Z',
    last_updated: '2025-01-15T09:00:00.000Z',
    context: { id: 'context_3', parent_id: null, user_id: null }
  },
  'sensor.temperature': {
    entity_id: 'sensor.temperature',
    state: '22.5',
    attributes: {
      friendly_name: 'Temperature Sensor',
      unit_of_measurement: '°C',
      device_class: 'temperature',
      state_class: 'measurement'
    },
    last_changed: '2025-01-15T10:25:00.000Z',
    last_updated: '2025-01-15T10:25:00.000Z',
    context: { id: 'context_4', parent_id: null, user_id: null }
  },
  'binary_sensor.motion': {
    entity_id: 'binary_sensor.motion',
    state: 'off',
    attributes: {
      friendly_name: 'Motion Sensor',
      device_class: 'motion'
    },
    last_changed: '2025-01-15T10:20:00.000Z',
    last_updated: '2025-01-15T10:20:00.000Z',
    context: { id: 'context_5', parent_id: null, user_id: null }
  },
  'weather.home': {
    entity_id: 'weather.home',
    state: 'sunny',
    attributes: {
      friendly_name: 'Home Weather',
      temperature: 22,
      temperature_unit: '°C',
      humidity: 65,
      pressure: 1013,
      wind_speed: 15,
      wind_speed_unit: 'km/h',
      wind_bearing: 180,
      visibility: 10,
      forecast: [
        {
          condition: 'sunny',
          datetime: '2025-01-15T12:00:00.000Z',
          temperature: 24,
          templow: 18
        },
        {
          condition: 'cloudy',
          datetime: '2025-01-16T12:00:00.000Z',
          temperature: 20,
          templow: 15
        }
      ]
    },
    last_changed: '2025-01-15T10:00:00.000Z',
    last_updated: '2025-01-15T10:15:00.000Z',
    context: { id: 'context_6', parent_id: null, user_id: null }
  },
  'media_player.spotify': {
    entity_id: 'media_player.spotify',
    state: 'playing',
    attributes: {
      friendly_name: 'Spotify',
      media_content_type: 'music',
      media_title: 'Test Song',
      media_artist: 'Test Artist',
      media_album_name: 'Test Album',
      entity_picture: '/api/media_player_proxy/media_player.spotify?token=abc123',
      media_duration: 240,
      media_position: 60,
      media_position_updated_at: '2025-01-15T10:30:00.000Z',
      volume_level: 0.5,
      is_volume_muted: false,
      supported_features: 152463
    },
    last_changed: '2025-01-15T10:28:00.000Z',
    last_updated: '2025-01-15T10:30:00.000Z',
    context: { id: 'context_7', parent_id: null, user_id: null }
  },
  'camera.front_door': {
    entity_id: 'camera.front_door',
    state: 'idle',
    attributes: {
      friendly_name: 'Front Door Camera',
      entity_picture: '/api/camera_proxy/camera.front_door?token=xyz789',
      supported_features: 1
    },
    last_changed: '2025-01-15T08:00:00.000Z',
    last_updated: '2025-01-15T10:00:00.000Z',
    context: { id: 'context_8', parent_id: null, user_id: null }
  },
  'climate.thermostat': {
    entity_id: 'climate.thermostat',
    state: 'heat',
    attributes: {
      friendly_name: 'Thermostat',
      current_temperature: 21,
      temperature: 22,
      target_temp_high: null,
      target_temp_low: null,
      hvac_modes: ['off', 'heat', 'cool', 'auto'],
      hvac_action: 'heating',
      fan_mode: 'auto',
      fan_modes: ['auto', 'on'],
      supported_features: 27
    },
    last_changed: '2025-01-15T09:00:00.000Z',
    last_updated: '2025-01-15T10:30:00.000Z',
    context: { id: 'context_9', parent_id: null, user_id: null }
  }
};

/**
 * Sample SERVICES object
 */
const sampleServices = {
  light: {
    turn_on: {
      name: 'Turn on',
      description: 'Turn on one or more lights and adjust properties of the light, even when they are turned on already.',
      fields: {
        transition: {
          description: 'Duration it takes to get to next state',
          example: 60
        },
        brightness: {
          description: 'Number indicating brightness',
          example: 120
        },
        brightness_pct: {
          description: 'Number indicating percentage of full brightness',
          example: 47
        }
      }
    },
    turn_off: {
      name: 'Turn off',
      description: 'Turn off one or more lights.',
      fields: {
        transition: {
          description: 'Duration it takes to get to next state',
          example: 60
        }
      }
    },
    toggle: {
      name: 'Toggle',
      description: 'Toggle one or more lights.',
      fields: {}
    }
  },
  switch: {
    turn_on: {
      name: 'Turn on',
      description: 'Turn on a switch',
      fields: {}
    },
    turn_off: {
      name: 'Turn off',
      description: 'Turn off a switch',
      fields: {}
    },
    toggle: {
      name: 'Toggle',
      description: 'Toggle a switch',
      fields: {}
    }
  },
  climate: {
    turn_on: {
      name: 'Turn on',
      description: 'Turn on climate device',
      fields: {}
    },
    turn_off: {
      name: 'Turn off',
      description: 'Turn off climate device',
      fields: {}
    },
    set_temperature: {
      name: 'Set temperature',
      description: 'Set target temperature',
      fields: {
        temperature: {
          description: 'Target temperature',
          example: 22
        }
      }
    }
  },
  media_player: {
    turn_on: {
      name: 'Turn on',
      description: 'Turn on media player',
      fields: {}
    },
    turn_off: {
      name: 'Turn off',
      description: 'Turn off media player',
      fields: {}
    },
    media_play: {
      name: 'Play',
      description: 'Play media',
      fields: {}
    },
    media_pause: {
      name: 'Pause',
      description: 'Pause media',
      fields: {}
    },
    media_play_pause: {
      name: 'Play/Pause',
      description: 'Toggle play/pause',
      fields: {}
    },
    media_next_track: {
      name: 'Next track',
      description: 'Skip to next track',
      fields: {}
    },
    media_previous_track: {
      name: 'Previous track',
      description: 'Skip to previous track',
      fields: {}
    },
    volume_set: {
      name: 'Set volume',
      description: 'Set volume level',
      fields: {
        volume_level: {
          description: 'Volume level (0-1)',
          example: 0.5
        }
      }
    }
  }
};

/**
 * Sample AREAS array
 */
const sampleAreas = {
  'living_room': {
    area_id: 'living_room',
    name: 'Living Room',
    picture: null,
    aliases: ['lounge', 'sitting room']
  },
  'bedroom': {
    area_id: 'bedroom',
    name: 'Bedroom',
    picture: null,
    aliases: ['master bedroom']
  },
  'kitchen': {
    area_id: 'kitchen',
    name: 'Kitchen',
    picture: null,
    aliases: []
  }
};

/**
 * Sample UNIT_SYSTEM (metric)
 */
const sampleUnitSystemMetric = {
  temperature: '°C',
  length: 'km',
  wind_speed: 'm/s',
  pressure: 'hPa',
  precipitation: 'mm',
  volume: 'L',
  mass: 'kg'
};

/**
 * Sample UNIT_SYSTEM (imperial)
 */
const sampleUnitSystemImperial = {
  temperature: '°F',
  length: 'mi',
  wind_speed: 'mph',
  pressure: 'inHg',
  precipitation: 'in',
  volume: 'gal',
  mass: 'lb'
};

/**
 * Sample WebSocket Messages
 */
const sampleWebSocketMessages = {
  // Auth messages
  authRequest: {
    type: 'auth',
    access_token: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.mock_token'
  },
  authOk: {
    type: 'auth_ok',
    ha_version: '2025.1.0'
  },
  authInvalid: {
    type: 'auth_invalid',
    message: 'Invalid access token'
  },

  // Request messages
  getStatesRequest: {
    id: 1000,
    type: 'get_states'
  },
  getStatesResponse: {
    id: 1000,
    type: 'result',
    success: true,
    result: Object.values(sampleStates)
  },
  getServicesRequest: {
    id: 1001,
    type: 'get_services'
  },
  getServicesResponse: {
    id: 1001,
    type: 'result',
    success: true,
    result: sampleServices
  },
  getConfigRequest: {
    id: 1002,
    type: 'get_config'
  },
  getConfigResponse: {
    id: 1002,
    type: 'result',
    success: true,
    result: {
      unit_system: sampleUnitSystemMetric,
      location_name: 'Home',
      latitude: 52.3676,
      longitude: 4.9041,
      elevation: 0,
      time_zone: 'Europe/Amsterdam'
    }
  },
  getAreasRequest: {
    id: 1003,
    type: 'config/area_registry/list'
  },
  getAreasResponse: {
    id: 1003,
    type: 'result',
    success: true,
    result: Object.values(sampleAreas)
  },

  // Subscription messages
  subscribeEventsRequest: {
    id: 1004,
    type: 'subscribe_events',
    event_type: 'state_changed'
  },
  subscribeEventsResponse: {
    id: 1004,
    type: 'result',
    success: true,
    result: null
  },

  // State changed event
  stateChangedEvent: {
    id: 1004,
    type: 'event',
    event: {
      event_type: 'state_changed',
      data: {
        entity_id: 'light.living_room',
        old_state: {
          entity_id: 'light.living_room',
          state: 'off',
          attributes: { friendly_name: 'Living Room Light' },
          last_changed: '2025-01-15T10:00:00.000Z',
          last_updated: '2025-01-15T10:00:00.000Z',
          context: { id: 'old_context', parent_id: null, user_id: null }
        },
        new_state: {
          entity_id: 'light.living_room',
          state: 'on',
          attributes: { friendly_name: 'Living Room Light', brightness: 255 },
          last_changed: '2025-01-15T10:30:00.000Z',
          last_updated: '2025-01-15T10:30:00.000Z',
          context: { id: 'new_context', parent_id: null, user_id: null }
        }
      },
      origin: 'LOCAL',
      time_fired: '2025-01-15T10:30:00.000Z',
      context: { id: 'event_context', parent_id: null, user_id: null }
    }
  },

  // Service call
  callServiceRequest: {
    id: 1005,
    type: 'call_service',
    domain: 'light',
    service: 'turn_on',
    service_data: {
      entity_id: 'light.living_room',
      brightness: 200
    }
  },
  callServiceResponse: {
    id: 1005,
    type: 'result',
    success: true,
    result: {
      context: { id: 'service_context', parent_id: null, user_id: null }
    }
  },

  // Ping/Pong
  ping: {
    type: 'ping'
  },
  pong: {
    type: 'pong'
  }
};

module.exports = {
  sampleConfig,
  sampleStates,
  sampleServices,
  sampleAreas,
  sampleUnitSystemMetric,
  sampleUnitSystemImperial,
  sampleWebSocketMessages
};
