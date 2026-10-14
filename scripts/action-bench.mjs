#!/usr/bin/env node
/**
 * The composite-action entrypoint for `mode: bench`. Every action input arrives as an ENVIRONMENT
 * VARIABLE (never interpolated into shell source), is validated here, and is handed to the globally
 * installed `ur` bin as ONE argv element each (`--flag=value`), with no shell in between. So an
 * input — even one a workflow fills from pull-request text — is data: a `$(…)`, a backtick or a
 * `;` in it is never evaluated, and a value cannot smuggle in an extra flag.
 *
 * The one deliberate execution point is the `capture` input: it IS a shell command (it drives your
 * app or tests through the gateway), and `ur bench run --capture` runs it, once, with the Bench
 * environment set. Pass only a command you control there.
 *
 * Fail-closed: an invalid input exits 1 before anything runs; a gate failure, an API error or a
 * signal-terminated CLI exits non-zero.
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Characters no input may contain (control characters, including newlines). */
const CONTROL = /[\u0000-\u001f\u007f]/;
const NUMBER = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const RUN_TAG = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

/**
 * Validate the bench inputs (as env) and build the `ur` argv. PURE: returns `{ args }` or
 * `{ error }`, never throws, never runs anything.
 * @param {Record<string, string | undefined>} env
 * @returns {{ args: string[] } | { error: string }}
 */
export function buildBenchArgs(env) {
  const get = (name) => (env[name] ?? '').trim();
  const text = (name, label, { required = false, max = 200 } = {}) => {
    const value = get(name);
    if (value === '') return required ? { error: `'${label}' is required` } : { value: '' };
    if (CONTROL.test(value)) return { error: `'${label}' must not contain control characters` };
    if (value.startsWith('-')) return { error: `'${label}' must not start with '-'` };
    if (value.length > max) return { error: `'${label}' is longer than ${String(max)} characters` };
    return { value };
  };
  const number = (name, label, required) => {
    const value = get(name);
    if (value === '') return required ? { error: `'${label}' is required` } : { value: '' };
    if (!NUMBER.test(value) || Number(value) <= 0) {
      return { error: `'${label}' must be a positive number (got '${value}')` };
    }
    return { value };
  };
  const bool = (name, label) => {
    const value = get(name).toLowerCase();
    if (value === '' || value === 'false') return { value: false };
    if (value === 'true') return { value: true };
    return { error: `'${label}' must be 'true' or 'false' (got '${get(name)}')` };
  };

  const suite = text('UR_SUITE', 'suite', { required: true });
  if ('error' in suite) return suite;
  const baseline = text('UR_BASELINE', 'baseline', { required: true });
  if ('error' in baseline) return baseline;
  const budget = number('UR_BUDGET', 'budget', true);
  if ('error' in budget) return budget;
  const ceiling = number('UR_COST_CEILING', 'cost-ceiling', false);
  if ('error' in ceiling) return ceiling;
  const mode = get('UR_PAIRED_MODE') === '' ? 'request' : get('UR_PAIRED_MODE');
  if (mode !== 'request' && mode !== 'task') {
    return { error: `'paired-mode' must be 'request' or 'task' (got '${mode}')` };
  }
  const runTag = get('UR_RUN_TAG');
  if (runTag !== '' && !RUN_TAG.test(runTag)) {
    return { error: `'run-tag' must match ${RUN_TAG.source}` };
  }
  const allowInconclusive = bool('UR_ALLOW_INCONCLUSIVE', 'allow-inconclusive');
  if ('error' in allowInconclusive) return allowInconclusive;
  const pinBaseline = bool('UR_PIN_BASELINE', 'pin-baseline');
  if ('error' in pinBaseline) return pinBaseline;
  // The capture command is a shell command by design; it only has to be one line of text.
  const capture = env.UR_CAPTURE ?? '';
  if (/[\r\n\u0000]/.test(capture)) return { error: "'capture' must be a single line" };

  const args = [
    'bench',
    'run',
    suite.value,
    '--gate',
    '--json',
    `--baseline=${baseline.value}`,
    `--budget=${budget.value}`,
    `--mode=${mode}`,
  ];
  if (capture.trim() !== '') args.push(`--capture=${capture}`);
  if (ceiling.value !== '') args.push(`--cost-ceiling=${ceiling.value}`);
  if (runTag !== '') args.push(`--run-tag=${runTag}`);
  if (allowInconclusive.value) args.push('--allow-inconclusive');
  if (pinBaseline.value) args.push('--pin-baseline');
  return { args };
}

function main() {
  const built = buildBenchArgs(process.env);
  if ('error' in built) {
    process.stderr.write(`::error::ur action (mode: bench): ${built.error}\n`);
    process.exitCode = 1;
    return;
  }
  const child = spawn('ur', built.args, { stdio: 'inherit', env: { ...process.env } });
  child.on('close', (code, signal) => {
    process.exitCode = code ?? (signal !== null ? 2 : 1); // a signal-killed gate fails closed
  });
  child.on('error', (e) => {
    process.stderr.write(
      `action-bench: failed to spawn ur: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    process.exitCode = 2; // fail closed
  });
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
