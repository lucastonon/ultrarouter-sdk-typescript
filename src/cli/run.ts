/**
 * `ur bench run` — the orchestration. Drives capture → freeze → trigger (compare) →
 * poll → gate → exit code. IO is INJECTED (`client`, `spawnCapture`, `log`/`err`) so the whole flow is
 * unit-testable against a stub gateway with no real process/network. Fails CLOSED: any
 * API/pipeline error resolves to an `error` verdict ⇒ exit 2 (a broken gate is never silently green).
 */

import type { UltraRouter } from '../client.js';
import { UltraRouterError } from '../errors.js';
import type { BenchCompareGate } from '../types.js';

import {
  buildGateJson,
  EXIT,
  exitCodeFor,
  renderGateTable,
  resolveBaseline,
  type GateJson,
  type GateVerdict,
} from './gate.js';

/** The resolved `ur bench run` options (parsed from argv). */
export interface BenchRunOptions {
  readonly suite: string;
  readonly budgetUsd: number;
  readonly gate: boolean;
  readonly allowInconclusive: boolean;
  /** The `--baseline <ref>` value (⇒ compare mode), or undefined. */
  readonly baseline: string | undefined;
  /** The `--cost-ceiling <usd>` absolute per-unit ceiling, or undefined. */
  readonly costCeilingUsd: number | undefined;
  readonly mode: 'request' | 'task' | undefined;
  readonly selectionMode: 'selection' | 'noninferiority' | undefined;
  /** The fresh run tag (default the commit SHA) stamped as `UR_BENCH_RUN` for capture. */
  readonly runTag: string;
  /** The `--capture <cmd>` shell command to run with the bench env set, or undefined. */
  readonly captureCmd: string | undefined;
  readonly json: boolean;
  readonly waitTimeoutMs: number | undefined;
  /** `--pin-baseline`: on a PASS, advance the suite baseline to the new run. */
  readonly pinBaseline: boolean;
}

/** The `ur bench run` flags that take a value. */
const BENCH_RUN_VALUED = new Set([
  'capture',
  'budget',
  'baseline',
  'cost-ceiling',
  'mode',
  'selection',
  'run-tag',
  'wait-timeout',
  'base-url',
  'api-key',
]);

/** The `ur bench run` boolean flags. */
const BENCH_RUN_SWITCHES = new Set(['gate', 'json', 'allow-inconclusive', 'pin-baseline']);

/** The result of {@link parseBenchRunArgs}: the options, or a usage error to print (exit 1). */
export type BenchRunArgs =
  | { readonly ok: true; readonly options: BenchRunOptions }
  | { readonly ok: false; readonly error: string };

/**
 * Parse and VALIDATE every `ur bench run` argument BEFORE anything runs: unknown flags, missing
 * values, malformed numbers and every invalid COMBINATION (`--gate` without `--baseline`,
 * `--pin-baseline` / `--allow-inconclusive` without `--gate`, `--cost-ceiling` without a compare
 * baseline) are usage errors — so a mistake never costs a capture run or the evaluation budget
 * first. PURE: `defaultRunTag` is called only when `--run-tag` is absent.
 */
