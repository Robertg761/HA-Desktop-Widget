// The demo home the commercial shows: states, services, a reactive service handler, and the
// camera / artwork images the app fetches from Home Assistant.
const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '..', 'assets');
const CAM_FRAMES = Array.from({ length: 60 }, (_, i) =>
  fs.readFileSync(path.join(ASSETS, 'cam', `${String(i).padStart(2, '0')}.jpg`))
);
const ALBUM = fs.readFileSync(path.join(ASSETS, 'album.jpg'));

function stateBuilder(now) {
  const stamp = now.toISOString();
  return (entityId, state, attributes = {}) => ({
    entity_id: entityId,
    state,
    attributes,
    last_changed: stamp,
    last_updated: stamp,
    context: { id: entityId, parent_id: null, user_id: null },
  });
}

function buildStates(now = new Date()) {
  const e = stateBuilder(now);
  const stamp = now.toISOString();
  const dimmable = { supported_color_modes: ['brightness'], color_mode: 'brightness' };
  const colour = {
    supported_color_modes: ['color_temp', 'hs'],
    min_color_temp_kelvin: 2000,
    max_color_temp_kelvin: 6500,
  };
  return [
    e('weather.home', 'partlycloudy', {
      friendly_name: 'Home',
      temperature: 18,
      temperature_unit: '°C',
      humidity: 62,
      wind_speed: 9,
      wind_speed_unit: 'km/h',
    }),
    e('light.living_room', 'on', {
      friendly_name: 'Living room',
      brightness: 204,
      ...colour,
      color_mode: 'color_temp',
      color_temp_kelvin: 2900,
    }),
    e('light.kitchen', 'off', { friendly_name: 'Kitchen', ...dimmable, color_mode: null }),
    e('light.bedside', 'off', { friendly_name: 'Bedside lamp', ...dimmable, color_mode: null }),
    e('light.porch', 'off', { friendly_name: 'Porch light', ...dimmable, color_mode: null }),
    e('light.office', 'on', { friendly_name: 'Office', brightness: 166, ...dimmable }),
    e('light.accent_strip', 'on', {
      friendly_name: 'Accent strip',
      brightness: 150,
      supported_color_modes: ['color_temp', 'rgb'],
      color_mode: 'rgb',
      rgb_color: [120, 140, 255],
      min_color_temp_kelvin: 2000,
      max_color_temp_kelvin: 6500,
    }),
    e('climate.thermostat', 'heat', {
      friendly_name: 'Thermostat',
      current_temperature: 20.5,
      temperature: 21.5,
      hvac_action: 'heating',
      hvac_modes: ['off', 'heat', 'cool', 'auto'],
      min_temp: 7,
      max_temp: 30,
      target_temp_step: 0.5,
      supported_features: 1,
    }),
    e('lock.front_door', 'locked', { friendly_name: 'Front door' }),
    e('lock.back_door', 'locked', { friendly_name: 'Back door' }),
    e('cover.garage_door', 'closed', {
      friendly_name: 'Garage',
      device_class: 'garage',
      current_position: 0,
      supported_features: 15,
    }),
    e('cover.blinds', 'open', {
      friendly_name: 'Blinds',
      device_class: 'blind',
      current_position: 100,
      supported_features: 15,
    }),
    e('scene.movie_night', stamp, { friendly_name: 'Movie night' }),
    e('scene.good_morning', stamp, { friendly_name: 'Good morning' }),
    e('camera.porch', 'idle', { friendly_name: 'Porch' }),
    e('sensor.energy', '1.42', {
      friendly_name: 'Energy now',
      unit_of_measurement: 'kW',
      device_class: 'power',
      state_class: 'measurement',
    }),
    e('sensor.office_temp', '21.4', {
      friendly_name: 'Office',
      unit_of_measurement: '°C',
      device_class: 'temperature',
      state_class: 'measurement',
    }),
    e('sensor.outdoor_temp', '18.2', {
      friendly_name: 'Outdoor',
      unit_of_measurement: '°C',
      device_class: 'temperature',
      state_class: 'measurement',
    }),
    e('sensor.bedroom_temp', '19.6', {
      friendly_name: 'Bedroom',
      unit_of_measurement: '°C',
      device_class: 'temperature',
      state_class: 'measurement',
    }),
    e('vacuum.robot', 'docked', { friendly_name: 'Robot vacuum', supported_features: 12316 }),
    e('fan.bedroom', 'off', {
      friendly_name: 'Ceiling fan',
      percentage: 0,
      percentage_step: 33.3,
      supported_features: 1,
    }),
    e('switch.coffee_maker', 'off', { friendly_name: 'Coffee maker' }),
    e('binary_sensor.back_window', 'off', { friendly_name: 'Back window', device_class: 'window' }),
    e('person.sam', 'home', { friendly_name: 'Sam' }),
    e('timer.laundry', 'active', {
      friendly_name: 'Laundry',
      duration: '0:45:00',
      remaining: '0:18:40',
      finishes_at: new Date(now.getTime() + 1120000).toISOString(),
    }),
    e('alarm_control_panel.home', 'armed_away', {
      friendly_name: 'Home alarm',
      code_format: 'number',
      code_arm_required: false,
      supported_features: 63,
    }),
    e('media_player.living_room', 'playing', {
      friendly_name: 'Living room',
      media_title: 'Afterglow',
      media_artist: 'Nova Lane',
      entity_picture: '/api/media_player_proxy/media_player.living_room?token=art',
      volume_level: 0.42,
      media_duration: 236,
      media_position: 71,
      media_position_updated_at: stamp,
      supported_features: 152463,
    }),
    e('input_select.house_mode', 'Home', {
      friendly_name: 'House mode',
      options: ['Home', 'Away', 'Night', 'Guests'],
    }),
  ];
}

