import windowDisplay from './window-display.cjs';
const activePickers = new WeakMap();

// Keep the choice separate from the config snapshot. A Settings form left open while
// someone uses the tray must not silently put the widget back on the old monitor.
export function createWindowDisplaySettings({ document, getDisplays, t, layerMode = false }) {
  const select = document.getElementById('window-display');
  const help = document.getElementById('window-display-help');
  let state = null;
  let touched = false;
  let failed = false;
  let loadVersion = 0;
  const owner = {};
  if (select) activePickers.set(select, owner);
  if (select)
    select.onchange = () => {
      touched = true;
    };

  function render(value = state?.selectedId || '') {
    if (!select || !help || activePickers.get(select) !== owner) return;
    select.replaceChildren();
    const addOption = (value, label) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      select.append(option);
    };
    addOption('', t('Automatic'));
    for (const display of state?.displays || []) {
      addOption(display.id, windowDisplay.formatWindowDisplayLabel(display, t));
    }
    select.value = value;
    select.disabled = !state?.supported;
    help.textContent = failed
      ? t('Could not load displays. Reopen Settings to try again.')
      : state?.supported
        ? t(
            'Choose where the widget opens. Automatic remembers where you drag it. Desktop pins keep their own positions.'
          )
        : layerMode
          ? t('Use Move to Monitor in the tray menu on this desktop.')
          : t('Your desktop manages window placement.');
    select.title = select.selectedOptions[0]?.textContent || '';
  }

  return {
    async load() {
      if (!select) return;
      const version = ++loadVersion;
      if (!state) select.disabled = true;
      try {
        const next = await getDisplays();
        if (version !== loadVersion || activePickers.get(select) !== owner) return;
        const pending = touched ? select.value : undefined;
        const pendingDisplay = state?.displays?.find((display) => display.id === pending);
        if (pendingDisplay && !next.displays?.some((display) => display.id === pending)) {
          next.displays = [...(next.displays || []), { ...pendingDisplay, available: false }];
        }
        state = next;
        failed = false;
        render(pending);
      } catch {
        if (version !== loadVersion || activePickers.get(select) !== owner) return;
        state = null;
        failed = true;
        render();
      }
    },
    choice: () => (state?.supported && touched && !select?.disabled ? select.value : undefined),
    relocalize: () => render(select?.value),
  };
}
