#!/usr/bin/env node
// The preflight + useLearned battery. It drives the real built `@ultrarouter/sdk` client
// (../../dist/index.js) through the surface against a hermetic HTTP stub gateway
// (stub-gateway.mjs) over a real socket: the two-lifetime cache (ETag config part + 30 s live part),
// the grant that is NEVER cached (a cached 304 still yields the FRESH X-UR-Grant), the
// learned-slot placement, the delivery advisory (apply ALWAYS injects on this non-proxied path,
// regardless of `delivery`, which governs only the gateway on a PROXIED request), the deduped-eval
// trigger (a dedupe names the prior run), and the whole non-proxied loop (preflight → apply → record the
// grant → outcome). Boots nothing external; exits 0 on success, 2 on any failure (fail-closed).
// Prereq: `npm run build`.
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startPreflightStub } from './stub-gateway.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SDK = resolve(HERE, '../../dist/index.js');

if (!existsSync(SDK)) {
  console.error(`preflight battery: the built SDK is missing (${SDK}).`);
  console.error('Build it first: npm run build (at the repository root)');
  process.exit(1);
}

const { default: UltraRouter, learnedPlacementIndex } = await import(SDK);

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) {
    process.stdout.write(`  ✓ ${name}\n`);
  } else {
    failures += 1;
    process.stdout.write(`  ✗ ${name}${detail ? ` — ${detail}` : ''}\n`);
  }
}

const stub = await startPreflightStub();
const ur = new UltraRouter({ apiKey: 'ur_sk_test_pf', baseURL: stub.url });

