// — the `preflight()` client + the `useLearned()` wrapper.
//
// Proven against an in-process stub gateway (a recording `fetch` that returns real headers): the
// two-lifetime cache (config-versioned ETag part + 30 s live fallbacks), the GRANT that is NEVER
// cached (a cached 304 still yields the FRESH `X-UR-Grant`), the `useLearned` learned-slot placement
// PARITY against the cross-repo golden generated from the gateway core `learnedPlacementIndex`, and
// the outcome call QUOTING the grant exactly as posts it.
//
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { UltraRouter } from '../src/client.js';
import { UltraRouterError } from '../src/errors.js';
import {
  applyLearnedContext,
  learnedPlacementIndex,
  LEARNED_MESSAGE_ROLE,
} from '../src/learned-placement.js';
import {
  decidePreflightCache,
  parseGrantHeader,
  parseMaxAgeSeconds,
  preflightCacheKey,
  preflightHasClusterKey,
  type PreflightCacheEntry,
  type PreflightParams,
  type PreflightResponse,
} from '../src/preflight.js';
import type { ChatMessage, FetchLike } from '../src/types.js';

// ─────────────────────────────── the golden (parent's own output) ───────────────────────────────

interface PlacementGoldenCase {
  readonly roles: string[];
  readonly index: number;
}

/** The cross-repo placement golden — generated from the compiled gateway `learnedPlacementIndex`. */
const PLACEMENT_GOLDEN = JSON.parse(
  readFileSync(new URL('./learned/placement-golden.json', import.meta.url), 'utf8'),
) as PlacementGoldenCase[];

// ─────────────────────────────── fixtures + a header-aware recorder ───────────────────────────────

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | undefined;
}

interface Scripted {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

/** A `fetch` that records every call and returns a scripted status + headers + JSON body (or a 304). */
function recorder(script: (call: Captured, n: number) => Scripted): {
  fetch: FetchLike;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  const fetch: FetchLike = (url, init) => {
    const headers: Record<string, string> = {};
    const raw = init?.headers as Record<string, string> | undefined;
    if (raw) for (const [k, v] of Object.entries(raw)) headers[k.toLowerCase()] = v;
    const call: Captured = {
      url: String(url),
      method: init?.method ?? 'GET',
      headers,
      body:
        init?.body === undefined
          ? undefined
          : (JSON.parse(String(init.body)) as Record<string, unknown>),
    };
    calls.push(call);
    const r = script(call, calls.length);
    const respHeaders = r.headers ?? {};
    if (r.status === 304) {
      return Promise.resolve(new Response(null, { status: 304, headers: respHeaders }));
    }
    return Promise.resolve(
      new Response(JSON.stringify(r.body ?? {}), {
        status: r.status,
        headers: { 'content-type': 'application/json', ...respHeaders },
      }),
    );
  };
  return { fetch, calls };
}

function grantFixture(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    grant_id: `grant_${'a'.repeat(32)}`,
    arm: 'treated',
    lever_id: null,
    epoch: 3,
    valid_until_epoch_close: '2026-10-01T00:00:00Z',
    request_id: 'req_pf_served_1',
    ...over,
  };
}

function preflightFixture(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    object: 'preflight',
    config_version: 7,
    routing: {
      mode: 'candidates',
      model: { id: 'openai/gpt-5.2-mini', evidence: 'none', score: null },
      fallbacks: [{ id: 'openai/gpt-5.2', score: null }],
      why: null,
      max_age_s: 30,
    },
    knowledge: {
      module: {
        id: 'lcm_abc',
        version: 'lcm1_deadbeef',
        kind: 'ur:learned',
        slot: 'learned',
        state: 'screened',
        content_hash: 'sha_content',
        tokens: 18,
        content: 'LEARNED-DATA-BLOCK',
        lineage: {
          pack_hash: 'lcp1_pack',
          epoch: 3,
          item_ids: ['fact_1'],
          ranker_version: 'lcr1_ranker',
          k: 3,
          key_spec: 'sit1',
          source_snapshot: '2026-09-01T00:00:00Z',
        },
      },
      placement: 'after_stable_prefix',
      // The gateway does NOT inject (`off`), so a non-proxied `useLearned().apply()` must.
      delivery: 'off',
    },
    knowledge_reason: null,
    grant: grantFixture(),
    grant_reason: null,
    provisional: true,
    reason: 'not_benchmarkable',
    ...over,
  };
}

