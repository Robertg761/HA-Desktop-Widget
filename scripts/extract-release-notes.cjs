const fs = require('fs');
const path = require('path');

const RELEASE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function normalizeVersion(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/^v/, '');

  if (!RELEASE_VERSION_PATTERN.test(normalized)) {
    throw new Error(
      `Release version must use X.Y.Z or X.Y.Z-suffix format; received ${value || '<empty>'}.`
    );
  }

  return normalized;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractSection(changelog, label) {
  const lines = String(changelog).split(/\r?\n/);
  const headingPattern = new RegExp(`^## \\[${escapeRegExp(label)}\\](?:\\s+-\\s+.+)?\\s*$`);
  const sectionStart = lines.findIndex((line) => headingPattern.test(line));

  if (sectionStart === -1) {
    throw new Error(`CHANGELOG.md has no section for ${label}.`);
  }

  const nextSectionOffset = lines
    .slice(sectionStart + 1)
    .findIndex((line) => /^## \[.+\](?:\s+-\s+.+)?\s*$/.test(line));
  const sectionEnd = nextSectionOffset === -1 ? lines.length : sectionStart + 1 + nextSectionOffset;
  const notes = lines
    .slice(sectionStart + 1, sectionEnd)
    .join('\n')
    .trim();

  if (!notes) {
    throw new Error(`CHANGELOG.md section for ${label} is empty.`);
  }

  return `${notes}\n`;
}

function extractReleaseNotes(changelog, requestedVersion) {
  return extractSection(changelog, normalizeVersion(requestedVersion));
}

// What a commit has not released yet. A beta promoted to stable ships exactly this.
function extractUnreleasedNotes(changelog) {
  return extractSection(changelog, 'Unreleased');
}

function main() {
  const version = process.argv[2];
  const changelogPath = path.resolve(process.cwd(), 'CHANGELOG.md');
  const changelog = fs.readFileSync(changelogPath, 'utf8');
  process.stdout.write(
    version === '--unreleased'
      ? extractUnreleasedNotes(changelog)
      : extractReleaseNotes(changelog, version)
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  extractReleaseNotes,
  extractUnreleasedNotes,
  normalizeVersion,
};
