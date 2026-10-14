// — init-defaults vs per-call precedence.
import { describe, expect, it } from 'vitest';

import { applyChatDefaults, applyEmbeddingDefaults, type ResolvedInit } from '../src/config.js';
import type { ChatCompletionCreateParams } from '../src/types.js';

const messages: ChatCompletionCreateParams['messages'] = [{ role: 'user', content: 'hi' }];

describe('applyChatDefaults — per-call overrides init defaults', () => {
  it('uses the init defaultModel when the call omits model', () => {
    const init: ResolvedInit = { defaultModel: 'anthropic/claude-sonnet-4.6', defaults: {} };
    const body = applyChatDefaults({ messages }, init);
    expect(body.model).toBe('anthropic/claude-sonnet-4.6');
  });

  it('a per-call model overrides the init defaultModel', () => {
    const init: ResolvedInit = { defaultModel: 'anthropic/claude-sonnet-4.6', defaults: {} };
    const body = applyChatDefaults({ model: 'openai/gpt-5.2-mini', messages }, init);
    expect(body.model).toBe('openai/gpt-5.2-mini');
  });

  it('omits model entirely when neither call nor init supplies one', () => {
    const body = applyChatDefaults({ messages }, { defaults: {} });
    expect('model' in body).toBe(false);
  });

  it('applies every init default (router/compression/callType/provider/maxCostUsd)', () => {
    const init: ResolvedInit = {
      defaults: {
        router: 'off',
        compression: 'lossless',
        callType: 'support-reply-draft',
        provider: { sort: 'price' },
        maxCostUsd: 0.25,
      },
    };
    const body = applyChatDefaults({ messages }, init);
    expect(body.router).toBe('off');
    expect(body.compression).toBe('lossless');
    expect(body.call_type).toBe('support-reply-draft');
    expect(body.provider).toEqual({ sort: 'price' });
    expect(body.ur?.max_cost_usd).toBe(0.25);
  });

  it('a per-call value wins for each overridable default', () => {
    const init: ResolvedInit = {
      defaults: {
        router: 'off',
        compression: 'lossless',
        callType: 'a',
        provider: { sort: 'price' },
        maxCostUsd: 0.25,
      },
    };
    const body = applyChatDefaults(
      {
        messages,
        router: 'auto',
        compression: { mode: 'auto', no_compress_fields: ['messages.1.content'] },
        call_type: 'b',
        provider: { sort: 'throughput' },
        ur: { max_cost_usd: 1 },
      },
      init,
    );
    expect(body.router).toBe('auto');
    expect(body.compression).toEqual({ mode: 'auto', no_compress_fields: ['messages.1.content'] });
    expect(body.call_type).toBe('b');
    expect(body.provider).toEqual({ sort: 'throughput' });
    expect(body.ur?.max_cost_usd).toBe(1);
  });

  it('preserves a per-call ur field while injecting the init maxCostUsd default', () => {
    const init: ResolvedInit = { defaults: { maxCostUsd: 0.5 } };
    const body = applyChatDefaults({ messages, ur: { trace_id: 't1' } }, init);
    expect(body.ur).toEqual({ max_cost_usd: 0.5, trace_id: 't1' });
  });

  it('does not add an ur block when there is nothing to inject', () => {
    const body = applyChatDefaults({ messages, model: 'm' }, { defaults: {} });
    expect('ur' in body).toBe(false);
  });

  it('carries ur.segments hints straight through', () => {
    const body = applyChatDefaults(
      { messages, model: 'm', ur: { segments: [{ index: 0, kind: 'reference_context' }] } },
      { defaults: {} },
    );
    expect(body.ur?.segments).toEqual([{ index: 0, kind: 'reference_context' }]);
  });
});

describe('applyEmbeddingDefaults — model + callType + maxCostUsd precedence', () => {
  it('uses the init defaultModel and callType when omitted', () => {
    const init: ResolvedInit = { defaultModel: 'openai/embed', defaults: { callType: 'ct' } };
    const body = applyEmbeddingDefaults({ input: 'x' }, init);
    expect(body.model).toBe('openai/embed');
    expect(body.call_type).toBe('ct');
  });

  it('a per-call model/callType overrides the init defaults', () => {
    const init: ResolvedInit = { defaultModel: 'openai/embed', defaults: { callType: 'ct' } };
    const body = applyEmbeddingDefaults(
      { model: 'cohere/embed', input: 'x', call_type: 'other' },
      init,
    );
    expect(body.model).toBe('cohere/embed');
    expect(body.call_type).toBe('other');
  });
});
