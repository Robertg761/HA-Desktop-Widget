/**
 * Language coverage for the shared renderer helpers: entity states, timer labels, gauge labels,
 * theme names, weather icons, default page names and notification times all have to follow the
 * active language, and numbers have to use its decimal separator.
 */
const i18n = require('../../src/i18n.js');
const utils = require('../../src/utils.js');
const { formatGaugeBoundLabel } = require('../../src/sensor-gauge.js');
const { createWeatherIcon } = require('../../src/weather-icons.js');
const {
  normalizeQuickAccessConfig,
  addQuickAccessView,
} = require('../../src/quick-access-tabs.js');
const { formatRelativeTime } = require('../../src/notifications.js');
const uiUtils = require('../../src/ui-utils.js');
const trayEntities = require('../../src/tray-entities.cjs');
const { mountSensorHistoryDetail } = require('../../src/sensor-history-detail.js');

const GERMAN = {
  Detected: 'Erkannt',
  Clear: 'Frei',
  Ready: 'Bereit',
  On: 'An',
  Away: 'Abwesend',
  Unknown: 'Unbekannt',
  Unavailable: 'Nicht verfügbar',
  Idle: 'Inaktiv',
  Running: 'Läuft',
  Paused: 'Pausiert',
  Finished: 'Abgelaufen',
  'Domain: Binary Sensor': 'Binärsensor',
  'Domain: Light': 'Licht',
  Indigo: 'Indigo-Blau',
  'Focused and modern': 'Konzentriert und modern',
  'Saved custom color': 'Gespeicherte eigene Farbe',
  'Custom {{color}}': 'Eigene Farbe {{color}}',
  'Partly cloudy': 'Teilweise bewölkt',
  All: 'Alle',
  'View {{index}}': 'Ansicht {{index}}',
  'New View': 'Neue Ansicht',
  'just now': 'gerade eben',
};

function useGerman() {
  i18n.setLocaleBootstrap({ activeLocale: 'de', messages: GERMAN });
}

afterEach(() => {
  i18n.setLocaleBootstrap({ activeLocale: 'en', messages: {} });
});

describe('entity display state in the active language', () => {
  it('formats sensor values with the German decimal separator and keeps the unit', () => {
    useGerman();
    const sensor = {
      entity_id: 'sensor.outside',
      state: '15.6',
      attributes: { unit_of_measurement: '°C' },
    };
    // German writes the unit after a no-break space, so it never wraps onto its own line.
    expect(utils.getEntityDisplayState(sensor)).toBe('15,6\u00a0°C');
    // Temperatures read at one decimal, like the tile, whatever precision Home Assistant sent.
    expect(utils.getEntityDisplayState({ ...sensor, state: '15.60' })).toBe('15,6\u00a0°C');
  });

  it('translates binary sensors, scenes, known raw states and climate temperatures', () => {
    useGerman();
    expect(
      utils.getEntityDisplayState({ entity_id: 'binary_sensor.hall', state: 'on', attributes: {} })
    ).toBe('Erkannt');
    expect(
      utils.getEntityDisplayState({ entity_id: 'binary_sensor.hall', state: 'off', attributes: {} })
    ).toBe('Frei');
    expect(utils.getEntityDisplayState({ entity_id: 'scene.movie', state: 'x' })).toBe('Bereit');
    expect(utils.getEntityDisplayState({ entity_id: 'switch.kettle', state: 'on' })).toBe('An');
    expect(utils.getEntityDisplayState({ entity_id: 'person.anna', state: 'not_home' })).toBe(
      'Abwesend'
    );
    expect(
      utils.getEntityDisplayState({
        entity_id: 'climate.office',
        state: 'heat',
        attributes: { current_temperature: 21.5 },
      })
    ).toBe('21,5\u00a0°C');
    expect(utils.getEntityDisplayState(null)).toBe('Unbekannt');
  });

  it('shows an unavailable sensor as a state instead of a value with a unit', () => {
    useGerman();
    expect(
      utils.getEntityDisplayState({
        entity_id: 'sensor.outside',
        state: 'unavailable',
        attributes: { unit_of_measurement: '°C' },
      })
    ).toBe('Nicht verfügbar');
  });

  it('keeps unknown raw states readable in English', () => {
    expect(utils.getEntityDisplayState({ entity_id: 'vacuum.robot', state: 'mopping' })).toBe(
      'Mopping'
    );
    expect(utils.getEntityTypeDescription({ entity_id: 'binary_sensor.hall' })).toBe(
      'Binary Sensor'
    );
    useGerman();
    expect(utils.getEntityTypeDescription({ entity_id: 'binary_sensor.hall' })).toBe('Binärsensor');
  });

  it('uses the same English state names as the tray, so both share translation keys', () => {
    expect(utils.HA_STATE_NAMES).toEqual(trayEntities.STATE_NAMES);
  });
});

