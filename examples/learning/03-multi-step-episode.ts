/**
 * Plug-and-play learning 3/8: a multi-step tool episode. Every step of one task carries the same
 * episode key (`x-ur-artifact`) and its own request id, so one terminal verdict covers the whole
 * episode. A second task running at the same time gets its own key even though its opening text is
 * identical: without explicit keys the gateway groups steps by their opening text, and the two
 * episodes would be merged and share one verdict.
 *
 * Run: ULTRAROUTER_API_KEY=ur_sk_test_... ULTRAROUTER_BASE_URL=http://localhost:8080 \
 *      npx tsx examples/learning/03-multi-step-episode.ts
 * Expected output (the verdicts depend on the model):
 *   episode ep_… (first): 7 steps · verdict pass
 *   episode ep_… (second): 7 steps · verdict pass
 *   each episode reported once, on its final request: delivered, delivered
 */
import UltraRouter, { mintEpisodeKey, type ChatMessage } from '@ultrarouter/sdk';
import { createOrderDesk, orderDeskTools, type OrderDesk } from '@ultrarouter/sdk/learning';

const ur = new UltraRouter({
  defaultModel: process.env.ULTRAROUTER_MODEL ?? 'openai/gpt-5.2-mini',
});

type ToolCall = { id: string; function: { name: string; arguments: string } };

/** Run one episode to its end; every step shares `episodeKey`. Returns each step's request id. */
async function runEpisode(desk: OrderDesk, episodeKey: string): Promise<string[]> {
  const messages: ChatMessage[] = [{ role: 'user', content: desk.task }];
  const requestIds: string[] = [];
  for (let step = 0; step < 16; step += 1) {
    const res = await ur.chat.completions.create(
      { messages, tools: orderDeskTools() },
      { episodeKey },
    );
    requestIds.push(res.requestId);
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
  return requestIds;
}

// Two concurrent tasks with the SAME opening text, each with its own episode key.
const tasks = [
  { name: 'first', desk: createOrderDesk('s3'), key: mintEpisodeKey() },
  { name: 'second', desk: createOrderDesk('s3'), key: mintEpisodeKey() },
];
const runs = await Promise.all(tasks.map((t) => runEpisode(t.desk, t.key)));

const statuses: string[] = [];
for (const [i, task] of tasks.entries()) {
  const requestIds = runs[i] ?? [];
  const finalRequestId = requestIds.at(-1);
  if (finalRequestId === undefined) throw new Error('the episode made no request');
  const verdict = task.desk.verify();
  console.log(
    `episode ${task.key} (${task.name}): ${String(requestIds.length)} steps · verdict ${verdict.verdict}`,
  );
  // Terminal feedback: one report, on the final request. The episode key ties it to every step.
  const report = await ur.ur.outcomes.report(finalRequestId, {
    verdict: verdict.verdict,
    source: 'verifier',
    evidenceHash: verdict.evidenceHash,
  });
  statuses.push(report.status);
  const receipts = await ur.ur.outcomes.receiptsForRequest(finalRequestId);
  if (receipts.data.length !== 1) throw new Error('expected exactly one receipt per episode');
}
console.log(`each episode reported once, on its final request: ${statuses.join(', ')}`);
if (statuses.some((s) => s !== 'delivered')) process.exitCode = 1;
