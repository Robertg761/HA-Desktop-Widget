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

// The settings a scene may change and the runner puts back afterwards (see run.cjs). A scene that
// changes any other setting leaves it changed for every scene after it.
const RESETTABLE_SETTINGS = [
  'frostedGlass',
  'customTabs',
  'activeTabId',
  'entityAlerts',
  'primaryCards',
  'primaryMediaPlayer',
  'globalHotkeys',
  'comparisonGraphs',
  'quickAccessTileOptions',
];

// Settings reopens on the page and scroll position it was closed on, so a scene that opens it
// without choosing a page would photograph whichever page the scene before it ended on. The runner
// evaluates this after every scene to put it back on its first page at the top. It has to run while
// Settings is still open, because a closed dialog has no layout and ignores a scroll position set
// on it. It goes through the tab button, which is what the app itself listens to, but only when
// another page is showing: the click replays the page's entrance animation, and most scenes never
// open Settings at all. The scroll is set either way, as the click is skipped on General.
const RESET_SETTINGS_VIEW = `(() => {
  const general = document.querySelector('#settings-modal .tab-link[data-tab="general"]');
  if (general && !general.classList.contains('active')) general.click();
  const body = document.querySelector('#settings-modal .modal-body');
  if (body) body.scrollTop = 0;
})()`;

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
        'light.colour_strip',
      ],
    },
  ],
  // A comparison graph and a camera with a picture, the tiles that carry a label in the corner
  // the edit buttons use. The graph and the camera's preview are set in the scene's config.
  graph: [
    {
      id: 'default',
      name: 'Home',
      entityIds: ['graph:temps', 'camera.driveway', 'light.desk_lamp', 'sensor.office_temp'],
    },
    { id: 'bedroom', name: 'Bedroom', entityIds: ['light.shelf_leds', 'fan.bedroom'] },
  ],
  // Three pages: the point where the strip first has no room to spare beside the edit buttons.
  three: [
    { id: 'default', name: 'Home', entityIds: HOME_ENTITIES },
    { id: 'bedroom', name: 'Bedroom', entityIds: ['light.shelf_leds', 'fan.bedroom'] },
    { id: 'kitchen', name: 'Kitchen', entityIds: ['switch.coffee_maker', 'timer.laundry'] },
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
  // One tile for each dialog the other pages do not open: the helpers, a vacuum, a to-do list and a
  // calendar, plus a favourite Home Assistant no longer has, which opens the repair picker.
  dialogs: [
    {
      id: 'default',
      name: 'Home',
      entityIds: [
        'input_select.house_mode',
        'vacuum.robot',
        'todo.shopping',
        'calendar.family',
        'light.old_kitchen',
        'media_player.living_room',
        'light.color_strip',
        'fan.office',
        'cover.garage',
        'media_player.den_stereo',
      ],
    },
    // The tab strip only exists with two pages, and the runner waits for it.
    { id: 'spare', name: 'Spare', entityIds: ['light.desk_lamp'] },
  ],
};

// Names and readings that strain a tile, a dialog title or a row: what Home Assistant's own
// generated names, an unbroken German compound and a long-running film do to the layout. The edge
// scenes show this page; the entities are listed here so the fixture test can see them.
const EDGE_ENTITIES = [
  'light.hallway_ceiling_long',
  'sensor.energy_total',
  'switch.compound_name',
  'sensor.long_named_temperature',
  'climate.heat_pump',
  'cover.patio_awning_long',
];
PAGE_SETS.edge = [
  { id: 'default', name: 'Home', entityIds: EDGE_ENTITIES },
  { id: 'spare', name: 'Spare', entityIds: ['light.desk_lamp'] },
];

