const { installRangeProgress, syncRangeProgress } = require('../../src/range-progress.js');

function slider({ min = '0', max = '100', value = '50' } = {}) {
  const input = document.createElement('input');
  input.type = 'range';
  input.min = min;
  input.max = max;
  input.value = value;
  return input;
}

const progress = (input) => input.style.getPropertyValue('--range-progress');
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('range progress', () => {
  describe('syncRangeProgress', () => {
    it.each([
      [{ value: '0' }, '0%'],
      [{ value: '25' }, '25%'],
      [{ value: '100' }, '100%'],
      // The thermostat's scale does not start at zero.
      [{ min: '7', max: '30', value: '22' }, '65.2%'],
      [{ min: '-5', max: '5', value: '0' }, '50%'],
    ])('writes the share of the track left of the thumb for %j', (attributes, expected) => {
      const input = slider(attributes);
      syncRangeProgress(input);
      expect(progress(input)).toBe(expected);
    });

    it('assumes the browser defaults when the slider has no limits, and survives a bad scale', () => {
      const input = slider();
      input.removeAttribute('min');
      input.removeAttribute('max');
      input.value = '40';
      syncRangeProgress(input);
      expect(progress(input)).toBe('40%');

      input.max = '0';
      input.min = '0';
      syncRangeProgress(input);
      expect(progress(input)).toBe('0%');
    });
  });

  describe('installRangeProgress', () => {
    let observer;

    beforeEach(() => {
      document.body.innerHTML = '';
    });

    afterEach(() => {
      observer?.disconnect();
    });

    it('follows the user dragging, even when the slider stops the event itself', () => {
      const input = slider();
      input.addEventListener('input', (event) => event.stopPropagation());
      document.body.appendChild(input);
      observer = installRangeProgress(document);

      input.value = '80';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      expect(progress(input)).toBe('80%');
    });

    it('follows script assigning a value, which fires no event', () => {
      const input = slider({ value: '10' });
      document.body.appendChild(input);
      observer = installRangeProgress(document);
      expect(progress(input)).toBe('10%');

      input.value = '35';
      expect(input.value).toBe('35');
      expect(progress(input)).toBe('35%');
    });

    it('picks up sliders added later, whatever they are nested in', async () => {
      observer = installRangeProgress(document);
      const wrapper = document.createElement('div');
      wrapper.innerHTML = '<label><input type="range" min="0" max="200" value="50"></label>';
      document.body.appendChild(wrapper);
      await flush();

      const input = wrapper.querySelector('input');
      expect(progress(input)).toBe('25%');
      input.value = '100';
      expect(progress(input)).toBe('50%');
    });

    it('moves the fill when a slider is given new limits', async () => {
      const input = slider({ value: '50' });
      document.body.appendChild(input);
      observer = installRangeProgress(document);

      input.max = '200';
      await flush();
      expect(progress(input)).toBe('25%');
    });

    it('leaves other inputs alone and tracks a slider once', async () => {
      const text = document.createElement('input');
      const range = slider();
      document.body.append(text, range);
      observer = installRangeProgress(document);
      document.body.append(range);
      await flush();

      expect(progress(text)).toBe('');
      const { set } = Object.getOwnPropertyDescriptor(range, 'value');
      range.dispatchEvent(new Event('input', { bubbles: true }));
      expect(Object.getOwnPropertyDescriptor(range, 'value').set).toBe(set);
      expect(Object.getOwnPropertyDescriptor(text, 'value')).toBeUndefined();
    });
  });
});
