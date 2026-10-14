// The GitHub Action and the workflows. The action installs the CLI version it was released with, so
// a pinned action runs a pinned CLI; no step interpolates an input (or any `${{ … }}` context) into
// shell source — inputs reach scripts as environment variables, are validated, and are passed on as
// argv; and every third-party action is pinned to a full commit SHA.
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// @ts-expect-error -- js-yaml ships no bundled type declarations here
import yaml from 'js-yaml';

// @ts-expect-error -- a plain ESM script without declarations
import { buildBenchArgs } from '../scripts/action-bench.mjs';

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
}

const ROOT = new URL('..', import.meta.url).pathname;
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const action = yaml.load(read('action.yml')) as {
  inputs: Record<string, { default?: string }>;
  runs: { steps: Step[] };
};
const pkg = JSON.parse(read('package.json')) as { version: string };
const step = (name: string): Step => {
  const found = action.runs.steps.find((s) => s.name === name);
  if (found === undefined) throw new Error(`no step named ${name}`);
  return found;
};

/** A temp dir with fake executables (each records its argv) first on PATH. */
function sandbox(fakes: readonly string[]): {
  dir: string;
  bin: string;
  log: string;
  pwned: string;
} {
  const dir = mkdtempSync(join(tmpdir(), 'ur-action-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const log = join(dir, 'calls.jsonl');
  for (const name of fakes) {
    const file = join(bin, name);
    writeFileSync(
      file,
      `#!${process.execPath}\nrequire('fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify([${JSON.stringify(name)}, ...process.argv.slice(2)]) + '\\n');\n`,
    );
    chmodSync(file, 0o755);
  }
  return { dir, bin, log, pwned: join(dir, 'PWNED') };
}

function calls(log: string): string[][] {
  if (!existsSync(log)) return [];
  return readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => JSON.parse(l) as string[]);
}

/** Run a step's `run:` script with bash, its env set as the runner would (inputs → env). */
function runStep(s: Step, env: Record<string, string>, box: { dir: string; bin: string }) {
  return spawnSync('bash', ['-c', s.run ?? ''], {
    cwd: box.dir,
    encoding: 'utf8',
    env: { PATH: `${box.bin}:${process.env.PATH ?? ''}`, HOME: box.dir, ...env },
  });
}

/**
 * A command substitution, a backtick and a `;` that, if ever evaluated, create the PWNED marker in the
 * sandbox (every step runs with the sandbox as its working directory).
 */
const hostile = (_box: { pwned: string }): string => 'x$(touch PWNED)`touch PWNED`;touch PWNED';

describe('action.yml', () => {
  it('defaults sdk-version to this release', () => {
    expect(action.inputs['sdk-version']?.default).toBe(pkg.version);
  });

  it('passes the fork input to both app-ci and flywheel-pr', () => {
    const steps = action.runs.steps.filter((s) => (s.env ?? {})['UR_APPCI_CONFIG'] !== undefined);
    expect(steps.length).toBe(2);
    for (const s of steps) expect(s.env?.['UR_APPCI_FORK']).toBe('${{ inputs.fork }}');
  });

  it('never interpolates an expression into a run script (inputs travel as env)', () => {
    const runs = action.runs.steps.filter((s) => s.run !== undefined);
    expect(runs.length).toBeGreaterThanOrEqual(5);
    for (const s of runs) expect(s.run, s.name).not.toMatch(/\$\{\{/);
  });

  it('install step: a hostile sdk-version is refused and never evaluated', () => {
    const s = step('Install the ur CLI');
    const box = sandbox(['npm']);
    const r = runStep(s, { UR_SDK_VERSION: `0.0.1${hostile(box)}` }, box);
    expect(r.status).not.toBe(0);
    expect(existsSync(box.pwned)).toBe(false);
    expect(calls(box.log)).toEqual([]);
    for (const bad of ['latest', '^0.0.1', '0.0', '0.0.1 --global evil', '../x']) {
      expect(runStep(s, { UR_SDK_VERSION: bad }, box).status, bad).not.toBe(0);
    }
    expect(calls(box.log)).toEqual([]);
  });

  it('install step: an exact version installs exactly that package', () => {
    const s = step('Install the ur CLI');
    const box = sandbox(['npm']);
    const r = runStep(s, { UR_SDK_VERSION: pkg.version }, box);
    expect(r.status, r.stderr).toBe(0);
    expect(calls(box.log)).toEqual([['npm', 'install', '-g', `@ultrarouter/sdk@${pkg.version}`]]);
  });

  it('mode guard: a hostile mode is refused and never evaluated', () => {
    const s = step('Validate mode (fail closed on an unknown/legacy selector)');
    const box = sandbox([]);
    const r = runStep(s, { UR_MODE: hostile(box), UR_SUITE: 'x' }, box);
    expect(r.status).toBe(1);
    expect(existsSync(box.pwned)).toBe(false);
  });

  it('bench step: hostile inputs reach `ur` as literal argv, and nothing is evaluated', () => {
    const s = step('Run the ultrarouter Bench gate (bench mode)');
    expect(s.run).toBe('node "$GITHUB_ACTION_PATH/scripts/action-bench.mjs"');
    const box = sandbox(['ur']);
    const suite = `suite${hostile(box)}`;
    const baseline = `bench:main${hostile(box)}`;
    const r = runStep(
      s,
      {
        GITHUB_ACTION_PATH: ROOT,
        UR_SUITE: suite,
        UR_BASELINE: baseline,
        UR_BUDGET: '3',
        UR_PAIRED_MODE: 'request',
        UR_ALLOW_INCONCLUSIVE: 'false',
        UR_PIN_BASELINE: 'false',
      },
      box,
    );
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(box.pwned)).toBe(false);
    expect(calls(box.log)).toEqual([
      [
        'ur',
        'bench',
        'run',
        suite,
        '--gate',
        '--json',
        `--baseline=${baseline}`,
        '--budget=3',
        '--mode=request',
      ],
    ]);
  });

  it('bench step: invalid inputs fail before `ur` runs', () => {
    const s = step('Run the ultrarouter Bench gate (bench mode)');
    const box = sandbox(['ur']);
    const base = {
      GITHUB_ACTION_PATH: ROOT,
      UR_SUITE: 's',
      UR_BASELINE: 'bench:main',
      UR_BUDGET: '3',
    };
    for (const env of [
      { ...base, UR_BUDGET: '3; touch PWNED' },
      { ...base, UR_BUDGET: '-1' },
      { ...base, UR_SUITE: '--api-key=stolen' },
      { ...base, UR_PAIRED_MODE: 'trace' },
      { ...base, UR_PIN_BASELINE: 'yes' },
      { ...base, UR_COST_CEILING: 'cheap' },
      { ...base, UR_RUN_TAG: '$(touch PWNED)' },
      { ...base, UR_CAPTURE: 'npm test\ntouch x' },
      { ...base, UR_SUITE: '' },
    ]) {
      const r = runStep(s, env, box);
      expect(r.status, JSON.stringify(env)).toBe(1);
      expect(r.stderr).toMatch(/::error::ur action \(mode: bench\)/);
    }
    expect(existsSync(box.pwned)).toBe(false);
    expect(calls(box.log)).toEqual([]);
  });
});

describe('buildBenchArgs', () => {
  it('passes the capture command as ONE argv element (it is executed only by `ur --capture`)', () => {
    const built = buildBenchArgs({
      UR_SUITE: 'support-replies',
      UR_BASELINE: 'bench:main',
      UR_BUDGET: '5',
      UR_CAPTURE: 'npm test -- --grep "a b"',
      UR_COST_CEILING: '0.01',
      UR_RUN_TAG: 'abc123',
      UR_ALLOW_INCONCLUSIVE: 'true',
      UR_PIN_BASELINE: 'TRUE',
    }) as { args: string[] };
    expect(built.args).toEqual([
      'bench',
      'run',
      'support-replies',
      '--gate',
      '--json',
      '--baseline=bench:main',
      '--budget=5',
      '--mode=request',
      '--capture=npm test -- --grep "a b"',
      '--cost-ceiling=0.01',
      '--run-tag=abc123',
      '--allow-inconclusive',
      '--pin-baseline',
    ]);
  });
});

describe('third-party actions are pinned to a full commit SHA', () => {
  const files = ['action.yml', '.github/workflows/ci.yml', '.github/workflows/publish.yml'];
  it.each(files)('%s', (file) => {
    const uses = read(file)
      .split('\n')
      .filter((l) => /^\s*(?:-\s*)?uses:/.test(l));
    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses) {
      expect(line, line).toMatch(/uses:\s*[\w.-]+\/[\w.-]+@[0-9a-f]{40}\s+#\s*v\d+\.\d+\.\d+\s*$/);
    }
  });
});

describe('the workflows', () => {
  const workflow = (file: string) =>
    yaml.load(read(file)) as { jobs: Record<string, { steps: Step[] }> };

  it.each(['.github/workflows/ci.yml', '.github/workflows/publish.yml'])(
    '%s interpolates no expression into a run script',
    (file) => {
      for (const job of Object.values(workflow(file).jobs)) {
        for (const s of job.steps)
          if (s.run !== undefined) expect(s.run, s.name).not.toMatch(/\$\{\{/);
      }
    },
  );

  it('publish refuses to run its leak gate (and so to publish) without LEAK_PATTERNS_JSON', () => {
    const steps = workflow('.github/workflows/publish.yml').jobs.publish?.steps ?? [];
    const gate = steps.find((s) => (s.name ?? '').startsWith('Leak scan with the maintainers'));
    const publishIndex = steps.findIndex((s) => (s.name ?? '').startsWith('Publish to npm'));
    expect(gate).toBeDefined();
    expect(steps.indexOf(gate as Step)).toBeLessThan(publishIndex);
    expect(gate?.env?.LEAK_PATTERNS_JSON).toBe('${{ secrets.LEAK_PATTERNS_JSON }}');
    const box = sandbox([]);
    const r = runStep(
      gate as Step,
      { LEAK_PATTERNS_JSON: '', TARBALL: join(box.dir, 'x.tgz') },
      box,
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/refusing to publish/);
  });

  it('CI scans the full history (fetch-depth 0) and passes the optional patterns via env', () => {
    const steps = workflow('.github/workflows/ci.yml').jobs.check?.steps ?? [];
    expect(read('.github/workflows/ci.yml')).toMatch(/fetch-depth: 0/);
    const scan = steps.find((s) => (s.name ?? '').startsWith('Leak scan'));
    expect(scan?.env?.LEAK_PATTERNS_JSON).toBe('${{ secrets.LEAK_PATTERNS_JSON }}');
    expect(scan?.run).toMatch(/--redact-external/);
  });
});
