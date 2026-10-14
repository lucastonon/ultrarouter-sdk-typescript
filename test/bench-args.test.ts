// `ur bench run` validates every flag and combination BEFORE any capture or network call.
import { describe, expect, it } from 'vitest';

import { parseBenchRunArgs, runBench } from '../src/cli/run.js';
import type { UltraRouter } from '../src/client.js';

const tag = (): string => 'tag-1';
const parse = (...args: string[]) => parseBenchRunArgs(args, tag);

describe('parseBenchRunArgs', () => {
  it('accepts the documented gate invocation', () => {
    const r = parse(
      'support-replies',
      '--capture',
      'npm test',
      '--gate',
      '--baseline',
      'bench:main',
      '--budget',
      '5',
    );
    expect(r).toEqual({
      ok: true,
      options: expect.objectContaining({
        suite: 'support-replies',
        captureCmd: 'npm test',
        gate: true,
        baseline: 'bench:main',
        budgetUsd: 5,
        runTag: 'tag-1',
      }),
    });
  });

  it('accepts --flag=value and finds the suite after valued flags', () => {
    const r = parse('--budget=2', '--baseline', 'br_1', 'suite-x', '--gate');
    expect(r.ok && r.options.suite).toBe('suite-x');
    expect(r.ok && r.options.budgetUsd).toBe(2);
  });

  it.each([
    [['s', '--gate'], /--gate requires --baseline/],
    [['s', '--pin-baseline'], /--pin-baseline requires --gate/],
    [['s', '--allow-inconclusive'], /--allow-inconclusive requires --gate/],
    [['s', '--cost-ceiling', '0.1'], /--cost-ceiling requires --baseline/],
    [['s', '--budget', 'five'], /--budget must be a positive number/],
    [['s', '--budget', '0'], /--budget must be a positive number/],
    [['s', '--budget', '-3'], /--budget must be a positive number/],
    [['s', '--wait-timeout', '1.5'], /whole number/],
    [['s', '--mode', 'trace'], /--mode must be/],
    [['s', '--selection', 'best'], /--selection must be/],
    [['s', '--baselin', 'bench:main'], /unknown option '--baselin'/],
    [['s', '--capture'], /--capture needs a value/],
    [['s', '--capture', '--gate'], /--capture needs a value/],
    [['s', '--budget', '1', '--budget', '2'], /more than once/],
    [['--gate', '--baseline', 'b'], /a suite slug is required/],
    [['a', 'b'], /exactly one suite slug/],
    [['s', '--json=yes'], /takes no value/],
  ])('%j ⇒ %s', (args, message) => {
    const r = parse(...args);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(message);
  });
});

describe('runBench refuses a gate with no baseline before capturing', () => {
  it('never spawns the capture command nor calls the gateway', async () => {
    let spawned = false;
    const client = new Proxy(
      {},
      {
        get() {
          throw new Error('the gateway must not be called');
        },
      },
    ) as UltraRouter;
    const result = await runBench(
      {
        client,
        spawnCapture: () => {
          spawned = true;
          return Promise.resolve(0);
        },
        log: () => undefined,
        err: () => undefined,
      },
      {
        suite: 's',
        budgetUsd: 1,
        gate: true,
        allowInconclusive: false,
        baseline: undefined,
        costCeilingUsd: undefined,
        mode: undefined,
        selectionMode: undefined,
        runTag: 't',
        captureCmd: 'npm test',
        json: true,
        waitTimeoutMs: undefined,
        pinBaseline: false,
      },
    );
    expect(result.exitCode).toBe(2);
    expect(spawned).toBe(false);
  });
});
