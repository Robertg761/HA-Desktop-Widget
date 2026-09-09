const trayEntities = require('../../src/tray-entities.cjs');

const {
  buildNumericLabelCandidates,
  buildTrayEntityPresentation,
  chooseTrayLabelLayout,
  getTrayEntityIds,
  getTrayIconSizeForPlatform,
  isTrayEntity,
  normalizeTrayEntitiesConfig,
  sanitizeTrayEntityIconPayload,
} = trayEntities;

const entity = (entityId, state, attributes = {}) => ({ entity_id: entityId, state, attributes });
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('tray-entities config helpers', () => {
  it('normalizes the tray entity map and drops junk', () => {
    expect(normalizeTrayEntitiesConfig(undefined)).toEqual({});
    expect(normalizeTrayEntitiesConfig(['sensor.a'])).toEqual({});
    expect(
      normalizeTrayEntitiesConfig({
        ' sensor.cpu ': { label: 'x' },
        'light.desk': true,
        '': {},
        'not an id': {},
      })
    ).toEqual({ 'sensor.cpu': { label: 'x' }, 'light.desk': {} });
  });

  it('lists configured ids and answers membership checks', () => {
    const config = { trayEntities: { 'sensor.cpu': {}, 'binary_sensor.door': {} } };
    expect(getTrayEntityIds(config)).toEqual(['sensor.cpu', 'binary_sensor.door']);
    expect(getTrayEntityIds({})).toEqual([]);
    expect(isTrayEntity(config, 'sensor.cpu')).toBe(true);
    expect(isTrayEntity(config, 'sensor.gpu')).toBe(false);
    expect(isTrayEntity(config, 'toString')).toBe(false);
    expect(isTrayEntity({ trayEntities: null }, 'sensor.cpu')).toBe(false);
  });

  it('sizes icons per platform', () => {
    expect(getTrayIconSizeForPlatform('win32')).toBe(16);
    expect(getTrayIconSizeForPlatform('linux')).toBe(22);
    expect(getTrayIconSizeForPlatform('darwin')).toBe(22);
  });
});

describe('buildNumericLabelCandidates', () => {
  it('offers unit-suffixed and compact variants, most informative first', () => {
    expect(buildNumericLabelCandidates(85, '%')).toEqual(['85%', '85']);
    expect(buildNumericLabelCandidates(21.46, '°C')).toEqual(['21.5°', '21.5', '21°', '21']);
    expect(buildNumericLabelCandidates(1234, 'W')).toEqual([
      '1234W',
      '1234',
      '1.2kW',
      '1.2k',
      '1kW',
      '1k',
    ]);
    expect(buildNumericLabelCandidates(2500000, 'kWh')).toEqual([
      '2500000kWh',
      '2500000',
      '2.5M',
      '3M',
    ]);
  });
});

