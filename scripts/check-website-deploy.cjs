#!/usr/bin/env node
/**
 * Compares the deployed website with website/ in this checkout.
 *
 * The site deploys from main, and nothing used to check that it had: for a week the live pages
 * still described features the app did not have. Every file is fetched from the site (pages
 * without their .html, as the host's clean URLs serve them) and compared byte for byte, and the
 * response headers vercel.json promises are compared too, so a deployment that skipped the
 * configuration shows up as well.
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

/** The headers vercel.json sets for every path, which every page must carry. */
function expectedHeaders(siteDir) {
  const config = JSON.parse(fs.readFileSync(path.join(siteDir, 'vercel.json'), 'utf8'));
  const all = (config.headers || []).find((rule) => rule.source === '/(.*)');
  return Object.fromEntries(
    (all?.headers || []).map(({ key, value }) => [key.toLowerCase(), value])
  );
}

/**
 * @param {{baseUrl: string, siteDir: string, fetchImpl?: typeof fetch}} options
 * @returns {Promise<string[]>} What differs, one line each; empty when the deployment matches.
 */
async function compareDeployment({ baseUrl, siteDir, fetchImpl = fetch }) {
  const problems = [];
  const root = baseUrl.replace(/\/+$/, '');
  for (const file of listFiles(siteDir)) {
    const url = root + servedPath(file);
    let response;
    try {
      response = await fetchImpl(url, request());
    } catch (error) {
      problems.push(`${url}: ${error.message}`);
      continue;
    }
    if (!response.ok) {
      problems.push(`${url}: HTTP ${response.status}`);
      continue;
    }
    const deployed = Buffer.from(await response.arrayBuffer());
    if (!deployed.equals(fs.readFileSync(path.join(siteDir, file)))) {
      problems.push(`${url}: differs from website/${file}`);
    }
  }
  try {
    const response = await fetchImpl(`${root}/`, request());
    for (const [key, value] of Object.entries(expectedHeaders(siteDir))) {
      if (response.headers.get(key) !== value) {
        problems.push(`${root}/: response header ${key} is not what vercel.json sets`);
      }
    }
  } catch (error) {
    problems.push(`${root}/: ${error.message}`);
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

module.exports = { compareDeployment, expectedHeaders, listFiles, servedPath };
