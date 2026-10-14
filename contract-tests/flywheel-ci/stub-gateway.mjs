// The hermetic stub gateway for the flywheel-ci battery. It serves the three routes the candidate
// flow needs, and nothing else:
//
// POST /v1/flywheel/candidates/:ref/rollout → the server's rollout decision (decided by the
// gateway; the CLI reads it and never re-derives it, so this stub returns a canned decision per
// scenario);
// POST /v1/flywheel/candidates/:ref/decisions → the authenticated, replay-safe human decision
// callback. The stub INDEPENDENTLY RECOMPUTES the HMAC over the bytes it RECEIVED, so a
// client that signed the wrong thing goes red rather than silently passing;
// GET /v1/bench/runs/:id/gate → the existing compare gate (reused).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

import { gateFixture } from '../app-ci/stub-gateway.mjs';
import { canonicalJson, sha256 } from './lib.mjs';

export { gateFixture };

/** A rollout decision with NO blockers — the unlocked (but never pressed) state. */
export function unlockedGate(candidateRef, evidenceHash = '') {
  return {
    unlocked: true,
    pressed: false,
    blockers: [],
    evidence_hash: evidenceHash,
    candidate_ref: candidateRef,
  };
}

/** The family each named blocker belongs to (mirrors the gateway core `ROLLOUT_REFUSAL_FAMILY`). */
const FAMILY = {
  stale_head: 'frozen_baseline',
  app_config_changed: 'frozen_baseline',
  epoch_changed: 'frozen_baseline',
  baseline_not_frozen: 'frozen_baseline',
  consent_revoked: 'consent',
  budget_exceeded: 'budget',
  rollout_not_permitted: 'permissions',
  repository_write_not_granted: 'permissions',
  candidate_not_qualified: 'qualification',
  application_check_not_passed: 'qualification',
};

/** A rollout decision BLOCKED by the named reasons (each with its own family + message). */
export function blockedGate(candidateRef, reasons, evidenceHash = '') {
  return {
    unlocked: false,
    pressed: false,
    blockers: reasons.map((reason) => ({
      reason,
      family: FAMILY[reason] ?? 'unknown',
      message: `blocked: ${reason}`,
    })),
    evidence_hash: evidenceHash,
    candidate_ref: candidateRef,
  };
}

/** Constant-time signature comparison (length-checked first). */
function equal(a, b) {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Start the stub gateway.
 *
 * @param {object} opts
 * @param {(ref: string, request: object) => object|null} [opts.rollout] the decision to return
 * (`null` ⇒ a 500, so the CLI's fail-closed path is exercised).
 * @param {string} [opts.apiKey] the key the decision callback must be signed with.
 * @param {Record<string, object>} [opts.gates] bench compare gates by run id.
 */
export function startStubGateway(opts = {}) {
  const state = { rolloutRequests: [], decisions: [], seenCallbacks: new Set(), rejected: [] };
  const apiKey = opts.apiKey ?? 'ur_sk_test_x';

  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const url = req.url ?? '';
      const method = req.method ?? 'GET';
      const send = (obj, status = 200) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      let m;

      if (method === 'POST' && (m = url.match(/\/v1\/flywheel\/candidates\/([^/]+)\/rollout/))) {
        const ref = decodeURIComponent(m[1]);
        const request = raw === '' ? {} : JSON.parse(raw);
        state.rolloutRequests.push(request);
        const decision = opts.rollout ? opts.rollout(ref, request) : unlockedGate(ref);
        if (decision === null) return send({ error: { code: 'internal' } }, 500);
        // A real server addresses the evidence object with `applicationIdentityHash` — the SAME
        // canonical-JSON + sha256 recipe the CLI used. Recomputing it here (rather than echoing a
        // field) is what makes "dashboard and PR link to the same object" a checked property.
        const identity = request?.observed_identity;
        if ((decision.evidence_hash ?? '') === '' && identity !== undefined) {
          return send({ ...decision, evidence_hash: sha256(canonicalJson(identity)) });
        }
        return send(decision);
      }

      if (method === 'POST' && (m = url.match(/\/v1\/flywheel\/candidates\/([^/]+)\/decisions/))) {
        // 1. AUTHENTICATE first — recompute the MAC over the bytes actually received.
        const signature = req.headers['x-ur-appci-signature'];
        const timestamp = req.headers['x-ur-appci-timestamp'];
        if (typeof signature !== 'string' || typeof timestamp !== 'string') {
          state.rejected.push('missing_signature');
          return send({ status: 'refused', reason: 'missing_signature' }, 403);
        }
        const expected = `sha256=${createHmac('sha256', apiKey).update(`${timestamp}.${raw}`, 'utf8').digest('hex')}`;
        if (!equal(expected, signature)) {
          state.rejected.push('invalid_signature');
          return send({ status: 'refused', reason: 'invalid_signature' }, 403);
        }
        // 2. Only then the replay check — a known callback id is a VISIBLE no-op, never a 2nd row.
        const body = raw === '' ? {} : JSON.parse(raw);
        const id = typeof body.callback_id === 'string' ? body.callback_id : '';
        if (id === '') return send({ status: 'refused', reason: 'missing_callback_id' }, 400);
        if (state.seenCallbacks.has(id)) return send({ status: 'duplicate', callback_id: id });
        state.seenCallbacks.add(id);
        state.decisions.push(body);
        return send({ status: 'accepted', callback_id: id }, 201);
      }

      if (method === 'GET' && (m = url.match(/\/v1\/bench\/runs\/([^/?]+)\/gate/))) {
        const gate = (opts.gates ?? {})[decodeURIComponent(m[1])];
        if (!gate) return send({ error: { code: 'not_found', type: 'not_found' } }, 404);
        return send(gate);
      }

      send({ error: { code: 'not_found', type: 'not_found', message: url } }, 404);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}`, state, close: () => server.close() });
    });
  });
}
