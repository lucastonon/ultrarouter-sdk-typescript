// A hermetic stub gateway for the reviewer-adapter battery. It serves the five
// reviewer routes over REAL HTTP and implements the three server behaviours the contract must prove
// against a real socket rather than a mock:
//
// 1. SIGNATURE VERIFICATION — it recomputes `HMAC-SHA256("<X-UR-Reviewer-Timestamp>.<raw body>")`
// keyed by the bearer key and FAILS CLOSED with the same distinct named reasons the gateway
// uses (`missing_signature` / `stale_signature` / `invalid_signature`). So if the SDK ever signed
// the wrong bytes, or stopped signing, the contract goes red.
// 2. EVENT-ID IDEMPOTENCY — a replayed `event_id` is a `duplicate` (a visible no-op), never a second
// row and never an error.
// 3. NAMED, REPAIRABLE REFUSALS — a stale `artifact_version` is `version_mismatch:claimed=…,current=…`
// with `repairable: true`; the repair route re-drives it into the SAME receipt.
//
// It also REJECTS any event carrying `learning_use` / `source` / `producer` (the strict-schema half of
// "the adapter cannot supply provenance"). NEVER logs a body.
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

const TOLERANCE_SECONDS = 900;
const FORBIDDEN_EVENT_FIELDS = ['learning_use', 'source', 'producer', 'latency_class'];

