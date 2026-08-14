const fs = require('fs');
const path = require('path');

function readWorkflow(name) {
  return fs.readFileSync(path.resolve(__dirname, `../../.github/workflows/${name}`), 'utf8');
}

describe('release workflow hardening', () => {
  const ci = readWorkflow('ci.yml');
  const release = readWorkflow('release.yml');
  const tagRelease = readWorkflow('tag-release.yml');
  const nightlyBeta = readWorkflow('nightly-beta.yml');

  test('keeps CI permissions minimal and packaged smoke launches bounded', () => {
    expect(ci).toMatch(/permissions:\s*\n\s+contents: read/);
    expect(ci.match(/timeout-minutes: 2/g)).toHaveLength(3);
    expect(ci).toContain('timeout --kill-after=5s 30s xvfb-run');
    expect(ci).toContain('npm audit --omit=dev --audit-level=high');
    expect(release).toContain('npm audit --omit=dev --audit-level=high');
  });

  test('pins validation and every release consumer to one tested tag commit', () => {
    expect(release).toContain(
      'ref: refs/tags/${{ github.event.inputs.release_tag || github.ref_name }}'
    );
    expect(release).toContain('release_sha: ${{ steps.release_meta.outputs.release_sha }}');
    expect(release).toContain('$expectedWorkflowRef = "refs/tags/$releaseTag"');
    expect(release).toContain('$env:WORKFLOW_REF -ne $expectedWorkflowRef');
    expect(release.match(/ref: \$\{\{ needs\.validate\.outputs\.release_sha \}\}/g)).toHaveLength(
      5
    );
    expect(release).toContain('git merge-base --is-ancestor "$tag_sha" "$main_head"');
    expect(release).toContain('"refs/tags/$RELEASE_TAG^{commit}"');
    expect(release).toContain('RELEASE_SHA: ${{ needs.validate.outputs.release_sha }}');
  });

  test('requires exact-SHA CI before either manual or nightly tag creation', () => {
    for (const workflow of [tagRelease, nightlyBeta]) {
      expect(workflow).toContain('--workflow ci.yml');
      expect(workflow).toContain('--commit "$main_sha"');
      expect(workflow).toContain('--status success');
    }
  });

  test('dispatches publication from the created tag rather than mutable main', () => {
    expect(tagRelease).toContain('--ref "$release_tag"');
    expect(nightlyBeta).toContain('--ref "$RELEASE_TAG"');
    expect(tagRelease).not.toContain('--ref main');
    expect(nightlyBeta).not.toContain('--ref main');
  });

  test('publishes stable release notes from the matching changelog section', () => {
    expect(release).toContain(
      'node scripts/extract-release-notes.cjs "$RELEASE_VERSION" > "$release_notes_file"'
    );
    expect(release).toContain('notes_flags=(--notes-file "$release_notes_file")');
    expect(release).toContain(
      'Stable releases require a non-empty CHANGELOG.md section for $RELEASE_VERSION.'
    );
    expect(release).toContain('notes_flags=(--generate-notes)');
    expect(release).toContain('Generating prerelease notes from $notes_start_tag to $RELEASE_TAG.');
  });
});
