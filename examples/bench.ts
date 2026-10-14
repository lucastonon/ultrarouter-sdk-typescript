/**
 * Bench: check a suite's readiness, freeze it, estimate a run, run it and read the report.
 *
 * Run (a test key with `config:read`, `config:write` and `bench:run`):
 *
 *   ULTRAROUTER_API_KEY=ur_sk_test_... npx tsx examples/bench.ts checkout-assistant
 *
 * See docs/bench.md. To gate CI on a verdict, use `ur bench run --gate` (docs/cli.md).
 */
import UltraRouter from '@ultrarouter/sdk';

const suite = process.argv[2] ?? 'checkout-assistant';
const ur = new UltraRouter();

const status = await ur.ur.bench.status(suite);
console.log(`${suite}: ${String(status.capture.confirmed)} confirmed capture(s)`);

const frozen = await ur.ur.bench.freeze(suite, { max_items: 300 });
for (const d of frozen.datasets) {
  console.log(
    `  dataset ${d.dataset_hash} for ${d.call_type_id}: ${String(d.card.item_count)} item(s)`,
  );
}

// Estimate first: nothing is reserved or run.
const estimate = await ur.ur.bench.run({ suite, max_cost_usd: 5, dry_run: true });
if ('estimate_usd' in estimate) {
  console.log(`estimate ${String(estimate.estimate_usd)} USD`);
  for (const d of estimate.dispositions)
    console.log(`  ${d.call_type_id}: ${d.disposition} (${d.tier})`);
}

// Run within the cap and wait for a terminal status.
const run = await ur.ur.bench.run({ suite, max_cost_usd: 5, wait: true, waitTimeoutMs: 600_000 });
if ('status' in run) {
  console.log(`run ${run.id}: ${run.status}`);
  const report = await ur.ur.bench.report(run.id, { format: 'md' });
  console.log(report.split('\n')[0]);
}
