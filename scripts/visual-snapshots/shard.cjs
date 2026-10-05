/**
 * Which scenes one run captures. SNAPSHOT_SCENES narrows the list first, and SNAPSHOT_SHARD=k/n
 * then keeps the k-th of n parts of what is left, so CI can split the suite across jobs.
 *
 * A shard is a contiguous run of the list, never every n-th scene. The list is in capture order,
 * and the first-run scenes at its end empty the server address, so they have to come after every
 * scene that needs the app connected (see scenes.cjs). A contiguous run keeps the list's order, so
 * they stay after every other scene of their shard, and with two shards they all land in the last
 * one. Any scene can open a shard: each shard starts its own app on the fixture's settings, as a
 * run of one scene does.
 *
 * The parts hold equal numbers of scenes, and the first parts take one more when the count does
 * not divide. Scenes take about the same time each. On the hosted runners in October 2026 a scene
 * took 2.5 to 3 seconds on average and the slowest took about 6, and the two halves of the
 * 357-scene list took within 8% of each other on every OS (473 s and 499 s on windows-latest). A
 * start-up scene that launches an app of its own took 3 to 5 seconds, so it gets no weight of its
 * own either.
 */

/** Read SNAPSHOT_SHARD ("k/n"): null when it is unset or empty. */
function parseShard(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const match = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(String(value));
  const index = match ? Number(match[1]) : 0;
  const count = match ? Number(match[2]) : 0;
  if (!match || count < 1 || index < 1 || index > count) {
    throw new Error(`SNAPSHOT_SHARD must be k/n with 1 <= k <= n, such as 1/2, not "${value}"`);
  }
  return { index, count };
}

/** The k-th of n contiguous parts of a list, in the list's order. */
function shardScenes(list, { index, count }) {
  const size = Math.floor(list.length / count);
  const extra = list.length % count;
  const start = (index - 1) * size + Math.min(index - 1, extra);
  return list.slice(start, start + size + (index <= extra ? 1 : 0));
}

/**
 * The scenes a run captures: those whose name matches the filter, then the shard of them. Returns
 * both lists, so a run can tell a filter that matches nothing from a shard left empty.
 */
function selectScenes(scenes, { filter = null, shard = null } = {}) {
  const matched = scenes.filter((scene) => !filter || filter.test(scene.name));
  return { matched, selected: shard ? shardScenes(matched, shard) : matched };
}

module.exports = { parseShard, selectScenes, shardScenes };
