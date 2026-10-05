/** @jest-environment node */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const {
  parseShard,
  selectScenes,
  shardScenes,
} = require('../../scripts/visual-snapshots/shard.cjs');
const { scenes } = require('../../scripts/visual-snapshots/scenes.cjs');

// CI splits the snapshot suite across jobs with SNAPSHOT_SHARD=k/n. The scene list is in capture
// order and some scenes have to come last, so a shard must be a contiguous run of the list.
describe('the visual snapshot shards', () => {
  const list = (length) => Array.from({ length }, (_, i) => ({ name: `scene-${i}` }));
  const shardsOf = (items, count) =>
    Array.from({ length: count }, (_, i) => shardScenes(items, { index: i + 1, count }));
  // The first-run scenes empty the server address, which the runner does not put back, so no
  // scene that needs the shared app connected may follow them. A scene with a `startup` runs on an
  // app of its own, so it may.
  const emptiesServer = (scene) => scene.config?.homeAssistant?.url === '';
  const mayFollow = (scene) => emptiesServer(scene) || !!scene.startup;

  describe('reading SNAPSHOT_SHARD', () => {
    it('runs every scene when it is unset or empty', () => {
      expect(parseShard(undefined)).toBeNull();
      expect(parseShard('')).toBeNull();
      expect(parseShard('  ')).toBeNull();
    });

    it('reads k/n', () => {
      expect(parseShard('1/2')).toEqual({ index: 1, count: 2 });
      expect(parseShard('2/2')).toEqual({ index: 2, count: 2 });
      expect(parseShard(' 3 / 4 ')).toEqual({ index: 3, count: 4 });
      expect(parseShard('1/1')).toEqual({ index: 1, count: 1 });
    });

    // A typo must not quietly run the whole suite, or nothing, in every job.
    it.each(['0/2', '3/2', '1/0', '2', '1/2/3', 'a/b', '-1/2', '1.5/2'])('rejects %s', (value) => {
      expect(() => parseShard(value)).toThrow(/SNAPSHOT_SHARD/);
    });
  });

  describe('cutting a list', () => {
    const cases = [];
    for (let length = 0; length <= 23; length += 1) {
      for (let count = 1; count <= 5; count += 1) cases.push([length, count]);
    }

    it.each(cases)(
      'cuts %i scenes into %i contiguous parts that cover them once',
      (length, count) => {
        const items = list(length);
        const shards = shardsOf(items, count);

        // Joined in shard order, the parts are the list itself: every scene once, in its order, and
        // each part a run of neighbours.
        expect(shards.flat()).toEqual(items);
        let next = 0;
        for (const shard of shards) {
          shard.forEach((scene) => expect(items.indexOf(scene)).toBe(next++));
        }
        // No scene in two parts.
        expect(new Set(shards.flat()).size).toBe(length);
        // Equal parts, the first ones one longer when the count does not divide.
        const sizes = shards.map((shard) => shard.length);
        expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
        expect([...sizes].sort((a, b) => b - a)).toEqual(sizes);
        // The last scene of the list is the last of the last part.
        if (length >= count) expect(shards[count - 1].at(-1)).toBe(items.at(-1));
      }
    );

    it('gives the shards past the end nothing when there are fewer scenes than shards', () => {
      const items = list(2);
      expect(shardsOf(items, 3)).toEqual([[items[0]], [items[1]], []]);
    });
  });

  describe('with the real scene list', () => {
    const workflow = yaml.load(
      fs.readFileSync(
        path.resolve(__dirname, '../../.github/workflows/visual-snapshots.yml'),
        'utf8'
      )
    );
    const shardCount = workflow.jobs.snapshots.strategy.matrix.shard.length;

    it('has scenes that empty the server address, at the end of the list', () => {
      const first = scenes.findIndex(emptiesServer);
      expect(first).toBeGreaterThan(0);
      expect(scenes.slice(first).every(mayFollow)).toBe(true);
    });

    it("puts them all in the workflow's last shard", () => {
      const shards = shardsOf(scenes, shardCount);
      expect(shards.flat()).toEqual(scenes);
      shards.slice(0, -1).forEach((shard) => expect(shard.some(emptiesServer)).toBe(false));
      expect(shards.at(-1).filter(emptiesServer)).toEqual(scenes.filter(emptiesServer));
    });

    it('keeps them after every other scene of their shard, however many shards there are', () => {
      for (let count = 1; count <= 12; count += 1) {
        for (const shard of shardsOf(scenes, count)) {
          const first = shard.findIndex(emptiesServer);
          if (first >= 0) expect(shard.slice(first).every(mayFollow)).toBe(true);
        }
      }
    });

    // SNAPSHOT_SCENES narrows the list first and the shard is cut from what is left, so the parts
    // of a filtered run are the same size and still in the list's order.
    it('cuts the shards from the scenes SNAPSHOT_SCENES leaves', () => {
      const filter = /first-run|^main-dark$/;
      const all = selectScenes(scenes, { filter });
      expect(all.selected).toEqual(all.matched);
      expect(all.matched.map((scene) => scene.name)).toEqual(
        scenes.filter((scene) => filter.test(scene.name)).map((scene) => scene.name)
      );

      const halves = [1, 2].map((index) =>
        selectScenes(scenes, { filter, shard: { index, count: 2 } })
      );
      halves.forEach((half) => expect(half.matched).toEqual(all.matched));
      expect(halves.flatMap((half) => half.selected)).toEqual(all.matched);
      expect(halves[0].selected[0].name).toBe('main-dark');
      expect(halves[1].selected.at(-1)).toBe(all.matched.at(-1));
      // Cut first and filtered after, the first half would have had main-dark alone.
      expect(halves[0].selected.length).toBe(Math.ceil(all.matched.length / 2));
    });

    it('runs every scene when no shard and no filter are set', () => {
      expect(selectScenes(scenes)).toEqual({ matched: scenes, selected: scenes });
    });
  });
});