const GRAPH = {
  'sensor.office_temp': { base: 21.2, swing: 0.9 },
  'sensor.outdoor_temp': { base: 15, swing: 4.5 },
  'sensor.bedroom_temp': { base: 19.5, swing: 1.4 },
  'sensor.energy': { base: 1.1, swing: 0.7 },
};

function buildHistories(now = new Date()) {
  return (entityId, message) => {
    const g = GRAPH[entityId];
    if (!g) return [];
    const rows = [];
    // Relative to the request's own window, whatever clock the app asked with.
    const end = message?.end_time ? new Date(message.end_time).getTime() - 60000 : now.getTime();
    for (let step = 96; step >= 0; step -= 1) {
      const at = end - step * 15 * 60000;
      const p = (step / 96) * Math.PI * 2;
      const v = g.base + Math.sin(p + 1.3) * g.swing + Math.sin(p * 3.1) * g.swing * 0.18;
      rows.push({ s: v.toFixed(2), lu: at / 1000 });
    }
    return rows;
  };
}

function buildServices() {
  const domain = (...names) =>
    Object.fromEntries(names.map((name) => [name, { name, description: '', fields: {} }]));
  return {
    light: domain('turn_on', 'turn_off', 'toggle'),
    switch: domain('turn_on', 'turn_off', 'toggle'),
    fan: domain('turn_on', 'turn_off', 'toggle', 'set_percentage'),
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
    alarm_control_panel: domain('alarm_disarm', 'alarm_arm_home', 'alarm_arm_away', 'alarm_arm_night'),
    cover: domain('open_cover', 'close_cover', 'stop_cover', 'set_cover_position', 'toggle'),
    input_select: domain('select_option'),
    vacuum: domain('start', 'pause', 'stop', 'return_to_base'),
    scene: domain('turn_on'),
    script: domain('turn_on'),
    timer: domain('start', 'pause', 'cancel'),
  };
}

