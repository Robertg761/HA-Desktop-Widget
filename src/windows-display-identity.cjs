/* global Buffer, __dirname, process */
const childProcess = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

// Chromium hashes the target adapter LUID and target ID, not the GDI display name.
// https://chromium.googlesource.com/chromium/src/+/main/ui/display/win/display_info.cc
// PersistentHash uses SuperFastHash. Only ASCII integer strings are hashed here.
// The SuperFastHash algorithm below is adapted under its BSD license:
// Copyright (c) 2010, Paul Hsieh. All rights reserved.
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are met:
// * Redistributions of source code must retain the above copyright notice, this
//   list of conditions and the following disclaimer.
// * Redistributions in binary form must reproduce the above copyright notice,
//   this list of conditions and the following disclaimer in the documentation
//   and/or other materials provided with the distribution.
// * Neither my name, Paul Hsieh, nor the names of any other contributors to the
//   code use may be used to endorse or promote products derived from this
//   software without specific prior written permission.
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
// AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
// IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
// ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
// LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
// CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
// SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
// INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
// CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
// ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
// POSSIBILITY OF SUCH DAMAGE.
function chromiumDisplayId({ adapterLow, adapterHigh, targetId }) {
  if (
    !Number.isInteger(adapterLow) ||
    adapterLow < 0 ||
    adapterLow > 0xffffffff ||
    !Number.isInteger(adapterHigh) ||
    adapterHigh < -0x80000000 ||
    adapterHigh > 0x7fffffff ||
    !Number.isInteger(targetId) ||
    targetId < 0 ||
    targetId > 0xffffffff
  )
    throw new TypeError('Invalid Windows display target identifiers');
  const bytes = Buffer.from(`${adapterLow}/${adapterHigh}/${targetId}`, 'ascii');
  let hash = bytes.length;
  let offset = 0;
  for (; offset + 4 <= bytes.length; offset += 4) {
    hash = (hash + bytes.readUInt16LE(offset)) >>> 0;
    const temporary = (bytes.readUInt16LE(offset + 2) << 11) ^ hash;
    hash = ((hash << 16) ^ temporary) >>> 0;
    hash = (hash + (hash >>> 11)) >>> 0;
  }
  switch (bytes.length - offset) {
    case 3:
      hash = (hash + bytes.readUInt16LE(offset)) >>> 0;
      hash ^= hash << 16;
      hash ^= bytes[offset + 2] << 18;
      hash = (hash + (hash >>> 11)) >>> 0;
      break;
    case 2:
      hash = (hash + bytes.readUInt16LE(offset)) >>> 0;
      hash ^= hash << 11;
      hash = (hash + (hash >>> 17)) >>> 0;
      break;
    case 1:
      hash = (hash + bytes[offset]) >>> 0;
      hash ^= hash << 10;
      hash = (hash + (hash >>> 1)) >>> 0;
      break;
  }
  hash ^= hash << 3;
  hash = (hash + (hash >>> 5)) >>> 0;
  hash ^= hash << 4;
  hash = (hash + (hash >>> 17)) >>> 0;
  hash ^= hash << 25;
  return String((hash + (hash >>> 6)) >>> 0);
}

function parseWindowsDisplayIdentities(stdout) {
  const value = JSON.parse(stdout.replace(/^\uFEFF/, ''));
  const records = Array.isArray(value) ? value : [value];
  const pathsById = new Map();
  const idsByPath = new Map();
  for (const record of records) {
    if (
      !record ||
      typeof record.monitorDevicePath !== 'string' ||
      !record.monitorDevicePath.trim()
    ) {
      throw new TypeError('Missing Windows monitor device path');
    }
    const id = chromiumDisplayId(record);
    const devicePath = record.monitorDevicePath.trim().toLowerCase();
    if (!pathsById.has(id)) pathsById.set(id, new Set());
    if (!idsByPath.has(devicePath)) idsByPath.set(devicePath, new Set());
    pathsById.get(id).add(devicePath);
    idsByPath.get(devicePath).add(id);
  }
  const identities = {};
  for (const [id, paths] of pathsById) {
    if (paths.size !== 1) continue;
    const [devicePath] = paths;
    if (idsByPath.get(devicePath).size === 1) identities[id] = devicePath;
  }
  return identities;
}

/** Read active Windows monitor identities without loading native code into Electron. */
async function loadWindowsDisplayIdentities({
  platform = process.platform,
  execFile = childProcess.execFile,
} = {}) {
  if (platform !== 'win32') return {};
  // Read through Electron's asar-aware filesystem; PowerShell cannot open an asar path.
  const script = await fs.readFile(path.join(__dirname, 'windows-display-identity.ps1'), 'utf8');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const executable = path.win32.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  );
  const stdout = await new Promise((resolve, reject) => {
    execFile(
      executable,
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      {
        windowsHide: true,
        timeout: 10000,
        maxBuffer: 1024 * 1024,
        encoding: 'utf8',
      },
      (error, output) => (error ? reject(error) : resolve(output))
    );
  });
  return parseWindowsDisplayIdentities(stdout);
}
module.exports = { chromiumDisplayId, parseWindowsDisplayIdentities, loadWindowsDisplayIdentities };
