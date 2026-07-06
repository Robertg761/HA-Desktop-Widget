const { buildSparklinePoints } = require('../../src/sparklines.js');

describe('buildSparklinePoints', () => {
  it('returns an empty point string for an empty series', () => {
    expect(buildSparklinePoints([], 100, 40)).toBe('');
  });

  it('centers a single value', () => {
    expect(buildSparklinePoints([42], 100, 40)).toBe('50,20');
  });

  it('centers flat series without dividing by zero', () => {
    expect(buildSparklinePoints([5, 5, 5], 100, 40)).toBe('0,20 50,20 100,20');
  });

  it('scales a normal series across the sparkline box', () => {
    expect(buildSparklinePoints([0, 50, 100], 100, 40)).toBe('0,40 50,20 100,0');
  });
});
