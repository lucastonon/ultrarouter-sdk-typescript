/**
 * The `preflight()` surface: a caller that calls its models directly asks, before a call, which
 * model and fallbacks to use and which learned knowledge to inject (and where); with a cluster key it
 * also receives its exposure grant in the same response. Every shape is aliased from the generated
 * OpenAPI schema (`PreflightRequest` / `PreflightResponse`); the request's `messages` are the same
 * {@link ChatMessage} objects `chat.completions.create` takes.
 *
 * The client honours two cache lifetimes exactly as the gateway declares them:
 * - the config-versioned part (routing model and learned module) carries a strong `ETag` and
 *   `Cache-Control: private, max-age=5`, and is revalidated with `If-None-Match` (a 304);
 * - the health-ordered fallbacks are the live part (`routing.max_age_s` / `X-UR-Live-Max-Age`,
 *   30 seconds by default);
 * - the grant is never cached: it rides the uncached `X-UR-Grant` header (present on both a 200 and
 *   a 304), so a client reusing its cached body still gets a fresh grant. The cache strips the grant
 *   from the stored body and reads it from the header on every response.
 */

import { sha256Hex } from './diff-stats.js';
import type { components } from './generated/types.js';
import type { ChatMessage, RequestOptions } from './types.js';

type Schemas = components['schemas'];

/**
 * `preflight(params)` request: a call type, an optional cluster key (`artifact_key` or `trace_id`),
 * optional budget hints, and the optional `messages` a per-request case module is rendered for.
 * `messages` takes the same {@link ChatMessage} objects as `chat.completions.create` (a content part
 * may carry provider-specific fields such as `image_url`, which the gateway accepts as sent).
 */
export type PreflightParams = Omit<Schemas['PreflightRequest'], 'messages'> & {
  messages?: ChatMessage[];
};

/** The preflight response — routing + learned knowledge + placement + the grant. */
export type PreflightResponse = Schemas['PreflightResponse'];

/** The exposure grant embedded in a preflight response (present when a cluster key is given). */
export type PreflightGrant = NonNullable<PreflightResponse['grant']>;

/** The ACTIVE hosted prompt version a preflight returns (`{ version, template, variables, sha256 }`). */
export type PreflightPrompt = NonNullable<PreflightResponse['prompt']>;

/** The learned knowledge preflight would inject, and where (`after_stable_prefix`). */
export type PreflightKnowledge = NonNullable<PreflightResponse['knowledge']>;

/** The routing block (mode + recommended model + health-ordered fallbacks + why). */
export type PreflightRouting = PreflightResponse['routing'];

/** The lowercased response header the grant is served on — uncached, present on 200 AND 304. */
export const PREFLIGHT_GRANT_HEADER = 'x-ur-grant';

/** The lowercased response header carrying the 30 s LIVE-part max age (`routing.max_age_s`). */
export const PREFLIGHT_LIVE_MAX_AGE_HEADER = 'x-ur-live-max-age';

/** The config-part max age (seconds) the gateway declares — `Cache-Control: private, max-age=5`. */
export const PREFLIGHT_DEFAULT_CONFIG_MAX_AGE_S = 5;

/** The live-part (health-ordered fallbacks) max age (seconds) — `routing.max_age_s`. */
export const PREFLIGHT_DEFAULT_LIVE_MAX_AGE_S = 30;

/** Per-call preflight options. Extends {@link RequestOptions} with the cache knobs. */
export interface PreflightRequestOptions extends RequestOptions {
  /**
   * Override the client-side LIVE-part freshness window (seconds). Within it a repeat call
   * revalidates (`If-None-Match` ⇒ 304, reusing the cached body); past it a full unconditional
   * refetch re-pulls the health-ordered fallbacks. Defaults to the response's `X-UR-Live-Max-Age`.
   */
  maxAgeS?: number;
  /** Bypass the client cache entirely — always an unconditional fetch; never serve/revalidate/store. */
  noCache?: boolean;
  /**
   * Injectable clock (ms). Advanced/testing seam so cache freshness can be exercised deterministically;
   * defaults to `Date.now`.
   */
  now?: () => number;
}

