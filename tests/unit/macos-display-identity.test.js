/** @jest-environment node */
const {
  parseMacOSDisplayIdentities,
  loadMacOSDisplayIdentities,
} = require('../../src/macos-display-identity.cjs');

const firstUUID = '01234567-89AB-CDEF-0123-456789ABCDEF';
const secondUUID = 'FEDCBA98-7654-3210-FEDC-BA9876543210';
const first = { displayId: 23, uuid: firstUUID };
const second = { displayId: 42, uuid: secondUUID };

test('maps native display IDs to normalized UUIDs without relying on labels or geometry', () => {
  expect(parseMacOSDisplayIdentities(JSON.stringify([first, second]))).toEqual({
    23: '01234567-89ab-cdef-0123-456789abcdef',
    42: 'fedcba98-7654-3210-fedc-ba9876543210',
  });
});

test('keeps the UUID when macOS assigns a new runtime display ID', () => {
  expect(
    parseMacOSDisplayIdentities(JSON.stringify([{ ...first, displayId: 4294967295 }]))
  ).toEqual({
    4294967295: '01234567-89ab-cdef-0123-456789abcdef',
  });
});

test('omits conflicting runtime IDs while retaining unambiguous displays', () => {
  expect(
    parseMacOSDisplayIdentities(
      JSON.stringify([
        first,
        { ...second, displayId: 23 },
        { displayId: 64, uuid: 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE' },
      ])
    )
  ).toEqual({ 64: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' });
});

test('omits UUIDs claimed by multiple runtime IDs', () => {
  expect(
    parseMacOSDisplayIdentities(
      JSON.stringify([first, { ...first, displayId: 42, uuid: firstUUID.toLowerCase() }])
    )
  ).toEqual({});
});

test('deduplicates identical records', () => {
  expect(parseMacOSDisplayIdentities(JSON.stringify([first, first]))).toEqual({
    23: '01234567-89ab-cdef-0123-456789abcdef',
  });
});

test('returns an empty map when there are no screens', () => {
  expect(parseMacOSDisplayIdentities('[]')).toEqual({});
});

test.each([
  '',
  'not JSON',
  '{}',
  'null',
  '[null]',
  JSON.stringify([{ ...first, displayId: 0 }]),
  JSON.stringify([{ ...first, displayId: -1 }]),
  JSON.stringify([{ ...first, displayId: 4294967296 }]),
  JSON.stringify([{ ...first, displayId: 2.5 }]),
  JSON.stringify([{ ...first, displayId: '23' }]),
  JSON.stringify([{ ...first, uuid: '' }]),
  JSON.stringify([{ ...first, uuid: null }]),
  JSON.stringify([{ ...first, uuid: 'not-a-uuid' }]),
  JSON.stringify([{ ...first, uuid: '00000000-0000-0000-0000-000000000000' }]),
])('rejects malformed native identities: %s', (stdout) => {
  expect(() => parseMacOSDisplayIdentities(stdout)).toThrow();
});

test('does not launch macOS discovery on other platforms', async () => {
  const execFile = () => {
    throw new Error('must not spawn');
  };
  await expect(loadMacOSDisplayIdentities({ platform: 'linux', execFile })).resolves.toEqual({});
});

test('queries through bounded asynchronous osascript execution without a shell', async () => {
  const execFile = (executable, args, options, callback) => {
    expect(executable).toBe('/usr/bin/osascript');
    expect(args).toEqual(['-l', 'JavaScript', '-e', expect.any(String)]);
    expect(options).toMatchObject({ timeout: 10000, maxBuffer: 1024 * 1024, encoding: 'utf8' });
    expect(options.shell).not.toBe(true);
    setImmediate(() => callback(null, JSON.stringify([first, second]), ''));
  };
  await expect(loadMacOSDisplayIdentities({ platform: 'darwin', execFile })).resolves.toEqual({
    23: '01234567-89ab-cdef-0123-456789abcdef',
    42: 'fedcba98-7654-3210-fedc-ba9876543210',
  });
});

test.each(['ENOENT', 'ETIMEDOUT'])('propagates native discovery errors: %s', async (code) => {
  const error = Object.assign(new Error('native query failed'), { code });
  const execFile = (_file, _args, _options, callback) => callback(error, '', '');
  await expect(loadMacOSDisplayIdentities({ platform: 'darwin', execFile })).rejects.toBe(error);
});

test('rejects invalid output from a successful process', async () => {
  const execFile = (_file, _args, _options, callback) => callback(null, 'unexpected output', '');
  await expect(loadMacOSDisplayIdentities({ platform: 'darwin', execFile })).rejects.toThrow();
});
