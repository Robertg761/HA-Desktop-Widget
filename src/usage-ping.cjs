'use strict';

/**
 * Anonymous install counting. Each install gets a random ID (a UUID with no
 * link to the user, the computer or Home Assistant) and sends it once a day
 * with the app version and OS family, so the maintainer can count how many
 * installs are in use. Nothing else is sent: no settings, entities, URLs,
 * hostnames or usage events.
 *
 * The ID lives in its own file in the profile folder rather than config.json,
 * so settings export, profile sync and the development profile clone never
 * copy it to another computer and count two installs as one.
 */

const USAGE_PING_URL = 'https://usage.hadesktopwidget.com/v1/ping';
const USAGE_STATE_FILE_NAME = 'usage-ping.json';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KNOWN_PLATFORMS = new Set(['win32', 'darwin', 'linux']);

/** UTC calendar day, e.g. "2026-10-02". The server counts at most one ping per install per day. */
function utcDay(now) {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * True when the environment asks apps not to phone home. DO_NOT_TRACK is the
 * cross-tool convention (https://consoledonottrack.com).
 */
function isUsagePingDisabledByEnv(env = {}) {
  const truthy = (value) => /^(1|true|yes)$/i.test(String(value || '').trim());
  return truthy(env.DO_NOT_TRACK) || truthy(env.HA_WIDGET_DISABLE_USAGE_PING);
}

function readUsageState(fs, statePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (parsed && typeof parsed === 'object' && UUID_PATTERN.test(parsed.installId)) {
      return {
        installId: parsed.installId,
        lastPingDay: typeof parsed.lastPingDay === 'string' ? parsed.lastPingDay : '',
      };
    }
  } catch {
    // Missing or damaged: a new ID is minted below.
  }
  return null;
}

function writeUsageState(fs, statePath, state) {
  const temporaryPath = `${statePath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(state, null, 2));
  fs.renameSync(temporaryPath, statePath);
}

/**
 * Sends the daily ping while the app runs. `isEnabled` is read before every
 * send, so turning the setting off takes effect without a restart.
 */
function createUsagePinger({
  fs,
  path,
  userDataDir,
  randomUUID,
  fetchImpl,
  isEnabled,
  appVersion,
  platform,
  log,
  url = USAGE_PING_URL,
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  initialDelayMs = 60 * 1000,
  checkIntervalMs = 60 * 60 * 1000,
  timeoutMs = 10 * 1000,
}) {
  const statePath = path.join(userDataDir, USAGE_STATE_FILE_NAME);
  let timer = null;
  let inFlight = false;

  function loadOrCreateState() {
    const existing = readUsageState(fs, statePath);
    if (existing) return existing;
    const created = { installId: randomUUID(), lastPingDay: '' };
    writeUsageState(fs, statePath, created);
    return created;
  }

  async function pingIfDue() {
    if (inFlight || !isEnabled()) return false;
    const today = utcDay(now());
    let state;
    try {
      state = loadOrCreateState();
    } catch (error) {
      log?.warn?.(`Usage ping skipped: could not read or create the install ID (${error.message})`);
      return false;
    }
    if (state.lastPingDay === today) return false;

    inFlight = true;
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: state.installId,
          version: String(appVersion || ''),
          os: KNOWN_PLATFORMS.has(platform) ? platform : 'other',
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`status ${response.status}`);
      }
      writeUsageState(fs, statePath, { ...state, lastPingDay: today });
      return true;
    } catch (error) {
      // Offline, blocked by a firewall, or the service is down. Try again next check.
      log?.info?.(`Usage ping not sent: ${error.message}`);
      return false;
    } finally {
      inFlight = false;
    }
  }

  // Checking hourly (instead of sleeping a whole day) keeps the count right for
  // a widget left running for weeks across sleep/resume cycles.
  function schedule(delayMs) {
    timer = setTimer(async () => {
      timer = null;
      await pingIfDue();
      schedule(checkIntervalMs);
    }, delayMs);
    timer?.unref?.();
  }

  return {
    start() {
      if (timer) return;
      schedule(initialDelayMs);
    },
    stop() {
      if (timer) clearTimer(timer);
      timer = null;
    },
    pingIfDue,
    statePath,
  };
}

module.exports = {
  USAGE_PING_URL,
  USAGE_STATE_FILE_NAME,
  createUsagePinger,
  isUsagePingDisabledByEnv,
  utcDay,
};
