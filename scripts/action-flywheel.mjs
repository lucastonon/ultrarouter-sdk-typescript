#!/usr/bin/env node
/**
 * The composite-action entrypoint for `mode: flywheel-pr`. It maps the action inputs (passed as
 * env) onto the `ur flywheel-pr` CLI and spawns the globally installed `ur` bin. The CLI does the
 * real work: validate the SCREENED candidate → plan the change and SHOW its diff + destination
 * branch → resolve the delivery mode from the PROBED repository-write grant → (only with
 * `apply-changes: true`) attach to the existing PR, open an improvement PR, or write a downloadable
 * patch → run the SAME application check with the candidate bound → read the SERVER's
 * rollout decision → publish one idempotent comment + Check Run.
 *
 * Three properties this wrapper preserves rather than decides:
 * - **Writing is opt-in twice.** `apply-changes` must be true AND the probed `contents: write`
 * grant must be `granted`; anything else produces the patch path, which runs the identical check.
 * - **Nothing merges and nothing adopts.** The CLI has no merge capability and no rollout-start
 * call; this script adds neither.
 * - **Fail closed.** Any pipeline error exits 2 — a broken candidate gate is never silently green.
 */
import { spawn } from 'node:child_process';

const env = process.env;
const cfg =
  env.UR_APPCI_CONFIG && env.UR_APPCI_CONFIG !== '' ? env.UR_APPCI_CONFIG : 'ur-app-ci.config.json';
const candidate = env.UR_FLW_CANDIDATE ?? '';

if (candidate === '') {
  process.stderr.write(
    "action-flywheel: the 'candidate' input is required for mode: flywheel-pr\n",
  );
  process.exitCode = 2; // fail closed
} else {
  const args = ['flywheel-pr', '--config', cfg, '--candidate', candidate, '--json'];

  const base = env.UR_APPCI_BASE || env.UR_APPCI_BASE_EVENT;
  const head = env.UR_APPCI_HEAD || env.GITHUB_SHA;
  const pr = env.UR_APPCI_PR || env.UR_APPCI_PR_EVENT;
  if (base) args.push('--base', base);
  if (head) args.push('--head', head);
  if (pr) args.push('--pr', pr);
  if (env.UR_APPCI_CHANGED_FROM) args.push('--changed-from', env.UR_APPCI_CHANGED_FROM);
  if (env.UR_FLW_SHAPE) args.push('--shape', env.UR_FLW_SHAPE);
  if (env.UR_FLW_MODULE_PATH) args.push('--module-path', env.UR_FLW_MODULE_PATH);
  if (env.UR_FLW_DELIVERY) args.push('--mode', env.UR_FLW_DELIVERY);
  if (env.UR_FLW_BASE_BRANCH) args.push('--base-branch', env.UR_FLW_BASE_BRANCH);
  if (env.UR_FLW_PATCH_OUT) args.push('--patch-out', env.UR_FLW_PATCH_OUT);
  // The write is an EXPLICIT opt-in: anything other than a literal `true` plans without writing.
  if ((env.UR_FLW_APPLY ?? '').trim().toLowerCase() === 'true') args.push('--apply');
  if ((env.UR_APPCI_ALLOW_INCONCLUSIVE ?? '').toLowerCase() === 'true')
    args.push('--allow-inconclusive');
  if (env.UR_APPCI_ASSERTED) {
    for (const v of env.UR_APPCI_ASSERTED.split(/\s+/).filter((s) => s !== '')) {
      args.push('--asserted-evidence-hash', v);
    }
  }
  // Fork pull requests never execute their code with secrets: the explicit `fork` input wins, else
  // the pull-request event's head-repo fork flag (the same detection as the app-ci entrypoint).
  const forkInput = (env.UR_APPCI_FORK ?? '').trim().toLowerCase();
  const fork =
    forkInput === 'true' || forkInput === '1'
      ? true
      : forkInput === 'false' || forkInput === '0'
        ? false
        : (env.UR_APPCI_FORK_EVENT ?? '').trim().toLowerCase() === 'true';
  if (fork) args.push('--fork');

  const child = spawn('ur', args, { stdio: 'inherit', env: { ...env } });
  child.on('close', (code) => {
    process.exitCode = code ?? 2; // fail closed
  });
  child.on('error', (e) => {
    process.stderr.write(
      `action-flywheel: failed to spawn ur: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    process.exitCode = 2; // fail closed
  });
}
