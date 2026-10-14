// The total timeout and the caller's AbortSignal cover the WHOLE call: waiting for headers AND
// consuming the body (JSON or SSE). A body that drips in slower than the deadline fails with
// `timeout`; aborting after the headers arrived still aborts the body read; a stalled stream fails
// with `timeout` / `aborted` instead of hanging. Driven through the public client, as a user would.
import { describe, expect, it } from 'vitest';

import { UltraRouter } from '../src/client.js';
import type { FetchLike } from '../src/types.js';

const encoder = new TextEncoder();

const CHAT = {
  id: 'chatcmpl-1',
  object: 'chat.completion',
  created: 1,
  model: 'openai/gpt-5.2-mini',
  choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  ur: {
    request_id: 'req_1',
    call_type: null,
    model_served: 'openai/gpt-5.2-mini',
    provider: 'openai',
    routing: { mode: 'off', fallback_used: false },
    compression: { applied: 'off' },
    cost_usd: 0.0001,
    byok: false,
  },
};

function chunkFrame(text: string): string {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'm',
    choices: [{ index: 0, delta: { content: text } }],
  })}\n\n`;
}

/**
 * A fetch whose response headers arrive at once while the body pieces arrive after the given delays
 * (ms, cumulative). The body never honours the request signal — like a fetch implementation that
 * stops watching it once headers are in — so only the SDK's own deadline can end the read.
 */
function drippingFetch(
  pieces: readonly { afterMs: number; text: string }[],
  contentType = 'application/json',
): { fetch: FetchLike; cancelled: () => boolean } {
  let cancelled = false;
  const fetch: FetchLike = async () => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        let at = 0;
        for (const piece of pieces) {
          at += piece.afterMs;
          timers.push(
            setTimeout(() => {
              if (!cancelled) controller.enqueue(encoder.encode(piece.text));
            }, at),
          );
        }
        timers.push(
          setTimeout(() => {
            if (!cancelled) controller.close();
          }, at + 1),
        );
      },
      cancel() {
        cancelled = true;
        for (const t of timers) clearTimeout(t);
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': contentType } });
  };
  return { fetch, cancelled: () => cancelled };
}

function client(fetch: FetchLike, timeout: number): UltraRouter {
  return new UltraRouter({
    apiKey: 'ur_sk_test_x',
    baseURL: 'https://gw.test',
    fetch,
    timeout,
    maxRetries: 0,
  });
}

describe('the total timeout covers body consumption', () => {
  it('a JSON body that arrives after the deadline fails with `timeout`', async () => {
    const text = JSON.stringify(CHAT);
    const { fetch, cancelled } = drippingFetch([
      { afterMs: 0, text: text.slice(0, 10) },
      { afterMs: 400, text: text.slice(10) },
    ]);
    const started = Date.now();
    await expect(
      client(fetch, 60).chat.completions.create({
        model: 'm',
        messages: [{ role: 'user', content: 'x' }],
      }),
    ).rejects.toMatchObject({ code: 'timeout', status: 0, retryable: false });
    expect(Date.now() - started).toBeLessThan(350);
    expect(cancelled()).toBe(true); // the body was torn down, not left running
  });

  it('a JSON body inside the deadline still resolves (the deadline is total, not per chunk)', async () => {
    const text = JSON.stringify(CHAT);
    const { fetch } = drippingFetch([
      { afterMs: 0, text: text.slice(0, 10) },
      { afterMs: 20, text: text.slice(10) },
    ]);
    const res = await client(fetch, 2_000).chat.completions.create({
      model: 'm',
      messages: [{ role: 'user', content: 'x' }],
    });
    expect(res.choices[0]?.message.content).toBe('hi');
  });

  it('aborting AFTER the headers arrived still aborts the body read with `aborted`', async () => {
    const text = JSON.stringify(CHAT);
    const { fetch } = drippingFetch([
      { afterMs: 0, text: text.slice(0, 10) },
      { afterMs: 400, text: text.slice(10) },
    ]);
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error('user navigated away')), 40);
    await expect(
      client(fetch, 10_000).chat.completions.create(
        { model: 'm', messages: [{ role: 'user', content: 'x' }] },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: 'aborted', status: 0 });
  });

  it('a stalled stream fails with `timeout` instead of hanging', async () => {
    const { fetch, cancelled } = drippingFetch(
      [
        { afterMs: 0, text: chunkFrame('Hel') },
        { afterMs: 500, text: chunkFrame('lo') + 'data: [DONE]\n\n' },
      ],
      'text/event-stream',
    );
    const stream = await client(fetch, 80).chat.completions.create({
      model: 'm',
      stream: true,
      messages: [{ role: 'user', content: 'x' }],
    });
    const seen: string[] = [];
    const started = Date.now();
    await expect(
      (async () => {
        for await (const chunk of stream) seen.push(chunk.choices[0]?.delta.content ?? '');
      })(),
    ).rejects.toMatchObject({ code: 'timeout', status: 0 });
    expect(seen).toEqual(['Hel']);
    expect(Date.now() - started).toBeLessThan(450);
    expect(cancelled()).toBe(true);
  });

  it("the caller's AbortSignal stays wired until the stream is torn down", async () => {
    const { fetch } = drippingFetch(
      [
        { afterMs: 0, text: chunkFrame('a') },
        { afterMs: 500, text: chunkFrame('b') + 'data: [DONE]\n\n' },
      ],
      'text/event-stream',
    );
    const controller = new AbortController();
    const stream = await client(fetch, 10_000).chat.completions.create(
      { model: 'm', stream: true, messages: [{ role: 'user', content: 'x' }] },
      { signal: controller.signal },
    );
    setTimeout(() => controller.abort(new Error('stop')), 40);
    await expect(
      (async () => {
        for await (const _chunk of stream) {
          // consume
        }
      })(),
    ).rejects.toMatchObject({ code: 'aborted' });
  });

  it('a stream that completes inside the deadline is untouched by it', async () => {
    const { fetch } = drippingFetch(
      [
        { afterMs: 0, text: chunkFrame('a') },
        { afterMs: 10, text: chunkFrame('b') },
        { afterMs: 10, text: 'data: [DONE]\n\n' },
      ],
      'text/event-stream',
    );
    const controller = new AbortController();
    const stream = await client(fetch, 5_000).chat.completions.create(
      { model: 'm', stream: true, messages: [{ role: 'user', content: 'x' }] },
      { signal: controller.signal },
    );
    let text = '';
    for await (const chunk of stream) text += chunk.choices[0]?.delta.content ?? '';
    expect(text).toBe('ab');
    // Released: aborting after completion has nothing left to cancel and throws nothing.
    controller.abort();
  });
});
