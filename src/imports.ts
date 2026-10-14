/**
 * The history-import vocabulary and request helpers for `ur.imports.*` and the `ur import` CLI. Every
 * shape is aliased from the generated OpenAPI schemas.
 *
 * `POST /v1/imports` is the only import route that may carry bodies (intact-trace records), which are
 * stored only under corrections consent and redacted on ingest. A usage-only import never produces a
 * prompt, an output, a quality figure or a replayable case. The capability report holds counts only
 * (accepted, duplicate, rejected, unsupported), never a body.
 */

import type { components } from './generated/types.js';

type Schemas = components['schemas'];

/** `POST /v1/imports` request — create/resume a history import (consent-gated). */
export type ImportParams = Schemas['ImportRequest'];

/** An import job as rendered by the API (metadata + capability report; NEVER a body). */
export type Import = Schemas['ImportSummary'];

/** The `{ import: … }` envelope returned by create / get / cancel. */
export type ImportEnvelope = Schemas['ImportEnvelope'];

/** The pre-analysis capability report (accepted/duplicate/rejected/unsupported; NEVER a body). */
export type ImportCapabilityReport = Schemas['ImportCapabilityReport'];

/** `GET /v1/imports` response — a keyset page of imports (metadata only). */
export type ImportListResponse = Schemas['ImportListResponse'];

/** `GET /v1/imports` keyset query filters (never OFFSET). */
export interface ImportListQuery {
  /** Page size (1–200, default 50). */
  limit?: number;
  /** Opaque keyset cursor from the prior page. */
  cursor?: string;
}

/** Build the `/v1/imports` query string (empty when no filters). */
export function importListQueryString(query: ImportListQuery = {}): string {
  const qs = new URLSearchParams();
  if (query.limit !== undefined) qs.set('limit', String(query.limit));
  if (query.cursor !== undefined) qs.set('cursor', query.cursor);
  const s = qs.toString();
  return s === '' ? '' : `?${s}`;
}