export function parseBenchRunArgs(
  argv: readonly string[],
  defaultRunTag: () => string,
): BenchRunArgs {
  const values = new Map<string, string>();
  const switches = new Set<string>();
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] ?? '';
    if (!a.startsWith('--')) {
      positionals.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
    if (BENCH_RUN_SWITCHES.has(name)) {
      if (eq !== -1) return { ok: false, error: `--${name} takes no value` };
      switches.add(name);
      continue;
    }
    if (!BENCH_RUN_VALUED.has(name)) return { ok: false, error: `unknown option '--${name}'` };
    let value: string | undefined;
    if (eq !== -1) value = a.slice(eq + 1);
    else {
      value = argv[i + 1];
      i += 1;
    }
    if (value === undefined || value === '' || (eq === -1 && value.startsWith('--'))) {
      return { ok: false, error: `--${name} needs a value` };
    }
    if (values.has(name)) return { ok: false, error: `--${name} was given more than once` };
    values.set(name, value);
  }
  if (positionals.length === 0) return { ok: false, error: 'a suite slug is required' };
  if (positionals.length > 1) {
    return {
      ok: false,
      error: `exactly one suite slug is expected (got ${positionals.join(', ')})`,
    };
  }

  const positive = (name: string): number | undefined | string => {
    const raw = values.get(name);
    if (raw === undefined) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : `--${name} must be a positive number (got '${raw}')`;
  };
  const budget = positive('budget');
  if (typeof budget === 'string') return { ok: false, error: budget };
  const ceiling = positive('cost-ceiling');
  if (typeof ceiling === 'string') return { ok: false, error: ceiling };
  const wait = positive('wait-timeout');
  if (typeof wait === 'string') return { ok: false, error: wait };
  if (wait !== undefined && !Number.isInteger(wait)) {
    return { ok: false, error: '--wait-timeout must be a whole number of milliseconds' };
  }
  const mode = values.get('mode');
  if (mode !== undefined && mode !== 'request' && mode !== 'task') {
    return { ok: false, error: "--mode must be 'request' or 'task'" };
  }
  const selection = values.get('selection');
  if (selection !== undefined && selection !== 'selection' && selection !== 'noninferiority') {
    return { ok: false, error: "--selection must be 'selection' or 'noninferiority'" };
  }

  const gate = switches.has('gate');
  const baseline = values.get('baseline');
  if (gate && baseline === undefined) {
    return {
      ok: false,
      error:
        '--gate requires --baseline <ref> (for example --baseline bench:main): the gate compares a run against a baseline',
    };
  }
  if (switches.has('pin-baseline') && !gate) {
    return {
      ok: false,
      error: '--pin-baseline requires --gate (only a passing gate may move the baseline)',
    };
  }
  if (switches.has('allow-inconclusive') && !gate) {
    return { ok: false, error: '--allow-inconclusive requires --gate' };
  }
  if (ceiling !== undefined && baseline === undefined) {
    return {
      ok: false,
      error: '--cost-ceiling requires --baseline <ref> (it is a compare-run bar)',
    };
  }

  return {
    ok: true,
    options: {
      suite: positionals[0] as string,
      budgetUsd: budget ?? 1,
      gate,
      allowInconclusive: switches.has('allow-inconclusive'),
      baseline,
      costCeilingUsd: ceiling,
      mode: mode as 'request' | 'task' | undefined,
      selectionMode: selection as 'selection' | 'noninferiority' | undefined,
      runTag: values.get('run-tag') ?? defaultRunTag(),
      captureCmd: values.get('capture'),
      json: switches.has('json'),
      waitTimeoutMs: wait,
      pinBaseline: switches.has('pin-baseline'),
    },
  };
}

/** Injected IO for {@link runBench} (the entry wires the real process/spawn; tests inject fakes). */
export interface BenchRunDeps {
  readonly client: UltraRouter;
  /** Run `<cmd>` with the bench env set; resolve its exit code. Absent ⇒ `--capture` is a no-op error. */
  readonly spawnCapture?: (cmd: string, env: Record<string, string>) => Promise<number>;
  readonly log: (line: string) => void;
  readonly err: (line: string) => void;
}

/** The result of a `ur bench run` invocation. */
export interface BenchRunResult {
  readonly exitCode: number;
  readonly json: GateJson;
}

/** Resolve the effective bench run id from the trigger/wait result (a BenchRun.id or a trigger.bench_run_id). */
function effectiveRunId(result: { id?: string; bench_run_id?: string | null }): string | null {
  if (typeof result.id === 'string') return result.id;
  return result.bench_run_id ?? null;
}

/**
 * Run the `ur bench run` flow. Optionally CAPTURES bench-tagged traffic by spawning
 * `<cmd>` with `UR_BENCH`/`UR_BENCH_RUN` (base URL/key) set, FREEZES the suite, TRIGGERS a run
 * (COMPARE mode when `--baseline` is given: the CURRENT config is the single arm), waits for it to
 * complete, reads the gate, prints the summary (or `--json`), and returns the exit code.
 * Fail-closed: any error ⇒ an `error` verdict ⇒ exit 2.
 */
