/**
 * The dashboard every visual snapshot shows. The Home page has one of each tile state the main
 * view draws (on, off, sensor, door, scene, camera, running timer, unavailable, heating climate),
 * plus weather and a playing media player. The other pages hold what the later scenes open: a
 * lock and a switch, media tiles, helpers and an alarm panel.
 *
 * Home is nine tiles, three rows, on purpose: with the weather and clock cards and the media
 * player it fits a 500x660 window without scrolling, so a whole page shows on the 1024x768
 * Windows runners (taskbar included).
 */

const TOKEN = 'visual-snapshot-token';

// Where the main window opens. The default (100, 100) puts a 660px window under the taskbar on a
// 768px display; y=20 keeps all of it on screen. Pins are placed by the app, off to the side.
const WINDOW_SIZE = { width: 500, height: 660 };
const WINDOW_POSITION = { x: 100, y: 20 };

// The page tabs the scenes switch between. Each scene names the set it wants.
const HOME_ENTITIES = [
  'light.desk_lamp',
  'light.shelf_leds',
  'sensor.office_temp',
  'binary_sensor.front_door',
  'scene.movie_time',
  'camera.driveway',
  'timer.laundry',
  'fan.bedroom',
  'climate.living_room',
];
// The entities the pin scenes pin. Only Quick Access entities can be pinned, so they sit on a page
// of their own; scenes that pin one of them bring this page set.
const PIN_ENTITIES = [
  'light.desk_lamp',
  'light.shelf_leds',
  'light.upstairs_hallway_ceiling',
  'climate.living_room',
  'climate.bedroom',
  'fan.office',
  'cover.garage_door',
  'media_player.kitchen_speaker',
  'media_player.bathroom_radio',
  'media_player.hall_chime',
  'sensor.office_temp',
  'sensor.grid_power',
  'binary_sensor.front_door',
  'input_number.thermostat_offset',
  'input_select.house_mode',
  'weather.home',
  'camera.driveway',
  'scene.movie_time',
  'script.goodnight',
  'lock.back_door',
  'switch.coffee_maker',
  'timer.laundry',
  'vacuum.robot',
  'automation.morning_routine',
  'person.alex',
];
const PAGE_SETS = {
  // Every desktop pin family, for the scenes that pin one. A second page keeps the tab strip, which
  // the runner waits for after it changes the pages.
  pins: [
    { id: 'pins', name: 'Pins', entityIds: PIN_ENTITIES },
    { id: 'default', name: 'Home', entityIds: HOME_ENTITIES },
  ],
  // What the app opens with.
  default: [
    { id: 'default', name: 'Home', entityIds: HOME_ENTITIES },
    {
      id: 'bedroom',
      name: 'Bedroom',
      entityIds: [
        'light.shelf_leds',
        'fan.bedroom',
        'binary_sensor.front_door',
        'lock.back_door',
        'switch.coffee_maker',
      ],
    },
  ],
  // Enough pages that the tab strip overflows a 500px window. The last one holds the helpers.
  six: [
    { id: 'default', name: 'Home', entityIds: HOME_ENTITIES },
    { id: 'bedroom', name: 'Bedroom', entityIds: ['light.shelf_leds', 'fan.bedroom'] },
    { id: 'kitchen', name: 'Kitchen', entityIds: ['switch.coffee_maker', 'timer.laundry'] },
    { id: 'garage', name: 'Garage', entityIds: ['binary_sensor.front_door', 'lock.back_door'] },
    {
      id: 'media',
      name: 'Media',
      entityIds: ['media_player.kitchen_speaker', 'media_player.bedroom_tv', 'light.desk_lamp'],
    },
    {
      id: 'devices',
      name: 'Devices',
      entityIds: [
        'input_number.thermostat_offset',
        'alarm_control_panel.home_alarm',
        'lock.back_door',
        'switch.coffee_maker',
      ],
    },
  ],
};

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
  const states = [
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
    // Media tiles on the Media page: one paused, one with a title and artist too long for the tile.
    entity('media_player.kitchen_speaker', 'paused', {
      friendly_name: 'Kitchen speaker',
      media_title: 'Weightless',
      media_artist: 'Marconi Union',
      volume_level: 0.25,
      media_duration: 480,
      media_position: 120,
      media_position_updated_at: stamp,
      supported_features: 152463,
    }),
    entity('media_player.bedroom_tv', 'playing', {
      friendly_name: 'Bedroom TV',
      media_title:
        "The Quick Brown Fox Jumps Over the Lazy Dog - Extended Director's Cut Special Edition",
      media_artist: 'Some Very Long Artist Name feat. Another Very Long Collaborator Name',
      app_name: 'Netflix',
      volume_level: 0.6,
      media_duration: 5400,
      media_position: 1300,
      media_position_updated_at: stamp,
      supported_features: 152463,
    }),
    // Helpers and an alarm panel, for the dialogs they open. The alarm is armed so the command
    // palette offers "Disarm", which asks for the code.
    entity('input_number.thermostat_offset', '1.5', {
      friendly_name: 'Thermostat offset',
      min: -5,
      max: 5,
      step: 0.5,
      mode: 'slider',
      unit_of_measurement: '°C',
    }),
    entity('alarm_control_panel.home_alarm', 'armed_home', {
      friendly_name: 'Home alarm',
      code_format: 'number',
      code_arm_required: true,
      changed_by: null,
      supported_features: 63,
    }),
  ];
  // One of each desktop pin family the Home page does not already have, plus the long names and
  // labels that strain a 168x148 pin. They are not on any page; the pin scenes pin them directly.
  states.push(
    entity('light.upstairs_hallway_ceiling', 'on', {
      friendly_name: 'Upstairs hallway ceiling light',
      brightness: 153,
      supported_color_modes: ['brightness'],
      color_mode: 'brightness',
    }),
    entity('climate.bedroom', 'cool', {
      friendly_name: 'Bedroom',
      current_temperature: 23.5,
      temperature: 21,
      hvac_modes: ['off', 'heat', 'cool', 'auto'],
      min_temp: 7,
      max_temp: 30,
      supported_features: 1,
    }),
    entity('fan.office', 'on', {
      friendly_name: 'Office fan',
      percentage: 66,
      supported_features: 1,
    }),
    entity('cover.garage_door', 'open', {
      friendly_name: 'Garage door',
      current_position: 40,
      supported_features: 15,
    }),
    // Play and pause only (no previous or next), and a player that only plays.
    entity('media_player.bathroom_radio', 'paused', {
      friendly_name: 'Bathroom radio',
      media_title: 'Morning news',
      supported_features: 16385,
    }),
    entity('media_player.hall_chime', 'idle', {
      friendly_name: 'Hall chime',
      supported_features: 16384,
    }),
    entity('sensor.grid_power', '1234.5678901', {
      friendly_name: 'Grid power',
      unit_of_measurement: 'W',
      device_class: 'power',
      state_class: 'measurement',
    }),
    entity('input_select.house_mode', 'Away', {
      friendly_name: 'House mode',
      options: ['Home', 'Away', 'Guests', 'Vacation'],
    }),
    entity('vacuum.robot', 'docked', { friendly_name: 'Robot vacuum', supported_features: 12316 }),
    entity('script.goodnight', 'off', { friendly_name: 'Goodnight' }),
    entity('automation.morning_routine', 'on', { friendly_name: 'Morning routine' }),
    entity('person.alex', 'home', { friendly_name: 'Alex' })
  );
  // Enough other entities that the Manage Quick Access list runs past its 50-row page.
  for (let index = 1; index <= 40; index += 1) {
    const number = String(index).padStart(2, '0');
    states.push(
      entity(`sensor.battery_${number}`, String(20 + ((index * 7) % 80)), {
        friendly_name: `Battery ${number}`,
        unit_of_measurement: '%',
        device_class: 'battery',
        state_class: 'measurement',
      })
    );
  }
  return states;
}

