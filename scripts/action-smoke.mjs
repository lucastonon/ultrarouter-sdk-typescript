#!/usr/bin/env node
/**
 * The `ur bench` gate smoke: hermetic, no external network. It boots a tiny local stub gateway
 * implementing the Bench freeze / run / poll / gate routes, then runs the real built `ur` CLI
 * (`dist/cli/index.cjs`) against it for each verdict fixture and asserts the exit codes: pass ⇒ 0,
 * fail ⇒ 2, inconclusive ⇒ 2 (0 with `--allow-inconclusive`), API error ⇒ 2 (fail closed). This is
 * the behaviour the GitHub Action's `mode: bench` wraps, proven end to end without a live gateway.
 *
 * Run: `npm run build && node scripts/action-smoke.mjs`.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, '../dist/cli/index.cjs');

/** A canonical gate response for a verdict (deterministic). */
function gate(verdict, extra = {}) {
  const ct = {
    call_type_id: 'ct_checkout',
    eval_run_id: 'er_cand',
    baseline_eval_run_id: 'er_base',
    verdict,
    quality: extra.quality ?? verdict,
    cost: extra.cost ?? verdict,
    quality_interval: { low: 0.01, high: 0.03, point: 0.02, n: 40, clusters: 40, bar: -0.05 },
    cost_interval: { low: 0.25, high: 0.35, point: 0.3, n: 40, clusters: 40, bar: 0.1 },
    quality_margin_pp: 5,
    cost_min_savings: 0.1,
    mde_pp: 2.3,
    cost_ceiling: {
      enabled: false,
      ceiling_micro_usd: null,
      observed_mean_micro_usd: null,
      breached: false,
    },
    pairing: {
      candidate_items: 40,
      eligible_pairs: 40,
      ineligible_missing_artifact: 0,
      unpaired: 0,
      eligible_clusters: 40,
    },
    reasons: extra.reasons ?? [],
  };
  return {
    object: 'bench_compare_gate',
    bench_run_id: 'br_run1',
    baseline_run_id: 'br_base1',
    verdict,
    cost_ceiling_micro_usd: null,
    call_types: [ct],
    reasons: ct.reasons,
  };
}

/** Start a stub gateway that returns `gateFixture` from GET …/gate. Resolves to `{ url, close }`. */
function startStub(gateFixture, failOn) {
  return new Promise((res) => {
    const server = createServer((req, reply) => {
      const url = req.url ?? '';
      const method = req.method ?? 'GET';
      const send = (body, status = 200) => {
        reply.writeHead(status, { 'content-type': 'application/json' });
        reply.end(JSON.stringify(body));
      };
      const err = (code, status) =>
        send({ error: { code, message: `${code} (stub)`, type: code } }, status);
      if (method === 'POST' && url.endsWith('/freeze')) {
        return failOn === 'freeze'
          ? err('internal', 500)
          : send({ object: 'bench_dataset_freeze', suite: 's', suite_id: 'bs_1', datasets: [] });
      }
      if (method === 'POST' && url.endsWith('/runs')) {
        return send({
          object: 'bench_run_trigger',
          bench_run_id: 'br_run1',
          suite: 's',
          dry_run: false,
          mode: 'request',
          selection_mode: 'noninferiority',
          estimate_usd: 0.01,
          allowance: { grant_usd: 10, reserved_usd: 0, spent_usd: 0, available_usd: 10 },
          dispositions: [],
        });
      }
      if (method === 'GET' && /\/bench\/runs\/[^/]+$/.test(url)) {
        return send({
          object: 'bench_run',
          id: 'br_run1',
          suite: 's',
          mode: 'request',
          selection_mode: 'noninferiority',
          status: 'complete',
          estimate_usd: 0.01,
          allowance: { grant_usd: 10, reserved_usd: 0, spent_usd: 0, available_usd: 10 },
          dispositions: [],
          runs: [],
        });
      }
      if (method === 'GET' && url.endsWith('/gate')) {
        return failOn === 'gate' ? err('internal', 500) : send(gateFixture);
      }
      err('not_found', 404);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      res({ url: `http://127.0.0.1:${addr.port}`, close: () => server.close() });
    });
  });
}

/** Run the built CLI; resolve its exit code + stdout. */
function runCli(args, baseUrl) {
  return new Promise((res) => {
    const child = spawn(
      'node',
      [CLI, ...args, '--base-url', baseUrl, '--api-key', 'ur_sk_test_x'],
      {
        env: { ...process.env, GITHUB_SHA: 'deadbeefcafe' },
      },
    );
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', () => {});
    child.on('close', (code) => res({ code: code ?? 1, out })); // a signal-killed CLI failed
  });
}

let failures = 0;
function check(name, got, want) {
  const ok = got === want;
  if (!ok) failures += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${name}: exit ${got} (want ${want})`);
}

async function main() {
  console.log('bench gate smoke — the built ur CLI vs a hermetic stub gateway');

  const pass = await startStub(gate('pass'));
  check(
    'green fixture ⇒ pass',
    (
      await runCli(
        ['bench', 'run', 'checkout', '--gate', '--baseline', 'bench:main', '--json'],
        pass.url,
      )
    ).code,
    0,
  );
  pass.close();

  const fail = await startStub(
    gate('fail', { verdict: 'fail', quality: 'fail', reasons: ['quality_regression'] }),
  );
  check(
    'regression fixture ⇒ fail (exit 2)',
    (await runCli(['bench', 'run', 'checkout', '--gate', '--baseline', 'bench:main'], fail.url))
      .code,
    2,
  );
  fail.close();

  const inconc = await startStub(gate('inconclusive'));
  check(
    'inconclusive ⇒ exit 2 by default',
    (await runCli(['bench', 'run', 'checkout', '--gate', '--baseline', 'bench:main'], inconc.url))
      .code,
    2,
  );
  check(
    'inconclusive + --allow-inconclusive ⇒ exit 0',
    (
      await runCli(
        ['bench', 'run', 'checkout', '--gate', '--baseline', 'bench:main', '--allow-inconclusive'],
        inconc.url,
      )
    ).code,
    0,
  );
  inconc.close();

  const apiErr = await startStub(gate('pass'), 'gate');
  check(
    'API error ⇒ fail closed (exit 2)',
    (await runCli(['bench', 'run', 'checkout', '--gate', '--baseline', 'bench:main'], apiErr.url))
      .code,
    2,
  );
  apiErr.close();

  if (failures > 0) {
    console.error(`\nbench gate smoke: ${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log('\nbench gate smoke: all checks passed');
}

main().catch((e) => {
  console.error('bench gate smoke: fatal', e);
  process.exit(1);
});