describe('buildTrayEntityPresentation', () => {
  it('formats numeric sensors with unit and tooltip', () => {
    const presentation = buildTrayEntityPresentation(
      entity('sensor.cpu', '43.2', { unit_of_measurement: '%', friendly_name: 'CPU Load' })
    );
    expect(presentation.candidates).toEqual(['43.2%', '43.2', '43%', '43']);
    expect(presentation.tooltip).toBe('CPU Load: 43.2 %');
    expect(presentation.accent).toBe('neutral');
  });

  it('uses the supplied display name and state for the tooltip', () => {
    const presentation = buildTrayEntityPresentation(entity('sensor.cpu', '43'), {
      displayName: 'Custom',
      displayState: '43 %',
    });
    expect(presentation.tooltip).toBe('Custom: 43 %');
  });

  it('marks unavailable and unknown entities', () => {
    expect(buildTrayEntityPresentation(entity('sensor.cpu', 'unavailable'))).toMatchObject({
      candidates: ['N/A'],
      accent: 'unavailable',
    });
    expect(buildTrayEntityPresentation(entity('sensor.cpu', 'unknown')).candidates).toEqual(['?']);
    expect(buildTrayEntityPresentation(null).candidates).toEqual(['N/A']);
  });

  it('shows brightness, fan speed, cover position and humidity as percentages', () => {
    expect(
      buildTrayEntityPresentation(entity('light.desk', 'on', { brightness: 128 }))
    ).toMatchObject({ candidates: ['50%', '50', 'ON'], accent: 'on' });
    expect(buildTrayEntityPresentation(entity('light.desk', 'off'))).toMatchObject({
      candidates: ['OFF'],
      accent: 'off',
    });
    expect(
      buildTrayEntityPresentation(entity('fan.bedroom', 'on', { percentage: 66 })).candidates
    ).toEqual(['66%', '66', 'ON']);
    expect(
      buildTrayEntityPresentation(entity('cover.blind', 'open', { current_position: 30 }))
        .candidates
    ).toEqual(['30%', '30', 'OPEN']);
    expect(
      buildTrayEntityPresentation(entity('cover.blind', 'closing', { current_position: 30 }))
        .candidates
    ).toEqual(['CLSG']);
    expect(
      buildTrayEntityPresentation(entity('humidifier.bed', 'on', { current_humidity: 41 }))
        .candidates
    ).toEqual(['41%', '41']);
  });

  it('shows temperatures for climate, water heaters and weather', () => {
    const climate = buildTrayEntityPresentation(
      entity('climate.hall', 'heat', { current_temperature: 20.4, hvac_action: 'heating' })
    );
    expect(climate.candidates).toEqual(['20.4°', '20.4', '20°', '20']);
    expect(climate.accent).toBe('on');
    expect(
      buildTrayEntityPresentation(entity('climate.hall', 'off', { current_temperature: 20 })).accent
    ).toBe('off');
    expect(buildTrayEntityPresentation(entity('climate.hall', 'cool')).candidates).toEqual([
      'COOL',
    ]);
    expect(
      buildTrayEntityPresentation(entity('weather.home', 'sunny', { temperature: 27 })).candidates
    ).toEqual(['27°', '27']);
    expect(buildTrayEntityPresentation(entity('weather.home', 'sunny')).candidates).toEqual([
      'SUNNY',
      'SUNN',
      'SUN',
      'SU',
    ]);
  });

  it('uses device-class words for binary sensors', () => {
    expect(
      buildTrayEntityPresentation(entity('binary_sensor.front', 'on', { device_class: 'door' }))
    ).toMatchObject({ candidates: ['OPEN'], accent: 'on' });
    expect(
      buildTrayEntityPresentation(entity('binary_sensor.front', 'off', { device_class: 'motion' }))
    ).toMatchObject({ candidates: ['CLR'], accent: 'off' });
    expect(buildTrayEntityPresentation(entity('binary_sensor.front', 'on')).candidates).toEqual([
      'ON',
    ]);
  });

  it('handles presence, locks, media players and timers', () => {
    expect(buildTrayEntityPresentation(entity('person.robert', 'home'))).toMatchObject({
      candidates: ['HOME'],
      accent: 'on',
    });
    expect(buildTrayEntityPresentation(entity('person.robert', 'not_home')).candidates).toEqual([
      'AWAY',
    ]);
    expect(buildTrayEntityPresentation(entity('person.robert', 'Office')).candidates).toEqual([
      'OFFICE',
      'OFFI',
      'OFF',
      'OF',
    ]);
    expect(buildTrayEntityPresentation(entity('lock.front', 'locked'))).toMatchObject({
      candidates: ['LOCK'],
      accent: 'off',
    });
    expect(buildTrayEntityPresentation(entity('media_player.tv', 'playing'))).toMatchObject({
      candidates: ['PLAY'],
      accent: 'on',
    });
    expect(
      buildTrayEntityPresentation(entity('timer.laundry', 'active'), {
        timerRemainingSeconds: 3725,
      })
    ).toMatchObject({ candidates: ['1:02', '1h'], accent: 'on' });
    expect(
      buildTrayEntityPresentation(entity('timer.laundry', 'active'), { timerRemainingSeconds: 95 })
        .candidates
    ).toEqual(['1:35', '1m']);
    expect(
      buildTrayEntityPresentation(entity('timer.laundry', 'active'), { timerRemainingSeconds: 9 })
        .candidates
    ).toEqual(['9s']);
    expect(buildTrayEntityPresentation(entity('timer.laundry', 'idle'))).toMatchObject({
      candidates: ['IDLE'],
      accent: 'off',
    });
  });

  it('truncates long tooltips and strips line breaks', () => {
    const presentation = buildTrayEntityPresentation(entity('sensor.cpu', '1'), {
      displayName: 'A\nvery  long\tname '.padEnd(200, 'x'),
    });
    expect(presentation.tooltip).not.toMatch(/[\n\t]/);
    expect(Array.from(presentation.tooltip).length).toBeLessThanOrEqual(127);
  });
});