/** The 200 headers the gateway sets: strong ETag + config max-age 5 + live max-age 30 + the grant. */
function ok200Headers(etag: string, grant: Record<string, unknown> | null): Record<string, string> {
  return {
    etag,
    'cache-control': 'private, max-age=5',
    'x-ur-live-max-age': '30',
    ...(grant !== null ? { 'x-ur-grant': JSON.stringify(grant) } : {}),
  };
}

const client = (fetch: FetchLike): UltraRouter =>
  new UltraRouter({ apiKey: 'ur_sk_test_pf', baseURL: 'http://pf.test', fetch });

// ─────────────────────────────── pure cache helpers ───────────────────────────────

describe('pure cache helpers', () => {
  it('parseGrantHeader parses the JSON grant, and fails CLOSED on absent/garbled (never a throw)', () => {
    expect(parseGrantHeader(JSON.stringify(grantFixture()))?.grant_id).toBe(
      `grant_${'a'.repeat(32)}`,
    );
    expect(parseGrantHeader(null)).toBeNull();
    expect(parseGrantHeader('')).toBeNull();
    expect(parseGrantHeader('{not json')).toBeNull();
  });

  it('parseMaxAgeSeconds reads the config-part max-age (Cache-Control: private, max-age=5)', () => {
    expect(parseMaxAgeSeconds('private, max-age=5')).toBe(5);
    expect(parseMaxAgeSeconds('max-age=42, private')).toBe(42);
    expect(parseMaxAgeSeconds('no-store')).toBeNull();
    expect(parseMaxAgeSeconds(null)).toBeNull();
  });

  it('preflightHasClusterKey + preflightCacheKey key on call type + cluster key + budget', () => {
    expect(preflightHasClusterKey({ call_type: 'ct' })).toBe(false);
    expect(preflightHasClusterKey({ call_type: 'ct', artifact_key: 'k' })).toBe(true);
    expect(preflightHasClusterKey({ call_type: 'ct', trace_id: 't' })).toBe(true);
    expect(preflightCacheKey({ call_type: 'ct', artifact_key: 'k' })).not.toBe(
      preflightCacheKey({ call_type: 'ct', trace_id: 't' }),
    );
  });

  it('decidePreflightCache honours BOTH lifetimes (config fresh ⇒ no-network; live expiry ⇒ refetch)', () => {
    const entry: PreflightCacheEntry = {
      etag: '"e1"',
      body: {} as PreflightResponse,
      storedAtMs: 1_000,
      configMaxAgeS: 5,
      liveMaxAgeS: 30,
    };
    // no entry ⇒ fetch
    expect(decidePreflightCache(undefined, 1_000, false).kind).toBe('fetch');
    // no cluster key + within the 5 s config window ⇒ served from cache (no network)
    expect(decidePreflightCache(entry, 1_000 + 4_000, false).kind).toBe('fresh');
    // no cluster key + past 5 s but within 30 s live ⇒ revalidate (ETag)
    expect(decidePreflightCache(entry, 1_000 + 6_000, false)).toEqual({
      kind: 'revalidate',
      ifNoneMatch: '"e1"',
    });
    // a CLUSTER KEY always hits the network even inside the config window (the grant is never cached)
    expect(decidePreflightCache(entry, 1_000 + 1_000, true)).toEqual({
      kind: 'revalidate',
      ifNoneMatch: '"e1"',
    });
    // past the 30 s live window ⇒ a full unconditional refetch (re-pull the health-ordered fallbacks)
    expect(decidePreflightCache(entry, 1_000 + 31_000, true).kind).toBe('fetch');
    expect(decidePreflightCache(entry, 1_000 + 31_000, false).kind).toBe('fetch');
    // a maxAgeS override shrinks the live window
    expect(decidePreflightCache(entry, 1_000 + 11_000, true, 10).kind).toBe('fetch');
  });
});

// ─────────────────────────────── preflight() over the wire ───────────────────────────────

