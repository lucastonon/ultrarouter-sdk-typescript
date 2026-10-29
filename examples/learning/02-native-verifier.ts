/**
 * Plug-and-play learning 2/8: the native SDK with a real verifier. Run a small task, check the
 * result against the environment's actual state (not the model's own claim), and report the verdict
 * with the hash of its evidence. Only the hash leaves the process.
 *
 * The example resolves or creates order-desk (config:read/write) and sends its slug on every call.
 * Enable learning separately for its ct_... ID after full workspace learning consent.
 *
 * Run: ULTRAROUTER_API_KEY=ur_sk_test_... ULTRAROUTER_BASE_URL=http://localhost:8080 \
 *      npx tsx examples/learning/02-native-verifier.ts
 * Expected output (the verdict depends on the model):
 *   task: Please process order B-200.
 *   verdict: pass (sha256:…) · report delivered · teaches true
 */
import UltraRouter, { mintEpisodeKey, type ChatMessage } from '@ultrarouter/sdk';
import { createOrderDesk, orderDeskTools, runVerifier } from '@ultrarouter/sdk/learning';

const ur = new UltraRouter({
  defaultModel: process.env.ULTRAROUTER_MODEL ?? 'openai/gpt-5.2-mini',
});
// Keep traffic and learning controls on the same call type (config:read/write required).
const callTypes = await ur.ur.callTypes.list();
const callType =
  callTypes.data.find((ct) => ct.slug === 'order-desk') ??
  (await ur.ur.callTypes.create({ slug: 'order-desk' }));

type ToolCall = { id: string; function: { name: string; arguments: string } };

const desk = createOrderDesk('s2');
const episodeKey = mintEpisodeKey();
const messages: ChatMessage[] = [{ role: 'user', content: desk.task }];
console.log(`task: ${desk.task}`);

let finalRequestId = '';
for (let step = 0; step < 12; step += 1) {
  const res = await ur.chat.completions.create(
    { call_type: callType.slug, messages, tools: orderDeskTools() },
    { episodeKey },
  );
  finalRequestId = res.requestId;
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

// The verifier reads the final state of the environment.
const verdict = await runVerifier(() => {
  const check = desk.verify();
  return { pass: check.verdict === 'pass', evidence: desk.state(), reasons: check.reasons };
});
if (verdict.verdict === 'unknown') throw new Error('the verifier could not decide');

const report = await ur.ur.outcomes.report(finalRequestId, {
  verdict: verdict.verdict,
  source: 'verifier',
  ...(verdict.evidenceHash !== null ? { evidenceHash: verdict.evidenceHash } : {}),
});
await ur.ur.outcomes.flush();
console.log(
  `verdict: ${verdict.verdict} (${verdict.evidenceHash ?? 'no evidence'}) · report ${report.status} · teaches ${String(report.teaches)}`,
);
if (verdict.reasons.length > 0) console.log(`reasons: ${verdict.reasons.join('; ')}`);
if (report.status !== 'delivered') process.exitCode = 1;
