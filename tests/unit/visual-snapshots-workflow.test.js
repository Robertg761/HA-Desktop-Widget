/** @jest-environment node */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { Minimatch } = require('minimatch');
const { WINDOW_POSITION } = require('../../scripts/visual-snapshots/fixture.cjs');

// The workflow photographs the app on each OS. A capture is only worth reviewing if the runner can
// draw its text and nothing of the runner's own sits in the picture.
describe('the visual snapshot workflow', () => {
  const workflow = yaml.load(
    fs.readFileSync(path.resolve(__dirname, '../../.github/workflows/visual-snapshots.yml'), 'utf8')
  );
  const steps = workflow.jobs.snapshots.steps;
  const order = (name) => {
    const index = steps.findIndex((step) => step.name === name);
    expect(index).toBeGreaterThanOrEqual(0);
    return index;
  };

  // The image has no Devanagari font and the app bundles none, so every Hindi string was boxes.
  it('installs a Devanagari font on Linux before the snapshots', () => {
    const install = steps.find(
      (step) => step.if === "runner.os == 'Linux'" && /apt-get install/.test(step.run)
    );
    expect(install.run).toMatch(/\bfonts-noto-core\b/);
    expect(order(install.name)).toBeLessThan(order('Take snapshots (Linux)'));
  });

  // The agent's console sat behind the widget, a console asking for a WSL update covered the
  // Windows 11 pins, and the pointer, resting where the widget opens, left a tile's native tooltip
  // in the first capture.
  describe('clearing the Windows desktop', () => {
    const script = fs.readFileSync(
      path.resolve(__dirname, '../../scripts/visual-snapshots/windows-desktop.ps1'),
      'utf8'
    );
    const clear = steps[order('Clear the desktop (Windows)')];
    const check = steps[order('Check the desktop after the snapshots (Windows)')];

    it('runs the desktop script before the Windows snapshots, and checks again after them', () => {
      expect(clear.if).toBe("runner.os == 'Windows'");
      expect(clear.shell).toBe('pwsh');
      expect(clear.run.trim()).toBe('./scripts/visual-snapshots/windows-desktop.ps1');
      // After the Windows 11 first-run windows are closed, and before anything is captured.
      expect(order('Close first-run windows (Windows 11)')).toBeLessThan(
        order('Clear the desktop (Windows)')
      );
      expect(order('Clear the desktop (Windows)')).toBeLessThan(
        order('Take snapshots (Windows, macOS)')
      );
      // A window that opened during the run is reported too, even when the run failed.
      expect(check.if).toBe("always() && runner.os == 'Windows'");
      expect(check.shell).toBe('pwsh');
      expect(check.run.trim()).toBe('./scripts/visual-snapshots/windows-desktop.ps1 -Check');
      expect(order('Take snapshots (Windows, macOS)')).toBeLessThan(
        order('Check the desktop after the snapshots (Windows)')
      );
    });

    // Minimizing each process's MainWindowHandle left the console wsl.exe ran in on screen: it is
    // its host's window. The script ends the prompt and minimizes every top-level window on screen.
    it('ends the WSL prompt and minimizes every window on screen but explorer’s', () => {
      const clearing = script.slice(script.indexOf('if (-not $Check) {'));
      expect(clearing).toMatch(
        /Get-Process -Name wsl\b[^\n]*\|\s*ForEach-Object\s*\{[^}]*Stop-Process/
      );
      expect(clearing).toContain('[Win32.Desktop]::ShowWindow($window.Handle, 6)');
      expect(clearing).toContain('[Win32.Desktop]::SetCursorPos(0, 0)');
      // Every window Windows lists, shown and not cloaked; explorer's are the desktop and taskbar.
      expect(script).toContain('EnumWindows(');
      expect(script).toContain('IsWindowVisible(window)');
      expect(script).toContain('DWMWA_CLOAKED');
      expect(script).toMatch(/\$explorer -notcontains \$_\.ProcessId/);
      // The top-left corner is clear of the widget and the 32 px margin its screen capture takes.
      expect(WINDOW_POSITION.x - 32).toBeGreaterThan(32);
    });

    // Whatever is left is named on the run's summary, before and after the run, and the snapshots
    // still go ahead: they are informational.
    it('warns about every window still on screen, without failing the job', () => {
      const listing = script.slice(script.indexOf('$left = @(Get-StrayWindow)'));
      expect(listing).toMatch(/foreach \(\$window in \$left\)[\s\S]*Write-Output "::warning /);
      expect(script).not.toMatch(/\bexit [1-9]|\bthrow\b|::error /);
    });
  });

  // With every scene in one job, a slow windows-latest runner ran past the job's time limit. Each OS
  // now runs the list in shards, and reviewers still download one artifact per OS.
  describe('split into shards', () => {
    const { matrix } = workflow.jobs.snapshots.strategy;
    const labels = Object.fromEntries(matrix.include.map((entry) => [entry.os, entry.artifact]));
    const upload = steps[order('Upload snapshots')];
    const merge = workflow.jobs.merge;
    const fill = (template, values) =>
      template.replace(/\$\{\{\s*matrix\.(\w+)\s*\}\}/g, (_, key) => String(values[key]));
    const shardArtifacts = matrix.os.flatMap((os) =>
      matrix.shard.map((shard) => fill(upload.with.name, { artifact: labels[os], shard }))
    );

    it('runs shards 1 to n on every OS and tells each job which one it is', () => {
      expect(matrix.shard).toEqual(matrix.shard.map((_, i) => i + 1));
      expect(matrix.shard.length).toBeGreaterThan(1);
      expect(workflow.jobs.snapshots.env.SNAPSHOT_SHARD).toBe(
        `\${{ matrix.shard }}/${matrix.shard.length}`
      );
    });

    it('gives every OS its own artifact name, as runner.os cannot tell the two Windows apart', () => {
      expect(Object.keys(labels).sort()).toEqual([...matrix.os].sort());
      expect(new Set(Object.values(labels)).size).toBe(matrix.os.length);
      expect(new Set(shardArtifacts).size).toBe(matrix.os.length * matrix.shard.length);
      expect(upload.if).toBe('always()');
    });

    it("merges each OS's shards, and only those, into visual-snapshots-<OS>", () => {
      expect(merge.needs).toBe('snapshots');
      // Also when a shard failed or ran out of time, so its captures still arrive.
      expect(merge.if).toBe('always()');
      expect([...merge.strategy.matrix.artifact].sort()).toEqual(Object.values(labels).sort());
      const [download, merged] = merge.steps;
      expect(download.uses).toMatch(/^actions\/download-artifact@/);
      // Into one folder, which is what is uploaded.
      expect(download.with['merge-multiple']).toBe(true);
      expect(merged.uses).toMatch(/^actions\/upload-artifact@/);
      expect(merged.with.path.replace(/\/$/, '')).toBe(download.with.path.replace(/\/$/, ''));
      for (const artifact of merge.strategy.matrix.artifact) {
        expect(fill(merged.with.name, { artifact })).toBe(`visual-snapshots-${artifact}`);
        const pattern = new Minimatch(fill(download.with.pattern, { artifact }));
        const own = matrix.shard.map((shard) => fill(upload.with.name, { artifact, shard }));
        // visual-snapshots-Windows-shard-* must not take the Windows 11 shards as well.
        expect(shardArtifacts.filter((name) => pattern.match(name))).toEqual(own);
      }
    });

    // A re-run keeps the run's artifacts, and the job run again uploads under the name its first
    // attempt used: the shard that failed, then the merge that follows it. Without overwrite each
    // upload failed on the name it found, and the retry the docs describe never produced captures.
    it('replaces the first attempt’s artifacts when a shard is re-run', () => {
      const uploads = Object.values(workflow.jobs).flatMap((job) =>
        job.steps.filter((step) => /^actions\/upload-artifact[@/]/.test(step.uses || ''))
      );
      expect(uploads).toHaveLength(2);
      for (const step of uploads) {
        expect({ name: step.name, overwrite: step.with.overwrite }).toEqual({
          name: step.name,
          overwrite: true,
        });
      }
      // upload-artifact/merge cannot overwrite, and its delete-merged would drop the half a
      // re-run of the other one merges with.
      expect(uploads.some((step) => /\/merge@/.test(step.uses))).toBe(false);
    });
  });
});