describe('preflight()', () => {
  it('POSTs /v1/preflight and returns routing + knowledge + the grant from the X-UR-Grant header', async () => {
    const grant = grantFixture();
    const { fetch, calls } = recorder(() => ({
      status: 200,
      headers: ok200Headers('"e1"', grant),
      body: preflightFixture({ grant }),
    }));
    const res = await client(fetch).preflight({ call_type: 'ct', artifact_key: 'k1' });
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('http://pf.test/v1/preflight');
    expect(calls[0]?.body).toEqual({ call_type: 'ct', artifact_key: 'k1' });
    expect(res.object).toBe('preflight');
    expect(res.routing.model?.id).toBe('openai/gpt-5.2-mini');
    expect(res.knowledge?.placement).toBe('after_stable_prefix');
    expect(res.grant?.grant_id).toBe(grant.grant_id);
    expect(res.grant?.arm).toBe('treated');
  });

  it('two lifetimes — the CONFIG cache serves a no-cluster-key call from cache within 5 s, then revalidates', async () => {
    const { fetch, calls } = recorder((call, n) => {
      // A no-cluster-key preflight ⇒ grant null + grant_reason (no X-UR-Grant header).
      if (n === 1) {
        return {
          status: 200,
          headers: ok200Headers('"e1"', null),
          body: preflightFixture({ grant: null, grant_reason: 'no_cluster_key' }),
        };
      }
      // A CONDITIONAL revalidation (within the 30 s live window) ⇒ 304 (config unchanged).
      if (call.headers['if-none-match'] === '"e1"') {
        return { status: 304, headers: { 'x-ur-live-max-age': '30' } };
      }
      // An UNCONDITIONAL refetch (past the live window) ⇒ a fresh 200 (the fallbacks are re-pulled).
      return {
        status: 200,
        headers: ok200Headers('"e2"', null),
        body: preflightFixture({ grant: null, grant_reason: 'no_cluster_key' }),
      };
    });
    const ur = client(fetch);
    const t0 = 1_000;
    const r1 = await ur.preflight({ call_type: 'ct' }, { now: () => t0 });
    expect(r1.grant).toBeNull();
    expect(r1.grant_reason).toBe('no_cluster_key');
    expect(calls.length).toBe(1);

    // within the 5 s config window ⇒ served from cache, NO network call
    const r2 = await ur.preflight({ call_type: 'ct' }, { now: () => t0 + 4_000 });
    expect(r2.routing.model?.id).toBe('openai/gpt-5.2-mini');
    expect(r2.grant).toBeNull();
    expect(calls.length).toBe(1);

    // past 5 s (config) but within 30 s (live) ⇒ a conditional revalidation (304), body reused
    const r3 = await ur.preflight({ call_type: 'ct' }, { now: () => t0 + 6_000 });
    expect(r3.routing.model?.id).toBe('openai/gpt-5.2-mini');
    expect(calls.length).toBe(2);

    // past 30 s (live) ⇒ a full unconditional refetch (no If-None-Match)
    const r4 = await ur.preflight({ call_type: 'ct' }, { now: () => t0 + 40_000 });
    expect(r4).toBeDefined();
    expect(calls.length).toBe(3);
    expect(calls[2]?.headers['if-none-match']).toBeUndefined();
  });

  it('the GRANT is NEVER cached — a cached 304 still yields the FRESH X-UR-Grant grant', async () => {
    const g1 = grantFixture({ grant_id: `grant_${'1'.repeat(32)}`, request_id: 'req_served_1' });
    const g2 = grantFixture({
      grant_id: `grant_${'2'.repeat(32)}`,
      request_id: 'req_served_1',
      arm: 'treated',
    });
    const { fetch, calls } = recorder((call, n) => {
      if (n === 1)
        return {
          status: 200,
          headers: ok200Headers('"e1"', g1),
          body: preflightFixture({ grant: g1 }),
        };
      // A conditional revalidation ⇒ 304 with NO body but a FRESH grant on the header.
      expect(call.headers['if-none-match']).toBe('"e1"');
      return {
        status: 304,
        headers: { 'x-ur-live-max-age': '30', 'x-ur-grant': JSON.stringify(g2) },
      };
    });
    const ur = client(fetch);
    const t0 = 1_000;
    const r1 = await ur.preflight({ call_type: 'ct', artifact_key: 'loop:1' }, { now: () => t0 });
    expect(r1.grant?.grant_id).toBe(g1.grant_id);

    // A cluster key ALWAYS hits the network; the 304 reuses the cached config body but the grant is
    // read FRESH from the header — this is the load-bearing "grant never cached" assertion.
    const r2 = await ur.preflight(
      { call_type: 'ct', artifact_key: 'loop:1' },
      { now: () => t0 + 2_000 },
    );
    expect(calls.length).toBe(2);
    expect(r2.routing.model?.id).toBe('openai/gpt-5.2-mini'); // config body reused from cache
    expect(r2.grant?.grant_id).toBe(g2.grant_id); // grant is the FRESH header grant, not the cached g1
    expect(r2.grant_reason).toBeNull();
  });

  it('a cluster-key call past the live window forces a full unconditional refetch of the fallbacks', async () => {
    const g1 = grantFixture({ grant_id: `grant_${'1'.repeat(32)}` });
    const g3 = grantFixture({ grant_id: `grant_${'3'.repeat(32)}` });
    const { fetch, calls } = recorder((_call, n) =>
      n === 1
        ? { status: 200, headers: ok200Headers('"e1"', g1), body: preflightFixture({ grant: g1 }) }
        : { status: 200, headers: ok200Headers('"e2"', g3), body: preflightFixture({ grant: g3 }) },
    );
    const ur = client(fetch);
    const t0 = 1_000;
    await ur.preflight({ call_type: 'ct', artifact_key: 'loop:2' }, { now: () => t0 });
    const r2 = await ur.preflight(
      { call_type: 'ct', artifact_key: 'loop:2' },
      { now: () => t0 + 31_000 },
    );
    expect(calls.length).toBe(2);
    expect(calls[1]?.headers['if-none-match']).toBeUndefined(); // unconditional (live expired)
    expect(r2.grant?.grant_id).toBe(g3.grant_id);
  });

  it('noCache bypasses the cache entirely (always an unconditional fetch, never stored)', async () => {
    const g1 = grantFixture();
    const { fetch, calls } = recorder(() => ({
      status: 200,
      headers: ok200Headers('"e1"', g1),
      body: preflightFixture({ grant: g1 }),
    }));
    const ur = client(fetch);
    await ur.preflight({ call_type: 'ct', artifact_key: 'k' }, { noCache: true });
    await ur.preflight({ call_type: 'ct', artifact_key: 'k' }, { noCache: true });
    expect(calls.length).toBe(2);
    expect(calls[0]?.headers['if-none-match']).toBeUndefined();
    expect(calls[1]?.headers['if-none-match']).toBeUndefined();
  });
});

