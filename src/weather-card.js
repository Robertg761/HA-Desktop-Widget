/**
 * What opens the weather picker from the weather card: a click, a long press, or the keyboard.
 *
 * The card is a button, so a click opens the picker, which is also what an assistive technology's
 * "activate" sends. The long press that used to be the only way stays as a shortcut, and the
 * keyboard (Enter, Space, the menu key, Shift+F10) opens it as it always has.
 */

const LONG_PRESS_MS = 500;

/**
 * Wires one status card. The time card shares this wiring and is left alone: `isWeatherCard` says
 * whether the card currently shows the weather.
 * @param {HTMLElement} card
 * @param {Object} options
 * @param {() => boolean} options.isWeatherCard
 * @param {() => void} options.openPicker
 */
function bindWeatherCardPicker(card, { isWeatherCard, openPicker }) {
  let pressTimer = null;
  // A press that already opened the picker must not open it again with its click.
  let longPressOpened = false;
  const cancelPress = () => clearTimeout(pressTimer);

  card.addEventListener('mousedown', (event) => {
    if (event.button !== 0 || !isWeatherCard()) return;
    longPressOpened = false;
    pressTimer = setTimeout(() => {
      longPressOpened = true;
      openPicker();
    }, LONG_PRESS_MS);
  });
  card.addEventListener('mouseup', cancelPress);
  card.addEventListener('mouseleave', cancelPress);
  // A right-click is the context menu's, not a press that is still going.
  card.addEventListener('contextmenu', cancelPress);
  card.addEventListener('click', (event) => {
    if (event.button !== 0 || !isWeatherCard()) return;
    if (longPressOpened) {
      longPressOpened = false;
      return;
    }
    openPicker();
  });
  card.addEventListener('keydown', (event) => {
    if (event.target !== card || !isWeatherCard()) return;
    const opensPicker =
      ['Enter', ' ', 'ContextMenu'].includes(event.key) || (event.key === 'F10' && event.shiftKey);
    if (!opensPicker || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    openPicker();
  });
}

export { bindWeatherCardPicker, LONG_PRESS_MS };
