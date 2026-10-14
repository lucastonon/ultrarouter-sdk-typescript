// The client-side preflight cache is BOUNDED: sustained unique traffic (a new trace / artifact /
// message identity per call) keeps at most `maxEntries` identities, least recently used first out,
// and entries past their live window are swept; `maxEntries: 0` disables caching.
import { describe, expect, it } from 'vitest';

import { UltraRouter } from '../src/client.js';
import { UltraRouterError } from '../src/errors.js';
import {
  DEFAULT_PREFLIGHT_CACHE_MAX_ENTRIES,
  PreflightCache,
  type PreflightCacheEntry,
  type PreflightResponse,
} from '../src/preflight.js';
import type { FetchLike } from '../src/types.js';

const body = {} as PreflightResponse;
const entry = (storedAtMs: number, liveMaxAgeS = 30): PreflightCacheEntry => ({
  etag: '"e"',
  body,
  storedAtMs,
  configMaxAgeS: 300,
  liveMaxAgeS,
});

describe('PreflightCache bounds', () => {
  it('keeps at most maxEntries under sustained unique keys, evicting least recently used', () => {
    const cache = new PreflightCache({ maxEntries: 100 });
    for (let i = 0; i < 10_000; i += 1) {
      cache.set(`k${String(i)}`, entry(1_000));
      expect(cache.size).toBeLessThanOrEqual(100);
    }
    expect(cache.size).toBe(100);
    expect(cache.get('k0')).toBeUndefined();
    expect(cache.get('k9999')).toBeDefined();
  });

  it('a recently read entry survives eviction (LRU, not FIFO)', () => {
    const cache = new PreflightCache({ maxEntries: 3 });
    cache.set('a', entry(1));
    cache.set('b', entry(1));
    cache.set('c', entry(1));
    expect(cache.get('a')).toBeDefined(); // a is now the most recently used
    cache.set('d', entry(1));
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBeDefined();
  });

  it('sweeps entries past their live window even below the bound', () => {
    const cache = new PreflightCache({ maxEntries: 1_000 });
    for (let i = 0; i < 50; i += 1) cache.set(`old${String(i)}`, entry(0, 30));
    // 64 sets later (one sweep period), at t = 31 s, the 30 s entries are gone.
    for (let i = 0; i < 64; i += 1) cache.set(`new${String(i)}`, entry(31_000, 30));
    expect(cache.get('old0')).toBeUndefined();
    expect(cache.size).toBe(64);
  });

  it('maxEntries 0 disables the cache; a negative or fractional bound is refused', () => {
    const off = new PreflightCache({ maxEntries: 0 });
    off.set('a', entry(1));
    expect(off.size).toBe(0);
    expect(() => new PreflightCache({ maxEntries: -1 })).toThrow(RangeError);
    expect(() => new PreflightCache({ maxEntries: 1.5 })).toThrow(RangeError);
    expect(DEFAULT_PREFLIGHT_CACHE_MAX_ENTRIES).toBe(1000);
  });
});

describe('through the client', () => {
  function fetchCounting(): { fetch: FetchLike; calls: () => number } {
    let n = 0;
    const fetch: FetchLike = async () => {
      n += 1;
      return new Response(
        JSON.stringify({
          object: 'preflight',
          call_type: 'ct',
          config_version: 1,
          routing: { model: null, fallbacks: [], max_age_s: 30 },
          knowledge: null,
          grant: null,
          grant_reason: 'no_cluster_key',
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            etag: '"v1"',
            'cache-control': 'max-age=300',
          },
        },
      );
    };
    return { fetch, calls: () => n };
  }

  it('sustained unique message identities stay bounded by preflightCache.maxEntries', async () => {
    const { fetch } = fetchCounting();
    const ur = new UltraRouter({
      apiKey: 'ur_sk_test_x',
      baseURL: 'https://gw.test',
      fetch,
      preflightCache: { maxEntries: 5 },
    });
    for (let i = 0; i < 200; i += 1) {
      await ur.preflight({
        call_type: 'ct',
        messages: [{ role: 'user', content: `q${String(i)}` }],
      });
    }
    // The cache is private; its bound is observable through which identities still hit it.
    const cache = (ur as unknown as { preflightCache: PreflightCache }).preflightCache;
    expect(cache.size).toBe(5);
  });

  it('maxEntries 0 sends every call to the network', async () => {
    const { fetch, calls } = fetchCounting();
    const ur = new UltraRouter({
      apiKey: 'ur_sk_test_x',
      baseURL: 'https://gw.test',
      fetch,
      preflightCache: { maxEntries: 0 },
    });
    await ur.preflight({ call_type: 'ct' });
    await ur.preflight({ call_type: 'ct' });
    expect(calls()).toBe(2);
  });

  it('an invalid bound is a typed construction error', () => {
    expect(
      () =>
        new UltraRouter({
          apiKey: 'ur_sk_test_x',
          baseURL: 'https://gw.test',
          preflightCache: { maxEntries: -5 },
        }),
    ).toThrow(UltraRouterError);
  });
});
