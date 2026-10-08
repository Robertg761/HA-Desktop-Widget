/** @jest-environment node */
const {
  chromiumDisplayId,
  parseWindowsDisplayIdentities,
  loadWindowsDisplayIdentities,
} = require('../../src/windows-display-identity.cjs');

const monitorDevicePath = String.raw`\\?\DISPLAY#DEL1234#5&abc&0&UID1#{guid}`;
const record = { adapterLow: 123456, adapterHigh: 0, targetId: 1, monitorDevicePath };

// Independent outputs from Chromium's C SuperFastHash implementation compiled with gcc.
test.each([
  [0, 0, 0, '671097153'],
  [1, 0, 1, '3750480655'],
  [4294967295, -2147483648, 4294967295, '1088600165'],
  [123456, 0, 1, '704503303'],
  [123456, 0, 2, '3417864418'],
  [123456, -1, 17, '837475321'],
  [1, 1, 1, '1880153133'],
])('matches Chromium runtime hash for %s/%s/%s', (adapterLow, adapterHigh, targetId, expected) => {
  expect(chromiumDisplayId({ adapterLow, adapterHigh, targetId })).toBe(expected);
});

test.each([
  { adapterLow: -1 },
  { adapterHigh: 2147483648 },
  { targetId: 4294967296 },
  { adapterLow: '123456' },
  { targetId: 1.5 },
  { targetId: null },
])('rejects invalid native integer fields: %j', (patch) => {
  expect(() => chromiumDisplayId({ ...record, ...patch })).toThrow();
});

test('accepts PowerShell singleton JSON and normalizes a native device path', () => {
  expect(parseWindowsDisplayIdentities('\uFEFF' + JSON.stringify(record))).toEqual({
    704503303: monitorDevicePath.toLowerCase(),
  });
});

test('maps same-label monitors only by native target identity', () => {
  const other = {
    ...record,
    targetId: 2,
    monitorDevicePath: monitorDevicePath.replace('UID1', 'UID2'),
  };
  expect(parseWindowsDisplayIdentities(JSON.stringify([record, other]))).toEqual({
    704503303: monitorDevicePath.toLowerCase(),
    3417864418: other.monitorDevicePath.toLowerCase(),
  });
});

test('keeps a stable device path when the adapter runtime identity changes', () => {
  const before = parseWindowsDisplayIdentities(JSON.stringify(record));
  const after = parseWindowsDisplayIdentities(
    JSON.stringify({ ...record, adapterHigh: -1, targetId: 17 })
  );
  expect(before).toEqual({ 704503303: monitorDevicePath.toLowerCase() });
  expect(after).toEqual({ 837475321: monitorDevicePath.toLowerCase() });
});

test('omits ambiguous runtime IDs rather than choosing a device path', () => {
  const other = { ...record, monitorDevicePath: monitorDevicePath.replace('UID1', 'UID2') };
  expect(parseWindowsDisplayIdentities(JSON.stringify([record, other, record]))).toEqual({});
});

test('omits a device path claimed by multiple runtime IDs', () => {
  expect(
    parseWindowsDisplayIdentities(JSON.stringify([record, { ...record, targetId: 2 }]))
  ).toEqual({});
});

test('deduplicates identical native paths', () => {
  expect(parseWindowsDisplayIdentities(JSON.stringify([record, record]))).toEqual({
    704503303: monitorDevicePath.toLowerCase(),
  });
});

test('returns no identities when no active paths exist', () => {
  expect(parseWindowsDisplayIdentities('[]')).toEqual({});
});

test.each(['', 'not JSON', '{}', 'null', JSON.stringify({ ...record, monitorDevicePath: '' })])(
  'rejects unavailable or malformed native output %s',
  (output) => expect(() => parseWindowsDisplayIdentities(output)).toThrow()
);

test('does not run Windows discovery on other platforms', async () => {
  const execFile = () => {
    throw new Error('must not spawn');
  };
  await expect(loadWindowsDisplayIdentities({ platform: 'linux', execFile })).resolves.toEqual({});
});

test('queries Windows asynchronously without a window, shell, or unbounded process', async () => {
  const execFile = (executable, args, options, callback) => {
    expect(executable.toLowerCase()).toMatch(/powershell\.exe$/);
    expect(args).toEqual(['-NoProfile', '-NonInteractive', '-EncodedCommand', expect.any(String)]);
    expect(options).toMatchObject({ windowsHide: true, timeout: 10000, encoding: 'utf8' });
    expect(options.shell).not.toBe(true);
    // A packaged script is sent as text because PowerShell cannot read inside app.asar.
    expect(Buffer.from(args[3], 'base64').toString('utf16le').length).toBeGreaterThan(100);
    setImmediate(() => callback(null, JSON.stringify(record), ''));
  };
  await expect(loadWindowsDisplayIdentities({ platform: 'win32', execFile })).resolves.toEqual({
    704503303: monitorDevicePath.toLowerCase(),
  });
});

test.each(['ENOENT', 'ETIMEDOUT'])('propagates native discovery failure %s', async (code) => {
  const error = Object.assign(new Error('native query failed'), { code });
  const execFile = (_file, _args, _options, callback) => callback(error, '', '');
  await expect(loadWindowsDisplayIdentities({ platform: 'win32', execFile })).rejects.toBe(error);
});

test('rejects invalid output from a successful process', async () => {
  const execFile = (_file, _args, _options, callback) => callback(null, 'unexpected output', '');
  await expect(loadWindowsDisplayIdentities({ platform: 'win32', execFile })).rejects.toThrow();
});
