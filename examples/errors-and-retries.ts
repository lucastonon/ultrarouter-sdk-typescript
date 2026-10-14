/**
 * Errors and retries: branch on stable error codes, see which errors retry, and set timeouts.
 *
 * Run: ULTRAROUTER_API_KEY=ur_sk_test_... npx tsx examples/errors-and-retries.ts
 * (The model ids `example/...` below exist only on the local mock gateway used by the tests.)
 */
import UltraRouter, {
  GATEWAY_ERROR_TAXONOMY,
  ModelUnpricedError,
  UltraRouterError,
  isUltraRouterError,
} from '@ultrarouter/sdk';

const ur = new UltraRouter({ maxRetries: 2, timeout: 30_000 });
const messages = [{ role: 'user' as const, content: 'hi' }];

// 1. A non-retryable refusal: a model with no price is refused before any provider is called.
try {
  await ur.chat.completions.create({ model: 'example/unpriced-model', messages });
} catch (err) {
  if (err instanceof ModelUnpricedError) {
    console.log(`${err.code} (HTTP ${String(err.status)}), retryable=${String(err.retryable)}`);
  } else {
    throw err;
  }
}

// 2. A retryable error that persists: the SDK retries it, then surfaces the last error.
try {
  await ur.chat.completions.create({ model: 'example/rate-limited', messages }, { maxRetries: 1 });
} catch (err) {
  if (isUltraRouterError(err, 'rate_limited')) console.log('still rate limited after one retry');
  else throw err;
}

// 3. A transient failure that a retry absorbs: the call succeeds.
const ok = await ur.chat.completions.create({ model: 'example/flaky', messages });
console.log('recovered:', ok.choices[0]?.message.content);

// 4. Every gateway code, its HTTP status and whether the SDK retries it.
for (const [code, { status, retryable }] of Object.entries(GATEWAY_ERROR_TAXONOMY)) {
  if (retryable) console.log(`retried: ${code} (${String(status)})`);
}

// 5. A caller-side timeout surfaces as code `timeout` and is not retried.
try {
  await ur.models.list(undefined, { timeout: 1 });
} catch (err) {
  if (err instanceof UltraRouterError) console.log('timeout error code:', err.code);
}
