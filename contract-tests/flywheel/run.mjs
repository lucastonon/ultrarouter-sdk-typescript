#!/usr/bin/env node
// The outcome-ledger battery. It drives the real built `@ultrarouter/sdk` client
// (../../dist/index.js) through every artifact, outcome, status and import method against a
// hermetic HTTP stub gateway (stub-gateway.mjs) over a real socket, plus the retry rule proven end
// to end: a verbatim replay is a DUPLICATE (never a conflict), and the stub's idempotency really
// distinguishes the two. It boots nothing external and exits 0 on success, 2 on any failure.
// Prereq: `npm run build`.
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startFlywheelStub } from './stub-gateway.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SDK = resolve(HERE, '../../dist/index.js');

if (!existsSync(SDK)) {
  console.error(`flywheel battery: the built SDK is missing (${SDK}).`);
  console.error('Build it first: npm run build (at the repository root)');
  process.exit(1);
}

const { default: UltraRouter } = await import(SDK);

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) {
    process.stdout.write(`  ✓ ${name}\n`);
  } else {
    failures += 1;
    process.stdout.write(`  ✗ ${name}${detail ? ` — ${detail}` : ''}\n`);
  }
}

const stub = await startFlywheelStub();
const ur = new UltraRouter({ apiKey: 'ur_sk_test_ct', baseURL: stub.url });

