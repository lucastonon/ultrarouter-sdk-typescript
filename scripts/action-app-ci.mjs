#!/usr/bin/env node
/**
 * The composite-action entrypoint for `mode: app-ci`. It maps the action inputs (passed as env)
 * onto the `ur app-ci` CLI, auto-detects a fork pull request, and spawns the globally installed
 * `ur` bin. The CLI does the work: advisory change detection → the baseline and candidate harness
 * runs (with a scrubbed env, and never in fork mode) → evidence pinning and staleness → the
 * offline-replay gate → one idempotent comment and Check Run per workflow and head commit.
 * Fail-closed: any pipeline error exits 2, so a broken gate is never green.
 *
 * Least privilege and fork isolation: the publication token (GITHUB_TOKEN) reaches the CLI for the
 * comment and the check only; the CLI removes it from the environment before running your harness.
 * Fork pull requests never execute their code with secrets: `--fork` makes the run detection and
 * comment only.
 */
import { spawn } from 'node:child_process';

const env = process.env;
const cfg =
  env.UR_APPCI_CONFIG && env.UR_APPCI_CONFIG !== '' ? env.UR_APPCI_CONFIG : 'ur-app-ci.config.json';

// Auto-detect a fork PR: the explicit input wins, else the PR event's head-repo fork flag.
const forkInput = (env.UR_APPCI_FORK ?? '').trim().toLowerCase();
const fork =
  forkInput === 'true' || forkInput === '1'
    ? true
    : forkInput === 'false' || forkInput === '0'
      ? false
      : (env.UR_APPCI_FORK_EVENT ?? '').trim().toLowerCase() === 'true';

const args = ['app-ci', '--config', cfg, '--json'];

const base = env.UR_APPCI_BASE || env.UR_APPCI_BASE_EVENT;
const head = env.UR_APPCI_HEAD || env.GITHUB_SHA;
const pr = env.UR_APPCI_PR || env.UR_APPCI_PR_EVENT;
if (base) args.push('--base', base);
if (head) args.push('--head', head);
if (pr) args.push('--pr', pr);
if (env.UR_APPCI_CHANGED_FROM) args.push('--changed-from', env.UR_APPCI_CHANGED_FROM);
if (fork) args.push('--fork');
if ((env.UR_APPCI_ALLOW_INCONCLUSIVE ?? '').toLowerCase() === 'true')
  args.push('--allow-inconclusive');
if (env.UR_APPCI_ASSERTED) {
  for (const v of env.UR_APPCI_ASSERTED.split(/\s+/).filter((s) => s !== '')) {
    args.push('--asserted-evidence-hash', v);
  }
}

const child = spawn('ur', args, { stdio: 'inherit', env: { ...env } });
child.on('close', (code) => {
  process.exitCode = code ?? 2; // fail closed
});
child.on('error', (e) => {
  process.stderr.write(
    `action-app-ci: failed to spawn ur: ${e instanceof Error ? e.message : String(e)}\n`,
  );
  process.exitCode = 2; // fail closed
});
