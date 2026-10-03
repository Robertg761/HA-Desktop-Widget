#!/usr/bin/env node
/**
 * Maintenance tool for the language catalogs.
 *
 * English lives in locales/en.json. Every other language ships twice: as a downloadable pack in
 * locale-packs/<locale>.json (fetched from raw.githubusercontent.com, so a pack only reaches users
 * once it is on main and its manifest entry is current) and, for German, as a bundled catalog in
 * locales/<locale>.json. Adding a string therefore touches eight files, and every PR that adds one
 * conflicts with every other. This tool does the mechanical part:
 *
 *   check   [--against <ref>]          packs, catalogs and manifest agree (keys, placeholders,
 *                                      no blank text, versions, sha256); with --against, content
 *                                      that changed since <ref> must also carry a higher version
 *   add     <strings.json>             add or update keys everywhere from {key: {en, ar, de, ...}};
 *                                      a retired key that is added again stops being retired
 *   remove  --in <version> --reason <text> <key>...
 *                                      retire keys: drop them from en.json and the bundled catalogs,
 *                                      keep their translations in the packs and list them in
 *                                      locale-packs/retired-keys.json
 *   remove  --purge <key>...           delete keys everywhere, retired list included
 *   export  <base-ref> [<head-ref>]    print the texts added or changed between two refs, in the
 *                                      format `add` reads (head defaults to HEAD); a new key lists
 *                                      every language, an existing key only the ones that changed
 *   bump    [--against <ref>] [locale...]
 *                                      patch-bump every pack whose content differs from <ref>
 *                                      (default HEAD) and has not been bumped yet, or exactly the
 *                                      named packs; then refreshes the manifest
 *   manifest                           copy each pack's version and sha256 into manifest.json
 *
 * Packs outlive the app versions that wrote them: installed apps download whatever is on main,
 * merge it over their own bundled English and look strings up by English text. A key a newer
 * release stops using is still needed by every older release the manifest serves, so removing it
 * from the packs would silently turn it English there. Retiring keeps it. See "Language packs" in
 * CONTRIBUTING.md for when to retire, when to purge and the merge-conflict recipe.
 *
 * Files are written as JSON.stringify(value, null, 2) + "\n", which is what the manifest's sha256
 * is computed over.
 */

const nodeCrypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ENGLISH = 'en';
const RETIRED_FILE = 'retired-keys.json';
// The same pattern src/i18n-main.cjs interpolates with.
const PLACEHOLDER_PATTERN = /\{\{\s*([\w.]+)\s*\}\}/g;
const MAX_LISTED = 8;