// ─────────────────────────────── learned-slot placement PARITY ───────────────────────────────

describe('learned-slot placement parity vs learnedPlacementIndex (the vendored rule)', () => {
  it('the vendored learnedPlacementIndex reproduces the gateway golden for every shape', () => {
    expect(PLACEMENT_GOLDEN.length).toBeGreaterThan(0);
    for (const c of PLACEMENT_GOLDEN) {
      const messages = c.roles.map((role) => ({ role }));
      expect(learnedPlacementIndex(messages)).toBe(c.index);
    }
  });

  it('applyLearnedContext inserts the learned block at the golden index (the ONE cache-safe rule)', () => {
    for (const c of PLACEMENT_GOLDEN) {
      const original = c.roles.map((role, i) => ({ role, content: `orig-${String(i)}` }));
      const result = applyLearnedContext(original, 'LEARNED-DATA-BLOCK');
      const insertedAt = result.findIndex(
        (m) => (m as { content?: unknown }).content === 'LEARNED-DATA-BLOCK',
      );
      // The block lands EXACTLY at the vendored rule's index === the parent golden's index.
      expect(insertedAt).toBe(c.index);
      expect(insertedAt).toBe(learnedPlacementIndex(original));
      expect(result.length).toBe(original.length + 1);
      expect(result[insertedAt]?.role).toBe(LEARNED_MESSAGE_ROLE);
      // The stable prefix + the tail are preserved byte-for-byte around the insertion.
      expect(result.slice(0, insertedAt)).toEqual(original.slice(0, c.index));
      expect(result.slice(insertedAt + 1)).toEqual(original.slice(c.index));
    }
  });

  it('applyLearnedContext with no learned content passes the messages through UNCHANGED', () => {
    const msgs = [
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
    ];
    expect(applyLearnedContext(msgs, null)).toEqual(msgs);
    expect(applyLearnedContext(msgs, '')).toEqual(msgs);
    expect(applyLearnedContext(msgs, undefined)).toEqual(msgs);
  });
});

