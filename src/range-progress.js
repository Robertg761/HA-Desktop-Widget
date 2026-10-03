// CSS paints a range input's track but cannot read its value, so a track that shows how far it is
// filled (the pinned tiles' sliders, the Readable preset's sliders) needs the value as a length.
// --range-progress is the share of the track left of the thumb, as a percentage.
const PROGRESS_PROPERTY = '--range-progress';
const RANGE_SELECTOR = 'input[type="range"]';

export function syncRangeProgress(input) {
  const min = Number(input.min) || 0;
  const max = input.max === '' ? 100 : Number(input.max);
  const span = max - min;
  const share = span > 0 ? (Number(input.value) - min) / span : 0;
  const percent = Math.round(Math.min(1, Math.max(0, share)) * 1000) / 10;
  input.style.setProperty(PROGRESS_PROPERTY, `${percent}%`);
}

// The app moves its sliders from script as often as the user drags them (Home Assistant reports a
// new level, a failed command puts the old one back), and assigning .value fires no event, so the
// setter is wrapped on each slider as well as listening for `input`. The other ways a thumb moves
// (form.reset(), setAttribute('value') on an untouched slider, stepUp() and stepDown()) fire
// nothing this can hear and are not covered; no slider in the app is moved that way.
function trackRange(input) {
  if (Object.prototype.hasOwnProperty.call(input, 'value')) return;
  const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  Object.defineProperty(input, 'value', {
    configurable: true,
    enumerable: true,
    get() {
      return nativeValue.get.call(this);
    },
    set(next) {
      nativeValue.set.call(this, next);
      syncRangeProgress(this);
    },
  });
  syncRangeProgress(input);
}

function trackRangesIn(node) {
  if (node.nodeType !== 1) return;
  if (node.matches(RANGE_SELECTOR)) trackRange(node);
  node.querySelectorAll?.(RANGE_SELECTOR).forEach(trackRange);
}

export function installRangeProgress(root = document) {
  // Listen while the event is still travelling down: the climate range sliders stop it at the target.
  root.addEventListener(
    'input',
    (event) => {
      if (event.target.matches?.(RANGE_SELECTOR)) syncRangeProgress(event.target);
    },
    true
  );
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'childList') record.addedNodes.forEach(trackRangesIn);
      else if (record.target.matches(RANGE_SELECTOR)) syncRangeProgress(record.target);
    }
  });
  // Changing min or max moves a slider's thumb without touching its value.
  observer.observe(root.documentElement || root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['min', 'max'],
  });
  trackRangesIn(root.documentElement || root);
  return observer;
}
