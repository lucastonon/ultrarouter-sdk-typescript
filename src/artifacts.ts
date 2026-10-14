/**
 * The artifact vocabulary and request helpers for `ur.artifactTypes.*` and `ur.artifacts.*`. Every
 * shape is aliased from the generated OpenAPI schemas (`ArtifactSummary`, `CreateArtifactRequest`,
 * `UpsertArtifactTypeRequest`, `ArtifactType`, `FinalRequest`, `FinalResponse`, …).
 */

import type { components } from './generated/types.js';
import type { UrRequestOptions } from './types.js';

type Schemas = components['schemas'];

/** The closed artifact-archetype vocabulary. */
export type ArtifactArchetype = Schemas['ArtifactSummary']['archetype'];

/** An artifact as rendered by the API (metadata only — NEVER a body). */
export type Artifact = Schemas['ArtifactSummary'];

/** A claim on an artifact + its cached reducer state (metadata only). */
export type ArtifactClaim = Schemas['ArtifactClaim'];

/** The `{ artifact: … }` envelope returned by create/upsert + get. */
export type ArtifactEnvelope = Schemas['ArtifactEnvelope'];

/** `GET /v1/artifacts` response — a keyset page of artifacts. */
export type ArtifactListResponse = Schemas['ArtifactListResponse'];

/** `POST /v1/artifacts` request — create/upsert an artifact by `key`. */
export type CreateArtifactParams = Schemas['CreateArtifactRequest'];

/** A customer-declared claim on an artifact create. */
export type ClaimInput = NonNullable<CreateArtifactParams['claims']>[number];

/** `POST /v1/artifacts/:id/final` request — the human-approved output (channel 2). */
export type FinalParams = Schemas['FinalRequest'];

/** `POST /v1/artifacts/:id/final` response — the appended final artifact version. */
export type FinalResponse = Schemas['FinalResponse'];

/** `GET /v1/artifacts` keyset query filters (never OFFSET). */
export interface ArtifactListQuery {
  /** Page size (1–200, default 50). */
  limit?: number;
  /** Opaque keyset cursor from the prior page. */
  cursor?: string;
  /** Filter to one archetype. */
  archetype?: ArtifactArchetype;
  /** Filter to one artifact key. */
  key?: string;
}

/** Build the `/v1/artifacts` query string (empty when no filters). */
export function artifactListQueryString(query: ArtifactListQuery = {}): string {
  const qs = new URLSearchParams();
  if (query.limit !== undefined) qs.set('limit', String(query.limit));
  if (query.cursor !== undefined) qs.set('cursor', query.cursor);
  if (query.archetype !== undefined) qs.set('archetype', query.archetype);
  if (query.key !== undefined) qs.set('key', query.key);
  const s = qs.toString();
  return s === '' ? '' : `?${s}`;
}

// ─────────────────────────────── artifact types / objectives ───────────────────────────────

/**
 * An artifact-type objective. The objective is the one thing the product never
 * infers: you declare once what "it worked" means and it is pinned onto every
 * artifact of that type. Append-only: an upsert that CHANGES it appends a new version; an
 * unchanged upsert is an idempotent no-op returning the existing one.
 */
export type ArtifactObjective = Schemas['ArtifactObjective'];

/** The closed objective-metric vocabulary. */
export type ArtifactObjectiveMetric = ArtifactObjective['metric'];

/** The closed resolution-predicate vocabulary. */
export type ArtifactObjectivePredicate = NonNullable<ArtifactObjective['predicate_id']>;

/** `ur.artifactTypes.upsert(params)` — register/append an objective version. */
export type ArtifactTypeUpsertParams = Schemas['UpsertArtifactTypeRequest'];

/** A persisted artifact-type objective version as rendered by the API. */
export type ArtifactType = Schemas['ArtifactType'];

/** The `{ artifact_type: … }` envelope returned by `upsert`. */
export type ArtifactTypeEnvelope = Schemas['ArtifactTypeEnvelope'];

// ─────────────────────────────── binding helper (withArtifact) ───────────────────────────────

/**
 * Bind a chat/embeddings request to an artifact key via the `ur.artifact` request option
 * (the DECLARED pre-dispatch assembly key; `X-UR-Artifact` equivalent). Returns
 * a COPY with `ur.artifact` set; an explicit per-call `ur.artifact` already on the params
 * WINS (the caller can override the scope binding). Used by `withArtifact`.
 */
export function bindArtifactKey<T extends { ur?: UrRequestOptions }>(params: T, key: string): T {
  const ur: UrRequestOptions = { ...(params.ur ?? {}) };
  if (ur.artifact === undefined) ur.artifact = key;
  return { ...params, ur };
}
