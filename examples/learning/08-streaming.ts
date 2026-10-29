/**
 * Plug-and-play learning 8/8: a streaming agent loop with outcome reporting. The request id is known
 * as soon as each stream opens (before the first chunk), tool-call deltas are assembled as they
 * arrive, and the verified outcome is reported on the final request.
 *
 * The example resolves or creates order-desk (config:read/write) and sends its slug on every call.
 * Enable learning separately for its ct_... ID after full workspace learning consent.
 *
 * Run: ULTRAROUTER_API_KEY=ur_sk_test_... ULTRAROUTER_BASE_URL=http://localhost:8080 \
 *      npx tsx examples/learning/08-streaming.ts
 * Expected output (the verdict depends on the model):
 *   step 1 opened req_c_… (id known before the first chunk)
 *   …
 *   final answer: Done: F-600 reserved, F-601 backordered.
 *   verdict: pass · report delivered · receipt applied
 */
import UltraRouter, { mintEpisodeKey, type ChatMessage } from '@ultrarouter/sdk';
import { createOrderDesk, orderDeskTools } from '@ultrarouter/sdk/learning';

// `requestIds: 'client'` mints every request id client-side, so it is known even if a stream fails.
const ur = new UltraRouter({
  defaultModel: process.env.ULTRAROUTER_MODEL ?? 'openai/gpt-5.2-mini',
  requestIds: 'client',
});
// Keep traffic and learning controls on the same call type (config:read/write required).
const callTypes = await ur.ur.callTypes.list();
const callType =
  callTypes.data.find((ct) => ct.slug === 'order-desk') ??
  (await ur.ur.callTypes.create({ slug: 'order-desk' }));

interface ToolCallDelta {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

const desk = createOrderDesk('s6');
const episodeKey = mintEpisodeKey();
const messages: ChatMessage[] = [{ role: 'user', content: desk.task }];
let finalRequestId = '';
let answer = '';

for (let step = 1; step <= 16; step += 1) {
  const stream = await ur.chat.completions.create(
    { call_type: callType.slug, stream: true, messages, tools: orderDeskTools() },
    { episodeKey },
  );
  if (stream.requestId === null) throw new Error('no request id on the stream');
  finalRequestId = stream.requestId;
  console.log(`step ${String(step)} opened ${stream.requestId} (id known before the first chunk)`);

  // Assemble the streamed text and tool calls (arguments may arrive in fragments).
  let text = '';
  const calls = new Map<number, { id: string; name: string; arguments: string }>();
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    text += delta?.content ?? '';
    for (const part of (delta?.tool_calls ?? []) as ToolCallDelta[]) {
      const call = calls.get(part.index) ?? { id: '', name: '', arguments: '' };
      call.id ||= part.id ?? '';
      call.name ||= part.function?.name ?? '';
      call.arguments += part.function?.arguments ?? '';
      calls.set(part.index, call);
    }
  }
  const toolCalls = [...calls.values()];
  messages.push({
    role: 'assistant',
    content: text === '' ? null : text,
    ...(toolCalls.length > 0
      ? {
          tool_calls: toolCalls.map((c) => ({
            id: c.id,
            type: 'function',
            function: { name: c.name, arguments: c.arguments },
          })),
        }
      : {}),
  });
  if (toolCalls.length === 0) {
    answer = text;
    break;
  }
  for (const call of toolCalls) {
    messages.push({
      role: 'tool',
      tool_call_id: call.id,
      content: desk.callJson(call.name, call.arguments),
    });
  }
}
console.log(`final answer: ${answer}`);

const verdict = desk.verify();
const report = await ur.ur.outcomes.report(finalRequestId, {
  verdict: verdict.verdict,
  source: 'verifier',
  evidenceHash: verdict.evidenceHash,
});
const receipt =
  report.receipt === null
    ? null
    : await ur.ur.outcomes.waitForReceipt(report.receipt.id, { timeoutMs: 30_000 });
console.log(
  `verdict: ${verdict.verdict} · report ${report.status} · receipt ${receipt?.status ?? 'none'}`,
);
if (report.status !== 'delivered' || receipt?.status !== 'applied') process.exitCode = 1;
