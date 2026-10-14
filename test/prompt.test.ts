// — the hosted-prompt SDK surface (parity): `getPrompt()`, the pure
// `renderPrompt()` (fail-closed, byte-equivalent to the gateway), and the error-code enum.
//
// Proven against an in-process stub gateway (a recording `fetch`) + the cross-repo RENDER golden generated
// from the gateway core `renderHostedPrompt`.
//
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { UltraRouter } from '../src/client.js';
import { GATEWAY_ERROR_CODES, isGatewayErrorCode } from '../src/errors.js';
import {
  PromptVariablesMissingError,
  renderHostedPromptResult,
  renderPrompt,
  type RenderPromptResult,
} from '../src/prompt-render.js';
import type { FetchLike } from '../src/types.js';

// ─────────────────────────────── the render golden (parent's own output) ───────────────────────────────

interface RenderGoldenCase {
  readonly case: {
    readonly template: string;
    readonly variables: readonly {
      readonly name: string;
      readonly required: boolean;
    }[];
    readonly vars: Record<string, unknown>;
  };
  readonly result: RenderPromptResult;
}

/** The cross-repo render golden — generated from the compiled gateway `renderHostedPrompt`. */
const RENDER_GOLDEN = JSON.parse(
  readFileSync(new URL('./prompt/render-golden.json', import.meta.url), 'utf8'),
) as RenderGoldenCase[];

// ─────────────────────────────── render PARITY vs the gateway core ───────────────────────────────

describe(' /58 — renderHostedPromptResult parity vs the gateway core `renderHostedPrompt`', () => {
  it('the vendored render reproduces the gateway golden for every case (byte-equivalent)', () => {
    expect(RENDER_GOLDEN.length).toBeGreaterThan(0);
    for (const g of RENDER_GOLDEN) {
      expect(
        renderHostedPromptResult({
          template: g.case.template,
          variables: g.case.variables,
          vars: g.case.vars,
        }),
      ).toEqual(g.result);
    }
  });
});

// ─────────────────────────────── renderPrompt — fail-closed, never a silent blank ───────────────────────────────

describe(' /58 — renderPrompt (the ergonomic API)', () => {
  it('substitutes every {{name}} slot from the supplied vars', () => {
    expect(
      renderPrompt(
        {
          template: 'You are a {{role}} for {{brand}}.',
          variables: [
            { name: 'role', required: true },
            { name: 'brand', required: true },
          ],
        },
        { role: 'support', brand: 'Acme' },
      ),
    ).toBe('You are a support for Acme.');
  });

  it('a missing REQUIRED variable is a NAMED refusal listing the names — NEVER a silent blank (mutation-proof c)', () => {
    let thrown: unknown;
    try {
      renderPrompt(
        {
          template: 'You are a {{role}} for {{brand}}.',
          variables: [
            { name: 'role', required: true },
            { name: 'brand', required: true },
          ],
        },
        { role: 'support' },
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(PromptVariablesMissingError);
    expect((thrown as PromptVariablesMissingError).code).toBe('prompt_variables_missing');
    expect((thrown as PromptVariablesMissingError).missing).toEqual(['brand']);
  });

  it('a missing OPTIONAL variable renders as the empty string (never a refusal)', () => {
    expect(
      renderPrompt({
        template: 'Tone: {{tone}}.',
        variables: [{ name: 'tone', required: false }],
      }),
    ).toBe('Tone: .');
  });
});

// ─────────────────────────────── the error-code enum ───────────────────────────────

describe(' /58 error-code enum carries capability_unsupported + prompt_variables_missing', () => {
  it('both new codes are members of the enum + pass the guard; an unknown code is not', () => {
    expect(GATEWAY_ERROR_CODES).toContain('capability_unsupported');
    expect(GATEWAY_ERROR_CODES).toContain('prompt_variables_missing');
    expect(isGatewayErrorCode('capability_unsupported')).toBe(true);
    expect(isGatewayErrorCode('prompt_variables_missing')).toBe(true);
    expect(isGatewayErrorCode('not_a_real_code')).toBe(false);
  });
});

// ─────────────────────────────── getPrompt() over the wire ───────────────────────────────

function recorder(body: unknown): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const fetch: FetchLike = (url) => {
    calls.push(String(url));
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          etag: '"e1"',
          'x-ur-live-max-age': '30',
        },
      }),
    );
  };
  return { fetch, calls };
}

function preflightBody(prompt: unknown): Record<string, unknown> {
  return {
    object: 'preflight',
    config_version: 7,
    routing: {
      mode: 'candidates',
      model: { id: 'openai/gpt-5.2-mini', evidence: 'none', score: null },
      fallbacks: [],
      why: null,
      max_age_s: 30,
    },
    prompt,
    knowledge: null,
    knowledge_reason: 'no_learned_module',
    grant: null,
    grant_reason: 'no_cluster_key',
    provisional: false,
  };
}

describe(' /58 — getPrompt()', () => {
  const client = (fetch: FetchLike): UltraRouter =>
    new UltraRouter({
      apiKey: 'ur_sk_test_gp',
      baseURL: 'http://gp.test',
      fetch,
    });

  it('returns the ACTIVE hosted prompt version, and renderPrompt renders it', async () => {
    const prompt = {
      version: 3,
      template: 'You are a {{role}} agent.',
      variables: [{ name: 'role', required: true }],
      sha256: 'a'.repeat(64),
    };
    const { fetch, calls } = recorder(preflightBody(prompt));
    const got = await client(fetch).getPrompt('ct_support');
    expect(calls[0]).toBe('http://gp.test/v1/preflight');
    expect(got?.version).toBe(3);
    expect(got?.template).toBe('You are a {{role}} agent.');
    expect(renderPrompt(got!, { role: 'billing' })).toBe('You are a billing agent.');
  });

  it('returns null for a CODE-OWNED call type (no active hosted prompt)', async () => {
    const { fetch } = recorder(preflightBody(null));
    expect(await client(fetch).getPrompt('ct_code_owned')).toBeNull();
  });
});