/** A cached preflight decision. `body` has its grant STRIPPED to null — the grant is NEVER cached. */
export interface PreflightCacheEntry {
  /** The strong `ETag` of the config-versioned part. */
  readonly etag: string;
  /** The cached response body with `grant` nulled (the grant is never part of the cache). */
  readonly body: PreflightResponse;
  /** When this entry was stored/last revalidated (ms). */
  readonly storedAtMs: number;
  /** The config-versioned part max age (seconds) — from `Cache-Control: max-age`. */
  readonly configMaxAgeS: number;
  /** The LIVE (fallbacks) part max age (seconds) — from `X-UR-Live-Max-Age` / `routing.max_age_s`. */
  readonly liveMaxAgeS: number;
}

/** The cache decision for a preflight call. Pure — {@link decidePreflightCache} derives it. */
export type PreflightCacheDecision =
  /** Serve fully from the cache with NO network (config part fresh; no grant to fetch). */
  | { readonly kind: 'fresh' }
  /** Send a conditional request (`If-None-Match`); a 304 reuses the body + a FRESH header grant. */
  | { readonly kind: 'revalidate'; readonly ifNoneMatch: string }
  /** Send an unconditional request (no cache, or the live part expired — refetch the fallbacks). */
  | { readonly kind: 'fetch' };

/**
 * Decide how to serve a preflight call from the two-lifetime cache (PURE — every input explicit):
 * - no entry ⇒ `fetch`;
 * - the LIVE part expired (`age ≥ liveMaxAge`) ⇒ `fetch` (a full refetch re-pulls the fallbacks; a
 * 304 must never resurrect a stale live part);
 * - LIVE still fresh + NO cluster key + the CONFIG part still fresh (`age < configMaxAge`) ⇒ `fresh`
 * (the grant would be null anyway, and the config part is guaranteed current — no network);
 * - otherwise ⇒ `revalidate` (a cluster key MUST hit the network for a fresh grant, and past the
 * config window the config part is revalidated by ETag).
 */
export function decidePreflightCache(
  entry: PreflightCacheEntry | undefined,
  nowMs: number,
  hasClusterKey: boolean,
  liveMaxAgeOverrideS?: number,
): PreflightCacheDecision {
  if (entry === undefined) return { kind: 'fetch' };
  const ageMs = nowMs - entry.storedAtMs;
  const liveMaxAgeMs = (liveMaxAgeOverrideS ?? entry.liveMaxAgeS) * 1000;
  if (ageMs >= liveMaxAgeMs) return { kind: 'fetch' };
  if (!hasClusterKey && ageMs < entry.configMaxAgeS * 1000) return { kind: 'fresh' };
  return { kind: 'revalidate', ifNoneMatch: entry.etag };
}

/** Does a preflight request carry a cluster key (so a grant is minted)? */
export function preflightHasClusterKey(params: PreflightParams): boolean {
  return params.artifact_key !== undefined || params.trace_id !== undefined;
}

/** A stable cache key for a preflight request: call type, cluster key, budget and a digest of `messages`. */
export function preflightCacheKey(params: PreflightParams): string {
  return JSON.stringify({
    call_type: params.call_type,
    artifact_key: params.artifact_key ?? null,
    trace_id: params.trace_id ?? null,
    budget: params.budget ?? null,
    // A per-request case module renders different knowledge for different messages, so the
    // messages are part of the cache identity (as a digest; the text itself is never stored).
    messages: params.messages === undefined ? null : sha256Hex(JSON.stringify(params.messages)),
  });
}

/**
 * Parse the uncached `X-UR-Grant` header into a {@link PreflightGrant}, or null when absent/blank/
 * unparseable (fail-closed — a garbled header is treated as "no grant", never a throw).
 */
export function parseGrantHeader(value: string | null): PreflightGrant | null {
  if (value === null || value === '') return null;
  try {
    return JSON.parse(value) as PreflightGrant;
  } catch {
    return null;
  }
}