/** The services the fixture's domains offer, as get_services reports them. */
function buildServices() {
  const domain = (...names) =>
    Object.fromEntries(names.map((name) => [name, { name, description: '', fields: {} }]));
  return {
    light: domain('turn_on', 'turn_off', 'toggle'),
    switch: domain('turn_on', 'turn_off', 'toggle'),
    fan: domain('turn_on', 'turn_off', 'toggle', 'set_percentage'),
    lock: domain('lock', 'unlock', 'open'),
    climate: domain('set_temperature', 'set_hvac_mode', 'turn_on', 'turn_off'),
    media_player: domain('media_play', 'media_pause', 'media_play_pause', 'volume_set'),
    alarm_control_panel: domain(
      'alarm_disarm',
      'alarm_arm_home',
      'alarm_arm_away',
      'alarm_arm_night',
      'alarm_arm_custom_bypass',
      'alarm_arm_vacation'
    ),
    input_number: domain('set_value', 'increment', 'decrement'),
    scene: domain('turn_on'),
    timer: domain('start', 'pause', 'cancel', 'finish'),
  };
}

function buildConfig(haUrl) {
  return {
    homeAssistant: { url: haUrl, token: TOKEN, authMethod: 'token' },
    alwaysOnTop: true,
    frostedGlass: true,
    opacity: 0.95,
    windowSize: { ...WINDOW_SIZE },
    windowPosition: { ...WINDOW_POSITION },
    primaryCards: ['weather', 'time'],
    primaryMediaPlayer: 'media_player.living_room',
    selectedWeatherEntity: 'weather.home',
    customTabs: PAGE_SETS.default,
    activeTabId: 'default',
    omarchyThemeDefaultApplied: true,
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
      // On by default, taking the theme from an installed Omarchy (so a developer's machine
      // would not show the light theme); omarchyThemeDefaultApplied below makes the app keep it off.
      followOmarchy: false,
      // Seasonal themes follow the calendar; off so the screenshots do not change with the date.
      seasonal: { enabled: false },
    },
  };
}

module.exports = {
  PAGE_SETS,
  TOKEN,
  WINDOW_POSITION,
  WINDOW_SIZE,
  buildConfig,
  buildServices,
  buildStates,
};
