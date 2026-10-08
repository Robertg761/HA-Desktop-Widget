/* global process */
const childProcess = require('node:child_process');

// Chromium uses NSScreenNumber (CGDirectDisplayID) directly as Display.id:
// https://chromium.googlesource.com/chromium/src/+/main/ui/display/mac/screen_mac.mm
// ColorSync converts that runtime ID into the display's persistent UUID:
// https://developer.apple.com/documentation/colorsync/cgdisplaycreateuuidfromdisplayid(_:)
// Run in the built-in JavaScript for Automation host, without native addons or
// a compiler. Passing the script as text also works inside packaged app.asar.
const discoveryScript = `
ObjC.import('AppKit');
ObjC.import('ColorSync');
ObjC.import('CoreFoundation');
var screens = $.NSScreen.screens;
var records = [];
for (var index = 0; index < screens.count; index++) {
  var screen = screens.objectAtIndex(index);
  var displayId = screen.deviceDescription.objectForKey('NSScreenNumber').unsignedIntValue;
  var uuid = $.CGDisplayCreateUUIDFromDisplayID(displayId);
  var uuidString = $.CFUUIDCreateString(null, uuid);
  records.push({ displayId: displayId, uuid: ObjC.unwrap(uuidString) });
}
JSON.stringify(records);
`;

function parseMacOSDisplayIdentities(stdout) {
  const records = JSON.parse(stdout);
  if (!Array.isArray(records)) throw new TypeError('Invalid macOS display identity list');
  const uuidsById = new Map();
  const idsByUUID = new Map();
  for (const record of records) {
    if (
      !record ||
      !Number.isInteger(record.displayId) ||
      record.displayId <= 0 ||
      record.displayId > 0xffffffff ||
      typeof record.uuid !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(record.uuid) ||
      record.uuid === '00000000-0000-0000-0000-000000000000'
    ) {
      throw new TypeError('Invalid macOS display identity');
    }
    const id = String(record.displayId);
    const uuid = record.uuid.toLowerCase();
    if (!uuidsById.has(id)) uuidsById.set(id, new Set());
    if (!idsByUUID.has(uuid)) idsByUUID.set(uuid, new Set());
    uuidsById.get(id).add(uuid);
    idsByUUID.get(uuid).add(id);
  }
  const identities = {};
  for (const [id, uuids] of uuidsById) {
    if (uuids.size !== 1) continue;
    const [uuid] = uuids;
    if (idsByUUID.get(uuid).size === 1) identities[id] = uuid;
  }
  return identities;
}

/** Read macOS monitor UUIDs without loading native code into Electron. */
async function loadMacOSDisplayIdentities({
  platform = process.platform,
  execFile = childProcess.execFile,
} = {}) {
  if (platform !== 'darwin') return {};
  const stdout = await new Promise((resolve, reject) => {
    execFile(
      '/usr/bin/osascript',
      ['-l', 'JavaScript', '-e', discoveryScript],
      { timeout: 10000, maxBuffer: 1024 * 1024, encoding: 'utf8' },
      (error, output) => (error ? reject(error) : resolve(output))
    );
  });
  return parseMacOSDisplayIdentities(stdout);
}
module.exports = { parseMacOSDisplayIdentities, loadMacOSDisplayIdentities };
