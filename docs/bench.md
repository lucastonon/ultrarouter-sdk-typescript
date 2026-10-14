# Bench

**Bench** turns real captured traffic into a frozen, versioned evaluation dataset and runs paired
comparisons over it: your current configuration against challenger models, or a new configuration
against a pinned baseline. It reports quality and cost with intervals and an honest
`pass` / `fail` / `inconclusive` verdict.

The flow:

1. **Capture**: tag requests with a Bench suite so the gateway records them for the suite.
2. **Freeze**: snapshot the suite's captures into immutable datasets (one per call type).
3. **Assert** (optional): attach programmatic assertions and per-trace outcomes.
4. **Run**: estimate first (`dry_run`), then run within a cost cap.
5. **Read**: the run, its report, and in compare mode the gate verdict.

`ur.ur.bench` is the programmatic surface. In CI, the [`ur bench` CLI](./cli.md) and the
[GitHub Action](./github-action.md) wrap the same calls and turn the verdict into an exit code.

- [Capture traffic for a suite](#capture-traffic-for-a-suite)
- [Freeze and check readiness](#freeze-and-check-readiness)
- [Run](#run)
- [Compare against a baseline](#compare-against-a-baseline)
- [Reports](#reports)
- [Assertions and outcomes](#assertions-and-outcomes)

## Capture traffic for a suite

Tag requests with a suite slug, either for the whole client or per call. Bench capture needs a **test
key** (`ur_sk_test_…`); a live key with a Bench tag is refused unless a workspace owner allows live
capture, and the client warns once at construction.

```ts
import UltraRouter from '@ultrarouter/sdk';

// Every request from this client is captured for the `checkout-assistant` suite. `run` labels the
// capture window; `trace` groups the calls of one multi-step task (a function gives a fresh id per call).
const ur = new UltraRouter({
  defaultModel: 'openai/gpt-5.2-mini',
  bench: {
    suite: 'checkout-assistant',
    run: 'nightly-2026-10-13',
    trace: () => `task-${Date.now()}`,
  },
});

const res = await ur.chat.completions.create({
  messages: [{ role: 'user', content: 'Which plan includes priority support?' }],
});
console.log(res.ur.bench?.capture_status ?? 'not captured');

// A per-call tag wins over the client tag.
await ur.chat.completions.create({
  bench: { suite: 'checkout-assistant', trace: 'task-42' },
  messages: [{ role: 'user', content: 'And what does it cost?' }],
});
```

Without the `bench` option, the client falls back to the `UR_BENCH` environment variable (plus
optional `UR_BENCH_RUN` and `UR_BENCH_TRACE`). The tag rides as `X-UR-Bench-*` headers on every request,
including retries and clients created with [`asOpenAI()`](./openai-compatibility.md). A response's
`ur.bench.capture_status` is `queued`: capture is recorded asynchronously, and the suite status reports
what was actually confirmed.

## Freeze and check readiness

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();

const status = await ur.ur.bench.status('checkout-assistant'); // needs `config:read`
console.log(
  'confirmed captures:',
  status.capture.confirmed,
  'call types:',
  status.call_types.length,
);

// Freeze (needs `config:write`). `max_items` caps items per call type (1–5000, default 500).
const frozen = await ur.ur.bench.freeze('checkout-assistant', { max_items: 300 });
for (const d of frozen.datasets) {
  console.log(
    d.call_type_id,
    d.dataset_hash,
    'items:',
    d.card.item_count,
    'unique:',
    d.card.unique_count,
  );
}
for (const w of frozen.warnings ?? []) console.log('warning:', w.code, w.message);
```

Freezing deduplicates (exact and near-duplicate clustering), keeps frequencies as weights, and returns
a **dataset card** per call type: counts, strata, exclusions and a pre-registered power plan.
Re-freezing identical captures returns the same `dataset_hash`. A warning such as
`no_call_type_attribution` means captures were not tagged with a call type.

## Run

Always estimate first. `max_cost_usd` is required: it is the ceiling of the allowance the run reserves
across all its child evaluations.

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();

// 1. Dry run: the estimate, the allowance and per-call-type dispositions. Nothing is reserved or run.
const estimate = await ur.ur.bench.run({
  suite: 'checkout-assistant',
  max_cost_usd: 5,
  dry_run: true,
});
if ('dispositions' in estimate && 'estimate_usd' in estimate) {
  console.log(
    'estimate',
    estimate.estimate_usd,
    'USD; available',
    estimate.allowance.available_usd,
  );
  for (const d of estimate.dispositions)
    console.log(d.call_type_id, d.disposition, d.tier, d.reason ?? '');
}

// 2. Run and wait for a terminal status (polls the run; default timeout 2 minutes).
const run = await ur.ur.bench.run({
  suite: 'checkout-assistant',
  max_cost_usd: 5,
  candidates: ['openai/gpt-5.2-mini', 'anthropic/claude-sonnet-4.6'],
  wait: true,
  waitTimeoutMs: 600_000,
});
console.log(run.object, 'status' in run ? run.status : 'n/a');
```

| `run` parameter                                  | Meaning                                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `suite`                                          | The suite slug. Required.                                                                              |
| `max_cost_usd`                                   | Required. The run's reservation ceiling in USD.                                                        |
| `dry_run`                                        | Return the estimate only.                                                                              |
| `mode`                                           | `request` (default) or `task` (whole traces; the only mode whose cost is per task).                    |
| `selection_mode`                                 | `selection` (default: ranked evidence, never a recommendation) or `noninferiority` (incumbent-paired). |
| `candidates`                                     | Challenger model ids (default: chosen from the catalog).                                               |
| `call_types`                                     | Restrict the run to these frozen call types.                                                           |
| `require_power`                                  | Exclude underpowered call types before anything is reserved (default `false`).                         |
| `force`                                          | Skip the recent-run deduplication and always run fresh.                                                |
| `compare`, `baseline_run_id`, `cost_ceiling_usd` | Compare mode, below.                                                                                   |
| `wait`, `pollIntervalMs`, `waitTimeoutMs`        | Client-side polling: resolve the finished `BenchRun` instead of the trigger receipt.                   |

Without `wait`, `run` resolves the trigger receipt (`bench_run_id`, the estimate, dispositions);
read the run later with `ur.ur.bench.get(runId)`. A `wait` that times out throws an
`UltraRouterError` with code `timeout`; the run itself keeps going. Running needs the `bench:run`
scope. A deployment where paid runs are unavailable answers a live run with
`atomic_spend_guard_unavailable`; dry runs still work.

## Compare against a baseline

Compare mode runs your **current** configuration (a new prompt, a new pinned model) as the single arm
and pairs it item by item against a pinned baseline run's retained outputs. The gate passes only when
both the quality non-inferiority interval and the cost interval clear their bars; a cost-ceiling breach
fails regardless of quality, and missing evidence degrades toward `inconclusive`, never to `pass`.

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();

// Pin a completed run as the suite baseline (once).
const pinned = await ur.ur.bench.baseline('br_baseline_run');
console.log('baseline:', pinned.baseline_run_id);

// Later, after changing the configuration: run in compare mode and read the gate.
const trigger = await ur.ur.bench.run({
  suite: 'checkout-assistant',
  max_cost_usd: 5,
  compare: true,
  cost_ceiling_usd: 0.01,
});
const runId =
  'bench_run_id' in trigger && trigger.bench_run_id !== null
    ? trigger.bench_run_id
    : 'br_compare_run';
const gate = await ur.ur.bench.gate(runId);
console.log('verdict:', gate.verdict, gate.reasons.join('; '));
for (const ct of gate.call_types)
  console.log(ct.call_type_id, 'quality', ct.quality, 'cost', ct.cost);
```

The umbrella verdict is the strictest across call types. `ur bench run --gate` in the CLI maps it to an
exit code (`pass` → 0, `fail` / `inconclusive` → 2).

## Reports

`report(runId)` returns the immutable evidence report of a completed run: the dataset card, the power
statement, per-arm cost and quality with intervals and their units, the verdict, limitations and a
reproducibility appendix. `format: 'md'` returns a Markdown export and `format: 'bundle'` an
offline-verifiable evidence bundle, both as text.

```ts
import { writeFile } from 'node:fs/promises';
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();
const report = await ur.ur.bench.report('br_mock_1'); // typed JSON
console.log(report.bench_run_id, report.call_types.length);

const markdown = await ur.ur.bench.report('br_mock_1', { format: 'md' }); // string
await writeFile('bench-report.md', markdown);
console.log(markdown.split('\n')[0]);
```

Cost figures in a report are labelled with their basis (provider-reported or estimated) and unit
(`$/request` or `$/task`). Treat estimated figures as estimates.

## Assertions and outcomes

Attach programmatic assertions to a suite (`json_schema`, `exact_field`, `regex_match`,
`citation_substring`) and record per-trace pass/fail outcomes, the strongest evidence class. Both are
append-only and attach forward: the next freeze or run uses them; a frozen dataset never changes.

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();

await ur.ur.bench.expect('checkout-assistant', [
  { kind: 'regex_match', config: { pattern: '\\bpriority support\\b', flags: 'i' } },
  {
    kind: 'json_schema',
    call_type: 'ct_plan_lookup',
    config: { required_fields: ['plan', 'price'] },
  },
]);

const recorded = await ur.ur.bench.record({ suite: 'checkout-assistant' }, [
  { trace: 'task-42', passed: true },
  { trace: 'task-43', passed: false, labels: { failure: 'wrong_plan' } },
]);
console.log(recorded);

// Or scope outcomes to one run:
await ur.ur.bench.record({ run: 'br_mock_1' }, [{ trace: 'task-44', passed: true }]);
```

Assertion configs are validated per kind; an unknown kind or a malformed config is refused.

## Pitfalls

- **Use a test key for capture.** Live-key capture is refused unless explicitly allowed.
- **Freeze before you run.** Runs read frozen datasets only; new captures need a new freeze.
- **Always dry-run a new suite** and read the dispositions: small call types are `not_runnable` until
  they have enough unique items.
- **`selection` mode never recommends.** Use `noninferiority` or compare mode when you need a decision.

## Related

- [CLI: `ur bench`](./cli.md) and [GitHub Action](./github-action.md) — gate CI on the verdict
- [Call types](./call-types.md) — the configuration a compare run evaluates
- [Errors](./errors.md) — `timeout`, `atomic_spend_guard_unavailable`
- API reference: [`BenchResource`](./api/sdk.md#benchresource), [`BenchRunParams`](./api/sdk.md#benchrunparams)
