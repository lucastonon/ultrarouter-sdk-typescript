/**
 * Integration tests against a real gateway. Skipped unless ULTRAROUTER_API_KEY and
 * ULTRAROUTER_BASE_URL are both set (`npm run test:integration`). Optional:
 * ULTRAROUTER_INTEGRATION_MODEL (a chat model id; default: the first active model with tools
 * support) and ULTRAROUTER_INTEGRATION_EMBEDDING_MODEL (enables the embeddings test). Every model call
 * is capped at a few output tokens.
 */
import { describe, expect, it } from 'vitest';

import UltraRouter, { UltraRouterError, isUltraRouterError } from '../../src/index.js';

const apiKey = process.env.ULTRAROUTER_API_KEY ?? process.env.UR_API_KEY;
const baseURL = process.env.ULTRAROUTER_BASE_URL ?? process.env.UR_BASE_URL;
const configured = apiKey !== undefined && apiKey !== '' && baseURL !== undefined && baseURL !== '';
const embeddingModel = process.env.ULTRAROUTER_INTEGRATION_EMBEDDING_MODEL;

describe.skipIf(!configured)('integration: a real gateway', () => {
  // The describe body is still collected when skipped, so only construct the client when configured.
  const ur = configured
    ? new UltraRouter({ apiKey, baseURL, maxRetries: 1, timeout: 90_000 })
    : (undefined as unknown as UltraRouter);
  let model = process.env.ULTRAROUTER_INTEGRATION_MODEL ?? '';

  it('lists models and retrieves one', async () => {
    const list = await ur.models.list();
    expect(list.object).toBe('list');
    expect(list.data.length).toBeGreaterThan(0);
    if (model === '')
      model = (list.data.find((m) => m.active && m.capabilities.tools === true) ?? list.data[0])!
        .id;
    const detail = await ur.models.retrieve(model);
    expect(detail.id).toBe(model);
  });

  it('introspects the key', async () => {
    const key = await ur.ur.key.get();
    expect(Array.isArray(key.scopes)).toBe(true);
  });

  it('creates a chat completion with the ur block', async () => {
    const res = await ur.chat.completions.create({
      model,
      max_completion_tokens: 16,
      messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
    });
    expect(res.choices.length).toBeGreaterThan(0);
    expect(res.ur.request_id).toMatch(/^req_/);
    expect(typeof res.ur.cost_usd).toBe('number');
  });

  it('streams a chat completion that ends with usage and the ur block', async () => {
    const stream = await ur.chat.completions.create({
      model,
      stream: true,
      max_completion_tokens: 16,
      messages: [{ role: 'user', content: 'Count from 1 to 3.' }],
    });
    let sawUr = false;
    for await (const chunk of stream) if (chunk.ur !== undefined) sawUr = true;
    expect(sawUr).toBe(true);
  });

  it.skipIf(embeddingModel === undefined || embeddingModel === '')(
    'creates embeddings',
    async () => {
      const res = await ur.embeddings.create({
        model: embeddingModel ?? '',
        input: ['hello', 'world'],
      });
      expect(res.data).toHaveLength(2);
    },
  );

  it('maps an invalid key to a typed authentication error', async () => {
    const bad = new UltraRouter({ apiKey: 'ur_sk_test_invalid', baseURL, maxRetries: 0 });
    const err = await bad.models.list().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UltraRouterError);
    expect(isUltraRouterError(err, 'authentication')).toBe(true);
    expect((err as UltraRouterError).status).toBe(401);
  });

  it('maps an unknown model to a typed, non-retryable error', async () => {
    const err = await ur.chat.completions
      .create({
        model: 'unknown-provider/no-such-model',
        max_completion_tokens: 4,
        messages: [{ role: 'user', content: 'x' }],
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UltraRouterError);
    expect((err as UltraRouterError).retryable).toBe(false);
  });

  it('reaches an operation through the typed request() helper', async () => {
    const key = await ur.request('get', '/v1/key');
    expect(key).toHaveProperty('scopes');
  });
});

describe.runIf(!configured)('integration: not configured', () => {
  it('is skipped: set ULTRAROUTER_API_KEY and ULTRAROUTER_BASE_URL to run it', () => {
    expect(configured).toBe(false);
  });
});
