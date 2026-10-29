/**
 * Plug-and-play learning 6/8: a lost acknowledgement never double-counts. The network drops the
 * gateway's answer to the outcome report after the gateway already recorded it. The SDK retries with
 * the same Idempotency-Key and the same bytes; your code then retries the whole report call too. The
 * gateway still holds exactly one outcome, so learning consumes it once.
 *
 * Every report carries a source_event_id derived from (request id, verdict, source, your key), and
 * the durable queue replays the identical event, so retries are duplicates by construction.
 *
 * Run: ULTRAROUTER_API_KEY=ur_sk_test_... ULTRAROUTER_BASE_URL=http://localhost:8080 \
 *      npx tsx examples/learning/06-ack-loss-retry.ts
 * Expected output:
 *   answers lost in transit: 1 · outcome POSTs sent: 3 (identical bytes and key)
 *   first report: delivered (duplicate) · app-level retry: delivered (duplicate)
 *   receipts for the request: 1 · the same source_event_id rpt_…
 */
import UltraRouter, { type FetchLike } from '@ultrarouter/sdk';

const model = process.env.ULTRAROUTER_MODEL ?? 'openai/gpt-5.2-mini';

// A transport that loses the first answer to an outcome POST, after the gateway processed it.
let lost = 0;
const sent: { body: string; key: string }[] = [];
const lossyFetch: FetchLike = async (url, init) => {
  const res = await fetch(url, init);
  if (init?.method === 'POST' && String(url).endsWith('/outcomes')) {
    const headers = (init.headers ?? {}) as Record<string, string>;
    sent.push({ body: String(init.body), key: headers['idempotency-key'] ?? '' });
    if (lost === 0) {
      lost += 1;
      await res.text(); // the gateway has recorded the outcome…
      throw new TypeError('fetch failed: connection reset'); // …but its answer never arrives
    }
  }
  return res;
};

const ur = new UltraRouter({ defaultModel: model, fetch: lossyFetch, maxRetries: 2 });
const res = await ur.chat.completions.create({
  messages: [{ role: 'user', content: 'Please process order A-100.' }],
});

const params = { verdict: 'pass', source: 'verifier', idempotencyKey: 'order-a100-check' } as const;
const first = await ur.ur.outcomes.report(res.requestId, params);
// Your own retry policy (a crash-and-resume, a job retry) calls report again with the same input.
const retried = await ur.ur.outcomes.report(res.requestId, params);

const receipts = await ur.ur.outcomes.receiptsForRequest(res.requestId);
const identical = sent.every((s) => s.body === sent[0]?.body && s.key === sent[0]?.key);
console.log(
  `answers lost in transit: ${String(lost)} · outcome POSTs sent: ${String(sent.length)} (${identical ? 'identical bytes and key' : 'DIFFERENT'})`,
);
console.log(
  `first report: ${first.status} (${first.result?.status ?? '-'}) · app-level retry: ${retried.status} (${retried.result?.status ?? '-'})`,
);
console.log(
  `receipts for the request: ${String(receipts.data.length)} · the same source_event_id ${first.sourceEventId === retried.sourceEventId ? first.sourceEventId.slice(0, 12) + '…' : 'DIFFERENT'}`,
);
if (
  lost !== 1 ||
  !identical ||
  first.status !== 'delivered' ||
  retried.status !== 'delivered' ||
  receipts.data.length !== 1
) {
  process.exitCode = 1;
}