export async function runBench(deps: BenchRunDeps, opts: BenchRunOptions): Promise<BenchRunResult> {
  const baseline = resolveBaseline(opts.baseline);

  const finish = (
    verdict: GateVerdict,
    benchRunId: string | null,
    gate: BenchCompareGate | null,
    error?: string,
  ): BenchRunResult => {
    const json = buildGateJson({
      suite: opts.suite,
      runTag: opts.runTag,
      benchRunId,
      baseline,
      verdict,
      allowInconclusive: opts.allowInconclusive,
      gate,
      ...(error !== undefined ? { error } : {}),
    });
    if (opts.json) deps.log(JSON.stringify(json, null, 2));
    else deps.log(renderGateTable(json));
    return { exitCode: exitCodeFor(verdict, opts.allowInconclusive), json };
  };

  // Validate the combination BEFORE any capture or network call: a gate with nothing to compare
  // against must never first spend a capture run and the evaluation budget.
  if (opts.gate && !baseline.compare) {
    return finish('error', null, null, '--gate requires --baseline <ref> (a compare run to gate)');
  }

  try {
    // 1. Capture (optional): spawn the customer's test/app with the bench env set. A non-zero exit
    // means the traffic is incomplete — fail closed (you cannot gate on partial evidence).
    if (opts.captureCmd !== undefined) {
      if (deps.spawnCapture === undefined) {
        return finish('error', null, null, 'capture requested but no spawn is available');
      }
      deps.err(
        `ur bench: capturing '${opts.captureCmd}' (UR_BENCH=${opts.suite}, run=${opts.runTag})…`,
      );
      const code = await deps.spawnCapture(opts.captureCmd, {
        UR_BENCH: opts.suite,
        UR_BENCH_RUN: opts.runTag,
      });
      if (code !== 0) {
        return finish('error', null, null, `capture command exited ${String(code)}`);
      }
    }

    // 2. Freeze the suite into immutable, content-addressed datasets.
    await deps.client.ur.bench.freeze(opts.suite);

    // 3. Trigger the run (COMPARE mode when a baseline was given) and wait for it to complete.
    const runResult = await deps.client.ur.bench.run({
      suite: opts.suite,
      max_cost_usd: opts.budgetUsd,
      wait: true,
      ...(opts.mode !== undefined ? { mode: opts.mode } : {}),
      ...(baseline.compare
        ? {
            compare: true,
            selection_mode: opts.selectionMode ?? 'noninferiority',
            ...(baseline.baselineRunId !== undefined
              ? { baseline_run_id: baseline.baselineRunId }
              : {}),
            ...(opts.costCeilingUsd !== undefined ? { cost_ceiling_usd: opts.costCeilingUsd } : {}),
          }
        : opts.selectionMode !== undefined
          ? { selection_mode: opts.selectionMode }
          : {}),
      ...(opts.waitTimeoutMs !== undefined ? { waitTimeoutMs: opts.waitTimeoutMs } : {}),
    });
    const benchRunId = effectiveRunId(runResult);
    if (benchRunId === null) {
      return finish('error', null, null, 'no bench run was created (dry run or empty suite)');
    }

    // 4. When not gating, we just ran — report success (nothing to gate against).
    if (!opts.gate) {
      deps.err(`ur bench: run ${benchRunId} complete (no --gate; not evaluated).`);
      return finish('pass', benchRunId, null);
    }
    // 5. Read the baseline-compare gate + resolve the exit code.
    const gate = await deps.client.ur.bench.gate(benchRunId);
    const verdict = gate.verdict as GateVerdict;

    // 6. --pin-baseline: advance the suite baseline to the new run ONLY on a clean pass.
    if (opts.pinBaseline && verdict === 'pass') {
      try {
        const pinned = await deps.client.ur.bench.baseline(benchRunId);
        deps.err(
          `ur bench: pinned run ${benchRunId} as the new baseline (was ${pinned.previous_baseline_run_id ?? 'none'}).`,
        );
      } catch (e) {
        deps.err(`ur bench: warning — failed to pin baseline: ${errMessage(e)}`);
      }
    }

    return finish(verdict, benchRunId, gate);
  } catch (e) {
    // Fail CLOSED on any API/pipeline error: a broken gate is never silently green.
    return finish('error', null, null, errMessage(e));
  }
}

/** A stable message for any thrown value (UltraRouterError carries a code + message). */
function errMessage(e: unknown): string {
  if (e instanceof UltraRouterError) return `${e.code}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}

export { EXIT };
