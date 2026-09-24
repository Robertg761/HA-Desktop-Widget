/**
 * The dashboard every visual snapshot shows: one of each tile state the main view draws (on, off,
 * sensor, door, scene, camera, running timer, unavailable, lock, heating climate) plus weather and
 * a playing media player.
 */

const TOKEN = 'visual-snapshot-token';

function buildStates(now = new Date()) {
  const stamp = now.toISOString();
  const entity = (entityId, state, attributes = {}) => ({
    entity_id: entityId,
    state,
    attributes,
    last_changed: stamp,
    last_updated: stamp,
    context: { id: entityId, parent_id: null, user_id: null },
  });
  return [
    entity('weather.home', 'cloudy', {
      friendly_name: 'Home',
      temperature: 4,
      temperature_unit: '°C',
      humidity: 81,
      wind_speed: 12,
      wind_speed_unit: 'km/h',
    }),
    entity('light.desk_lamp', 'on', {
      friendly_name: 'Desk lamp',
      brightness: 204,
      supported_color_modes: ['brightness'],
      color_mode: 'brightness',
    }),
    entity('light.shelf_leds', 'off', {
      friendly_name: 'Shelf LEDs',
      supported_color_modes: ['brightness'],
    }),
    entity('switch.coffee_maker', 'off', { friendly_name: 'Coffee maker' }),
    entity('sensor.office_temp', '21.4', {
      friendly_name: 'Office temp',
      unit_of_measurement: '°C',
      device_class: 'temperature',
      state_class: 'measurement',
    }),
    entity('binary_sensor.front_door', 'off', {
      friendly_name: 'Front door',
      device_class: 'door',
    }),
    entity('scene.movie_time', stamp, { friendly_name: 'Movie time' }),
    entity('camera.driveway', 'idle', { friendly_name: 'Driveway' }),
    entity('timer.laundry', 'active', {
      friendly_name: 'Laundry',
      duration: '0:45:00',
      remaining: '0:32:10',
      finishes_at: new Date(now.getTime() + 1930000).toISOString(),
    }),
    entity('fan.bedroom', 'unavailable', { friendly_name: 'Bedroom fan' }),
    entity('lock.back_door', 'locked', { friendly_name: 'Back door' }),
    entity('climate.living_room', 'heat', {
      friendly_name: 'Living room',
      current_temperature: 20.5,
      temperature: 22,
      hvac_modes: ['off', 'heat'],
      min_temp: 7,
      max_temp: 30,
      supported_features: 1,
    }),
    entity('media_player.living_room', 'playing', {
      friendly_name: 'Living room',
      media_title: 'Midnight City',
      media_artist: 'M83',
      volume_level: 0.4,
      media_duration: 243,
      media_position: 81,
      media_position_updated_at: stamp,
      supported_features: 152463,
    }),
  ];
}

function buildConfig(haUrl) {
  return {
    homeAssistant: { url: haUrl, token: TOKEN, authMethod: 'token' },
    alwaysOnTop: true,
    frostedGlass: true,
    opacity: 0.95,
    windowSize: { width: 500, height: 760 },
    primaryCards: ['weather', 'time'],
    primaryMediaPlayer: 'media_player.living_room',
    selectedWeatherEntity: 'weather.home',
    customTabs: [
      {
        id: 'default',
        name: 'Home',
        entityIds: [
          'light.desk_lamp',
          'light.shelf_leds',
          'switch.coffee_maker',
          'sensor.office_temp',
          'binary_sensor.front_door',
          'scene.movie_time',
          'camera.driveway',
          'timer.laundry',
          'fan.bedroom',
          'lock.back_door',
          'climate.living_room',
        ],
      },
      {
        id: 'bedroom',
        name: 'Bedroom',
        entityIds: ['light.shelf_leds', 'fan.bedroom', 'binary_sensor.front_door'],
      },
    ],
    activeTabId: 'default',
    globalHotkeys: { enabled: false, hotkeys: {} },
    entityAlerts: { enabled: false, alerts: {} },
    updates: { allowPrerelease: false },
    ui: {
      theme: 'dark',
      accent: 'original',
      background: 'original',
      language: 'en',
      density: 'comfortable',
      activeTileGlow: true,
    },
  };
}

module.exports = { TOKEN, buildConfig, buildStates };