describe('chooseTrayLabelLayout', () => {
  const measure = (text, fontSize) => text.length * fontSize * 0.6;

  it('picks the first candidate that fits at a readable size', () => {
    // A less informative candidate at a readable size beats a fuller one squeezed below it.
    expect(
      chooseTrayLabelLayout(['43.2%', '43.2', '43%', '43'], measure, { maxWidth: 15 })
    ).toEqual({ text: '43', fontSize: 12 });
    expect(chooseTrayLabelLayout(['43%', '43'], measure, { maxWidth: 21 })).toEqual({
      text: '43%',
      fontSize: 11,
    });
  });

  it('prefers readability over information when nothing fits large enough', () => {
    expect(chooseTrayLabelLayout(['43.2%', '43'], measure, { maxWidth: 15 })).toEqual({
      text: '43',
      fontSize: 12,
    });
  });

  it('uses an ellipsis when labels cannot fit and survives unavailable text measurement', () => {
    expect(chooseTrayLabelLayout(['ABCDEFG', 'ABCDEF'], measure, { maxWidth: 10 })).toEqual({
      text: '…',
      fontSize: 7,
    });
    expect(chooseTrayLabelLayout([], measure, { maxWidth: 10 })).toEqual({
      text: '?',
      fontSize: 7,
    });
    expect(
      chooseTrayLabelLayout(
        ['1'],
        () => {
          throw new Error('no canvas');
        },
        { maxWidth: 10 }
      )
    ).toEqual({ text: '1', fontSize: 7 });
  });
});

describe('sanitizeTrayEntityIconPayload', () => {
  it('rejects malformed payloads', () => {
    expect(sanitizeTrayEntityIconPayload(null)).toBeNull();
    expect(sanitizeTrayEntityIconPayload({})).toBeNull();
    expect(sanitizeTrayEntityIconPayload({ entityId: 'nope' })).toBeNull();
  });

  it('keeps only PNG data URLs with sane scale factors', () => {
    const sanitized = sanitizeTrayEntityIconPayload({
      entityId: ' sensor.cpu ',
      label: 'x'.repeat(100),
      tooltip: `line1\nline2 ${'y'.repeat(200)}`,
      representations: [
        { scaleFactor: 1, dataURL: PNG },
        { scaleFactor: 2, dataURL: 'data:image/svg+xml;base64,PHN2Zz4=' },
        { scaleFactor: 0.5, dataURL: PNG },
        { scaleFactor: 8, dataURL: PNG },
        { scaleFactor: 1.5, dataURL: 'data:image/png;base64,not*base64' },
        { scaleFactor: 1.5, dataURL: `data:image/png;base64,${'A'.repeat(100 * 1024)}` },
        'junk',
        { scaleFactor: 2, dataURL: PNG },
        { scaleFactor: 3, dataURL: PNG },
        { scaleFactor: 4, dataURL: PNG },
        { scaleFactor: 4, dataURL: PNG },
      ],
    });
    expect(sanitized.entityId).toBe('sensor.cpu');
    expect(sanitized.label.length).toBe(64);
    expect(sanitized.tooltip).not.toContain('\n');
    expect(Array.from(sanitized.tooltip).length).toBeLessThanOrEqual(127);
    expect(sanitized.representations).toEqual([
      { scaleFactor: 1, dataURL: PNG },
      { scaleFactor: 2, dataURL: PNG },
      { scaleFactor: 3, dataURL: PNG },
      { scaleFactor: 4, dataURL: PNG },
    ]);
  });

  it('tolerates missing optional fields', () => {
    expect(sanitizeTrayEntityIconPayload({ entityId: 'light.desk' })).toEqual({
      entityId: 'light.desk',
      label: '',
      tooltip: '',
      representations: [],
      activeTimer: false,
    });
  });
});