async function readRaw(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

function equalConst(a, b) {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Verify the signed delivery exactly as the gateway does. Returns null on success, else the reason. */
function verifySignature(headers, rawBody, secret, nowMs) {
  const signature = (headers['x-ur-reviewer-signature'] ?? '').trim();
  const timestamp = (headers['x-ur-reviewer-timestamp'] ?? '').trim();
  if (signature === '' || timestamp === '') return 'missing_signature';
  const seconds = Number(timestamp);
  if (!Number.isInteger(seconds)) return 'stale_signature';
  if (Math.abs(nowMs / 1000 - seconds) > TOLERANCE_SECONDS) return 'stale_signature';
  const expected = `sha256=${createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex')}`;
  return equalConst(expected, signature) ? null : 'invalid_signature';
}

/**
 * Start the stub. `state.artifacts` maps artifact key → current version; `state.receipts` maps
 * `event_id` → the last verdict, modelling the durable receipt stream.
 */
export async function startReviewerStub(options = {}) {
  const secret = options.apiKey ?? 'ur_sk_test_reviewer_key';
  const state = {
    artifacts: new Map([['invoice:4711', 1]]),
    receipts: new Map(),
    duplicates: 0,
    deliveries: [],
    signatureFailures: [],
  };

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://stub');
      const raw = await readRaw(req);
      const headers = Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), String(v ?? '')]),
      );
      const json = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      const gwError = (status, code, message) =>
        json(status, { error: { code, message, retryable: false } });

      // Every route authenticates first (the shape).
      const authz = headers.authorization ?? '';
      if (!authz.startsWith('Bearer ur_sk_')) {
        return gwError(401, 'authentication', 'authentication required');
      }

      if (url.pathname === '/v1/flywheel/reviewer/setup') {
        return json(200, {
          object: 'reviewer_setup',
          adapter: 'reviewer.v1',
          endpoint: '/v1/flywheel/reviewer/events',
          signature: {
            header: 'x-ur-reviewer-signature',
            timestamp_header: 'x-ur-reviewer-timestamp',
            algorithm: 'HMAC-SHA256 over "<unix-seconds>.<raw body>", hex, prefixed `sha256=`',
            key: 'your ultrarouter API key — never returned by this endpoint',
            tolerance_seconds: TOLERANCE_SECONDS,
          },
          required_scope: 'outcomes:write',
          mapping: [
            {
              decision: 'approved',
              channel: 'correction',
              kind: 'accepted_unchanged',
              accepts_final: true,
              note: 'n',
            },
            {
              decision: 'approved_with_edits',
              channel: 'correction',
              kind: 'edited',
              accepts_final: true,
              note: 'n',
            },
            {
              decision: 'rejected',
              channel: 'correction',
              kind: 'rejected',
              accepts_final: false,
              note: 'n',
            },
            {
              decision: 'regenerated',
              channel: 'correction',
              kind: 'regenerated',
              accepts_final: false,
              note: 'n',
            },
          ],
          corrections_consent: false,
          test_artifact_key: 'ur:reviewer-adapter:setup-test',
          events_received: state.receipts.size,
        });
      }

      if (url.pathname === '/v1/flywheel/reviewer/events' && req.method === 'POST') {
        const reason = verifySignature(headers, raw, secret, Date.now());
        if (reason !== null) {
          state.signatureFailures.push(reason);
          return gwError(403, 'permission', `${reason}: the signed-webhook check failed`);
        }
        const body = raw === '' ? {} : JSON.parse(raw);
        state.deliveries.push({
          backfill: body.backfill ?? null,
          reviewer_system: body.reviewer_system ?? null,
          count: (body.events ?? []).length,
        });
        const data = (body.events ?? []).map((event) => {
          for (const forbidden of FORBIDDEN_EVENT_FIELDS) {
            if (Object.prototype.hasOwnProperty.call(event, forbidden)) {
              return refusal(event.event_id, `caller_set_${forbidden}`, false);
            }
          }
          const prior = state.receipts.get(event.event_id);
          if (prior !== undefined && prior.status === 'accepted') {
            state.duplicates += 1;
            return { ...prior, status: 'duplicate' };
          }
          const current = state.artifacts.get(event.artifact_key);
          if (current === undefined) {
            const r = refusal(event.event_id, 'unmatched_artifact_key', true);
            state.receipts.set(event.event_id, r);
            return r;
          }
          if (event.artifact_version !== current) {
            const r = refusal(
              event.event_id,
              `version_mismatch:claimed=${event.artifact_version}:current=${current}`.replace(
                ':current=',
                ',current=',
              ),
              true,
            );
            state.receipts.set(event.event_id, r);
            return r;
          }
          const accepted = {
            event_id: event.event_id,
            status: 'accepted',
            reason: '',
            artifact_id: 'art_stub',
            artifact_version: current,
            channel: 'correction',
            kind: event.decision === 'approved' ? 'accepted_unchanged' : 'edited',
            latency_class: 'instant',
            learning_use: ['calibrate', 'train'],
            outcome_event_id: `oev_${randomUUID().slice(0, 8)}`,
            final_version: event.final === undefined ? null : current + 1,
            repairable: false,
          };
          state.receipts.set(event.event_id, accepted);
          return accepted;
        });
        return json(200, {
          object: 'reviewer_events',
          adapter: 'reviewer.v1',
          data,
          accepted: data.filter((r) => r.status === 'accepted').length,
          duplicate: data.filter((r) => r.status === 'duplicate').length,
          rejected: data.filter((r) => r.status === 'rejected').length,
          unsupported: data.filter((r) => r.status === 'unsupported').length,
        });
      }

      if (url.pathname === '/v1/flywheel/reviewer/repair' && req.method === 'POST') {
        const body = raw === '' ? {} : JSON.parse(raw);
        const event = body.event ?? {};
        const before = state.receipts.get(event.event_id);
        if (before === undefined) return gwError(404, 'not_found', 'no receipt for that event id');
        if (before.status === 'accepted') {
          return json(200, {
            object: 'reviewer_repair',
            event_id: event.event_id,
            before: { status: before.status, reason: before.reason },
            result: null,
          });
        }
        const current = state.artifacts.get(event.artifact_key);
        const version = body.repin_to_current_version === true ? current : event.artifact_version;
        if (current === undefined || version !== current) {
          return json(200, {
            object: 'reviewer_repair',
            event_id: event.event_id,
            before: { status: before.status, reason: before.reason },
            result: before,
          });
        }
        const repaired = {
          event_id: event.event_id,
          status: 'accepted',
          reason: 'repaired',
          artifact_id: 'art_stub',
          artifact_version: current,
          channel: 'correction',
          kind: 'edited',
          latency_class: 'instant',
          learning_use: ['calibrate', 'train'],
          outcome_event_id: `oev_${randomUUID().slice(0, 8)}`,
          final_version: null,
          repairable: false,
        };
        state.receipts.set(event.event_id, repaired);
        return json(200, {
          object: 'reviewer_repair',
          event_id: event.event_id,
          before: { status: before.status, reason: before.reason },
          result: repaired,
        });
      }

      if (url.pathname === '/v1/flywheel/reviewer/health') {
        const receipts = [...state.receipts.values()];
        const dead = receipts.filter((r) => r.status !== 'accepted');
        return json(200, {
          object: 'reviewer_health',
          adapter: 'reviewer.v1',
          last_success_at: receipts.some((r) => r.status === 'accepted')
            ? new Date().toISOString()
            : null,
          last_success_event_id: receipts.find((r) => r.status === 'accepted')?.event_id ?? null,
          events: {
            accepted: receipts.filter((r) => r.status === 'accepted').length,
            duplicate: state.duplicates,
            unmatched: dead.filter((r) => r.reason.startsWith('unmatched')).length,
            delayed: 0,
            rejected: dead.filter((r) => !r.reason.startsWith('unmatched')).length,
            unsupported: 0,
          },
          dead_letters: dead.map((r) => ({
            event_id: r.event_id,
            reason: r.reason,
            created_at: new Date().toISOString(),
          })),
          dead_letter_total: dead.length,
          backfills: [],
          next_repair:
            dead.length === 0
              ? { action: 'none', detail: 'nothing to repair', event_id: null }
              : { action: 'repair_version', detail: 'repair it', event_id: dead[0].event_id },
        });
      }

      return gwError(404, 'not_found', `no stub route for ${url.pathname}`);
    })().catch((err) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'internal', message: String(err) } }));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    apiKey: secret,
    state,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function refusal(eventId, reason, repairable) {
  return {
    event_id: eventId,
    status: 'rejected',
    reason,
    artifact_id: null,
    artifact_version: null,
    channel: null,
    kind: null,
    latency_class: null,
    learning_use: null,
    outcome_event_id: null,
    final_version: null,
    repairable,
  };
}
