/**
 * Plug-and-play learning 1/8: an existing OpenAI-compatible agent. Keep the official `openai`
 * client and your agent loop; change only the base URL and the key, send a request id and an
 * episode key with each call, and report the verified outcome of the finished task.
 *
 * The task runs in the order-desk demonstration environment (a toy, not evidence of efficacy).
 *
 * The example resolves or creates order-desk (config:read/write) and sends its slug on every call.
 * Enable learning separately for its ct_... ID after full workspace learning consent.
 *
 * Run: ULTRAROUTER_API_KEY=ur_sk_test_... ULTRAROUTER_BASE_URL=http://localhost:8080 \
 *      npx tsx examples/learning/01-openai-client.ts
 * Expected output (the verdict depends on the model):
 *   steps: 5 · episode ep_… · last request req_c_…
 *   verdict: pass · report delivered · receipt pending|applied
 */
import OpenAI from 'openai';
import UltraRouter, {
  correlationHeaders,
  mintEpisodeKey,
  mintRequestId,
  readRequestId,
} from '@ultrarouter/sdk';
import { createOrderDesk, orderDeskTools } from '@ultrarouter/sdk/learning';

const baseURL = process.env.ULTRAROUTER_BASE_URL;
const apiKey = process.env.ULTRAROUTER_API_KEY;
if (baseURL === undefined || apiKey === undefined) {
  throw new Error('set ULTRAROUTER_BASE_URL and ULTRAROUTER_API_KEY');
}
const model = process.env.ULTRAROUTER_MODEL ?? 'openai/gpt-5.2-mini';

const ur = new UltraRouter();
// Keep traffic and learning controls on the same call type (config:read/write required).
const callTypes = await ur.ur.callTypes.list();
const callType =
  callTypes.data.find((ct) => ct.slug === 'order-desk') ??
  (await ur.ur.callTypes.create({ slug: 'order-desk' }));

// 1. The only change to your OpenAI client: point it at the gateway.
const openai = new OpenAI({ baseURL: `${baseURL.replace(/\/+$/, '')}/v1`, apiKey });

// 2. Your agent loop. One episode key for the whole task; a fresh request id for every call.
const desk = createOrderDesk('s1');
const episodeKey = mintEpisodeKey();
const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: 'user', content: desk.task }];
let lastRequestId = '';
let steps = 0;
while (steps < 12) {
  steps += 1;
  const requestId = mintRequestId();
  const { data, response } = await openai.chat.completions
    .create(
      { model, messages, tools: orderDeskTools(), ...{ call_type: callType.slug } },
      { headers: correlationHeaders({ requestId, episodeKey }) },
    )
    .withResponse();
  lastRequestId = readRequestId(response) ?? requestId;
  const message = data.choices[0]?.message;
  if (message === undefined) throw new Error('the gateway returned no choice');
  messages.push({ role: 'assistant', content: message.content, tool_calls: message.tool_calls });
  const calls = (message.tool_calls ?? []).filter((c) => c.type === 'function');
  if (calls.length === 0) break;
  for (const call of calls) {
    const result = desk.callJson(call.function.name, call.function.arguments);
    messages.push({ role: 'tool', tool_call_id: call.id, content: result });
  }
}
console.log(`steps: ${String(steps)} · episode ${episodeKey} · last request ${lastRequestId}`);

// 3. Verify against the real state, then report once, on the final request of the episode.
const verdict = desk.verify();
const report = await ur.ur.outcomes.report(lastRequestId, {
  verdict: verdict.verdict,
  source: 'verifier',
  evidenceHash: verdict.evidenceHash,
});
await ur.ur.outcomes.flush();
console.log(
  `verdict: ${verdict.verdict} · report ${report.status} · receipt ${report.receipt?.status ?? 'none'}`,
);
if (report.status !== 'delivered') {
  console.error(`the outcome was not delivered: ${report.error?.message ?? 'unknown'}`);
  process.exitCode = 1;
}
