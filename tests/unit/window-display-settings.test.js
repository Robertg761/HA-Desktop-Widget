/** @jest-environment jsdom */
const { createWindowDisplaySettings } = require('../../src/window-display-settings.js');
const t = (text, values = {}) => text.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key]);
const available = {
  supported: true,
  selectedId: '',
  displays: [
    { id: '1', label: 'Laptop', width: 1920, height: 1080, primary: true, available: true },
    { id: '2', label: 'Desk', width: 1280, height: 900, available: true },
  ],
};
function setup(getDisplays = async () => available, layerMode = false) {
  document.body.innerHTML = '<select id="window-display"></select><p id="window-display-help"></p>';
  const select = document.getElementById('window-display');
  return { select, picker: createWindowDisplaySettings({ document, getDisplays, t, layerMode }) };
}

test('lists the displays but only sends a choice after the user changes it', async () => {
  const { select, picker } = setup();
  await picker.load();
  expect([...select.options].map((option) => option.value)).toEqual(['', '1', '2']);
  expect(picker.choice()).toBeUndefined();
  select.value = '2';
  select.dispatchEvent(new Event('change'));
  expect(picker.choice()).toBe('2');
  picker.relocalize();
  expect(select.value).toBe('2');
  expect(picker.choice()).toBe('2');
});

test('preserves a disconnected selection when unrelated settings are saved', async () => {
  const { select, picker } = setup(async () => ({
    supported: true,
    selectedId: '2',
    displays: [available.displays[0], { id: '2', label: 'Desk', available: false }],
  }));
  await picker.load();
  expect(select.value).toBe('2');
  expect(select.selectedOptions[0].textContent).toContain('disconnected');
  expect(picker.choice()).toBeUndefined();
  select.value = '';
  select.dispatchEvent(new Event('change'));
  expect(picker.choice()).toBe('');
});

test('unsupported desktops and failed enumeration cannot submit a choice', async () => {
  for (const getDisplays of [
    async () => ({ supported: false }),
    async () => {
      throw new Error('IPC failed');
    },
  ]) {
    const { select, picker } = setup(getDisplays);
    await picker.load();
    expect(select.disabled).toBe(true);
    expect(picker.choice()).toBeUndefined();
    expect(document.getElementById('window-display-help').textContent).not.toBe('');
  }
});

test('refreshes a tray selection, but preserves a pending edit when its display disconnects', async () => {
  let latest = available;
  const { select, picker } = setup(async () => latest);
  await picker.load();
  latest = { ...available, selectedId: '1' };
  await picker.load();
  expect(select.value).toBe('1');
  select.value = '2';
  select.dispatchEvent(new Event('change'));
  latest = { ...latest, displays: [available.displays[0]] };
  await picker.load();
  expect(select.value).toBe('2');
  expect(select.selectedOptions[0].textContent).toContain('disconnected');
  expect(picker.choice()).toBe('2');
});

test('a slow response from an earlier opening cannot overwrite the current form', async () => {
  let resolveFirst;
  const { select, picker } = setup(
    () =>
      new Promise((resolve) => {
        resolveFirst = resolve;
      })
  );
  const first = picker.load();
  const current = createWindowDisplaySettings({
    document,
    t,
    getDisplays: async () => ({ ...available, selectedId: '2' }),
  });
  await current.load();
  resolveFirst(available);
  await first;
  expect(select.value).toBe('2');
});