// ─────────────────────────────── useLearned() — the stateful wrapper ───────────────────────────────

describe('useLearned()', () => {
  /** Route the preflight + the grant-quoting artifact/outcome calls the E2E loop makes. */
  function loopRecorder(
    grant: Record<string, unknown> | null,
    knowledge: unknown,
  ): {
    fetch: FetchLike;
    calls: Captured[];
  } {
    return recorder((call) => {
      if (call.url.endsWith('/v1/preflight')) {
        return {
          status: 200,
          headers: ok200Headers('"e1"', grant),
          body: preflightFixture({
            grant,
            knowledge,
            ...(grant === null ? { grant_reason: 'no_cluster_key' } : {}),
          }),
        };
      }
      if (call.url.endsWith('/v1/artifacts')) {
        return {
          status: 201,
          body: {
            artifact: {
              object: 'artifact',
              id: 'art_loop',
              key: (call.body?.key as string) ?? 'k',
              archetype: (call.body?.archetype as string) ?? 'answer',
              artifact_type_version_id: null,
              call_type_id: null,
              situation_key: null,
              occurred_at: '2026-09-14T00:00:00Z',
              exposure_arm: grant?.arm ?? 'pre_lever',
              exposure_epoch: grant?.epoch ?? 0,
              grant_id: (call.body?.grant_id as string) ?? null,
              grant_attestation: (call.body?.attestation as string) ?? null,
              lifecycle: 'open',
              current_version: 1,
              request_ids: [],
              claims: [],
              created_at: '2026-09-14T00:00:00Z',
              updated_at: '2026-09-14T00:00:00Z',
            },
          },
        };
      }
      if (/\/v1\/artifacts\/[^/]+\/outcomes$/.test(new URL(call.url).pathname)) {
        return {
          status: 202,
          body: {
            object: 'list',
            data: [
              {
                status: 'accepted',
                id: 'oev_1',
                source_event_id:
                  (call.body?.outcomes as { source_event_id?: string }[])?.[0]?.source_event_id ??
                  null,
                canonical_target_id: 'art_loop',
                target_kind: 'artifact',
                artifact_version: 1,
                latency_class: 'instant',
                source: 'declared',
                learning_use: ['calibrate'],
                reason: null,
              },
            ],
          },
        };
      }
      return {
        status: 404,
        body: { error: { code: 'not_found', message: 'x', type: 'not_found' } },
      };
    });
  }

  it('preflights once, then apply() places the learned block at learnedPlacementIndex (delivery=off)', async () => {
    const { fetch } = loopRecorder(grantFixture(), preflightFixture().knowledge);
    const session = await client(fetch).useLearned({ call_type: 'ct', artifact_key: 'loop:apply' });
    expect(session.grant?.arm).toBe('treated');
    expect(session.model).toBe('openai/gpt-5.2-mini');
    // The gateway does NOT inject (`off`), so the SDK MUST inject client-side.
    expect(session.knowledge?.delivery).toBe('off');

    const messages = [
      { role: 'system', content: 'You are a support agent.' },
      { role: 'user', content: 'refund please' },
    ];
    const applied = session.apply(messages);
    const at = learnedPlacementIndex(messages);
    expect(at).toBe(1);
    expect(applied[at]).toEqual({ role: 'user', content: 'LEARNED-DATA-BLOCK' });
    expect(applied.length).toBe(3);
  });

  it('apply() injects under BOTH delivery values (the non-proxied path always injects)', async () => {
    // useLearned() is the NON-proxied path: the gateway never sees this request, so apply() injects the
    // returned module regardless of `delivery`. `delivery` is exposed for visibility (it governs only the
    // gateway on a PROXIED request) but never gates apply() — a customer on the DEFAULT gateway delivery
    // still gets the learned knowledge when they call their model directly.
    const baseKnowledge = preflightFixture().knowledge as Record<string, unknown>;
    const gwKnowledge = {
      ...baseKnowledge,
      delivery: 'gateway_inject_after_stable_prefix',
    };
    const { fetch } = loopRecorder(grantFixture(), gwKnowledge);
    const session = await client(fetch).useLearned({
      call_type: 'ct',
      artifact_key: 'loop:gw',
    });
    expect(session.knowledge?.delivery).toBe('gateway_inject_after_stable_prefix');
    const messages = [
      { role: 'system', content: 'You are a support agent.' },
      { role: 'user', content: 'refund please' },
    ];
    const applied = session.apply(messages);
    const at = learnedPlacementIndex(messages);
    expect(at).toBe(1);
    expect(applied[at]).toEqual({ role: 'user', content: 'LEARNED-DATA-BLOCK' });
    expect(applied.length).toBe(messages.length + 1);
  });

  it('a HOLDOUT session (knowledge null) applies NOTHING — messages pass through unchanged', async () => {
    const holdoutGrant = grantFixture({ arm: 'holdout' });
    const { fetch } = loopRecorder(holdoutGrant, null);
    const session = await client(fetch).useLearned({
      call_type: 'ct',
      artifact_key: 'loop:holdout',
    });
    expect(session.knowledge).toBeNull();
    const messages = [
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
    ];
    expect(session.apply(messages)).toEqual(messages);
  });

  it('record() QUOTES the grant — upserts the artifact with grant_id + attestation:applied, then the outcome', async () => {
    const grant = grantFixture();
    const { fetch, calls } = loopRecorder(grant, preflightFixture().knowledge);
    const session = await client(fetch).useLearned({
      call_type: 'ct',
      artifact_key: 'pf-loop:xyz',
    });
    const receipt = await session.record({
      channel: 'correction',
      kind: 'edited',
      value: { diff_stats: { edit_ratio: 0.25, changed_spans: 2 } },
      source_event_id: 'pf-loop-corr-xyz',
    });
    expect(receipt.status).toBe('delivered');

    const artifactPost = calls.find((c) => c.url.endsWith('/v1/artifacts') && c.method === 'POST');
    expect(artifactPost?.body).toEqual({
      key: 'pf-loop:xyz',
      archetype: 'answer',
      grant_id: grant.grant_id,
      attestation: 'applied',
    });
    const outcomePost = calls.find((c) =>
      /\/v1\/artifacts\/[^/]+\/outcomes$/.test(new URL(c.url).pathname),
    );
    const event = (outcomePost?.body?.outcomes as Record<string, unknown>[] | undefined)?.[0];
    expect(event?.channel).toBe('correction');
    expect(event?.kind).toBe('edited');
    // provenance stays the server's — the SDK never sets source/producer/learning_use
    expect(event?.source).toBeUndefined();
    expect(event?.producer).toBeUndefined();
    expect(event?.learning_use).toBeUndefined();
  });

  it('record() without an artifact_key fails CLOSED (a named refusal, never a silent no-op)', async () => {
    const { fetch } = loopRecorder(null, preflightFixture().knowledge);
    const session = await client(fetch).useLearned({ call_type: 'ct' });
    await expect(
      session.record({ channel: 'behavioral', kind: 'accepted' }),
    ).rejects.toBeInstanceOf(UltraRouterError);
  });
});

