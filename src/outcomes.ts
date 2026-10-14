/**
 * The outcome vocabulary and request helpers for `ur.outcomes.*`. The event and result types are
 * aliased from the generated OpenAPI schemas (`OutcomeInput`, `OutcomeResult`, the batch and pending
 * shapes), so they cannot drift from the contract.
 *
 * `OutcomeInput` deliberately has no `source`, `producer`, `learning_use` or `latency_class` field:
 * provenance and learning use are assigned by the gateway (a caller-supplied value is a 400), so the
 * SDK type cannot set them. It has no body-bearing field either: outcomes carry ids, hashes and
 * numbers, never text.
 */

import type { components } from './generated/types.js';

type Schemas = components['schemas'];

/** The closed outcome-channel vocabulary. */
export type OutcomeChannel = Schemas['OutcomeInput']['channel'];

/** One outcome event as SENT by the caller (server assigns provenance + learning_use). */
export type OutcomeInput = Schemas['OutcomeInput'];

/** One recorded outcome event's server-assigned result. */
export type OutcomeResult = Schemas['OutcomeResult'];

/** `POST /v1/artifacts/:id/outcomes` response — the per-event results (202 after durable insert). */
export type RecordOutcomesResponse = Schemas['RecordOutcomesResponse'];

/** One batch outcome keyed by `request_id | artifact_id | artifact_key` (optional `claim_key`). */
export type BatchOutcomeInput = Schemas['BatchOutcomeInput'];

/** `POST /v1/outcomes/batch` response — per-row results + a verdict rollup. */
export type BatchOutcomesResponse = Schemas['BatchOutcomesResponse'];

/** One batch row's result (echoes the input target key + the per-row verdict). */
export type BatchOutcomeResult = Schemas['BatchOutcomeResult'];

/** A claim awaiting resolution, as listed by `GET /v1/outcomes/pending`. */
export type PendingClaim = Schemas['PendingClaim'];

/** `GET /v1/outcomes/pending` response — keyset-paginated pending/overdue claims. */
export type PendingClaimsResponse = Schemas['PendingClaimsResponse'];

/**
 * Where a recorded outcome lands: an artifact (by id) or a request (the request
 * shortcut). `ur.outcomes.record` also accepts a bare artifact-id string, normalized to
 * `{ artifact }` (the `record(art.id, …)` signature).
 */
export type OutcomeTarget = { readonly artifact: string } | { readonly request: string };

/** Normalize the `record` target: a bare string is an artifact id. */
export function normalizeOutcomeTarget(target: string | OutcomeTarget): OutcomeTarget {
  return typeof target === 'string' ? { artifact: target } : target;
}

/** `GET /v1/outcomes/pending` query filters (keyset — never OFFSET). */
export interface PendingOutcomesQuery {
  /** Page size (1–200, default 50). */
  limit?: number;
  /** Opaque keyset cursor from the prior page. */
  cursor?: string;
  /** Only claims created at/after this ISO-8601 instant. */
  since?: string;
  /** Filter to one archetype. */
  archetype?: string;
  /** Filter to `pending` or `overdue` (default: both). */
  state?: 'pending' | 'overdue';
}

/** Build the `/v1/outcomes/pending` query string (empty string when no filters). */
export function pendingQueryString(query: PendingOutcomesQuery = {}): string {
  const qs = new URLSearchParams();
  if (query.limit !== undefined) qs.set('limit', String(query.limit));
  if (query.cursor !== undefined) qs.set('cursor', query.cursor);
  if (query.since !== undefined) qs.set('since', query.since);
  if (query.archetype !== undefined) qs.set('archetype', query.archetype);
  if (query.state !== undefined) qs.set('state', query.state);
  const s = qs.toString();
  return s === '' ? '' : `?${s}`;
}
