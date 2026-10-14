#!/usr/bin/env node
// The reviewer-adapter battery. It drives the real built `@ultrarouter/sdk` (../../dist/index.js)
// through the whole `ur.reviewer.*` surface against a hermetic HTTP stub gateway
// (stub-gateway.mjs) over a real socket. It boots nothing external and exits 0 on success, 2 on any
// failure. Prereq: `npm run build`.
//
// What it proves that the unit suite cannot:
// - The SIGNATURE the built client puts on the wire verifies against an INDEPENDENT server-side
// recomputation over the exact received bytes (and a client signing with the wrong key is 403).
// - A replayed `event_id` is a `duplicate` across a real request/response cycle.
// - A `version_mismatch` dead-letters locally AND is repaired by the repair route, end to end.
// - The wire event never carries `learning_use` / `source` / `producer` (the stub refuses it, so a
// regression that started sending one turns the battery red instead of silently succeeding).
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startReviewerStub } from './stub-gateway.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SDK = resolve(HERE, '../../dist/index.js');

if (!existsSync(SDK)) {
  console.error(`reviewer battery: the built SDK is missing (${SDK}).`);
  console.error('Build it first: npm run build (at the repository root)');
  process.exit(1);
}

const { default: UltraRouter, MemoryOutcomeStore } = await import(SDK);

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) {
    process.stdout.write(`  ✓ ${name}\n`);
  } else {
    failures += 1;
    process.stdout.write(`  ✗ ${name}${detail ? ` — ${detail}` : ''}\n`);
  }
}

const stub = await startReviewerStub();
const ur = new UltraRouter({
  apiKey: stub.apiKey,
  baseURL: stub.url,
  reviewerStore: new MemoryOutcomeStore(),
});

const reviewEvent = (over = {}) => ({
  event_id: 'rev_contract_1',
  artifact_key: 'invoice:4711',
  artifact_version: 1,
  decision: 'approved_with_edits',
  effective_at: '2026-09-14T10:00:00Z',
  ...over,
});