function pathsFor(root) {
  return {
    root,
    english: path.join(root, 'locales', ENGLISH + '.json'),
    bundledDir: path.join(root, 'locales'),
    packDir: path.join(root, 'locale-packs'),
    manifest: path.join(root, 'locale-packs', 'manifest.json'),
    retired: path.join(root, 'locale-packs', RETIRED_FILE),
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeJson(file, value) {
  fs.writeFileSync(file, serialize(value));
}

function sha256(file) {
  return nodeCrypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function placeholderNames(text) {
  return [...String(text).matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]).sort();
}

/** True unless `value` is text with a visible character; the app shows "" as the English key. */
function isBlankText(value) {
  return typeof value !== 'string' || !value.trim();
}

function sameList(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function listKeys(keys) {
  const shown = keys
    .slice(0, MAX_LISTED)
    .map((key) => JSON.stringify(key.length > 70 ? `${key.slice(0, 67)}...` : key));
  const more = keys.length - shown.length;
  return more > 0 ? `${shown.join(', ')} and ${more} more` : shown.join(', ');
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version));
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(left, right) {
  const [a, b] = [parseVersion(left), parseVersion(right)];
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function bumpPatch(version) {
  const [major, minor, patch] = parseVersion(version);
  return `${major}.${minor}.${patch + 1}`;
}

/** Locale codes of the pack files on disk, sorted. */
function packLocales(paths) {
  return fs
    .readdirSync(paths.packDir)
    .filter((file) => file.endsWith('.json') && file !== 'manifest.json' && file !== RETIRED_FILE)
    .map((file) => path.basename(file, '.json'))
    .sort();
}

/** Locale codes of the bundled catalogs next to en.json, sorted. */
function bundledLocales(paths) {
  return fs
    .readdirSync(paths.bundledDir)
    .filter((file) => file.endsWith('.json') && file !== `${ENGLISH}.json`)
    .map((file) => path.basename(file, '.json'))
    .sort();
}

const packFile = (paths, locale) => path.join(paths.packDir, `${locale}.json`);
const bundledFile = (paths, locale) => path.join(paths.bundledDir, `${locale}.json`);

function git(root, args) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function assertRef(root, ref) {
  if (git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).status !== 0) {
    throw new Error(`Unknown git ref "${ref}".`);
  }
}

/** The parsed JSON file as it was at `ref`, or null when the ref has no such file. */
function readJsonAt(root, ref, relativePath) {
  const result = git(root, ['show', `${ref}:${relativePath}`]);
  return result.status === 0 ? JSON.parse(result.stdout) : null;
}

function withoutVersion(pack) {
  const { version: _version, ...rest } = pack;
  return rest;
}

function sameContent(left, right) {
  return JSON.stringify(withoutVersion(left)) === JSON.stringify(withoutVersion(right));
}

/**
 * The retired keys as a map of key -> {retiredIn, reason, en?}. A missing file is an empty list, so
 * a checkout from before the list existed still works.
 */
function readRetired(paths) {
  return fs.existsSync(paths.retired) ? readJson(paths.retired) : {};
}

/** The English text a retired key had; it is the key itself unless the entry says otherwise. */
function retiredEnglish(retired, key) {
  const text = retired[key]?.en;
  return isBlankText(text) ? key : text;
}

/** `messages` without the retired keys, which only the packs carry. */
function withoutRetired(messages, english, retired) {
  return Object.fromEntries(
    Object.entries(messages).filter(([key]) => key in english || !(key in retired))
  );
}

/**
 * The problems with the retired list itself. Returns the list to check packs against: the entries
 * that are not also current English, which would otherwise be required twice.
 */
function checkRetired(english, retired, problems) {
  const label = `locale-packs/${RETIRED_FILE}`;
  if (!retired || typeof retired !== 'object' || Array.isArray(retired)) {
    problems.push(`${label} must be an object of {key: {retiredIn, reason}}`);
    return {};
  }
  const entries = Object.entries(retired);
  const malformed = entries.filter(
    ([, entry]) => !entry || typeof entry !== 'object' || Array.isArray(entry)
  );
  if (malformed.length) {
    problems.push(
      `${label} needs an object of {retiredIn, reason} for: ${listKeys(malformed.map(([key]) => key))}`
    );
  }
  const objects = entries.filter((entry) => !malformed.includes(entry));
  const keysWhere = (test) => objects.filter(([, entry]) => test(entry)).map(([key]) => key);
  const noVersion = keysWhere((entry) => !parseVersion(entry.retiredIn));
  if (noVersion.length) {
    problems.push(`${label} needs retiredIn as major.minor.patch for: ${listKeys(noVersion)}`);
  }
  const noReason = keysWhere((entry) => isBlankText(entry.reason));
  if (noReason.length) problems.push(`${label} needs a reason for: ${listKeys(noReason)}`);
  const blankEnglish = keysWhere((entry) => 'en' in entry && isBlankText(entry.en));
  if (blankEnglish.length) {
    problems.push(`${label} has blank en text for: ${listKeys(blankEnglish)}`);
  }
  const alsoCurrent = entries.map(([key]) => key).filter((key) => key in english);
  if (alsoCurrent.length) {
    problems.push(
      `${label} lists keys en.json still has: ${listKeys(alsoCurrent)} ("add" a key again to un-retire it)`
    );
  }
  return Object.fromEntries(entries.filter(([key]) => !(key in english)));
}

/**
 * `retired` is given for packs, which must carry every current and every retired key, and left out
 * for the bundled catalogs, which only ever hold current keys.
 */
function checkMessages(label, english, messages, problems, retired = null) {
  const englishKeys = Object.keys(english);
  const retiredKeys = retired ? Object.keys(retired) : [];
  const missing = englishKeys.filter((key) => !(key in messages));
  const missingRetired = retiredKeys.filter((key) => !(key in messages));
  const extra = Object.keys(messages).filter(
    (key) => !(key in english) && !(retired && key in retired)
  );
  if (missing.length)
    problems.push(`${label} is missing ${missing.length} keys: ${listKeys(missing)}`);
  if (missingRetired.length) {
    problems.push(
      `${label} is missing ${missingRetired.length} retired keys that older apps still use: ${listKeys(missingRetired)}`
    );
  }
  if (extra.length) {
    problems.push(
      retired
        ? `${label} has ${extra.length} keys that neither en.json nor ${RETIRED_FILE} lists: ${listKeys(extra)}`
        : `${label} has ${extra.length} keys en.json lacks: ${listKeys(extra)}`
    );
  }

  const notStrings = Object.keys(messages).filter((key) => typeof messages[key] !== 'string');
  if (notStrings.length)
    problems.push(`${label} has non-string values for: ${listKeys(notStrings)}`);

  const blank = Object.keys(messages).filter(
    (key) => typeof messages[key] === 'string' && isBlankText(messages[key])
  );
  if (blank.length) problems.push(`${label} has blank text for: ${listKeys(blank)}`);

  const drifted = [
    ...englishKeys.map((key) => [key, english[key]]),
    ...retiredKeys.map((key) => [key, retiredEnglish(retired, key)]),
  ]
    .filter(
      ([key, text]) =>
        key in messages &&
        !isBlankText(messages[key]) &&
        !sameList(placeholderNames(text), placeholderNames(messages[key]))
    )
    .map(([key]) => key);
  if (drifted.length) {
    problems.push(`${label} changes the {{placeholders}} of: ${listKeys(drifted)}`);
  }
}

/** Every inconsistency between en.json, the packs, the bundled catalogs and the manifest. */
function checkPacks(paths, { against } = {}) {
  const problems = [];
  const english = readJson(paths.english);
  const manifest = readJson(paths.manifest);
  const entries = new Map(manifest.packs.map((entry) => [entry.locale, entry]));
  const locales = packLocales(paths);
  const retired = checkRetired(english, readRetired(paths), problems);

  for (const locale of entries.keys()) {
    if (!locales.includes(locale)) {
      problems.push(
        `manifest.json lists ${locale}, but locale-packs/${locale}.json does not exist`
      );
    }
  }

  if (against) assertRef(paths.root, against);

  for (const locale of locales) {
    const label = `locale-packs/${locale}.json`;
    const pack = readJson(packFile(paths, locale));
    const entry = entries.get(locale);

    if (pack.locale !== locale)
      problems.push(`${label} declares locale ${JSON.stringify(pack.locale)}`);
    checkMessages(label, english, pack.messages || {}, problems, retired);

    if (!parseVersion(pack.version)) {
      problems.push(
        `${label} has version ${JSON.stringify(pack.version)}, expected major.minor.patch`
      );
    }
    if (!entry) {
      problems.push(`${label} is not listed in manifest.json`);
      continue;
    }
    if (entry.version !== pack.version) {
      problems.push(
        `manifest.json lists ${locale} at ${entry.version}, but the pack says ${pack.version} (run "manifest")`
      );
    }
    if (entry.sha256 !== sha256(packFile(paths, locale))) {
      problems.push(`manifest.json has a stale sha256 for ${locale} (run "manifest")`);
    }

    if (against && parseVersion(pack.version)) {
      const base = readJsonAt(paths.root, against, `locale-packs/${locale}.json`);
      if (base && !sameContent(base, pack) && compareVersions(pack.version, base.version) <= 0) {
        problems.push(
          `${label} changed since ${against} but its version is still ${pack.version} (run "bump --against ${against}")`
        );
      }
    }
  }

  for (const locale of bundledLocales(paths)) {
    const label = `locales/${locale}.json`;
    const messages = readJson(bundledFile(paths, locale));
    checkMessages(label, english, messages, problems);
    if (locales.includes(locale)) {
      const pack = readJson(packFile(paths, locale));
      const current = withoutRetired(pack.messages || {}, english, retired);
      if (JSON.stringify(messages) !== JSON.stringify(current)) {
        problems.push(`${label} differs from locale-packs/${locale}.json`);
      }
    }
  }

  return problems;
}

/**
 * Add or update keys in en.json, every pack and every bundled catalog.
 * `strings` maps each key to {en, <locale>: text, ...}. A new key needs a value for every locale;
 * an existing key may name only the locales whose text changes. Every value given must be text
 * with a visible character. A retired key counts as new, and adding it again takes it off the
 * retired list. Nothing is written when any entry is invalid.
 */
function addStrings(paths, strings) {
  if (!strings || typeof strings !== 'object' || Array.isArray(strings)) {
    throw new Error('Expected a JSON object of {key: {en, ar, de, ...}}.');
  }
  const english = readJson(paths.english);
  const retired = readRetired(paths);
  const locales = packLocales(paths);
  const catalogs = new Map();
  for (const locale of locales) {
    catalogs.set(locale, {
      file: packFile(paths, locale),
      data: readJson(packFile(paths, locale)),
    });
  }
  const bundled = new Map();
  for (const locale of bundledLocales(paths)) {
    bundled.set(locale, {
      file: bundledFile(paths, locale),
      data: readJson(bundledFile(paths, locale)),
    });
  }
  const allLocales = [...new Set([...locales, ...bundled.keys()])];

  const problems = [];
  const added = [];
  const updated = [];
  for (const [key, entry] of Object.entries(strings)) {
    if (!key.trim()) {
      problems.push('Empty key.');
      continue;
    }
    if (!entry || typeof entry !== 'object') {
      problems.push(`${JSON.stringify(key)}: expected an object of translations.`);
      continue;
    }
    const isNew = !(key in english);
    const unknown = Object.keys(entry).filter(
      (name) => name !== ENGLISH && !allLocales.includes(name)
    );
    if (unknown.length)
      problems.push(`${JSON.stringify(key)}: unknown locale ${unknown.join(', ')}`);
    const required = isNew ? [ENGLISH, ...allLocales] : [];
    const absent = required.filter((name) => entry[name] === undefined);
    if (absent.length) problems.push(`${JSON.stringify(key)}: missing ${absent.join(', ')}`);
    const blank = [ENGLISH, ...allLocales].filter(
      (name) => entry[name] !== undefined && isBlankText(entry[name])
    );
    if (blank.length) {
      problems.push(`${JSON.stringify(key)}: blank or non-text value for ${blank.join(', ')}`);
    }
    const englishText = isBlankText(entry.en) ? english[key] : entry.en;
    for (const name of [ENGLISH, ...allLocales]) {
      if (isBlankText(entry[name]) || typeof englishText !== 'string') continue;
      if (!sameList(placeholderNames(englishText), placeholderNames(entry[name]))) {
        problems.push(
          `${JSON.stringify(key)}: ${name} changes the {{placeholders}} of the English text`
        );
      }
    }
    (isNew ? added : updated).push(key);
  }
  if (problems.length) throw new Error(`Nothing written:\n- ${problems.join('\n- ')}`);

  for (const [key, entry] of Object.entries(strings)) {
    if (typeof entry.en === 'string') english[key] = entry.en;
    for (const [locale, catalog] of catalogs) {
      if (typeof entry[locale] !== 'string') continue;
      // A retired key is dropped first so it lands at the end, where the bundled catalog puts it.
      if (key in retired) delete catalog.data.messages[key];
      catalog.data.messages[key] = entry[locale];
    }
    for (const [locale, catalog] of bundled) {
      if (typeof entry[locale] === 'string') catalog.data[key] = entry[locale];
    }
  }
  writeJson(paths.english, english);
  for (const { file, data } of [...catalogs.values(), ...bundled.values()]) writeJson(file, data);
  const revived = Object.keys(strings).filter((key) => key in retired);
  if (revived.length) {
    for (const key of revived) delete retired[key];
    writeJson(paths.retired, retired);
  }
  return { added, updated, revived };
}

/** The lowest minAppVersion any pack is offered to apps from, in the manifest or the pack itself. */
function lowestMinAppVersion(paths) {
  const fromManifest = readJson(paths.manifest).packs.map((entry) => entry.minAppVersion);
  const fromPacks = packLocales(paths).map(
    (locale) => readJson(packFile(paths, locale)).minAppVersion
  );
  const versions = [...fromManifest, ...fromPacks].filter(parseVersion);
  return versions.sort(compareVersions)[0] || '0.0.0';
}

/**
 * Take keys out of the app, either by retiring them or, with `purge`, by deleting them outright.
 *
 * Retiring drops a key from en.json and the bundled catalogs, which only the current release
 * reads, and lists it in retired-keys.json with the release that stops using it. The packs keep
 * their translations, because older apps download them and still look the key up.
 *
 * Purging also deletes the key from every pack and from the retired list. A retired key may only
 * be purged once no app that can install a pack still uses it, which is when the lowest
 * minAppVersion has reached the release that retired it. A current key may be purged at any time;
 * that is for text that never shipped. Nothing is written when any key is refused.
 */
function removeStrings(paths, keys, { purge = false, retiredIn, reason } = {}) {
  const unique = [...new Set(keys)];
  const english = readJson(paths.english);
  const retired = readRetired(paths);
  const unknown = unique.filter((key) => !(key in english) && !(key in retired));
  if (unknown.length) {
    throw new Error(`Not in en.json${purge ? ` or ${RETIRED_FILE}` : ''}: ${listKeys(unknown)}`);
  }

  if (purge) {
    const lowest = lowestMinAppVersion(paths);
    const inUse = unique.filter(
      (key) =>
        !(key in english) &&
        (parseVersion(retired[key]?.retiredIn)
          ? compareVersions(lowest, retired[key].retiredIn) < 0
          : true)
    );
    if (inUse.length) {
      throw new Error(
        `Cannot purge ${listKeys(inUse)}: apps from ${lowest} on can still install a pack and use ` +
          `it. Raise minAppVersion in the manifest and every pack to the release that retired it first.`
      );
    }
  } else {
    const already = unique.filter((key) => !(key in english));
    if (already.length)
      throw new Error(`Already retired (use --purge to delete): ${listKeys(already)}`);
    if (!parseVersion(retiredIn)) {
      throw new Error('Retiring a key needs --in <version>, the release that stops using it.');
    }
    if (isBlankText(reason)) throw new Error('Retiring a key needs --reason <text>.');
  }

  const touchesRetired = !purge || unique.some((key) => key in retired);
  for (const key of unique) {
    if (purge) {
      delete retired[key];
    } else {
      retired[key] = {
        retiredIn,
        reason,
        ...(english[key] === key ? {} : { en: english[key] }),
      };
    }
    delete english[key];
  }
  writeJson(paths.english, english);
  if (touchesRetired) writeJson(paths.retired, retired);
  for (const locale of bundledLocales(paths)) {
    const messages = readJson(bundledFile(paths, locale));
    for (const key of unique) delete messages[key];
    writeJson(bundledFile(paths, locale), messages);
  }
  if (purge) {
    for (const locale of packLocales(paths)) {
      const pack = readJson(packFile(paths, locale));
      for (const key of unique) delete pack.messages[key];
      writeJson(packFile(paths, locale), pack);
    }
  }
  return { retired: purge ? [] : unique, purged: purge ? unique : [] };
}

/**
 * The texts that differ between two refs, as an object `addStrings` accepts. A new key lists every
 * language; an existing key lists only the languages whose text changed. The merge recipe adds this
 * on top of another branch's catalogs, so exporting a language that only the other branch touched
 * would put the stale text back over its newer translation.
 */
function exportStrings(paths, baseRef, headRef = 'HEAD') {
  assertRef(paths.root, baseRef);
  assertRef(paths.root, headRef);
  const at = (ref, relativePath) => readJsonAt(paths.root, ref, relativePath);
  const headEnglish = at(headRef, 'locales/en.json');
  if (!headEnglish) throw new Error(`${headRef} has no locales/en.json.`);
  const baseEnglish = at(baseRef, 'locales/en.json') || {};
  const headManifest = at(headRef, 'locale-packs/manifest.json');
  const locales = (headManifest ? headManifest.packs.map((entry) => entry.locale) : []).sort();
  const text = (ref, locale) => at(ref, `locale-packs/${locale}.json`)?.messages || {};
  const headText = Object.fromEntries(locales.map((locale) => [locale, text(headRef, locale)]));
  const baseText = Object.fromEntries(locales.map((locale) => [locale, text(baseRef, locale)]));

  const result = {};
  for (const key of Object.keys(headEnglish)) {
    const isNew = !(key in baseEnglish);
    const entry = {};
    if (isNew || headEnglish[key] !== baseEnglish[key]) entry[ENGLISH] = headEnglish[key];
    for (const locale of locales) {
      const value = headText[locale][key];
      if (typeof value === 'string' && (isNew || value !== baseText[locale][key])) {
        entry[locale] = value;
      }
    }
    if (Object.keys(entry).length) result[key] = entry;
  }
  return result;
}

/** Copy every pack's version and sha256 into manifest.json. Returns the locales that changed. */
function syncManifest(paths) {
  const manifest = readJson(paths.manifest);
  const changed = [];
  for (const entry of manifest.packs) {
    const file = packFile(paths, entry.locale);
    if (!fs.existsSync(file)) {
      throw new Error(
        `manifest.json lists ${entry.locale}, but locale-packs/${entry.locale}.json is missing.`
      );
    }
    const version = readJson(file).version;
    const hash = sha256(file);
    if (entry.version !== version || entry.sha256 !== hash) {
      entry.version = version;
      entry.sha256 = hash;
      changed.push(entry.locale);
    }
  }
  if (changed.length) writeJson(paths.manifest, manifest);
  return changed;
}

/**
 * Patch-bump packs, then refresh the manifest. With named locales those packs are always bumped.
 * Otherwise a pack is bumped when its content differs from `against` and its version has not
 * moved past that ref's yet, so running this twice does not bump twice. Returns the bumps.
 */
function bumpPacks(paths, { against = 'HEAD', locales = [] } = {}) {
  const available = packLocales(paths);
  const unknown = locales.filter((locale) => !available.includes(locale));
  if (unknown.length) throw new Error(`No pack for: ${unknown.join(', ')}`);
  if (!locales.length) assertRef(paths.root, against);

  const bumps = [];
  for (const locale of locales.length ? locales : available) {
    const pack = readJson(packFile(paths, locale));
    let next = null;
    if (locales.length) {
      next = bumpPatch(pack.version);
    } else {
      const base = readJsonAt(paths.root, against, `locale-packs/${locale}.json`);
      if (base && !sameContent(base, pack) && compareVersions(pack.version, base.version) <= 0) {
        next = bumpPatch(base.version);
      }
    }
    if (!next) continue;
    bumps.push({ locale, from: pack.version, to: next });
    pack.version = next;
    writeJson(packFile(paths, locale), pack);
  }
  syncManifest(paths);
  return bumps;
}

function takeFlag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function takeOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} needs a value.`);
  args.splice(index, 2);
  return value;
}

const USAGE = `Usage: node scripts/locale-packs.cjs <command>

  check [--against <ref>]               verify packs, catalogs and manifest agree
  add <strings.json>                    add or update keys from {key: {en, ar, de, es, fr, hi, zh}}
  remove --in <version> --reason <text> <key>...
                                        retire keys: gone from the app, translations stay in the packs
  remove --purge <key>...               delete keys everywhere (see "Language packs" in CONTRIBUTING.md)
  export <base-ref> [<head-ref>]        print texts changed between refs, in the "add" format
  bump [--against <ref>] [locale...]    patch-bump changed (or named) packs, then refresh the manifest
  manifest                              copy every pack's version and sha256 into manifest.json
`;

/** Runs one command; returns the process exit code. `io` lets tests capture the output. */
function main(
  argv,
  { root = path.resolve(__dirname, '..'), stdout = console.log, stderr = console.error } = {}
) {
  const [command, ...args] = argv;
  const paths = pathsFor(root);
  try {
    switch (command) {
      case 'check': {
        const against = takeOption(args, '--against');
        const problems = checkPacks(paths, { against });
        if (problems.length) {
          stderr('Language packs are inconsistent:');
          problems.forEach((problem) => stderr(`- ${problem}`));
          return 1;
        }
        stdout('Language packs are consistent.');
        return 0;
      }
      case 'add': {
        if (!args[0]) throw new Error('add needs the path of a strings JSON file.');
        const { added, updated, revived } = addStrings(paths, readJson(path.resolve(args[0])));
        stdout(
          `Added ${added.length} keys, updated ${updated.length}` +
            `${revived.length ? ` (${revived.length} of them no longer retired)` : ''}. ` +
            'Next: "bump", then "check".'
        );
        return 0;
      }
      case 'remove': {
        const purge = takeFlag(args, '--purge');
        const retiredIn = takeOption(args, '--in');
        const reason = takeOption(args, '--reason');
        if (!args.length) throw new Error('remove needs at least one key.');
        if (purge && (retiredIn || reason)) {
          throw new Error(
            '--purge deletes keys outright; --in and --reason only apply to retiring.'
          );
        }
        const { retired, purged } = removeStrings(paths, args, { purge, retiredIn, reason });
        stdout(
          purge
            ? `Purged ${purged.length} keys. Next: "bump", then "check".`
            : `Retired ${retired.length} keys; the packs keep their translations. Next: "check".`
        );
        return 0;
      }
      case 'export': {
        if (!args[0]) throw new Error('export needs a base ref.');
        stdout(serialize(exportStrings(paths, args[0], args[1])).trimEnd());
        return 0;
      }
      case 'bump': {
        const against = takeOption(args, '--against') || undefined;
        const bumps = bumpPacks(paths, { against, locales: args });
        bumps.forEach(({ locale, from, to }) => stdout(`${locale}: ${from} -> ${to}`));
        if (!bumps.length) stdout('No pack needed a bump.');
        return 0;
      }
      case 'manifest': {
        const changed = syncManifest(paths);
        stdout(
          changed.length
            ? `Updated manifest entries: ${changed.join(', ')}`
            : 'Manifest is current.'
        );
        return 0;
      }
      default:
        stderr(USAGE);
        return command ? 1 : 0;
    }
  } catch (error) {
    stderr(error.message);
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  addStrings,
  bumpPacks,
  bumpPatch,
  checkPacks,
  compareVersions,
  exportStrings,
  main,
  pathsFor,
  placeholderNames,
  readRetired,
  removeStrings,
  syncManifest,
};