// Twelve pages with German names, two of them long enough to be cut short on the strip.
const GERMAN_PAGE_NAMES = [
  'Wohnzimmer',
  'Schlafzimmer',
  'Küche',
  'Arbeitszimmer',
  'Badezimmer',
  'Kinderzimmer Obergeschoss',
  'Gästezimmer',
  'Heizungskeller',
  'Terrasse',
  'Waschküche',
  'Garage',
  'Donaudampfschifffahrtsgesellschaft',
];
PAGE_SETS.twelve = GERMAN_PAGE_NAMES.map((name, index) => ({
  id: index === 0 ? 'default' : `page-${index + 1}`,
  name,
  entityIds: index === 0 ? HOME_ENTITIES : ['light.shelf_leds', 'switch.coffee_maker'],
}));

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
    // The one light with colour controls: a colour temperature slider and colour swatches.
    entity('light.colour_strip', 'on', {
      friendly_name: 'Colour strip',
      brightness: 153,
      supported_color_modes: ['color_temp', 'hs'],
      color_mode: 'color_temp',
      color_temp_kelvin: 3200,
      min_color_temp_kelvin: 2000,
      max_color_temp_kelvin: 6500,
    }),
    entity('switch.coffee_maker', 'off', { friendly_name: 'Coffee maker' }),
    // On no page. The mock server refuses every service call for it, so a scene that runs its
    // command from the command palette gets the "could not run command" error toast.
    entity('light.unreachable', 'on', { friendly_name: 'Unreachable lamp' }),
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
    // An RGB light that also dims its white, a fan with speeds and presets, and a garage door
    // with a position: the pop-ups with a slider and a row of chips.
    entity('light.color_strip', 'on', {
      friendly_name: 'Colour strip',
      brightness: 180,
      supported_color_modes: ['color_temp', 'rgb'],
      color_mode: 'color_temp',
      color_temp_kelvin: 3200,
      min_color_temp_kelvin: 2000,
      max_color_temp_kelvin: 6500,
      rgb_color: [255, 180, 100],
    }),
    entity('fan.office', 'on', {
      friendly_name: 'Office fan',
      percentage: 66,
      percentage_step: 33.3,
      preset_modes: ['auto', 'sleep'],
      preset_mode: null,
      supported_features: 9,
    }),
    // A player that can seek, skip tracks and mute: every button of the media pop-up.
    entity('media_player.den_stereo', 'playing', {
      friendly_name: 'Den stereo',
      media_title: 'Kind of Blue',
      media_artist: 'Miles Davis',
      volume_level: 0.4,
      is_volume_muted: false,
      media_duration: 540,
      media_position: 120,
      media_position_updated_at: stamp,
      supported_features: 152511,
    }),
    entity('cover.garage', 'open', {
      friendly_name: 'Garage door',
      current_position: 70,
      device_class: 'garage',
      supported_features: 15,
    }),
    entity('input_select.house_mode', 'Home', {
      friendly_name: 'House mode',
      options: ['Home', 'Away', 'Night', 'Guests'],
    }),
    // Start, pause, stop and return to base (HA's VacuumEntityFeature bits 8192, 4, 8 and 16).
    entity('vacuum.robot', 'docked', {
      friendly_name: 'Robot vacuum',
      supported_features: 8220,
    }),
    // Create and update items (TodoListEntityFeature bits 1 and 4).
    entity('todo.shopping', '3', { friendly_name: 'Shopping list', supported_features: 5 }),
    // On no page: a list long enough to scroll in a dialog, for the scene that holds the add field.
    entity('todo.errands', '10', { friendly_name: 'Errands', supported_features: 5 }),
    entity('calendar.family', 'off', {
      friendly_name: 'Family calendar',
      message: 'Dentist',
      start_time: new Date(now.getTime() + 26 * 3600000).toISOString(),
      all_day: false,
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
  // The edge-case page: a 95-character light, a seven-figure energy reading, a name that is one
  // unbroken word, a 90-character sensor, a heat/cool thermostat with half-degree bounds, and a
  // cover with an entity-id style name; plus a film that runs past an hour for the media card.
  states.push(
    entity('light.hallway_ceiling_long', 'on', {
      friendly_name:
        'Upstairs hallway ceiling light above the stairs next to the master bedroom door (dimmable, warm)',
      brightness: 153,
      supported_color_modes: ['brightness'],
      color_mode: 'brightness',
    }),
    entity('sensor.energy_total', '1234567890.12', {
      friendly_name: 'Energy total',
      unit_of_measurement: 'Wh',
      device_class: 'energy',
      state_class: 'total_increasing',
    }),
    entity('switch.compound_name', 'off', {
      friendly_name: 'Wohnzimmerdeckenbeleuchtungsschalterhinterdemgroßenfensterlinks',
    }),
    entity('sensor.long_named_temperature', '123456.79', {
      friendly_name:
        'Living room north wall temperature sensor behind the bookshelf next to the window frame',
      unit_of_measurement: 'W',
      device_class: 'power',
      state_class: 'measurement',
    }),
    entity('climate.heat_pump', 'heat_cool', {
      friendly_name: 'Heat pump',
      current_temperature: 21.5,
      target_temp_low: 19.5,
      target_temp_high: 24.5,
      target_temp_step: 0.5,
      hvac_modes: ['off', 'heat', 'cool', 'heat_cool', 'fan_only'],
      min_temp: 7,
      max_temp: 30,
      supported_features: 2,
    }),
    entity('cover.patio_awning_long', 'open', {
      friendly_name: 'sensor_living_room_north_wall_temperature_sensor_behind_bookshelf',
      current_position: 70,
      supported_features: 15,
    }),
    entity('media_player.theater', 'playing', {
      friendly_name: 'Theater',
      media_title: 'The Long Goodbye',
      media_artist: "Director's cut",
      volume_level: 0.5,
      media_duration: 6750,
      media_position: 4350,
      media_position_updated_at: stamp,
      supported_features: 152463,
    })
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
    fan: domain('turn_on', 'turn_off', 'toggle', 'set_percentage', 'set_preset_mode'),
    lock: domain('lock', 'unlock', 'open'),
    climate: domain('set_temperature', 'set_hvac_mode', 'turn_on', 'turn_off'),
    media_player: domain(
      'media_play',
      'media_pause',
      'media_play_pause',
      'media_previous_track',
      'media_next_track',
      'media_seek',
      'volume_set',
      'volume_mute'
    ),
    alarm_control_panel: domain(
      'alarm_disarm',
      'alarm_arm_home',
      'alarm_arm_away',
      'alarm_arm_night',
      'alarm_arm_custom_bypass',
      'alarm_arm_vacation'
    ),
    input_number: domain('set_value', 'increment', 'decrement'),
    cover: domain('open_cover', 'close_cover', 'stop_cover', 'set_cover_position'),
    input_select: domain('select_option'),
    vacuum: domain('start', 'pause', 'stop', 'return_to_base'),
    todo: domain('add_item', 'update_item', 'get_items'),
    calendar: domain('get_events'),
    scene: domain('turn_on'),
    timer: domain('start', 'pause', 'cancel', 'finish'),
  };
}

/**
 * What the services that return data answer, keyed `domain.service`: the shopping list's items
 * and the family calendar's events for the next week.
 */
function buildServiceResponses(now = new Date()) {
  const at = (hours) => new Date(now.getTime() + hours * 3600000).toISOString();
  const shopping = [
    { uid: 'milk', summary: 'Oat milk', status: 'needs_action' },
    { uid: 'bread', summary: 'Sourdough bread', status: 'needs_action' },
    { uid: 'coffee', summary: 'Coffee beans', status: 'needs_action' },
    { uid: 'soap', summary: 'Dish soap', status: 'completed' },
  ];
  const errands = [
    'Post the parcel',
    'Collect the dry cleaning',
    'Book the car in for a service',
    'Return the library books',
    'Pick up the prescription',
    'Renew the parking permit',
    'Buy a birthday card',
    'Drop the bottles at the recycling point',
    'Order the replacement filter',
    'Water the plants next door',
  ].map((summary, index) => ({
    uid: `errand-${index}`,
    summary,
    status: index === 3 ? 'completed' : 'needs_action',
  }));
  return {
    'todo.get_items': (message) => {
      const entityId = message.service_data?.entity_id || 'todo.shopping';
      return {
        [entityId]: {
          items: entityId === 'todo.errands' ? errands : shopping,
        },
      };
    },
    'calendar.get_events': (message) => ({
      [message.service_data?.entity_id || 'calendar.family']: {
        events: [
          { summary: 'Dentist', start: at(26), end: at(27), description: 'Bring the new forms.' },
          { summary: 'Parents evening', start: at(74), end: at(76) },
        ],
      },
    }),
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
    comparisonGraphs: [],
    quickAccessTileOptions: {},
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
      // Reset by every scene: the runner merges a scene's settings over the app's, so a scene that
      // enlarges the interface would otherwise leave it enlarged for the ones after it.
      scale: 1,
      // The Readable preset is the same: its scenes come before the pins, the layout scenes and
      // the first-run wizard, which all rendered in it until each scene put these back.
      highContrast: false,
      opaquePanels: false,
      dateFormat: 'system',
      activeTileGlow: true,
      // Saved custom colours, which the scenes that show one bring and take away again.
      customColors: [],
      // On by default, taking the theme from an installed Omarchy (so a developer's machine
      // would not show the light theme); omarchyThemeDefaultApplied below makes the app keep it off.
      followOmarchy: false,
      // Seasonal themes follow the calendar; off so the screenshots do not change with the date.
      seasonal: { enabled: false },
    },
  };
}

// Entities whose service calls the mock Home Assistant answers with an error.
const FAILING_ENTITIES = ['light.unreachable'];

module.exports = {
  FAILING_ENTITIES,
  PAGE_SETS,
  RESET_SETTINGS_VIEW,
  RESETTABLE_SETTINGS,
  TOKEN,
  WINDOW_POSITION,
  WINDOW_SIZE,
  buildConfig,
  buildServiceResponses,
  buildServices,
  buildStates,
};
