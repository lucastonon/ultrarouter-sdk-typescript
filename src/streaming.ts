/**
 * The SSE parser for the gateway's chat stream. `data:` frames carry JSON `chat.completion.chunk`
 * objects; a `:` comment line is a heartbeat and is ignored; an `event: error` frame carries the error
 * envelope and is raised as an {@link UltraRouterError}; `data: [DONE]` ends the stream. The final
 * chunk carries `usage` and the `ur` block.
 *
 * Uses only `ReadableStream` and `TextDecoder`, so it runs on every fetch-capable runtime.
 */

import { UltraRouterError, errorFromResponse, errorFromTransport } from './errors.js';
import { untilAborted } from './http.js';
import type { ChatCompletionChunk } from './types.js';

/** One dispatched SSE event: its `event:` type (default `message`) and its joined `data`. */
export interface SseEvent {
  event: string;
  data: string;
}

/**
 * An incremental Server-Sent Events parser following the WHATWG event-stream interpretation:
 * lines end in LF, CRLF or a lone CR (a CRLF split across two chunks is one line end); a blank line
 * dispatches the event; a line starting with `:` is a comment; `field: value` strips one leading
 * space from the value; `data` lines join with LF; an event with no `data` line is not dispatched;
 * unknown fields are ignored. Feed it decoded text in any chunking — the events are the same.
 */
export class SseParser {
  private buffer = '';
  private skipLeadingLf = false;
  private eventType = '';
  private dataLines: string[] = [];

  /** Feed the next decoded chunk; returns the events it completed, in order. */
  feed(chunk: string): SseEvent[] {
    let input = chunk;
    if (this.skipLeadingLf && input.length > 0) {
      if (input.startsWith('\n')) input = input.slice(1);
      this.skipLeadingLf = false;
    }
    this.buffer += input;
    const events: SseEvent[] = [];
    for (;;) {
      const cr = this.buffer.indexOf('\r');
      const lf = this.buffer.indexOf('\n');
      const at = cr === -1 ? lf : lf === -1 ? cr : Math.min(cr, lf);
      if (at === -1) break;
      const line = this.buffer.slice(0, at);
      let consumed = 1;
      if (this.buffer[at] === '\r') {
        if (at + 1 < this.buffer.length) {
          if (this.buffer[at + 1] === '\n') consumed = 2;
        } else {
          // A CR at the very end of the chunk: the line has ended, and an LF that opens the next
          // chunk belongs to this same CRLF line end.
          this.skipLeadingLf = true;
        }
      }
      this.buffer = this.buffer.slice(at + consumed);
      const evt = this.processLine(line);
      if (evt !== null) events.push(evt);
    }
    return events;
  }

  /**
   * The end of the stream. Per the standard, an event not terminated by a blank line is discarded;
   * the one exception is a trailing `data: [DONE]` sentinel, which is returned so a server that omits
   * the final blank line still ends the stream cleanly.
   */
  end(): SseEvent | null {
    if (this.buffer !== '') {
      const evt = this.processLine(this.buffer);
      this.buffer = '';
      if (evt !== null) return evt.data === '[DONE]' ? evt : null;
    }
    const pending = this.dataLines.join('\n');
    const isDone = this.dataLines.length > 0 && pending === '[DONE]';
    this.dataLines = [];
    this.eventType = '';
    return isDone ? { event: 'message', data: '[DONE]' } : null;
  }

  private processLine(line: string): SseEvent | null {
    if (line === '') {
      if (this.dataLines.length === 0) {
        this.eventType = '';
        return null;
      }
      const evt = {
        event: this.eventType === '' ? 'message' : this.eventType,
        data: this.dataLines.join('\n'),
      };
      this.dataLines = [];
      this.eventType = '';
      return evt;
    }
    if (line.startsWith(':')) return null; // a comment (the gateway's heartbeat)
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') this.eventType = value;
    else if (field === 'data') this.dataLines.push(value);
    return null;
  }
}

/**
 * The deadline/abort lifecycle a stream is consumed under (the transport's open response): reads
 * race `signal`, a failure is mapped by `toError`, and `release` runs once the stream is done.
 */
export interface StreamLifecycle {
  readonly signal?: AbortSignal | undefined;
  toError?(cause: unknown): UltraRouterError;
  release?(): void;
}

/**
 * Turn a fetch `Response` body (SSE) into an async iterable of chat chunks. A mid-stream
 * `event: error` frame rejects the iterator with an {@link UltraRouterError} (never a silent
 * truncation); `data: [DONE]` closes it cleanly; a stream that ends before `[DONE]` rejects with a
 * `connection` error. With a `lifecycle`, the total timeout and the caller's `AbortSignal` keep
 * applying while chunks arrive (a stalled stream fails with `timeout` / `aborted`), and the
 * wiring is released when the stream completes, fails or the consumer stops early.
 */
export async function* iterateChatStream(
  response: Response,
  lifecycle: StreamLifecycle = {},
): AsyncGenerator<ChatCompletionChunk, void, unknown> {
  const body = response.body;
  if (body === null) {
    lifecycle.release?.();
    throw new UltraRouterError({
      code: 'connection',
      message: 'streaming response has no body',
      status: response.status,
      retryable: false,
    });
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  const toError = (cause: unknown): UltraRouterError =>
    cause instanceof UltraRouterError
      ? cause
      : (lifecycle.toError?.(cause) ?? errorFromTransport(cause, null));
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk =
          lifecycle.signal === undefined
            ? await reader.read()
            : await untilAborted(reader.read(), lifecycle.signal, () => {
                void reader.cancel().catch(() => undefined);
              });
      } catch (cause) {
        throw toError(cause);
      }
      const text = chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      for (const evt of parser.feed(text)) {
        const decoded = yieldEvent(evt);
        if (decoded === 'done') return;
        yield decoded;
      }
      if (chunk.done) break;
    }
    const last = parser.end();
    if (last !== null && yieldEvent(last) === 'done') return;
    throw new UltraRouterError({
      code: 'connection',
      message: 'the stream ended before the gateway sent [DONE] (the response is incomplete)',
      status: 0,
      retryable: false,
    });
  } finally {
    lifecycle.release?.();
    try {
      reader.releaseLock();
    } catch {
      // A runtime that still has a read pending after the cancel above; the cancel below is enough.
    }
    // Best-effort cancel so an early `break` tears down the upstream fetch.
    void body.cancel().catch(() => undefined);
  }
}

/** Decode one SSE event: a chunk to yield, `'done'` to stop, or throw on error. */
function yieldEvent(evt: SseEvent): ChatCompletionChunk | 'done' {
  if (evt.data === '[DONE]') return 'done';
  let parsed: unknown;
  try {
    parsed = JSON.parse(evt.data);
  } catch {
    // A malformed frame mid-stream is a hard failure (never a silent skip).
    throw new UltraRouterError({
      code: 'internal',
      message: 'malformed SSE chunk received from the gateway',
      status: 0,
      retryable: false,
    });
  }
  if (evt.event === 'error') {
    throw errorFromResponse(0, parsed);
  }
  return parsed as ChatCompletionChunk;
}
