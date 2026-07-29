/**
 * @jest-environment node
 */

const {
  createSerializedTaskRunner,
  createLatestTaskCoalescer,
} = require('../../src/serialized-task-runner.cjs');

describe('serialized task runner', () => {
  it('does not start a later mutation until the current mutation settles', async () => {
    const runSerialized = createSerializedTaskRunner();
    const events = [];
    let releaseFirst;
    const firstGate = new Promise((resolve) => {
      releaseFirst = resolve;
    });

    const first = runSerialized(async () => {
      events.push('first:start');
      await firstGate;
      events.push('first:end');
      return 'first result';
    });
    const second = runSerialized(async () => {
      events.push('second:start');
      events.push('second:end');
      return 'second result';
    });

    await Promise.resolve();
    expect(events).toEqual(['first:start']);

    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual(['first result', 'second result']);
    expect(events).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });

  it('continues with the next mutation after a rejection', async () => {
    const runSerialized = createSerializedTaskRunner();
    const failure = runSerialized(() => {
      throw new Error('write failed');
    });
    const recovery = runSerialized(() => 'recovered');

    await expect(failure).rejects.toThrow('write failed');
    await expect(recovery).resolves.toBe('recovered');
  });
});

describe('latest task coalescer', () => {
  it('collapses repeated requests during an active task into one latest rerun', async () => {
    const calls = [];
    let releaseFirst;
    const firstGate = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    const run = createLatestTaskCoalescer(async (value) => {
      calls.push(value);
      if (calls.length === 1) await firstGate;
      return value;
    });

    const first = run('initial');
    const second = run('intermediate');
    const third = run('latest');
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(calls).toEqual(['initial']);

    releaseFirst();
    await expect(first).resolves.toBe('latest');
    expect(calls).toEqual(['initial', 'latest']);
    expect(run.isActive()).toBe(false);
  });

  it('runs the latest queued request after an earlier attempt rejects', async () => {
    let releaseFirst;
    const firstGate = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    const calls = [];
    const run = createLatestTaskCoalescer(async (value) => {
      calls.push(value);
      if (value === 'initial') {
        await firstGate;
        throw new Error('temporary failure');
      }
      return value;
    });

    const result = run('initial');
    run('recovery');
    releaseFirst();

    await expect(result).resolves.toBe('recovery');
    expect(calls).toEqual(['initial', 'recovery']);
  });

  it('returns each explicit request its exact result while coalescing background work', async () => {
    let releaseFirst;
    const firstGate = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    const calls = [];
    const runSerialized = createSerializedTaskRunner();
    const run = createLatestTaskCoalescer(
      (value, source) =>
        runSerialized(async () => {
          calls.push([value, source]);
          if (calls.length === 1) await firstGate;
          if (value === 'pull') throw new Error('manual pull failed');
          return `${value}-result`;
        }),
      { getPriority: (args) => (args[1] === 'manual' ? 1 : 0) }
    );

    const backgroundResult = run('initial', 'interval');
    const pullResult = run('pull', 'manual');
    const pushResult = run('push', 'manual');
    const coalescedResult = run('latest-background', 'interval');

    expect(pullResult).not.toBe(backgroundResult);
    expect(pushResult).not.toBe(backgroundResult);
    expect(coalescedResult).toBe(backgroundResult);

    const pullExpectation = expect(pullResult).rejects.toThrow('manual pull failed');
    releaseFirst();

    await pullExpectation;
    await expect(pushResult).resolves.toBe('push-result');
    await expect(backgroundResult).resolves.toBe('latest-background-result');
    expect(calls).toEqual([
      ['initial', 'interval'],
      ['pull', 'manual'],
      ['push', 'manual'],
      ['latest-background', 'interval'],
    ]);
  });
});
