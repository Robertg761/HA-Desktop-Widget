# Releasing

How stable releases, betas, release notes and the website are published. The README's
[System Integration](../README.md#system-integration) section tells users which builds update
themselves.

## Release channels

- **Stable releases**: Land the version bump (`package.json`, `package-lock.json`) and a `CHANGELOG.md` section for the version on `main`, wait for CI to pass there, then run the **Tag Release** workflow from the Actions tab with the version. It tags `main` and starts the release workflow, which publishes a normal release. Windows installer and Linux AppImage users can receive it through the in-app updater; portable, macOS, Linux deb, and Arch package users download it from GitHub Releases.
- **Tester prereleases**: Push a SemVer prerelease tag like `v4.1.0-beta.1`. GitHub Actions marks it as a prerelease. Only users who enable **Receive beta updates** in Settings → Advanced are offered these builds.
- **Nightly betas**: At 07:17 UTC, GitHub Actions checks `main` against the last successfully published beta in the active series. When unreleased changes exist, it creates the next `vX.Y.Z-beta.N` tag and runs the normal release workflow. The job can also be started manually from the Actions tab.
- **Manual-update builds**: Portable, macOS, Linux deb, and Arch package users update from GitHub Releases. The update checker shows the appropriate stable or prerelease download when beta updates are enabled.

The minimum planned beta version is stored in `.github/beta-target`. The nightly job starts the
active series at that version (for example `v4.0.0-beta.1`). Once that version is stable, it
automatically moves to the next patch (`v4.0.1-beta.N`); increasing the file starts a future minor
series instead.

Release builds align their package version from the tag. Manually prepared betas commit matching
prerelease metadata before tagging; automated nightly betas align it only inside the build.
If a stable tag's version is not yet in `package.json` and `package-lock.json` on `main`, the
release workflow commits it there after publishing. With the bump landed first, as above, it has
nothing to commit.

## Release notes

The notes of a stable release are its `CHANGELOG.md` section, followed by a link to the full
changelog, and the release fails without a non-empty section. A beta uses its own section when the
changelog has one; otherwise GitHub generates its notes from merged pull requests, comparing against
the previous published prerelease in the same version series (or the latest stable release for the
first beta). Notes are written once, when the release is created; to replace a published release's
notes, add or correct its `CHANGELOG.md` section on `main` and run the **Update Release Notes**
workflow with the release's tag.

## Publishing the website

The website in `website/` is not deployed by GitHub: a change merged to `main` goes live only when
someone publishes it with the Vercel CLI, usually before a release is tagged, so every line on it
has to read correctly on both sides of the release. Publish exactly what `main` holds, not a local
folder that may be stale or have uncommitted edits:

```bash
(
  set -euo pipefail # any failed step, a fetch included, stops before the deploy
  git fetch origin
  rm -rf /tmp/ha-site # one command a line: set -e ignores a failure on the left of &&
  mkdir -p /tmp/ha-site
  git archive origin/main website | tar -x -C /tmp/ha-site # exactly what main holds
  cp -r website/.vercel /tmp/ha-site/website/              # the link `vercel link` made
  cd /tmp/ha-site/website
  vercel deploy --prod
)
```

Then run the Website deploy check workflow, which checks out `main` and compares every live page,
asset and response header with it. (`node scripts/check-website-deploy.cjs` does the same against
your own checkout, so it only proves anything on a clean, up-to-date `main`.)