try {
  // 1) preflight WITH a cluster key ⇒ routing + learned knowledge + the grant (body + header)
  const t0 = 1_000;
  const pf1 = await ur.preflight(
    { call_type: 'ct', artifact_key: 'pf-loop:contract' },
    { now: () => t0 },
  );
  check('preflight POSTs /v1/preflight and returns object=preflight', pf1.object === 'preflight');
  check(
    'the routing recommendation is present (ranking)',
    pf1.routing.model?.id === 'openai/gpt-5.2-mini',
  );
  check(
    'the learned knowledge + the ONE placement rule are advised',
    pf1.knowledge?.placement === 'after_stable_prefix',
  );
  check(
    'the grant is in the body (grant_id + a dispatchable arm)',
    typeof pf1.grant?.grant_id === 'string' &&
      ['treated', 'holdout', 'lever_holdout', 'pre_lever'].includes(pf1.grant?.arm),
  );
  const firstPreflight = stub.calls.find((c) => c.path === '/v1/preflight');
  check(
    'the request carried NO If-None-Match on the first call',
    firstPreflight?.headers['if-none-match'] === undefined,
  );

  // 2) a 304 revalidation still yields the FRESH grant from X-UR-Grant (the grant is NEVER cached) ----
  // A cluster key ALWAYS hits the network (the grant is uncached); within the 30 s live window the SDK
  // sends a conditional request and the stub 304s. The config body is reused from cache; the grant can
  // only have come from the header (the SDK strips it from the cached body), so a non-null grant proves it.
  const pf2 = await ur.preflight(
    { call_type: 'ct', artifact_key: 'pf-loop:contract' },
    { now: () => t0 + 2_000 },
  );
  const secondPreflight = stub.calls.filter((c) => c.path === '/v1/preflight')[1];
  check(
    'the second call sent a conditional request (If-None-Match)',
    typeof secondPreflight?.headers['if-none-match'] === 'string',
  );
  check(
    'the cached config body was reused on the 304 (routing model present)',
    pf2.routing.model?.id === 'openai/gpt-5.2-mini',
  );
  check(
    'a cached 304 STILL yields the grant fresh from X-UR-Grant (never cached)',
    pf2.grant !== null && pf2.grant.grant_id === pf1.grant.grant_id,
  );
  check(
    'the idempotent grant is stable across the loop (same served request_id)',
    pf2.grant.request_id === pf1.grant.request_id,
  );

  // 3) preflight WITHOUT a cluster key ⇒ grant null + a NAMED reason (never a silent omission) --------
  const pf3 = await ur.preflight({ call_type: 'ct' });
  check(
    'no cluster key ⇒ grant null + grant_reason=no_cluster_key',
    pf3.grant === null && pf3.grant_reason === 'no_cluster_key',
  );

  // 4) useLearned — apply() places the learned block at learnedPlacementIndex (the vendored rule) -----
  // This call type reports delivery=off; apply() injects (the non-proxied path always injects — 4b
  // proves it injects on gateway delivery too).
  const session = await ur.useLearned(
    { call_type: 'ct', artifact_key: 'pf-loop:contract' },
    { noCache: true },
  );
  check(
    'useLearned exposes the arm + the recommended model',
    session.grant !== null && session.model === 'openai/gpt-5.2-mini',
  );
  check(
    'the knowledge block advertises delivery=off for this call type',
    session.knowledge?.delivery === 'off',
  );
  const messages = [
    { role: 'system', content: 'You are a support agent.' },
    { role: 'system', content: 'Follow the refund policy.' },
    { role: 'user', content: 'refund my order please' },
  ];
  const applied = session.apply(messages);
  const at = learnedPlacementIndex(messages);
  check(
    'apply() inserts the learned block AFTER the stable system prefix (parity vs the vendored rule)',
    at === 2 &&
      applied[at]?.content === session.knowledge.module.content &&
      applied[at]?.role === 'user',
  );
  check(
    'apply() adds exactly one message and preserves the prefix + tail',
    applied.length === messages.length + 1,
  );

  // 4b) a call type on the DEFAULT `gateway_inject_after_stable_prefix` delivery: apply() STILL
  // injects, because useLearned() is the NON-proxied path (the gateway never sees the call). `delivery`
  // is exposed for visibility but never gates apply(). ------------------------------------------------
  const gwSession = await ur.useLearned(
    { call_type: 'ct-gateway', artifact_key: 'pf-loop:gw' },
    { noCache: true },
  );
  check(
    'the knowledge block advertises delivery=gateway_inject_after_stable_prefix',
    gwSession.knowledge?.delivery === 'gateway_inject_after_stable_prefix',
  );
  const gwApplied = gwSession.apply(messages);
  const gwAt = learnedPlacementIndex(messages);
  check(
    'apply() injects the module even on gateway delivery (the non-proxied path always injects)',
    gwApplied[gwAt]?.content === gwSession.knowledge?.module.content &&
      gwApplied[gwAt]?.role === 'user' &&
      gwApplied.length === messages.length + 1,
  );

  // 5) record() QUOTES the grant on the artifact, then records the outcome ----
  const receipt = await session.record({
    channel: 'correction',
    kind: 'edited',
    value: { diff_stats: { edit_ratio: 0.25, changed_spans: 2 } },
    source_event_id: 'pf-loop-corr-contract',
  });
  check(
    'record() delivers the outcome',
    receipt.status === 'delivered' && receipt.result?.status === 'accepted',
  );
  const artifactPost = stub.calls.find((c) => c.path === '/v1/artifacts' && c.method === 'POST');
  check(
    'the artifact upsert QUOTES the grant (grant_id + attestation:applied)',
    artifactPost?.body?.grant_id === session.grant.grant_id &&
      artifactPost?.body?.attestation === 'applied' &&
      artifactPost?.body?.key === 'pf-loop:contract',
  );
  const outcomePost = stub.calls.find((c) => /^\/v1\/artifacts\/[^/]+\/outcomes$/.test(c.path));
  const event = outcomePost?.body?.outcomes?.[0];
  check(
    'the outcome event carries the customer fields, and provenance stays the server’s (never set by the SDK)',
    event?.channel === 'correction' &&
      event?.kind === 'edited' &&
      event.source === undefined &&
      event.producer === undefined &&
      event.learning_use === undefined,
  );

  // 6) a HOLDOUT session withholds the learned module in the SAME response (the standing holdout) -----
  const holdout = await ur.useLearned(
    { call_type: 'ct', artifact_key: 'loop:apply' },
    { noCache: true },
  );
  check(
    'a holdout-arm grant withholds the learned module (knowledge null; the holdout is honoured)',
    holdout.grant?.arm === 'holdout' && holdout.knowledge === null,
  );
  check(
    'a holdout session applies NOTHING (messages pass through unchanged)',
    JSON.stringify(holdout.apply(messages)) === JSON.stringify(messages),
  );

  // 7) the manual eval trigger. The FIRST fire ENQUEUES; an identical re-fire DEDUPES
  // and NAMES the run it deduped onto (prior_run_id + its trigger/status), so a client can follow it.
  const enq = await ur.ur.callTypes.enqueueEval('ct_eval', { mode: 'request' });
  check(
    'enqueueEval fires the manual trigger and returns the enqueued run',
    enq.enqueued === true && typeof enq.run_id === 'string' && enq.candidate_count === 3,
  );
  const dedup = await ur.ur.callTypes.enqueueEval('ct_eval');
  check(
    'an identical re-trigger DEDUPES with a named prior run + its trigger/status',
    dedup.enqueued === false &&
      dedup.deduped === true &&
      dedup.reason === 'deduped' &&
      dedup.prior_run_id === enq.run_id &&
      dedup.trigger === 'manual' &&
      dedup.status === 'queued',
  );
} finally {
  stub.close();
}

if (failures > 0) {
  process.stderr.write(`\npreflight battery: ${String(failures)} check(s) FAILED\n`);
  process.exit(2);
}
process.stdout.write(
  '\n✓ preflight + useLearned battery passed (two-lifetime cache, grant never cached, placement parity, apply always injects, the grant-quoting loop, the honoured holdout, the deduped-eval trigger)\n',
);