/** Parse the `max-age` seconds out of a `Cache-Control` header value, or null when absent. */
export function parseMaxAgeSeconds(cacheControl: string | null): number | null {
  if (cacheControl === null) return null;
  const match = /(?:^|,)\s*max-age\s*=\s*(\d+)/i.exec(cacheControl);
  return match ? Number(match[1]) : null;
}

/** The default bound on preflight cache entries (see {@link PreflightCacheOptions.maxEntries}). */
export const DEFAULT_PREFLIGHT_CACHE_MAX_ENTRIES = 1000;

/** How many `set`s pass between sweeps of expired entries while the cache is below its bound. */
const SWEEP_EVERY = 64;

/** Options for the client-side preflight cache (`new UltraRouter({ preflightCache })`). */
export interface PreflightCacheOptions {
  /**
   * The most request identities kept (default {@link DEFAULT_PREFLIGHT_CACHE_MAX_ENTRIES}). Past it
   * the least recently used entry is evicted. `0` disables the cache (every call goes to the network).
   */
  maxEntries?: number | undefined;
}

/**
 * The client-side preflight cache: one entry per request identity, honouring the two lifetimes with
 * the grant NEVER stored (it is re-read from `X-UR-Grant` on every response). BOUNDED: at most
 * `maxEntries` identities, least recently used evicted first, and entries past their live window
 * (when a fresh fetch is needed anyway) are swept out — so a long-lived client that sees unique
 * trace / artifact / message identities does not grow without limit. A per-call `maxAgeS` larger
 * than an entry's own live window cannot revive an entry that was already swept (it is fetched
 * again).
 */
export class PreflightCache {
  private readonly entries = new Map<string, PreflightCacheEntry>();
  private readonly maxEntries: number;
  private setsSinceSweep = 0;

  /** Create a cache bounded by `maxEntries`. */
  constructor(options: PreflightCacheOptions = {}) {
    const max = options.maxEntries ?? DEFAULT_PREFLIGHT_CACHE_MAX_ENTRIES;
    if (!Number.isInteger(max) || max < 0) {
      throw new RangeError(
        `preflightCache.maxEntries must be a non-negative integer (got ${String(max)})`,
      );
    }
    this.maxEntries = max;
  }

  /** The number of cached identities. */
  get size(): number {
    return this.entries.size;
  }

  /** The entry for a cache key, if any (marks it most recently used). */
  get(key: string): PreflightCacheEntry | undefined {
    const entry = this.entries.get(key);
    if (entry !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, entry);
    }
    return entry;
  }

  /** Store an entry under a cache key, evicting expired and then least recently used entries. */
  set(key: string, entry: PreflightCacheEntry): void {
    if (this.maxEntries === 0) return;
    this.entries.delete(key);
    this.setsSinceSweep += 1;
    if (this.entries.size >= this.maxEntries || this.setsSinceSweep >= SWEEP_EVERY) {
      this.sweepExpired(entry.storedAtMs);
    }
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }
    this.entries.set(key, entry);
  }

  /** Drop every entry. */
  clear(): void {
    this.entries.clear();
  }

  /** Remove every entry whose live window has passed at `nowMs` (it would be fetched anew). */
  private sweepExpired(nowMs: number): void {
    this.setsSinceSweep = 0;
    for (const [key, entry] of this.entries) {
      if (nowMs - entry.storedAtMs >= entry.liveMaxAgeS * 1000) this.entries.delete(key);
    }
  }
}

/**
 * Compose the returned response's grant from the FRESH `X-UR-Grant` header — NEVER from the cache
 * (read fresh on every response, including a 304). When the header is absent the grant is null
 * and `grant_reason` is preserved from the body (e.g. `no_cluster_key`); when present, the grant is
 * the header's and `grant_reason` is null.
 */
export function withHeaderGrant(
  body: PreflightResponse,
  headerGrant: PreflightGrant | null,
): PreflightResponse {
  return {
    ...body,
    grant: headerGrant,
    grant_reason: headerGrant === null ? body.grant_reason : null,
  };
}
