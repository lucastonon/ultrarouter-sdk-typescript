/**
 * Plug-and-play learning 4/8: report the outcome the moment you have the final response. The
 * gateway writes request logs asynchronously; an outcome that arrives first is accepted durably
 * (`pending`, with a receipt) and applied once the request lands. There is no sleep and no retry
 * loop here: `waitForReceipt` polls the public receipt route with bounded backoff, and is optional.
 *
 * Run: ULTRAROUTER_API_KEY=ur_sk_test_... ULTRAROUTER_BASE_URL=http://localhost:8080 \
 *      npx tsx examples/learning/04-immediate-outcome.ts
 * Expected output:
 *   reported 0 ms after the final response · gateway answered pending (or accepted)
 *   receipt rcpt_… applied · episode associated
 */
import UltraRouter, { mintEpisodeKey, type ChatMessage } from '@ultrarouter/sdk';
import { createOrderDesk, orderDeskTools } from '@ultrarouter/sdk/learning';

const ur = new UltraRouter({
  defaultModel: process.env.ULTRAROUTER_MODEL ?? 'openai/gpt-5.2-mini',
});

type ToolCall = { id: string; function: { name: string; arguments: string } };

const desk = createOrderDesk('s5');
const episodeKey = mintEpisodeKey();
const messages: ChatMessage[] = [{ role: 'user', content: desk.task }];
let finalRequestId = '';
let finishedAt = 0;
for (let step = 0; step < 12; step += 1) {
  const res = await ur.chat.completions.create(
    { messages, tools: orderDeskTools() },
    { episodeKey },
  );
  finalRequestId = res.requestId;
  finishedAt = Date.now();
  const message = res.choices[0]?.message;
  const calls = (message?.tool_calls ?? []) as ToolCall[];
  messages.push({ role: 'assistant', content: message?.content ?? null, tool_calls: calls });
  if (calls.length === 0) break;
  for (const call of calls) {
    messages.push({
      role: 'tool',
      tool_call_id: call.id,
      content: desk.callJson(call.function.name, call.function.arguments),
    });
  }
}

// Report immediately: no waiting for the gateway to finish writing the request.
const verdict = desk.verify();
const lag = Date.now() - finishedAt;
const report = await ur.ur.outcomes.report(finalRequestId, {
  verdict: verdict.verdict,
  source: 'verifier',
  evidenceHash: verdict.evidenceHash,
});
console.log(
  `reported ${String(lag)} ms after the final response · gateway answered ${report.result?.status ?? report.status}`,
);
if (report.status !== 'delivered' || report.receipt === null) {
  console.error('the outcome was not acknowledged with a receipt');
  process.exitCode = 1;
} else {
  // Optional: follow the receipt to its final state (bounded backoff, cancellable).
  const final = await ur.ur.outcomes.waitForReceipt(report.receipt.id, {
    timeoutMs: 30_000,
    signal: AbortSignal.timeout(60_000),
  });
  console.log(`receipt ${final.id} ${final.status} · episode ${final.episode ?? 'unknown'}`);
  if (final.status !== 'applied') process.exitCode = 1;
}