/** What Home Assistant would do: return the new states for a service call. */
function onServiceCall(message, states) {
  const { domain, service } = message;
  const data = { ...(message.service_data || {}), ...(message.target || {}) };
  const ids = [data.entity_id].flat().filter(Boolean);
  const get = (id) => states.find((s) => s.entity_id === id);
  const now = new Date().toISOString();
  const next = (s, state, attrs = {}) => ({
    ...s,
    state,
    attributes: { ...s.attributes, ...attrs },
    last_changed: s.state === state ? s.last_changed : now,
    last_updated: now,
  });
  const out = [];
  if (domain === 'scene' && ids.includes('scene.movie_night')) {
    const lr = get('light.living_room');
    const k = get('light.kitchen');
    const strip = get('light.accent_strip');
    const blinds = get('cover.blinds');
    if (lr) out.push(next(lr, 'on', { brightness: 46, color_temp_kelvin: 2400, color_mode: 'color_temp' }));
    if (k) out.push(next(k, 'off', { brightness: null, color_mode: null }));
    if (strip) out.push(next(strip, 'on', { brightness: 120, rgb_color: [150, 90, 255], color_mode: 'rgb' }));
    if (blinds) out.push(next(blinds, 'closed', { current_position: 0 }));
    const sc = get('scene.movie_night');
    if (sc) out.push(next(sc, now));
    return { add: out };
  }
  for (const id of ids) {
    const s = get(id);
    if (!s) continue;
    const on = s.state === 'on';
    switch (`${domain}.${service}`) {
      case 'light.toggle':
      case 'switch.toggle':
      case 'fan.toggle':
        if (on) out.push(next(s, 'off', domain === 'light' ? { brightness: null, color_mode: null } : { percentage: 0 }));
        else
          out.push(
            next(
              s,
              'on',
              domain === 'light'
                ? { brightness: s.attributes._last_brightness || 204, color_mode: s.attributes.supported_color_modes?.[0] === 'color_temp' ? 'color_temp' : 'brightness' }
                : domain === 'fan'
                  ? { percentage: 66 }
                  : {}
            )
          );
        break;
      case 'light.turn_on':
      case 'switch.turn_on':
      case 'fan.turn_on': {
        const attrs = {};
        if (data.brightness != null) attrs.brightness = data.brightness;
        if (data.brightness_pct != null) attrs.brightness = Math.round((data.brightness_pct / 100) * 255);
        if (data.color_temp_kelvin != null) Object.assign(attrs, { color_temp_kelvin: data.color_temp_kelvin, color_mode: 'color_temp' });
        if (data.rgb_color) Object.assign(attrs, { rgb_color: data.rgb_color, color_mode: 'rgb' });
        if (data.hs_color) Object.assign(attrs, { hs_color: data.hs_color, color_mode: 'hs' });
        if (domain === 'light' && attrs.brightness == null && !on) attrs.brightness = 204;
        if (domain === 'light' && !attrs.color_mode && !s.attributes.color_mode) attrs.color_mode = 'brightness';
        if (data.percentage != null) attrs.percentage = data.percentage;
        out.push(next(s, 'on', attrs));
        break;
      }
      case 'light.turn_off':
      case 'switch.turn_off':
      case 'fan.turn_off':
        out.push(next(s, 'off', domain === 'light' ? { brightness: null, color_mode: null } : {}));
        break;
      case 'fan.set_percentage':
        out.push(next(s, data.percentage > 0 ? 'on' : 'off', { percentage: data.percentage }));
        break;
      case 'lock.lock':
        out.push(next(s, 'locked'));
        break;
      case 'lock.unlock':
      case 'lock.open':
        out.push(next(s, 'unlocked'));
        break;
      case 'cover.open_cover':
        out.push(next(s, 'open', { current_position: 100 }));
        break;
      case 'cover.close_cover':
        out.push(next(s, 'closed', { current_position: 0 }));
        break;
      case 'cover.toggle':
        out.push(s.state === 'closed' ? next(s, 'open', { current_position: 100 }) : next(s, 'closed', { current_position: 0 }));
        break;
      case 'cover.set_cover_position':
        out.push(next(s, data.position > 0 ? 'open' : 'closed', { current_position: data.position }));
        break;
      case 'climate.set_temperature':
        out.push(next(s, s.state, { temperature: data.temperature }));
        break;
      case 'climate.set_hvac_mode':
        out.push(next(s, data.hvac_mode, { hvac_action: data.hvac_mode === 'off' ? 'off' : 'heating' }));
        break;
      case 'media_player.media_play_pause':
        out.push(next(s, s.state === 'playing' ? 'paused' : 'playing', { media_position_updated_at: now }));
        break;
      case 'media_player.media_pause':
        out.push(next(s, 'paused', { media_position_updated_at: now }));
        break;
      case 'media_player.media_play':
        out.push(next(s, 'playing', { media_position_updated_at: now }));
        break;
      case 'media_player.volume_set':
        out.push(next(s, s.state, { volume_level: data.volume_level }));
        break;
      case 'alarm_control_panel.alarm_disarm':
        out.push(next(s, 'disarmed'));
        break;
      case 'alarm_control_panel.alarm_arm_home':
        out.push(next(s, 'armed_home'));
        break;
      case 'alarm_control_panel.alarm_arm_away':
        out.push(next(s, 'armed_away'));
        break;
      case 'alarm_control_panel.alarm_arm_night':
        out.push(next(s, 'armed_night'));
        break;
      case 'vacuum.start':
        out.push(next(s, 'cleaning'));
        break;
      case 'vacuum.return_to_base':
      case 'vacuum.stop':
        out.push(next(s, 'returning'));
        break;
      case 'input_select.select_option':
        out.push(next(s, data.option));
        break;
      default:
        break;
    }
  }
  return out.length ? { add: out } : null;
}