// ─────────────────────────────── per-request case modules: `messages` ───────────────────────────────

/**
 * A gateway double for a call type whose learned module is a per-request CASE module: without
 * `messages` it answers `knowledge: null` + `knowledge_reason: 'case_query_missing'`; with them it
 * renders the cases for the last user message.
 */
function caseModuleGateway(call: Captured): Scripted {
  const messages = call.body?.messages as { role: string; content: string }[] | undefined;
  if (messages === undefined) {
    return {
      status: 200,
      headers: ok200Headers('"cfg-none"', null),
      body: preflightFixture({
        knowledge: null,
        knowledge_reason: 'case_query_missing',
        grant: null,
      }),
    };
  }
  const last = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const base = preflightFixture({ grant: null });
  const knowledge = base.knowledge as { module: Record<string, unknown> };
  return {
    status: 200,
    headers: ok200Headers(`"cfg-${String(last.length)}"`, null),
    body: {
      ...base,
      knowledge: { ...knowledge, module: { ...knowledge.module, content: `CASES FOR: ${last}` } },
    },
  };
}

describe('preflight() with messages (per-request case modules)', () => {
  const MESSAGES = [
    { role: 'system' as const, content: 'You classify invoices.' },
    { role: 'user' as const, content: 'Is INV-77 a duplicate?' },
  ];

  it('sends the optional messages field verbatim in the POST body', async () => {
    const rec = recorder(caseModuleGateway);
    await client(rec.fetch).preflight({ call_type: 'invoice-triage', messages: MESSAGES });
    expect(rec.calls[0]?.body).toEqual({ call_type: 'invoice-triage', messages: MESSAGES });
  });

  it('takes the same messages as chat (multi-part content, null content), sent verbatim', async () => {
    const rec = recorder(caseModuleGateway);
    const multimodal = [
      {
        role: 'user' as const,
        content: [
          { type: 'text', text: 'Is this invoice a duplicate?' },
          { type: 'image_url', image_url: { url: 'https://example.com/inv-77.png' } },
        ],
      },
      { role: 'assistant' as const, content: null, tool_calls: [{ id: 'call_1' }] },
    ];
    await client(rec.fetch).preflight({ call_type: 'invoice-triage', messages: multimodal });
    expect(rec.calls[0]?.body).toEqual({ call_type: 'invoice-triage', messages: multimodal });
    const chatMessages: ChatMessage[] = multimodal;
    const params: PreflightParams = { call_type: 'invoice-triage', messages: chatMessages };
    expect(params.messages).toBe(chatMessages);
    // @ts-expect-error message content is a string, an array of content parts or null
    const invalid: PreflightParams = { call_type: 'c', messages: [{ role: 'user', content: 5 }] };
    expect(invalid.call_type).toBe('c');
  });

  it('without messages a case module answers knowledge:null + case_query_missing', async () => {
    const rec = recorder(caseModuleGateway);
    const res = await client(rec.fetch).preflight({ call_type: 'invoice-triage' });
    expect(res.knowledge).toBeNull();
    expect(res.knowledge_reason).toBe('case_query_missing');
    expect(rec.calls[0]?.body).not.toHaveProperty('messages');
  });

  it('with messages the rendered cases come back as the learned module', async () => {
    const rec = recorder(caseModuleGateway);
    const res = await client(rec.fetch).preflight({
      call_type: 'invoice-triage',
      messages: MESSAGES,
    });
    expect(res.knowledge?.module.content).toBe('CASES FOR: Is INV-77 a duplicate?');
  });

  it('caches per messages: identical messages reuse the cache, different messages refetch', async () => {
    let t = 0;
    const rec = recorder(caseModuleGateway);
    const ur = client(rec.fetch);
    const now = () => t;
    const a = await ur.preflight({ call_type: 'invoice-triage', messages: MESSAGES }, { now });
    t += 1000; // inside the 5 s config window: a fresh hit needs no network
    const a2 = await ur.preflight({ call_type: 'invoice-triage', messages: MESSAGES }, { now });
    expect(rec.calls).toHaveLength(1);
    expect(a2.knowledge?.module.content).toBe(a.knowledge?.module.content);
    const other = [MESSAGES[0]!, { role: 'user' as const, content: 'And INV-78?' }];
    const b = await ur.preflight({ call_type: 'invoice-triage', messages: other }, { now });
    expect(rec.calls).toHaveLength(2);
    expect(b.knowledge?.module.content).toBe('CASES FOR: And INV-78?');
    expect(preflightCacheKey({ call_type: 'c', messages: MESSAGES })).not.toBe(
      preflightCacheKey({ call_type: 'c', messages: other }),
    );
    expect(preflightCacheKey({ call_type: 'c', messages: MESSAGES })).not.toContain('INV-77'); // a digest, never the text
  });

  it('useLearned() forwards messages, so apply() injects the rendered cases', async () => {
    const rec = recorder(caseModuleGateway);
    const session = await client(rec.fetch).useLearned({
      call_type: 'invoice-triage',
      messages: MESSAGES,
    });
    expect(rec.calls[0]?.body?.messages).toEqual(MESSAGES);
    const applied = session.apply(MESSAGES);
    expect(applied).toEqual([
      MESSAGES[0],
      { role: 'user', content: 'CASES FOR: Is INV-77 a duplicate?' },
      MESSAGES[1],
    ]);
  });
});
