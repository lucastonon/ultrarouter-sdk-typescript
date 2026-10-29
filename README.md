# @ultrarouter/sdk

The official TypeScript SDK for ultrarouter, an OpenAI-compatible LLM
gateway and router. Send chat, streaming, tool-calling, structured-output and embedding requests
through the gateway with an `openai`-shaped client; read what every request cost and which model
served it; and use the ultrarouter resources (call types, evals, outcomes, preflight, Bench) from
typed methods.

- **OpenAI-shaped**: `chat.completions.create`, `embeddings.create`, `models.list`, plus
  `asOpenAI()` to keep using the official `openai` client.
- **Typed end to end**: request and response types are checked against the published OpenAPI
  document; `ur.request()` gives typed access to every operation in it.
- **Robust transport**: retries for retryable failures with backoff and `Retry-After`, a total
  timeout, `AbortSignal`, and idempotency keys on writes.
- **Zero runtime dependencies**: `fetch`-based; ESM and CommonJS; tested on Node.js 20+ and Deno 2,
  expected to work (not yet tested) on Bun and edge runtimes. See
  [runtimes](./docs/installation.md).
- **Plug-and-play learning**: request and episode correlation, verdict reports with durable
  receipts that never double-count, learning controls, and starter verifiers and webhook receivers.
- **Batteries for CI**: the `ur` CLI and a GitHub Action for Bench and application-CI gates.

Version `0.1.0` is an early release; expect the API to evolve before 1.0.

## Install

`@ultrarouter/sdk` is **not published to the npm registry yet**, so `npm install @ultrarouter/sdk`
does not work today. Install it from the public GitHub source: build the package and install the
tarball it produces (Node.js 20 or later). The `feat/learning-loop` branch contains this
0.1.0 preview; the default branch does not yet include the learning additions.

<!-- doctest: skip — clones the public repository and builds the package -->

```bash
git clone --branch feat/learning-loop --single-branch https://github.com/lucastonon/ultrarouter-sdk-typescript.git
cd ultrarouter-sdk-typescript
npm ci && npm run build && npm pack   # writes ultrarouter-sdk-0.1.0.tgz

cd ../your-app
npm install ../ultrarouter-sdk-typescript/ultrarouter-sdk-0.1.0.tgz
```

