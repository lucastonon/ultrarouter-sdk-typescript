# Learning status, verdict sources and oracles

ultrarouter learns from the outcomes you record: which models are enough for a call type, which
learned context helps, which past cases answer a new request. This page covers the read side of that
loop and the two ways you make your signals trustworthy:

- **Status and improvement reads**: what the gateway has collected, and for every call type whether a
  cheaper model is enough or quality can improve (with the evidence state of each claim).
- **Verdict sources**: the producers of your task verdicts, and the planted-failure checks that
  qualify them.
- **Oracles**: checks you register that can tell a right answer from a wrong one, including a pull
  transport your own worker or CI answers.

What is available depends on your workspace's data and settings. Every read here reports its state
honestly: a workspace that is still collecting evidence says so, and nothing on this page reports an
improvement the evidence has not established.

- [Learning status](#learning-status)
- [Improvement reads](#improvement-reads)
- [Verdict sources and source checks](#verdict-sources-and-source-checks)
- [Oracles](#oracles)
- [The oracle pull transport](#the-oracle-pull-transport)

## Learning status

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();

const status = await ur.ur.flywheel.status();
console.log(
  'accepted outcomes:',
  status.usage.accepted_outcomes,
  'tracked artifacts:',
  status.usage.tracked_artifacts,
);
for (const channel of status.channels) {
  console.log(channel.channel, channel.accepted_outcomes, channel.last_observed_at ?? 'never');
}
console.log('imports:', status.imports.total, 'running:', status.imports.running);

// The `learning` block of the same read: calibration availability as the gateway declares it.
const learning = await ur.ur.flywheel.calibration();
console.log(
  learning.flywheel_class,
  learning.flywheel_class_reason,
  learning.calibration_available,
);
```

| Block      | Contents                                                                                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `usage`    | Usage quantities for the period, kept separate: accepted outcomes, tracked artifacts, analysis units, evaluation compute, storage, and whether overage is paused. |
| `channels` | Per outcome channel: accepted outcomes and the last time one was observed.                                                                                        |
| `imports`  | History-import counts: total, running, completed, failed, last import time.                                                                                       |
| `learning` | `flywheel_class`, `flywheel_class_reason`, `calibration_available`, `active_levers`.                                                                              |

`calibration()` is a projection of `status()`: there is no separate calibration route, and the SDK
never fabricates a track record. While the gateway reports `calibration_available: false` (for
example with reason `collecting`), treat learning as not yet established. Needs `config:read`.

## Improvement reads

For every call type, two reads side by side: **spend less** ("a cheaper model is enough here") and
**get better** ("quality can improve here"). Each resolves to one closed state with the next action.

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();
const reads = await ur.ur.improvementReads.list();
for (const ct of reads.call_types) {
  console.log(ct.slug ?? ct.call_type_id);
  console.log(
    '  spend less:',
    ct.spend_less.state,
    ct.spend_less.estimate ? '(estimate)' : '',
    ct.spend_less.next_action,
  );
  console.log('  get better:', ct.get_better.state, ct.get_better.next_action);
}
```

| `state`              | Meaning                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| `evidence`           | There is evidence: `source_id`, its `tier`, and `estimate: true` when the figure is an estimate. |
| `collecting`         | Not enough data yet; `collecting` says how much of which floor is met.                           |
| `needs_confirmation` | A learning-plan proposal is waiting for you to confirm it.                                       |
| `keep_incumbent`     | The evidence says to keep the current setup.                                                     |
| `unavailable`        | Not possible right now; `reason` names why.                                                      |

An estimate is labelled as one and is never shown as realized; a screened candidate is never shown as
confirmed. Needs `config:read`.

## Verdict sources and source checks

A **verdict source** is the producer of task verdicts (the credential that recorded them). A
claim-less task verdict counts toward readiness only when its source has shown that it reports known
failures as failures. You qualify a source with a **planted-failure check**: the gateway takes known-good
references from a call type's golden set, plants one failure and one valid alternative per reference,
shuffles them, and you answer every probe exactly once with the same credential.

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();

// Who counts today, and why not.
const sources = await ur.ur.flywheel.sources();
for (const s of sources.data) console.log(s.verdict_source, s.eligible, s.reason);

// Issue a check. The probes are returned once and never stored as text.
const check = await ur.ur.flywheel.sourceChecks.issue({ call_type_id: 'ct_support_reply' });
console.log(check.id, check.probe_count);

// Judge every probe with your real verification logic. This stand-in passes everything,
// which a real check would fail: passing planted failures is exactly what it detects.
const verdicts = check.probes.map((p) => ({
  probe_id: p.probe_id,
  kind: 'resolved_true' as const,
}));
const grade = await ur.ur.flywheel.sourceChecks.answer(check.id, { verdicts });
console.log(grade.result, 'recall', grade.recall.value, 'specificity', grade.specificity.value);
```

A pass needs recall of at least 0.8 on the planted failures and specificity of at least 0.9 on the
valid alternatives; a source that reports success for everything fails. A pass qualifies the source
from now on (never retroactively); a fail revokes it. Issuing a check needs `outcomes:write` plus
`logs:read` (the probes carry golden-set content); reading sources needs `config:read`. Named refusals
include `no_golden_set` and `insufficient_golden_items`.

## Oracles

An **oracle** is a check that can tell a right answer from a wrong one. Its role (detector or
certifier) is earned by qualification against planted failures, never declared.

| Kind             | Transport        | Who runs it                                                                       |
| ---------------- | ---------------- | --------------------------------------------------------------------------------- |
| `label_set`      | `platform`       | The gateway, in process: the output must be one of the labels.                    |
| `schema_rules`   | `platform`       | The gateway: a JSON schema plus rules (`equals`, `within_tolerance`, `ge`, `le`). |
| `test_endpoint`  | `push`           | The gateway calls your HTTPS endpoint.                                            |
| `reconciliation` | `push` or `pull` | Your endpoint, or your worker.                                                    |
| `customer_ci`    | `pull`           | Your worker or CI claims jobs and posts verdicts.                                 |

With an API key (`config:write`) you can register, qualify, test and revoke **platform** checks. Push
and pull oracles are registered by a workspace owner or admin in the dashboard, which shows their
signing secret once; your worker then uses that secret with `claimJobs` / `submitVerdicts`.

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();

// Register a platform check. The same spec again is a no-op; a new spec appends a version.
const reg = await ur.ur.oracles.register({
  kind: 'label_set',
  spec: { labels: ['refund', 'replacement', 'no_action'], case_insensitive: true },
});
console.log(reg.oracle_id, reg.version_hash, reg.inserted);

// Prove it end to end (nothing is graded).
const test = await ur.ur.oracles.test(reg.oracle_id, {
  probe: { input: 'Parcel arrived broken', output: 'refund' },
});
console.log('test verdict:', test.verdict ?? test.error);

// Qualify it: at least 10 distinct known-good examples.
const examples = Array.from({ length: 10 }, (_, i) => ({ input: `ticket ${i}`, output: 'refund' }));
const qualification = await ur.ur.oracles.qualify(reg.oracle_id, { examples });
console.log('qualification:', qualification.status);

// Read its versions, role and state; revoke it when you retire it (terminal).
const oracle = await ur.ur.oracles.get(reg.oracle_id);
console.log(oracle.current?.version_hash, oracle.role.role ?? 'not qualified', oracle.revoked);
await ur.ur.oracles.revoke(reg.oracle_id);
```

| Method                                | Route                                       | Notes                                                                                                                        |
| ------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `register(params)`                    | `POST /v1/flywheel/oracles`                 | `{ kind, spec, transport?, oracle_id? }`. `oracle_id` appends a version to an existing oracle.                               |
| `get(id)`                             | `GET /v1/flywheel/oracles/{id}`             | Versions, earned role, revocation, and transport state (never the secret).                                                   |
| `qualify(id, { examples })`           | `POST /v1/flywheel/oracles/{id}/qualify`    | Detector: recall at least 0.8 and specificity at least 0.9. Certifier: those bars plus zero false passes over enough probes. |
| `test(id, { probe? })`                | `POST /v1/flywheel/oracles/{id}/test`       | A platform check evaluates your probe; push / pull checks receive a synthetic probe.                                         |
| `revoke(id)`                          | `POST /v1/flywheel/oracles/{id}/revoke`     | Terminal: every version stops counting and open jobs are cancelled.                                                          |
| `claimJobs(id, params, signing)`      | `POST /v1/flywheel/oracles/{id}/jobs/claim` | Pull transport, signed. See below.                                                                                           |
| `submitVerdicts(id, params, signing)` | `POST /v1/flywheel/oracles/{id}/verdicts`   | Pull transport, signed. See below.                                                                                           |

## The oracle pull transport

A pull oracle's jobs wait for your worker. The worker leases due jobs, judges each one, and posts one
verdict per job. Both requests are **signed with the oracle's secret**: the SDK sends
`x-ur-oracle-timestamp` (unix seconds) and `x-ur-oracle-signature: sha256=<hex HMAC-SHA256 of
"<timestamp>.<raw body>">`, computed over the exact bytes it sends.

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();
const oracleId = process.env.UR_ORACLE_ID ?? 'orc_release_checks';
const secret = process.env.UR_ORACLE_SECRET; // shown once when the oracle was registered

if (secret === undefined) {
  console.log('Set UR_ORACLE_SECRET (and UR_ORACLE_ID) to run this worker.');
} else {
  // Lease up to 10 due jobs for 15 minutes. Each payload is returned exactly once.
  const claim = await ur.ur.oracles.claimJobs(
    oracleId,
    { max: 10, lease_seconds: 900 },
    { secret },
  );

  const verdicts = claim.data.map((job) => {
    const ok = job.output.trim().length > 0; // replace with your real check
    return {
      job_id: job.job_id,
      oracle_version: job.oracle_version, // echo what the job was issued under
      candidate_sha256: job.candidate_sha256, // and the candidate hash it carried
      verdict: ok ? ('pass' as const) : ('fail' as const),
      ...(ok ? {} : { reasons: ['missing_field' as const] }),
    };
  });

  if (verdicts.length > 0) {
    const result = await ur.ur.oracles.submitVerdicts(oracleId, { verdicts }, { secret });
    console.log(
      `accepted=${result.accepted} duplicate=${result.duplicate} refused=${result.refused}`,
    );
  } else {
    console.log('no jobs due');
  }
}
```

Rules the gateway enforces:

- Each verdict echoes the `job_id`, the `oracle_version` and the `candidate_sha256` of the job it
  answers; a mismatch is refused by name and never recorded as an answer.
- The same verdict again is a `duplicate` (a visible no-op); a different answer for an answered job is
  a `conflict` and never overwrites the first.
- A verdict after the lease expired is refused (`lease_expired`).
- A missing, stale or wrong signature is a `permission` error naming the reason. The timestamp may
  be off by at most a few minutes.
- Claiming needs an API key with `outcomes:write` and `logs:read` (the jobs carry stored content);
  posting verdicts needs `outcomes:write`.

Qualification probes and canaries look exactly like ordinary jobs; answer every job honestly. A
canary answered `pass` is a false pass and permanently stops that version from counting.

## Running a bounded experiment

A bounded experiment is a preregistered, candidate-frozen comparison a workspace owner sets up: a
fixed set of idea families (pairs), each with two slots that the gateway assigns to opposite arms
(`control` and `treated`). A runner — a key with the `flywheel:experiment:run` scope (never implied
by `gateway:invoke`) — drives each execution through `ur.flywheel.experiments`. The owner-session
parts (funding a phase, holds and their reconciliation, judgements, acknowledgement) are not on an
API key and are not part of this resource.

The loop for one execution:

1. **Enrol it before its first call.** Name the `phase` (`screen` or `test`), the `pair_key` and the
   `slot` (`0` or `1`). The gateway — never you — decides the arm from its sealed assignment; a repeat
   of the same `{ phase, pair_key, slot }` returns the same execution (`created: false`), so a resume
   re-enrols the identical tuple safely. Never change the slot to work around a failure.
2. **Send `x-ur-experiment-execution` on every call of the run.** The header value is the returned
   `execution_id`; it rides every `POST /v1/messages` and `POST /v1/responses` the execution makes,
   each with a fresh trace attempt. The constant `EXPERIMENT_EXECUTION_HEADER` is exported for it.
3. **Dry-run, then record the one terminal outcome.** The outcome is body-free: ids, hashes and
   numbers only. `{ dryRun: true }` runs the same validation against the current rows and holds and
   returns the answer with nothing written; the recorded call writes it (idempotent on the execution).
4. **Ask for the evaluation.** `evaluateScreen` / `evaluateTest` run the same exactly-once evaluation a
   recorded outcome does, so facts that changed since (a row landing, a hold settling) are picked up.

```ts
import UltraRouter, { EXPERIMENT_EXECUTION_HEADER } from '@ultrarouter/sdk';

const ur = new UltraRouter();

async function runOneExecution(experimentId: string, pairKey: string, slot: 0 | 1): Promise<void> {
  // 1. Enrol — the gateway decides the arm.
  const execution = await ur.ur.flywheel.experiments.enrol(experimentId, {
    phase: 'screen',
    pair_key: pairKey,
    slot,
  });

  // 2. Every call of this execution carries the execution id as a header, with a fresh trace attempt.
  const headers = { [EXPERIMENT_EXECUTION_HEADER]: execution.execution_id };
  // ...make the run's provider calls here, passing `headers` on each...
  void headers;

  // 3. Dry-run the outcome, then record it (ids, hashes and numbers only — never a body).
  const outcome = {
    terminal: 'delivered' as const,
    reason_codes: [],
    reason_vocab: 'ur.experiment.reasons.v1',
    receipts: [
      {
        ordinal: 0,
        stage: 'writer',
        call_type: 'support-reply',
        request_id: 'req_...',
        extractor_version: 'ex.v1',
        numbers: { post_length: 280 },
      },
    ],
    final_content_hash: 'sha256:...',
    request_ids: ['req_...'],
  };
  const dry = await ur.ur.flywheel.experiments.outcome(
    experimentId,
    execution.execution_id,
    outcome,
    { dryRun: true },
  );
  if (dry.status === 'refused') {
    console.log('would refuse:', dry.refusal);
    return;
  }
  await ur.ur.flywheel.experiments.outcome(experimentId, execution.execution_id, outcome);

  // 4. Re-evaluate the screen (idempotent; the verdict is computed once, only at the barrier).
  const screen = await ur.ur.flywheel.experiments.evaluateScreen(experimentId);
  console.log(screen.experiment_state, screen.computed);
}

void runOneExecution;
```

Refusals are named in the error message and reach you on the typed `UltraRouterError`: branch on
`err.code`, and read the specific reason (`experiment_not_live`, `phase_not_open`, `phase_unfunded`,
`pair_not_in_manifest`, `outcome_conflict`, `receipt_missing:<stage>`, `membership_incomplete`, …) in
`err.message`. The same reasons come back on an outcome dry run as its `refusal` field, so you can see
what recording would do before you write anything.

## Related

- [Outcomes and artifacts](./outcomes.md) — record the outcomes this page reports on
- [Call types](./call-types.md) — evals, recommendations and verified memory
- [History imports](./imports.md) — bring history in so reads have data sooner
- API reference: [`FlywheelResource`](./api/sdk.md#flywheelresource),
  [`ExperimentsResource`](./api/sdk.md#experimentsresource),
  [`OraclesResource`](./api/sdk.md#oraclesresource), [`OracleSigningOptions`](./api/sdk.md#oraclesigningoptions)