describe('domain names', () => {
  it('uses context-prefixed keys and shows the plain English name without a catalog', () => {
    expect(utils.getEntityTypeDescription({ entity_id: 'light.desk' })).toBe('Light');
    expect(utils.getEntityTypeDescription({ entity_id: 'update.core' })).toBe('Update');
    expect(utils.getEntityTypeDescription({ entity_id: 'lock.front' })).toBe('Lock');
    expect(utils.getEntityTypeDescription({ entity_id: 'custom_thing.x' })).toBe('Custom Thing');
    useGerman();
    expect(utils.getEntityTypeDescription({ entity_id: 'light.desk' })).toBe('Licht');
    // A domain the catalog has not translated yet still reads as its English name.
    expect(utils.getEntityTypeDescription({ entity_id: 'lock.front' })).toBe('Lock');
  });
});

describe('weather states and newer domains', () => {
  it('shows weather conditions with the translated weather card labels', () => {
    const weather = (state) => ({ entity_id: 'weather.home', state, attributes: {} });
    expect(utils.getEntityDisplayState(weather('clear-night'))).toBe('Clear night');
    expect(utils.getEntityDisplayState(weather('partlycloudy'))).toBe('Partly cloudy');
    useGerman();
    expect(utils.getEntityDisplayState(weather('partlycloudy'))).toBe('Teilweise bewölkt');
    expect(utils.getEntityDisplayState(weather('unavailable'))).toBe('Nicht verfügbar');
    // A condition id the widget does not know stays readable.
    expect(utils.getEntityDisplayState(weather('volcanic_ash'))).toBe('Volcanic ash');
  });

  it('names the newer Home Assistant domains, with a translation in every pack', () => {
    expect(utils.getEntityTypeDescription({ entity_id: 'lawn_mower.front' })).toBe('Lawn Mower');
    expect(utils.getEntityTypeDescription({ entity_id: 'radio_frequency.rf' })).toBe(
      'Radio Frequency'
    );
    expect(utils.getEntityTypeDescription({ entity_id: 'notify.phone' })).toBe('Notifications');
    const fs = require('fs');
    const path = require('path');
    const readJson = (file) =>
      JSON.parse(fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8'));
    const english = readJson('locales/en.json');
    const packs = ['de', 'es', 'fr', 'hi', 'zh', 'ar'].map(
      (locale) => readJson(`locale-packs/${locale}.json`).messages
    );
    for (const name of Object.values(utils.HA_DOMAIN_NAMES)) {
      expect(english[`Domain: ${name}`]).toBe(name);
      for (const messages of packs) expect(messages[`Domain: ${name}`]).toEqual(expect.any(String));
    }
  });
});

describe('icon labels', () => {
  it('relabel built-in icon names when the document is translated again', () => {
    const { Icons } = require('../../src/icons.js');
    const container = document.createElement('div');
    container.appendChild(Icons.close());
    container.appendChild(Icons.waterDrop());
    container.appendChild(Icons.close({ ariaLabel: 'Close dialog' }));
    i18n.setLocaleBootstrap({
      activeLocale: 'de',
      messages: { Close: 'Schließen', Humidity: 'Luftfeuchtigkeit' },
    });
    i18n.translateDocument(container);
    expect(
      [...container.querySelectorAll('svg')].map((svg) => svg.getAttribute('aria-label'))
    ).toEqual(['Schließen', 'Luftfeuchtigkeit', 'Close dialog']);
  });
});

describe('action buttons that share their English word with a state', () => {
  it('label Clear buttons with the verb key, not the binary sensor "Clear" state', () => {
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
    for (const id of ['popup-hotkey-clear-btn', 'clear-weather']) {
      expect(html).toMatch(new RegExp(`id="${id}"[^>]*data-i18n="Action: Clear"`));
    }
    const settings = fs.readFileSync(path.resolve(__dirname, '../../src/settings.js'), 'utf8');
    expect(settings).toContain("confirmText: t('Action: Clear')");
  });
});

describe('English display changes from the shared state names', () => {
  it('shows the app-wide state names instead of capitalized raw states', () => {
    expect(utils.getEntityDisplayState({ entity_id: 'person.anna', state: 'not_home' })).toBe(
      'Away'
    );
    expect(
      utils.getEntityDisplayState({ entity_id: 'climate.office', state: 'heat', attributes: {} })
    ).toBe('Heat');
    expect(utils.getEntityDisplayState({ entity_id: 'vacuum.robot', state: 'docked' })).toBe(
      'Docked'
    );
  });

  it('shows unavailable and unknown sensors as states without a unit', () => {
    const sensor = (state) => ({
      entity_id: 'sensor.outside',
      state,
      attributes: { unit_of_measurement: '°C' },
    });
    expect(utils.getEntityDisplayState(sensor('unavailable'))).toBe('Unavailable');
    expect(utils.getEntityDisplayState(sensor('unknown'))).toBe('Unknown');
    expect(
      utils.getEntityDisplayState({ entity_id: 'binary_sensor.door', state: 'unavailable' })
    ).toBe('Unavailable');
    expect(utils.getEntityDisplayState({ entity_id: 'binary_sensor.door', state: 'unknown' })).toBe(
      'Unknown'
    );
  });

  it('formats numeric sensor and climate values through the locale formatter', () => {
    const sensor = (state, attributes = { unit_of_measurement: 'W' }) => ({
      entity_id: 'sensor.power',
      state,
      attributes,
    });
    // Measurements get the locale's grouping and a no-break space before the unit.
    expect(utils.getEntityDisplayState(sensor('12345'))).toBe('12,345\u00a0W');
    expect(utils.getEntityDisplayState(sensor('-0.50'))).toBe('-0.5\u00a0W');
    expect(utils.getEntityDisplayState(sensor('1e3'))).toBe('1e3\u00a0W');
    expect(utils.getEntityDisplayState(sensor('12345', { state_class: 'total' }))).toBe('12,345');
    // Codes and unitless values stay as Home Assistant sent them, as in its own frontend.
    expect(utils.getEntityDisplayState(sensor('007'))).toBe('007\u00a0W');
    expect(utils.getEntityDisplayState(sensor('2026', {}))).toBe('2026');
    expect(utils.getEntityDisplayState(sensor('01234', {}))).toBe('01234');
    expect(
      utils.getEntityDisplayState({
        entity_id: 'climate.office',
        state: 'heat',
        attributes: { current_temperature: 21.12345 },
      })
    ).toBe('21.12°C');
  });

  it('names raw states the way the camera dialog status now shows them', () => {
    expect(utils.getLocalizedStateName('idle')).toBe('Idle');
    expect(utils.getLocalizedStateName('streaming')).toBe('Streaming');
    expect(utils.getLocalizedStateName('')).toBe('Unknown');
  });

  it('translates known raw states in sensor-based timer readouts', () => {
    expect(utils.getTimerDisplay({ entity_id: 'sensor.kitchen_timer', state: 'unavailable' })).toBe(
      'Unavailable'
    );
  });
});

describe('timer labels in the active language', () => {
  const timer = (state, attributes = {}) => ({ entity_id: 'timer.tea', state, attributes });

  it('translates the run status while the run state stays language independent', () => {
    useGerman();
    expect(utils.getTimerStatusLabel(timer('active'))).toBe('Läuft');
    expect(utils.getTimerStatusLabel(timer('paused'))).toBe('Pausiert');
    expect(utils.getTimerStatusLabel(timer('idle'))).toBe('Inaktiv');
    expect(utils.getTimerStatusLabel(timer('unavailable'))).toBe('Nicht verfügbar');
    expect(utils.getTimerRunState(timer('active'))).toBe('running');
    expect(utils.getTimerRunState(timer('paused'))).toBe('paused');
    expect(utils.getTimerRunState(null)).toBe('idle');
  });

  it('translates finished and idle timer readouts', () => {
    useGerman();
    const finished = {
      entity_id: 'sensor.kitchen_timer',
      state: '2020-01-01T00:00:00+00:00',
      attributes: {},
    };
    expect(utils.getTimerDisplay(finished)).toBe('Abgelaufen');
    expect(utils.getTimerStatusLabel(finished)).toBe('Abgelaufen');
    expect(utils.getTimerRunState(finished)).toBe('finished');
    expect(utils.getTimerDisplay(timer('idle'))).toBe('Inaktiv');
  });
});

describe('gauge labels in the active language', () => {
  it('uses the German decimal separator and keeps the compact suffixes', () => {
    useGerman();
    expect(formatGaugeBoundLabel(17.6)).toBe('17,6');
    expect(formatGaugeBoundLabel(2.25)).toBe('2,25');
    expect(formatGaugeBoundLabel(15500)).toBe('15,5k');
    expect(formatGaugeBoundLabel(2500000)).toBe('2,5M');
    // Mid-range bounds stay compact: no thousands separator.
    expect(formatGaugeBoundLabel(1500)).toBe('1500');
    expect(formatGaugeBoundLabel(-30)).toBe('-30');
  });
});

describe('other shared labels in the active language', () => {
  it('translates built-in theme names and default custom color names, not user names', () => {
    uiUtils.setCustomThemes([
      { id: 'custom-a', color: '#123456' },
      { id: 'custom-b', color: '#654321', name: 'Desk lamp' },
    ]);
    useGerman();
    const themes = uiUtils.getAccentThemes();
    const indigo = themes.find((theme) => theme.id === 'indigo');
    expect(indigo.name).toBe('Indigo-Blau');
    expect(indigo.description).toBe('Konzentriert und modern');
    const unnamed = themes.find((theme) => theme.id === 'custom-a');
    expect(unnamed.name).toBe('Eigene Farbe #123456');
    expect(unnamed.description).toBe('Gespeicherte eigene Farbe');
    expect(themes.find((theme) => theme.id === 'custom-b').name).toBe('Desk lamp');
    uiUtils.setCustomThemes([]);
  });

  it('labels a non-decorative weather icon in the active language', () => {
    useGerman();
    const icon = createWeatherIcon('partlycloudy', { decorative: false });
    expect(icon.getAttribute('aria-label')).toBe('Teilweise bewölkt');
  });

  it('names pages without a name in the active language', () => {
    useGerman();
    expect(normalizeQuickAccessConfig({}).customTabs[0].name).toBe('Alle');
    const config = normalizeQuickAccessConfig({
      customTabs: [
        { id: 'a', name: '' },
        { id: 'b', name: '' },
      ],
    });
    expect(config.customTabs.map((tab) => tab.name)).toEqual(['Alle', 'Ansicht 2']);
    const added = addQuickAccessView(config, '', { idFactory: () => 'c' });
    expect(added.customTabs[2].name).toBe('Neue Ansicht');
  });

  it('formats notification times in the active language', () => {
    useGerman();
    const now = Date.parse('2026-07-06T12:00:00Z');
    expect(formatRelativeTime('2026-07-06T12:00:00Z', now)).toBe('gerade eben');
    expect(formatRelativeTime('2026-07-06T11:45:00Z', now)).toBe(
      new Intl.RelativeTimeFormat('de', { numeric: 'auto', style: 'short' }).format(-15, 'minute')
    );
  });
});

describe('sensor history summary in the active language', () => {
  it('formats minimum, maximum and average with the German decimal separator', async () => {
    useGerman();
    const modal = document.createElement('div');
    const body = document.createElement('div');
    modal.appendChild(body);
    document.body.appendChild(modal);
    const websocket = { request: jest.fn(async () => ({ success: true, result: {} })) };
    const now = Date.now();
    mountSensorHistoryDetail({
      body,
      modal,
      entity: { entity_id: 'sensor.outside', attributes: { unit_of_measurement: '°C' } },
      websocket,
      normalize: () => [
        { timestamp: now - 7200000, value: 1.5 },
        { timestamp: now - 3600000, value: 2.25 },
      ],
      render: jest.fn(),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const summary = body.querySelector('.sensor-history-summary').textContent;
    // Every figure has the unit, at the one decimal a temperature reads with.
    expect(summary).toBe('Minimum 1,5\u00a0°C · Maximum 2,3\u00a0°C · Sample average 1,9\u00a0°C');
    // Each figure is a piece of its own, so a line never ends between "Sample average" and its
    // value; only the separators between them break.
    expect(
      [...body.querySelectorAll('.sensor-history-figure')].map((figure) => figure.textContent)
    ).toEqual(['Minimum 1,5\u00a0°C', 'Maximum 2,3\u00a0°C', 'Sample average 1,9\u00a0°C']);
    modal.remove();
  });
});

describe('left-to-right values in right-to-left languages', () => {
  it('isolates a value only while a right-to-left language is active', () => {
    expect(i18n.isolateLtr('23°C')).toBe('23°C');
    useGerman();
    expect(i18n.isolateLtr('23°C')).toBe('23°C');
    i18n.setLocaleBootstrap({ activeLocale: 'ar', messages: {} });
    expect(i18n.isolateLtr('23°C')).toBe('\u206623°C\u2069');
    expect(i18n.isolateLtr('')).toBe('');
  });

  it('keeps the unit next to every sensor history figure in Arabic', async () => {
    i18n.setLocaleBootstrap({ activeLocale: 'ar', messages: {} });
    const modal = document.createElement('div');
    const body = document.createElement('div');
    modal.appendChild(body);
    document.body.appendChild(modal);
    const now = Date.now();
    mountSensorHistoryDetail({
      body,
      modal,
      entity: { entity_id: 'sensor.outside', attributes: { unit_of_measurement: '°C' } },
      websocket: { request: jest.fn(async () => ({ success: true, result: {} })) },
      normalize: () => [{ timestamp: now - 3600000, value: 1.5 }],
      render: jest.fn(),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Each figure is isolated with its own unit, so none of them is reordered in the sentence.
    const summary = body.querySelector('.sensor-history-summary').textContent;
    expect(summary.match(/\u2066[^\u2069]*°C\u2069/g)).toHaveLength(3);
    modal.remove();
  });
});