`npm install github:lucastonon/ultrarouter-sdk-typescript` does not work either: the repository
holds no prebuilt `dist/`. See [installation](./docs/installation.md#install) for pnpm, Yarn and
Bun.

## Quickstart

Set your key and the URL of the gateway you run (there is no hosted default):

```bash
export ULTRAROUTER_API_KEY=ur_sk_test_...
export ULTRAROUTER_BASE_URL=https://gateway.example.com   # required; or http://localhost:8080 for a local gateway
```

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter(); // reads ULTRAROUTER_API_KEY and ULTRAROUTER_BASE_URL

const res = await ur.chat.completions.create({
  model: 'openai/gpt-5.2-mini',
  messages: [{ role: 'user', content: 'Say hello in one word.' }],
});

console.log(res.choices[0]?.message.content);
console.log(res.ur.request_id, res.ur.model_served, res.ur.cost_usd);
```

Every response carries the `ur` block: the gateway request id, the model and provider that served
it, routing and compression details, and the cost. Model ids are provider-prefixed; the ones in
these docs are illustrative, and `ur.models.list()` shows what your gateway serves.

## Configuration

| Setting     | Option         | Environment                                | Default                      |
| ----------- | -------------- | ------------------------------------------ | ---------------------------- |
| API key     | `apiKey`       | `ULTRAROUTER_API_KEY`, then `UR_API_KEY`   | required                     |
| Gateway URL | `baseURL`      | `ULTRAROUTER_BASE_URL`, then `UR_BASE_URL` | required (no hosted default) |
| Model       | `defaultModel` |                                            | none                         |
| Retries     | `maxRetries`   |                                            | `2`                          |
| Timeout     | `timeout` (ms) |                                            | `600000`                     |

Also: request `defaults` (call type, compression, provider preferences, cost cap), the `autopilot`
intent, a Bench capture tag, `defaultHeaders`, a custom `fetch`, and durable outcome stores. See
[configuration](./docs/configuration.md).

## Feature tour

### Streaming

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter({ defaultModel: 'openai/gpt-5.2-mini' });
const stream = await ur.chat.completions.create({
  stream: true,
  messages: [{ role: 'user', content: 'Write a haiku about rivers.' }],
});
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta.content ?? '');
  if (chunk.ur) console.log(`\n(${chunk.ur.model_served}, $${String(chunk.ur.cost_usd)})`);
}
```

[Streaming guide](./docs/streaming.md)

### Tools and structured outputs

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter({ defaultModel: 'openai/gpt-5.2-mini' });

const withTools = await ur.chat.completions.create({
  messages: [{ role: 'user', content: 'What is the weather in Oslo?' }],
  tools: [
    {
      type: 'function',
      function: {
        name: 'get_weather',
        parameters: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
      },
    },
  ],
});
console.log(withTools.choices[0]?.message.tool_calls);

const structured = await ur.chat.completions.create({
  messages: [{ role: 'user', content: 'Classify: "my parcel never arrived"' }],
  response_format: {
    type: 'json_schema',
    json_schema: {
      name: 'label',
      schema: {
        type: 'object',
        properties: { label: { type: 'string', enum: ['billing', 'shipping', 'other'] } },
        required: ['label'],
      },
    },
  },
});
console.log(JSON.parse(structured.choices[0]?.message.content ?? '{}'));
```

[Tools](./docs/tools.md) · [Structured outputs](./docs/structured-outputs.md)

### Embeddings and models

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();
const emb = await ur.embeddings.create({
  model: 'openai/text-embedding-3-small',
  input: ['first text', 'second text'],
});
console.log(emb.data.length, (emb.data[0]?.embedding as number[]).length);

const models = await ur.models.list({ capability: 'tools' });
const detail = await ur.models.retrieve('openai/gpt-5.2-mini');
console.log(models.data.length, detail.offers.length);
```

[Embeddings](./docs/embeddings.md) · [Models](./docs/models.md)

### Keep using the `openai` client

```ts
import OpenAI from 'openai';
import UltraRouter from '@ultrarouter/sdk';

const openai = new UltraRouter().asOpenAI(OpenAI); // baseURL (+ /v1), key and headers preset
const res = await openai.chat.completions.create({
  model: 'openai/gpt-5.2-mini',
  messages: [{ role: 'user', content: 'hi' }],
});
console.log(res.choices[0]?.message.content);
```

[OpenAI compatibility](./docs/openai-compatibility.md)

### Native passthrough: the official OpenAI and Anthropic SDKs

The gateway forwards the OpenAI Responses API (`POST /v1/responses`) and the Anthropic Messages API
(`POST /v1/messages`) to the provider unchanged, metering each call. Point the official client at
your gateway with two environment variables (`OPENAI_BASE_URL=<gateway>/v1`,
`ANTHROPIC_BASE_URL=<gateway>`) and your `ur_sk_…` key — nothing else changes.

```ts
import OpenAI from 'openai';

// OPENAI_BASE_URL=<your gateway>/v1 and OPENAI_API_KEY=<your ur_sk_… key> point the official client here.
const openai = new OpenAI();
const res = await openai.responses.create({
  model: 'openai/gpt-5.2-mini',
  input: 'Give me one word for "fast".',
});
console.log(res.output_text);
```

[Native passthrough](./docs/passthrough.md)

### Errors and retries

Errors carry a stable `code`, the HTTP `status`, the `requestId` and a `retryable` flag. Retryable
failures (rate limits, provider outages, network errors) are retried automatically; non-retryable
ones, such as `model_unpriced` (a model with no price, refused before dispatch), fail immediately.

```ts
import UltraRouter, { ModelUnpricedError, isUltraRouterError } from '@ultrarouter/sdk';

const ur = new UltraRouter({ maxRetries: 2, timeout: 30_000 });
try {
  await ur.chat.completions.create({
    model: 'example/unpriced-model',
    messages: [{ role: 'user', content: 'hi' }],
  });
} catch (err) {
  if (err instanceof ModelUnpricedError) console.log('choose a priced model');
  else if (isUltraRouterError(err)) console.log(err.code, err.status, err.requestId);
  else throw err;
}
```

[Errors](./docs/errors.md) · [Retries, timeouts and idempotency](./docs/retries-timeouts-idempotency.md)

### Any operation, typed

`ur.request()` reaches every operation in the published OpenAPI document with typed path
parameters, query, body and response, even those without a dedicated method:

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();
const key = await ur.request('get', '/v1/key');
const model = await ur.request('get', '/v1/models/{id}', { path: { id: 'openai/gpt-5.2-mini' } });
console.log(key.scopes, model.id);
```

[Typed requests](./docs/typed-requests.md) · [API coverage](./docs/api-coverage.md)

### Outcomes

Record what happened after a model call (a schema check passed, a human edited the draft, a claim
resolved) against the artifact it produced. Events are queued durably and replayed safely.

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter({ defaultModel: 'openai/gpt-5.2-mini' });
await ur.withArtifact('ticket-4821', async (scope) => {
  const res = await scope.chat.completions.create({
    messages: [{ role: 'user', content: 'Draft a reply to ticket 4821.' }],
  });
  console.log('id' in res ? res.ur.artifact_id : 'stream');
  await scope.record({ channel: 'mechanical', kind: 'schema_valid' });
}); // the outcome queue is flushed when the scope ends
```

[Outcomes](./docs/outcomes.md) · [Reviewer adapter](./docs/reviewer.md)

### Plug-and-play learning

Correlate every call, report the verified outcome of the finished task, and steer learning per
call type. A report is accepted even before the gateway has finished writing the request (a durable
`pending` receipt), and retries can never count it twice.

```ts
import UltraRouter, { mintEpisodeKey } from '@ultrarouter/sdk';

const ur = new UltraRouter({ defaultModel: 'openai/gpt-5.2-mini' });
const callTypes = await ur.ur.callTypes.list();
const callType =
  callTypes.data.find((ct) => ct.slug === 'support-reply') ??
  (await ur.ur.callTypes.create({ slug: 'support-reply' }));
const res = await ur.chat.completions.create(
  {
    call_type: callType.slug,
    messages: [{ role: 'user', content: 'Please process order A-100.' }],
  },
  { episodeKey: mintEpisodeKey() }, // one key per task; every step carries it
);

// Your own check decides the verdict (a test suite, a state check, a business rule).
const report = await ur.ur.outcomes.report(res.requestId, { verdict: 'pass', source: 'verifier' });
if (report.receipt !== null) {
  const receipt = await ur.ur.outcomes.waitForReceipt(report.receipt.id, { timeoutMs: 10_000 });
  console.log(receipt.status); // "applied"
}
console.log((await ur.ur.learning.status(callType.id)).state); // learning requires the ct_… id
```

[Plug-and-play learning](./docs/plug-and-play-learning.md) ·
[`@ultrarouter/sdk/learning` starters](./docs/api/learning.md) ·
[eight runnable examples](./examples/learning/)

### Preflight: learned context without proxying

Calling your model provider directly? Ask the gateway first which model to use and which learned
context to inject, then insert it at the right position:

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();
const messages = [
  { role: 'system' as const, content: 'You answer customer questions.' },
  { role: 'user' as const, content: 'Where is order 4711?' },
];
const session = await ur.useLearned({ call_type: 'support-reply', messages });
const prompt = session.apply(messages); // send `prompt` to your provider
console.log(session.model, prompt.length);
```

[Preflight and learned context](./docs/preflight.md)

### Context runtime

`@ultrarouter/sdk/context` is a pure, network-free runtime for describing, compiling and auditing
the context of a model call. Lifting messages and turning them back round-trips byte for byte:

```ts
import { fromMessages, toMessages } from '@ultrarouter/sdk/context';

const messages = [
  { role: 'system' as const, content: 'You are a support assistant.' },
  { role: 'user' as const, content: 'Where is my order?' },
];
const lifted = fromMessages(messages);
console.log(lifted.labels.map((l) => l.kind));
console.log(JSON.stringify(toMessages(lifted.manifest)) === JSON.stringify(messages)); // true
```

[Context runtime](./docs/context-runtime.md)

### CLI and GitHub Action

The package ships the `ur` command for CI: Bench baseline-compare gates, application-CI checks with
a pull-request comment, outcome imports, and knowledge-pack validation. In a project where the
package is installed (from the tarball, above), run it with `npx ur`.

```bash
npx ur --help
npx ur bench run support-replies --capture "npm test" --gate --baseline bench:main --budget 5
npx ur outcomes import outcomes.jsonl
```

The GitHub Action installs from the registry and is not available until publication. The following
configuration is illustrative; use the locally built `ur` CLI in the meantime.

```yaml
# .github/workflows/bench.yml (excerpt)
- uses: lucastonon/ultrarouter-sdk-typescript@v0.0.1
  with:
    mode: bench
    suite: support-replies
    capture: npm test
    api-key: ${{ secrets.ULTRAROUTER_API_KEY }}
```

[CLI](./docs/cli.md) · [GitHub Action](./docs/github-action.md)

## Documentation

- [Docs index](./docs/README.md): every guide.
- [API reference](./docs/api/README.md): generated from the TSDoc of every export.
- [Examples](./examples/README.md): runnable programs for the main flows.
- [Changelog](./CHANGELOG.md) · [Contributing](./CONTRIBUTING.md) · [Security](./SECURITY.md)

## For AI agents

Read [`AGENTS.md`](./AGENTS.md) for canonical usage patterns, pitfalls and the contributor
commands. [`llms.txt`](./llms.txt) indexes the docs and [`llms-full.txt`](./llms-full.txt) holds
them in one file. All of these ship in the package (`node_modules/@ultrarouter/sdk/` once installed).

## License

[MIT](./LICENSE)