try {
  // 1) artifactTypes.upsert --------------------------------------
  const at = await ur.ur.artifactTypes.upsert({
    name: 'thesis',
    archetype: 'forecast',
    objective: {
      metric: 'claim_resolution',
      unit: 'boolean',
      direction: 'true_is_good',
      resolution_criteria: 'filing vs claim',
      source: 'analyst',
      window: 'P12M',
    },
  });
  check(
    'artifactTypes.upsert returns the persisted objective version',
    at.object === 'artifact_type' && at.version === 1,
  );

  // 2) artifacts.create / get / list --------------------------------------
  const art = await ur.ur.artifacts.create({
    key: 'thesis:ct',
    archetype: 'forecast',
    artifact_type: 'thesis',
  });
  check('artifacts.create upserts by key', art.id === 'art_ct' && art.object === 'artifact');
  const got = await ur.ur.artifacts.get('art_ct');
  check('artifacts.get reads one artifact', got.id === 'art_ct');
  const page = await ur.ur.artifacts.list({ archetype: 'forecast' });
  check(
    'artifacts.list returns a keyset page',
    page.object === 'list' && page.next_cursor === null,
  );

  // 3) artifacts.final — no-consent path via the pure diffStats -----------
  const { diffStats } = await import(SDK);
  const stats = diffStats('draft body', 'final body');
  const fin = await ur.ur.artifacts.final('art_ct', {
    diff_stats: stats,
    final_hash: stats.final_hash,
  });
  check(
    'artifacts.final (no-consent) stores metadata_only',
    fin.client_computed === true && fin.stored === 'metadata_only',
  );

  // 4) outcomes.record — the finalized event carries observed_at + source_event_id
  const receipt = await ur.ur.outcomes.record('art_ct', {
    channel: 'behavioral',
    kind: 'accepted',
  });
  check(
    'outcomes.record is delivered',
    receipt.status === 'delivered' && receipt.result.status === 'accepted',
  );
  const firstOutcomeCall = stub.calls.find((c) => c.path === '/v1/artifacts/art_ct/outcomes');
  const firstEvent = firstOutcomeCall?.body?.outcomes?.[0];
  check(
    'the wire event has server-owned provenance ABSENT (SDK never sets source/producer/learning_use)',
    firstEvent !== undefined &&
      typeof firstEvent.observed_at === 'string' &&
      typeof firstEvent.source_event_id === 'string' &&
      firstEvent.source === undefined &&
      firstEvent.producer === undefined &&
      firstEvent.learning_use === undefined,
  );

  // 5) outcomes.batch + pending -------------------------------------------
  const batch = await ur.ur.outcomes.batch([
    { request_id: 'req_1', channel: 'behavioral', kind: 'accepted' },
  ]);
  check('outcomes.batch returns a verdict rollup', batch.accepted === 1);
  const pending = await ur.ur.outcomes.pending({ state: 'overdue' });
  check('outcomes.pending lists claims', pending.object === 'list');

  // 6) THE RETRY GUARANTEE (end-to-end over HTTP) ------------------------
  // A client that does NOT internally retry, so the queue-level retry is what replays.
  const urNoRetry = new UltraRouter({ apiKey: 'ur_sk_test_ct', baseURL: stub.url, maxRetries: 0 });
  stub.armFailNextOutcome(); // the next outcomes POST is RECORDED, then 503 (response lost).
  const r1 = await urNoRetry.ur.outcomes.record('art_retry', {
    channel: 'resolution',
    kind: 'resolved_true',
    artifact_version: 7,
  });
  check('a lost-response send leaves the event durably QUEUED', r1.status === 'queued');

  const flush = await urNoRetry.ur.outcomes.flush();
  check(
    'flush delivers the queued event exactly once',
    flush.delivered === 1 && flush.pending === 0,
  );
  check(
    'the retry is a DUPLICATE, never a conflict (verbatim replay)',
    flush.results[0]?.status === 'duplicate',
  );

  const retryCalls = stub.calls.filter((c) => c.path === '/v1/artifacts/art_retry/outcomes');
  const e1 = retryCalls[0]?.body?.outcomes?.[0];
  const e2 = retryCalls[1]?.body?.outcomes?.[0];
  check('the two attempts sent BYTE-IDENTICAL events', JSON.stringify(e1) === JSON.stringify(e2));
  check(
    'observed_at + source_event_id + artifact_version were replayed verbatim',
    e1 !== undefined &&
      e2 !== undefined &&
      e1.observed_at === e2.observed_at &&
      e1.source_event_id === e2.source_event_id &&
      e1.artifact_version === 7 &&
      e2.artifact_version === 7,
  );

  // 7) the CONTRAST that proves the retry rule matters: same idempotency key, DIFFERENT payload = conflict.
  await ur.ur.outcomes.record('art_conf', {
    channel: 'computable',
    kind: 'scored',
    source_event_id: 'fixed-1',
    value: { a: 1 },
  });
  const conflict = await ur.ur.outcomes.record('art_conf', {
    channel: 'computable',
    kind: 'scored',
    source_event_id: 'fixed-1',
    value: { a: 2 },
  });
  check(
    'a same-key DIFFERENT-payload event is a CONFLICT (so the duplicate above is real)',
    conflict.result?.status === 'conflict',
  );

  // 8) flywheel status + calibration -----------------------
  const status = await ur.ur.flywheel.status();
  check(
    'flywheel.status returns usage + integration health',
    status.object === 'flywheel_status' && typeof status.usage.period === 'string',
  );
  const statusCall = stub.calls.find((c) => c.path === '/v1/flywheel/status');
  check('flywheel.status GETs /v1/flywheel/status', statusCall?.method === 'GET');
  const cal = await ur.ur.flywheel.calibration();
  check(
    'flywheel.calibration surfaces the learning AVAILABILITY (unavailable/collecting — no fabricated track record)',
    cal.calibration_available === false &&
      cal.flywheel_class === 'unavailable' &&
      cal.flywheel_class_reason === 'collecting',
  );
  const statusReads = stub.calls.filter((c) => c.path === '/v1/flywheel/status').length;
  check(
    'flywheel.calibration reads the SAME status route and invents NO /v1/flywheel/calibration surface',
    statusReads === 2 && stub.calls.every((c) => c.path !== '/v1/flywheel/calibration'),
  );

  // 9) history imports — drives the EXISTING /v1/imports ----
  const imp = await ur.ur.imports.create({
    format: 'usage_summary',
    mode: 'commit',
    records: [
      {
        model: 'openai/gpt-5.2-mini',
        requests: 2,
        input_tokens: 10,
        output_tokens: 5,
        cost_micro_usd: 1000,
      },
    ],
  });
  check(
    'imports.create POSTs to /v1/imports and unwraps { import }',
    imp.object === 'import' && imp.record_count === 1,
  );
  const importPost = stub.calls.find((c) => c.path === '/v1/imports' && c.method === 'POST');
  check(
    'imports.create (commit) carries format + mode + records; a usage-only report never stores a body',
    importPost?.body?.format === 'usage_summary' &&
      importPost?.body?.mode === 'commit' &&
      Array.isArray(importPost?.body?.records) &&
      imp.report.replayable === false &&
      imp.report.bodies_stored === 0,
  );
  const preview = await ur.ur.imports.create({
    format: 'usage_summary',
    mode: 'preview',
    records: [],
  });
  check(
    'imports.create (preview) returns status=preview (nothing stored)',
    preview.status === 'preview',
  );
  const gotImport = await ur.ur.imports.get(imp.id);
  check('imports.get reads one import', gotImport.id === imp.id);
  const importPage = await ur.ur.imports.list({ limit: 25 });
  check(
    'imports.list returns a keyset page',
    importPage.object === 'list' && importPage.next_cursor === null,
  );
  const cancelled = await ur.ur.imports.cancel(imp.id);
  check('imports.cancel cancels a job', cancelled.status === 'cancelled');

  // 10) ur.manifest request option — carried verbatim ------
  const manifest = {
    scaffold_hash: 'sc_1',
    manifest_hash: 'mf_1',
    envelope_hash: 'ev_1',
    entries: [
      {
        kind: 'system_sop',
        slot: 'instruction',
        trust_class: 'authoritative',
        memory_class: 'core',
        content_hash: 'sha256:abc',
        mandatory: true,
        order: 0,
        range: { message_index: 0, start: 0, end: 5 },
      },
    ],
  };
  await ur.chat.completions.create({
    model: 'm',
    messages: [{ role: 'user', content: 'hello' }],
    ur: { manifest },
  });
  const chatCall = stub.calls.find((c) => c.path === '/v1/chat/completions');
  check(
    'ur.manifest rides the chat body VERBATIM (the gateway witnesses it; the SDK invents no semantics)',
    JSON.stringify(chatCall?.body?.ur?.manifest) === JSON.stringify(manifest),
  );
} finally {
  stub.close();
}

if (failures > 0) {
  process.stderr.write(`\nflywheel battery: ${String(failures)} check(s) FAILED\n`);
  process.exit(2);
}
process.stdout.write(
  `\n✓ outcome-ledger battery passed (all methods, the retry rule, flywheel ` +
    `status/calibration, imports, and ur.manifest carriage)\n`,
);
