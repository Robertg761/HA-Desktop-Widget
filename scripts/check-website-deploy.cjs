#!/usr/bin/env node
/**
 * Compares the deployed website with website/ in this checkout.
 *
 * The site deploys from main, and nothing used to check that it had: for a week the live pages
 * still described features the app did not have. Every file is fetched from the site (pages
 * without their .html, as the host's clean URLs serve them) and compared byte for byte, and each
 * file's response headers are compared with the vercel.json rules for its path, so a deployment
 * that skipped the configuration shows up as well.
 *
 * Usage: node scripts/check-website-deploy.cjs [--url https://hadesktopwidget.com] [--wait 600]
 *   --url   the site to check (default: the production site)
 *   --wait  keep checking every 15 seconds for up to this many seconds, for a deploy that is still
 *           building after a merge (default: check once)
 * Needs Node 18+ (global fetch). Exits 1 when anything differs.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_URL = 'https://hadesktopwidget.com';
const POLL_MS = 15 * 1000;
// A stalled request must not hold up the whole comparison.
const REQUEST_TIMEOUT_MS = 30 * 1000;
const request = () => ({ cache: 'no-store', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
// Files of website/ the host does not serve.
const NOT_SERVED = new Set(['vercel.json', '.gitignore']);

function listFiles(dir, base = dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return listFiles(full, base);
      return [path.relative(base, full).split(path.sep).join('/')];
    })
    .filter((file) => !NOT_SERVED.has(file))
    .sort();
}

/** The path a file is served at: index.html is the root, other pages lose their extension. */
function servedPath(file) {
  if (file === 'index.html') return '/';
  if (file.endsWith('.html')) return `/${file.slice(0, -'.html'.length)}`;
  return `/${file}`;
}

/** A vercel.json source as a pattern. The configuration only uses literal paths and (.*) groups. */
function sourcePattern(source) {
  const escaped = source
    .split('(.*)')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}$`);
}

function readHeaderRules(siteDir) {
  const config = JSON.parse(fs.readFileSync(path.join(siteDir, 'vercel.json'), 'utf8'));
  return (config.headers || []).map((rule) => ({
    pattern: sourcePattern(rule.source),
    headers: rule.headers || [],
  }));
}

/** The headers a path must carry: those of every rule whose source matches it, later rules last. */
function headersFor(rules, urlPath) {
  const expected = {};
  for (const rule of rules) {
    if (!rule.pattern.test(urlPath)) continue;
    for (const { key, value } of rule.headers) expected[key.toLowerCase()] = value;
  }
  return expected;
}

/** The headers vercel.json sets for a served path (the root by default). */
function expectedHeaders(siteDir, urlPath = '/') {
  return headersFor(readHeaderRules(siteDir), urlPath);
}

/**
 * @param {{baseUrl: string, siteDir: string, fetchImpl?: typeof fetch}} options
 * @returns {Promise<string[]>} What differs, one line each; empty when the deployment matches.
 */
async function compareDeployment({ baseUrl, siteDir, fetchImpl = fetch }) {
  const problems = [];
  const root = baseUrl.replace(/\/+$/, '');
  const rules = readHeaderRules(siteDir);
  // Every file is checked against the header rules that cover its path, so a rule for one part of
  // the site (the cache lifetime of /assets) is held to it too. A header the host left out is
  // usually missing everywhere, so it is reported once, with the paths it is missing on.
  const headerMisses = new Map();
  for (const file of listFiles(siteDir)) {
    const urlPath = servedPath(file);
    const url = root + urlPath;
    let response;
    let deployed;
    try {
      response = await fetchImpl(url, request());
      // Reading the body can fail after the headers arrived (a reset or a stall); that is a
      // problem to retry like any other, not the end of the check.
      if (response.ok) deployed = Buffer.from(await response.arrayBuffer());
    } catch (error) {
      problems.push(`${url}: ${error.message}`);
      continue;
    }
    if (!response.ok) {
      problems.push(`${url}: HTTP ${response.status}`);
      continue;
    }
    if (!deployed.equals(fs.readFileSync(path.join(siteDir, file)))) {
      problems.push(`${url}: differs from website/${file}`);
    }
    for (const [key, value] of Object.entries(headersFor(rules, urlPath))) {
      if (response.headers.get(key) === value) continue;
      if (!headerMisses.has(key)) headerMisses.set(key, []);
      headerMisses.get(key).push(urlPath);
    }
  }
  for (const [key, paths] of headerMisses) {
    const shown = paths.slice(0, 3).join(', ');
    const more = paths.length > 3 ? ` and ${paths.length - 3} more` : '';
    problems.push(`response header ${key} is not what vercel.json sets, on ${shown}${more}`);
  }
  return problems;
}

function parseArguments(argv) {
  const options = { baseUrl: DEFAULT_URL, waitSeconds: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--url') options.baseUrl = argv[(i += 1)];
    else if (argv[i] === '--wait') options.waitSeconds = Number(argv[(i += 1)]);
    else throw new Error(`Unknown argument ${argv[i]}`);
  }
  if (!options.baseUrl || !Number.isFinite(options.waitSeconds) || options.waitSeconds < 0) {
    throw new Error('Usage: check-website-deploy.cjs [--url <site>] [--wait <seconds>]');
  }
  return options;
}

async function main() {
  const { baseUrl, waitSeconds } = parseArguments(process.argv.slice(2));
  const siteDir = path.resolve(__dirname, '..', 'website');
  const deadline = Date.now() + waitSeconds * 1000;
  for (;;) {
    const problems = await compareDeployment({ baseUrl, siteDir });
    if (!problems.length) {
      console.log(`${baseUrl} matches website/.`);
      return;
    }
    if (Date.now() + POLL_MS > deadline) {
      console.error(`${baseUrl} does not match website/:`);
      problems.forEach((problem) => console.error(`- ${problem}`));
      process.exitCode = 1;
      return;
    }
    console.log(`${problems.length} difference(s); checking again in ${POLL_MS / 1000} s.`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { compareDeployment, expectedHeaders, listFiles, servedPath, sourcePattern };
