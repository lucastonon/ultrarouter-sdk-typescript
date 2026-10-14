// — one-line Autopilot intent. The `autopilot` option maps onto the
// Autonomy states through the config `router` layer; a per-request router can only
// DOWNGRADE from the declared ceiling; `ur.autopilot.status()` reads GET /v1/audit/readiness.
import { describe, expect, it } from 'vitest';

import { UltraRouter } from '../src/client.js';
import {
  applyChatDefaults,
  AUTOPILOT_ROUTER,
  clampRouterDowngrade,
  type ResolvedInit,
} from '../src/config.js';
import type { AutopilotMode, FetchLike } from '../src/types.js';

const messages = [{ role: 'user' as const, content: 'hi' }];

function recordingFetch(response: unknown): {
  fetch: FetchLike;
  last: () => { url: string; method: string; body: unknown };
} {
  let captured: { url: string; method: string; body: unknown } | undefined;
  const fetch: FetchLike = async (url, init) => {
    captured = {
      url: String(url),
      method: init?.method ?? 'GET',
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    };
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return {
    fetch,
    last: () => {
      if (captured === undefined) throw new Error('no request captured');
      return captured;
    },
  };
}

describe('autopilot → router mapping', () => {
  it('maps each intent onto the autonomy router mode', () => {
    expect(AUTOPILOT_ROUTER).toEqual({ audit: 'off', recommend: 'candidates', auto: 'auto' });
  });

  it.each<[AutopilotMode, string]>([
    ['audit', 'off'],
    ['recommend', 'candidates'],
    ['auto', 'auto'],
  ])('a client with autopilot=%s sends router=%s as the request default', async (mode, router) => {
    const { fetch, last } = recordingFetch({});
    const ur = new UltraRouter({ apiKey: 'k', baseURL: 'http://gw', autopilot: mode, fetch });
    expect(ur.autopilotMode).toBe(mode);
    expect(ur.ur.autopilot.mode).toBe(mode);
    await ur.chat.completions.create({ model: 'm', messages });
    expect((last().body as { router: string }).router).toBe(router);
  });
});

describe('per-request downgrade-only, no bypass (asserted)', () => {
  it('clampRouterDowngrade lowers an upgrade to the ceiling but passes a downgrade through', () => {
    // ceiling = audit(off): everything clamps down to off.
    expect(clampRouterDowngrade('auto', 'off')).toBe('off');
    expect(clampRouterDowngrade('candidates', 'off')).toBe('off');
    // ceiling = recommend(candidates): auto clamps down, off passes (a downgrade).
    expect(clampRouterDowngrade('auto', 'candidates')).toBe('candidates');
    expect(clampRouterDowngrade('off', 'candidates')).toBe('off');
    // ceiling = auto: a request may downgrade freely.
    expect(clampRouterDowngrade('off', 'auto')).toBe('off');
    expect(clampRouterDowngrade('candidates', 'auto')).toBe('candidates');
    expect(clampRouterDowngrade('auto', 'auto')).toBe('auto');
  });

  it('a per-request router upgrade is IGNORED under an audit ceiling (no bypass)', () => {
    const init: ResolvedInit = { defaults: {}, autopilotRouter: 'off' };
    // The caller asks for auto per request; audit is the ceiling ⇒ clamped to off.
    expect(applyChatDefaults({ messages, router: 'auto' }, init).router).toBe('off');
    expect(applyChatDefaults({ messages, router: 'candidates' }, init).router).toBe('off');
  });

  it('a per-request router DOWNGRADE is honored under an auto ceiling', () => {
    const init: ResolvedInit = { defaults: {}, autopilotRouter: 'auto' };
    expect(applyChatDefaults({ messages, router: 'off' }, init).router).toBe('off');
    expect(applyChatDefaults({ messages, router: 'candidates' }, init).router).toBe('candidates');
  });

  it("'auto' is intent, not a bypass: the SDK adds no header/flag beyond router:auto", async () => {
    const { fetch, last } = recordingFetch({});
    const ur = new UltraRouter({ apiKey: 'k', baseURL: 'http://gw', autopilot: 'auto', fetch });
    await ur.chat.completions.create({ model: 'm', messages });
    const body = last().body as Record<string, unknown>;
    // The ONLY autonomy signal is the config-layer router. No bespoke autopilot header/field
    // — the gateway still enforces server-side.
    expect(body.router).toBe('auto');
    expect('autopilot' in body).toBe(false);
  });

  it('without autopilot, a per-call router still wins (legacy precedence unchanged)', () => {
    const init: ResolvedInit = { defaults: { router: 'off' } };
    expect(applyChatDefaults({ messages, router: 'auto' }, init).router).toBe('auto');
  });
});

describe('ur.autopilot.status()', () => {
  it('reads GET /v1/audit/readiness and returns the readiness rollup', async () => {
    const readiness = {
      object: 'audit_readiness',
      state: 'observing',
      generated: true,
      total_requests: 3,
      total_spend_micro_usd: 0,
      observing_call_types: 1,
      call_types: [],
      inventory: { providers: ['openai'], models: ['openai/gpt-5.2'], key_modes: ['test'] },
      coverage: {
        retention_mode: 'metadata',
        payload_consented: false,
        confirmed_envelopes: 0,
        non_replayable_envelopes: 0,
        queued_envelopes: 0,
        notes: [],
      },
    };
    const { fetch, last } = recordingFetch(readiness);
    const ur = new UltraRouter({ apiKey: 'k', baseURL: 'http://gw', autopilot: 'audit', fetch });
    const status = await ur.ur.autopilot.status();
    expect(last().url).toBe('http://gw/v1/audit/readiness');
    expect(last().method).toBe('GET');
    expect(status.state).toBe('observing');
    expect(status.generated).toBe(true);
    expect(status.inventory.models).toContain('openai/gpt-5.2');
  });
});
