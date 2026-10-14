// The mock gateway used by the doctests, examples and pack smoke must answer every operation in the
// published OpenAPI document with a schema-valid body, or the docs could pass against a fiction.
import { createHmac } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// @ts-expect-error -- plain ESM test helpers without type declarations
import { loadSpec, responseSchema, validate } from '../scripts/lib/openapi-validate.mjs';
// @ts-expect-error -- plain ESM test helpers without type declarations
import { MOCK_ORACLE_SECRET, startMockGateway } from './support/mock-gateway.mjs';

interface Gateway {
  url: string;
  close: () => Promise<void>;
}

const KEY = 'ur_sk_test_mock';
let gw: Gateway;

beforeAll(async () => {
  gw = (await startMockGateway()) as Gateway;
});
afterAll(async () => {
  await gw.close();
});

/** A plausible request body per operation (the mock only inspects a few fields). */
function bodyFor(method: string, template: string): unknown {
  if (method === 'get' || method === 'delete') return undefined;
  if (template === '/v1/chat/completions')
    return { model: 'openai/gpt-5.2-mini', messages: [{ role: 'user', content: 'hi' }] };
  if (template === '/v1/embeddings')
    return { model: 'openai/text-embedding-3-small', input: ['a', 'b'] };
  if (template === '/v1/responses') return { model: 'openai/gpt-5.2-mini', input: 'hi' };
  if (template === '/v1/messages')
    return {
      model: 'anthropic/claude-sonnet-4.6',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'hi' }],
    };
  if (template === '/v1/preflight') return { call_type: 'support', artifact_key: 'a-1' };
  if (template === '/v1/flywheel/reviewer/events') return { events: [] };
  if (template === '/v1/requests/{id}/feedback') return { rating: 1 };
  if (template === '/v1/artifacts') return { key: 'k-1' };
  if (template === '/v1/artifacts/{id}/outcomes')
    return { outcomes: [{ channel: 'mechanical', kind: 'schema_valid' }] };
  if (template === '/v1/call-types') return { slug: 'support' };
  return method === 'get' || method === 'delete' ? undefined : {};
}

function concrete(template: string): string {
  if (template === '/v1/models/{id}') return '/v1/models/openai/gpt-5.2-mini';
  return template.replace(/\{[^}]+\}/g, 'x_1');
}

function signedHeaders(
  secret: string,
  raw: string,
  prefix: 'reviewer' | 'oracle',
): Record<string, string> {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = `sha256=${createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex')}`;
  return { [`x-ur-${prefix}-timestamp`]: ts, [`x-ur-${prefix}-signature`]: sig };
}

const spec = loadSpec() as { paths: Record<string, Record<string, unknown>> };
const operations: { method: string; template: string }[] = [];
for (const [template, item] of Object.entries(spec.paths)) {
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    if (item[method] !== undefined) operations.push({ method, template });
  }
}

describe('the mock gateway answers every published operation with a schema-valid body', () => {
  it('covers the whole document', () => {
    expect(operations.length).toBeGreaterThan(100);
  });

  for (const { method, template } of operations) {
    it(`${method.toUpperCase()} ${template}`, async () => {
      const body = bodyFor(method, template);
      const raw = body === undefined ? undefined : JSON.stringify(body);
      const headers: Record<string, string> = { authorization: `Bearer ${KEY}` };
      if (raw !== undefined) headers['content-type'] = 'application/json';
      if (template === '/v1/flywheel/reviewer/events')
        Object.assign(headers, signedHeaders(KEY, raw ?? '', 'reviewer'));
      if (/oracles\/\{id\}\/(jobs\/claim|verdicts)$/.test(template))
        Object.assign(headers, signedHeaders(MOCK_ORACLE_SECRET as string, raw ?? '', 'oracle'));
      const res = await fetch(`${gw.url}${concrete(template)}`, {
        method: method.toUpperCase(),
        headers,
        ...(raw !== undefined ? { body: raw } : {}),
      });
      expect(res.status, `${method} ${template}`).toBeLessThan(300);
      const text = await res.text();
      const schema = responseSchema(method, template, res.status) as
        Record<string, unknown> | undefined;
      if (schema === undefined) return;
      const errors = validate(JSON.parse(text), schema) as string[];
      expect(errors, `${method} ${template}`).toEqual([]);
    });
  }
});

describe('mock gateway behaviours the docs rely on', () => {
  it('streams SSE chunks ending in usage + ur and [DONE]', async () => {
    const res = await fetch(`${gw.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'openai/gpt-5.2-mini',
        stream: true,
        messages: [{ role: 'user', content: 'stream please' }],
      }),
    });
    const text = await res.text();
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(text.trim().endsWith('data: [DONE]')).toBe(true);
    const frames = text.split('\n\n').filter((f) => f.startsWith('data: {'));
    const last = JSON.parse(frames.at(-1)!.slice('data: '.length)) as {
      usage: unknown;
      ur: unknown;
    };
    expect(last.usage).toBeDefined();
    expect(last.ur).toBeDefined();
  });

  it('rejects missing auth and unpriced models with the documented codes', async () => {
    const noAuth = await fetch(`${gw.url}/v1/models`);
    expect(noAuth.status).toBe(401);
    const unpriced = await fetch(`${gw.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'example/unpriced-model',
        messages: [{ role: 'user', content: 'x' }],
      }),
    });
    expect(unpriced.status).toBe(403);
    expect(((await unpriced.json()) as { error: { code: string } }).error.code).toBe(
      'model_unpriced',
    );
  });

  it('refuses a forged oracle signature', async () => {
    const res = await fetch(`${gw.url}/v1/flywheel/oracles/orc_1/jobs/claim`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${KEY}`,
        'content-type': 'application/json',
        ...signedHeaders('wrong', '{}', 'oracle'),
      },
      body: '{}',
    });
    expect(res.status).toBe(403);
  });
});
