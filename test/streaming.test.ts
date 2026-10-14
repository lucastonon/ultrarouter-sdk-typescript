// — SSE stream assembly + ur-on-final-chunk + error frames.
import { describe, expect, it } from 'vitest';

import { UltraRouterError } from '../src/errors.js';
import { iterateChatStream, SseParser } from '../src/streaming.js';
import type { ChatCompletionChunk } from '../src/types.js';

/** Build an SSE `Response` whose body streams the given raw chunks in order. */
function sseResponse(rawChunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of rawChunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function chunkFrame(delta: string): string {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'm',
    choices: [{ index: 0, delta: { content: delta } }],
  })}\n\n`;
}

const FINAL_FRAME = `data: ${JSON.stringify({
  id: 'chatcmpl-1',
  object: 'chat.completion.chunk',
  created: 1,
  model: 'm',
  choices: [],
  usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  ur: {
    request_id: 'req_abc',
    call_type: null,
    model_served: 'm',
    provider: 'openai',
    routing: { mode: 'off', fallback_used: false },
    compression: { applied: 'off' },
    cost_usd: 0.0001,
    byok: false,
  },
})}\n\n`;

async function collect(response: Response): Promise<ChatCompletionChunk[]> {
  const chunks: ChatCompletionChunk[] = [];
  for await (const chunk of iterateChatStream(response)) chunks.push(chunk);
  return chunks;
}

describe('iterateChatStream — SSE parsing', () => {
  it('assembles content deltas and surfaces ur on the final chunk', async () => {
    const response = sseResponse([
      chunkFrame('Hello'),
      ': ping\n\n', // heartbeat comment — ignored
      chunkFrame(' world'),
      FINAL_FRAME,
      'data: [DONE]\n\n',
    ]);
    const chunks = await collect(response);
    const text = chunks.map((c) => c.choices[0]?.delta.content ?? '').join('');
    expect(text).toBe('Hello world');
    const final = chunks.at(-1);
    expect(final?.ur?.request_id).toBe('req_abc');
    expect(final?.usage?.total_tokens).toBe(5);
  });

  it('buffers events split across read boundaries', async () => {
    const full = chunkFrame('A') + chunkFrame('B') + 'data: [DONE]\n\n';
    // Slice into 7-byte pieces to force mid-frame boundaries.
    const pieces: string[] = [];
    for (let i = 0; i < full.length; i += 7) pieces.push(full.slice(i, i + 7));
    const chunks = await collect(sseResponse(pieces));
    expect(chunks.map((c) => c.choices[0]?.delta.content).join('')).toBe('AB');
  });

  it('throws an UltraRouterError on a terminal error frame', async () => {
    const errFrame = `event: error\ndata: ${JSON.stringify({
      error: {
        code: 'provider_unavailable',
        message: 'boom',
        request_id: 'req_err',
        retryable: true,
      },
    })}\n\n`;
    const response = sseResponse([chunkFrame('partial'), errFrame]);
    await expect(collect(response)).rejects.toMatchObject({
      code: 'provider_unavailable',
      requestId: 'req_err',
    });
  });

  it('throws on a malformed SSE chunk (never silently truncates)', async () => {
    const response = sseResponse([chunkFrame('ok'), 'data: {not json}\n\n']);
    await expect(collect(response)).rejects.toBeInstanceOf(UltraRouterError);
  });
});

/** Split a string into pieces at the given cut points (absolute offsets). */
function cutAt(text: string, cuts: readonly number[]): string[] {
  const out: string[] = [];
  let from = 0;
  for (const at of [...cuts, text.length]) {
    out.push(text.slice(from, at));
    from = at;
  }
  return out.filter((p) => p !== '');
}

/** The same frames with every LF line end rewritten to `eol`. */
function withLineEnds(frames: string, eol: '\r\n' | '\r' | '\n'): string {
  return frames.replace(/\n/g, eol);
}

describe('iterateChatStream — WHATWG line endings and chunk boundaries', () => {
  const frames = `${chunkFrame('Hello')}: ping\n\n${chunkFrame(' world')}${FINAL_FRAME}data: [DONE]\n\n`;

  for (const [name, eol] of [
    ['LF', '\n'],
    ['CRLF', '\r\n'],
    ['CR', '\r'],
  ] as const) {
    it(`parses ${name}-terminated frames in one chunk`, async () => {
      const chunks = await collect(sseResponse([withLineEnds(frames, eol)]));
      expect(chunks.map((c) => c.choices[0]?.delta.content ?? '').join('')).toBe('Hello world');
      expect(chunks.at(-1)?.ur?.request_id).toBe('req_abc');
    });

    it(`parses ${name}-terminated frames split at EVERY byte boundary`, async () => {
      const raw = withLineEnds(frames, eol);
      const pieces: string[] = [];
      for (let i = 0; i < raw.length; i += 1) pieces.push(raw.slice(i, i + 1));
      const chunks = await collect(sseResponse(pieces));
      expect(chunks.map((c) => c.choices[0]?.delta.content ?? '').join('')).toBe('Hello world');
    });
  }

  it('treats a CRLF split across two chunks as ONE line end (no phantom blank line)', async () => {
    // `data: {...}\r` | `\ndata: …` — if the LF opening chunk 2 were a new line end, the event would be
    // dispatched early and its second data line lost or mis-joined.
    const first = JSON.stringify({
      id: 'c',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'm',
    });
    const comma = first.indexOf(',') + 1; // split between JSON members, where a newline is whitespace
    const raw = `data: ${first.slice(0, comma)}\r\ndata: ${first.slice(comma)}\r\n\r\ndata: [DONE]\r\n\r\n`;
    const crAt = raw.indexOf('\r\n') + 1;
    const pieces = cutAt(raw, [crAt]);
    expect(pieces[0]?.endsWith('\r')).toBe(true);
    expect(pieces[1]?.startsWith('\n')).toBe(true);
    // Two data lines join with LF, so the JSON is split by a newline (valid JSON whitespace).
    const chunks = await collect(sseResponse(pieces));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.id).toBe('c');
  });

  it('handles mixed line endings and multi-byte UTF-8 split across chunks', async () => {
    const delta = 'olá — 你好 👋';
    const raw = `${chunkFrame(delta).replace('\n\n', '\r\n\r\n')}data: [DONE]\r\n\n`;
    const bytes = new TextEncoder().encode(raw);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
        controller.close();
      },
    });
    const chunks = await collect(new Response(stream, { status: 200 }));
    expect(chunks[0]?.choices[0]?.delta.content).toBe(delta);
  });

  it('ignores comments, unknown fields, id and retry; one leading space is stripped from values', async () => {
    const body = JSON.stringify({
      id: 'x',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'm',
      choices: [],
    });
    const raw = `: comment\r\nid: 7\r\nretry: 1000\r\nfoo: bar\r\ndata:${body}\r\n\r\ndata:  [DONE]\r\n\r\ndata: [DONE]\r\n\r\n`;
    // `data:  [DONE]` (two spaces) keeps one space, so it is NOT the sentinel and is malformed JSON.
    await expect(collect(sseResponse([raw]))).rejects.toMatchObject({ code: 'internal' });
    const ok = `: comment\r\nid: 7\r\ndata:${body}\r\n\r\ndata: [DONE]\r\n\r\n`;
    const chunks = await collect(sseResponse([ok]));
    expect(chunks.map((c) => c.id)).toEqual(['x']);
  });

  it('an `event: error` frame with CRLF line ends still raises the typed error', async () => {
    const err = `event: error\r\ndata: ${JSON.stringify({ error: { code: 'provider_timeout', message: 'slow', retryable: true } })}\r\n\r\n`;
    await expect(collect(sseResponse([chunkFrame('a'), err]))).rejects.toMatchObject({
      code: 'provider_timeout',
    });
  });

  it('a stream that ends before [DONE] is an error, never a silent truncation', async () => {
    await expect(collect(sseResponse([chunkFrame('partial')]))).rejects.toMatchObject({
      code: 'connection',
    });
  });

  it('accepts a final `data: [DONE]` that lacks the closing blank line', async () => {
    const chunks = await collect(sseResponse([chunkFrame('a'), 'data: [DONE]\r\n']));
    expect(chunks).toHaveLength(1);
  });
});

describe('SseParser', () => {
  it('produces the same events for every chunking of the same text', () => {
    const raw = 'event: a\r\ndata: 1\r\ndata: 2\r\r\ndata: 3\n\n: c\rdata: 4\r\r';
    const once = new SseParser().feed(raw);
    expect(once).toEqual([
      { event: 'a', data: '1\n2' },
      { event: 'message', data: '3' },
      { event: 'message', data: '4' },
    ]);
    for (let cut = 1; cut < raw.length; cut += 1) {
      const parser = new SseParser();
      const events = [...parser.feed(raw.slice(0, cut)), ...parser.feed(raw.slice(cut))];
      expect(events).toEqual(once);
    }
  });

  it('does not dispatch an event with no data line, and discards an unterminated event at the end', () => {
    const parser = new SseParser();
    expect(parser.feed('event: x\n\n')).toEqual([]);
    expect(parser.feed('data: partial')).toEqual([]);
    expect(parser.end()).toBeNull();
  });
});