try {
  // 1) guided setup ---------------------------------------------------------
  const setup = await ur.ur.reviewer.setup();
  check(
    'setup() returns the pinned adapter + the mapping preview',
    setup.adapter === 'reviewer.v1' && setup.mapping.length === 4,
  );
  check('setup() never echoes the API key', !JSON.stringify(setup).includes(stub.apiKey));

  // 2) a signed delivery the SERVER verifies independently -------------------
  const sent = await ur.ur.reviewer.send([reviewEvent()], { reviewerSystem: 'acme-review' });
  check(
    'a signed delivery is accepted over a real socket',
    sent.accepted === 1,
    JSON.stringify(sent.data?.[0] ?? {}),
  );
  check('the server saw no signature failure', stub.state.signatureFailures.length === 0);
  check('the server-assigned learning_use came back', Array.isArray(sent.data[0].learning_use));

  // 3) replay ⇒ duplicate ----------------------------------------------------
  const replay = await ur.ur.reviewer.send([reviewEvent()], { reviewerSystem: 'acme-review' });
  check('a replayed event_id is a duplicate', replay.duplicate === 1 && replay.accepted === 0);
  check('the replay was not an error', replay.data[0].status === 'duplicate');

  // 4) a client signing with the WRONG key is refused, named ------------------
  const forged = new UltraRouter({ apiKey: 'ur_sk_test_forged_key', baseURL: stub.url });
  let forgedError = null;
  try {
    await forged.ur.reviewer.send([reviewEvent({ event_id: 'rev_forged' })]);
  } catch (err) {
    forgedError = err;
  }
  check(
    'a wrong-key signature is refused 403 with a named reason',
    forgedError !== null &&
      forgedError.status === 403 &&
      String(forgedError.message).includes('invalid_signature'),
    forgedError === null
      ? 'no error thrown'
      : `${String(forgedError.status)} ${String(forgedError.message)}`,
  );
  check(
    'the server recorded the named failure',
    stub.state.signatureFailures.includes('invalid_signature'),
  );

  // 5) an UNSIGNED delivery is refused ---------------------------------------
  const unsignedRes = await fetch(`${stub.url}/v1/flywheel/reviewer/events`, {
    method: 'POST',
    headers: { authorization: `Bearer ${stub.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ events: [reviewEvent({ event_id: 'rev_unsigned' })] }),
  });
  const unsignedBody = await unsignedRes.json();
  check(
    'an UNSIGNED delivery fails closed with `missing_signature`',
    unsignedRes.status === 403 && String(unsignedBody.error.message).includes('missing_signature'),
  );

  // 6) the durable queue: record → flush → accepted ---------------------------
  await ur.ur.reviewer.record(reviewEvent({ event_id: 'rev_queued' }), {
    reviewerSystem: 'acme-review',
  });
  const flushed = await ur.ur.reviewer.flush();
  check(
    'record() + flush() delivers the queued event',
    flushed.accepted === 1 && flushed.pending === 0,
  );

  // 7) a version mismatch dead-letters locally, then repairs ------------------
  await ur.ur.reviewer.record(reviewEvent({ event_id: 'rev_stale', artifact_version: 99 }), {
    reviewerSystem: 'acme-review',
  });
  const stale = await ur.ur.reviewer.flush();
  check(
    'a stale pin is dead-lettered, not dropped',
    stale.deadLettered === 1 && stale.dropped === 0,
  );
  const dead = await ur.ur.reviewer.deadLetters();
  check(
    'the dead letter names both versions',
    dead.length === 1 && dead[0].dead_letter.reason === 'version_mismatch:claimed=99,current=1',
    dead[0]?.dead_letter?.reason,
  );

  const repaired = await ur.ur.reviewer.repair(dead[0], { repinToCurrentVersion: true });
  check('repair() re-drives the stored event to accepted', repaired.result?.status === 'accepted');
  check(
    'the local dead letter is cleared on success',
    (await ur.ur.reviewer.deadLetters()).length === 0,
  );

  // 8) the wire event carries no provenance ----------------------------------
  const illegal = await ur.ur.reviewer.send([
    { ...reviewEvent({ event_id: 'rev_illegal' }), learning_use: ['train'] },
  ]);
  check(
    'a caller-set `learning_use` is refused by the server (never silently stripped)',
    illegal.data[0].status === 'rejected' && illegal.data[0].reason === 'caller_set_learning_use',
    illegal.data[0].reason,
  );

  // 9) health ----------------------------------------------------------------
  const health = await ur.ur.reviewer.health();
  check('health() reports duplicates absorbed', health.events.duplicate >= 1);
  check('health() reports the next repair action', typeof health.next_repair.action === 'string');

  // 10) backfill grouping -----------------------------------------------------
  await ur.ur.reviewer.record(reviewEvent({ event_id: 'bf_a' }), {
    backfill: { id: 'bf_run', total: 2 },
  });
  await ur.ur.reviewer.record(reviewEvent({ event_id: 'bf_b' }), {
    backfill: { id: 'bf_run', total: 2, complete: true },
  });
  const beforeDeliveries = stub.state.deliveries.length;
  await ur.ur.reviewer.flush();
  const backfillDeliveries = stub.state.deliveries.slice(beforeDeliveries);
  check(
    'a declared backfill rides its own delivery with the declaration intact',
    backfillDeliveries.length === 1 && backfillDeliveries[0].backfill?.id === 'bf_run',
    JSON.stringify(backfillDeliveries),
  );
} finally {
  await stub.close();
}

if (failures > 0) {
  process.stdout.write(`\n✗ reviewer battery: ${String(failures)} failure(s)\n`);
  process.exit(2);
}
process.stdout.write('\n✓ reviewer-adapter battery passed (signed, replay-safe, repairable)\n');