let camCounter = 0;
function httpRoute(request, response) {
  const url = request.url || '';
  if (url.startsWith('/api/camera_proxy_stream/')) {
    // Chromium shows a multipart part once the next boundary arrives, so frames go out every
    // second. A capture runs about 15x slower than real time, so the on-picture clock advances
    // one second per 15 s of real time: about once per second of finished video.
    const boundary = 'frame';
    response.writeHead(200, { 'content-type': `multipart/x-mixed-replace; boundary=${boundary}` });
    const started = Date.now();
    const push = () => {
      const i = Math.floor((Date.now() - started) / 15000) + 1;
      const jpg = CAM_FRAMES[i % CAM_FRAMES.length];
      response.write(`--${boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpg.length}\r\n\r\n`);
      response.write(jpg);
      response.write('\r\n');
    };
    push();
    push();
    const timer = setInterval(push, 1000);
    request.on('close', () => clearInterval(timer));
    return true;
  }
  if (url.startsWith('/api/camera_proxy/')) {
    const jpg = CAM_FRAMES[camCounter++ % CAM_FRAMES.length];
    response.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': jpg.length });
    response.end(jpg);
    return true;
  }
  if (url.startsWith('/api/media_player_proxy/')) {
    response.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': ALBUM.length });
    response.end(ALBUM);
    return true;
  }
  return false;
}

const PAGES = {
  home: {
    id: 'default',
    name: 'Home',
    entityIds: [
      'light.living_room',
      'light.kitchen',
      'climate.thermostat',
      'lock.front_door',
      'cover.garage_door',
      'scene.movie_night',
      'sensor.energy',
      'vacuum.robot',
      'person.sam',
    ],
  },
  bedroom: {
    id: 'bedroom',
    name: 'Bedroom',
    entityIds: [
      'light.bedside',
      'fan.bedroom',
      'cover.blinds',
      'sensor.bedroom_temp',
      'light.accent_strip',
      'timer.laundry',
    ],
  },
  security: {
    id: 'security',
    name: 'Security',
    entityIds: ['camera.porch', 'alarm_control_panel.home', 'lock.back_door', 'light.porch', 'binary_sensor.back_window'],
  },
  office: {
    id: 'office',
    name: 'Office',
    entityIds: ['light.office', 'sensor.office_temp', 'switch.coffee_maker', 'sensor.outdoor_temp'],
  },
};

function buildConfig(overrides = {}) {
  const ui = {
    theme: 'dark',
    accent: 'original',
    background: 'original',
    language: 'en',
    density: 'comfortable',
    scale: 1,
    highContrast: false,
    opaquePanels: false,
    dateFormat: 'weekday-short',
    timeFormat: '12h',
    activeTileGlow: true,
    customColors: [],
    followOmarchy: false,
    weatherEffectsEnabled: false,
    seasonal: { enabled: false },
    ...(overrides.ui || {}),
  };
  return {
    alwaysOnTop: true,
    frostedGlass: true,
    opacity: 0.95,
    windowSize: { width: 500, height: 660 },
    windowPosition: { x: 40, y: 40 },
    primaryCards: ['weather', 'time'],
    primaryMediaPlayer: 'media_player.living_room',
    selectedWeatherEntity: 'weather.home',
    customTabs: [PAGES.home, PAGES.bedroom, PAGES.security, PAGES.office],
    activeTabId: 'default',
    comparisonGraphs: [],
    quickAccessTileOptions: { 'camera.porch': { cameraPreviewRefresh: '30s' } },
    tileSpans: {},
    omarchyThemeDefaultApplied: true,
    globalHotkeys: { enabled: false, hotkeys: {} },
    entityAlerts: { enabled: false, alerts: {} },
    updates: { allowPrerelease: false },
    ...overrides,
    ui,
  };
}

function mock(now = new Date()) {
  return {
    states: buildStates(now),
    services: buildServices(),
    histories: buildHistories(now),
    onServiceCall,
    httpRoute,
  };
}

module.exports = { buildStates, buildConfig, mock, PAGES, onServiceCall };
