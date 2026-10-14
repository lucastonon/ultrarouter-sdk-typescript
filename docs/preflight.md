# Preflight and learned context

Not every call goes through the gateway. If your application calls a model provider directly, it can
still use what ultrarouter knows by asking **before** the call:

- which model and fallbacks to use for this call type,
- which learned context to add to the prompt, and where,
- the active hosted prompt, if the call type has one,
- and, with a cluster key, an **exposure grant**: the experiment arm this unit of work belongs to, which
  you quote when you later record its outcome.

That is `preflight()`. `useLearned()` wraps it for the common case, and `getPrompt()` / `renderPrompt()`
cover hosted prompts. Preflight needs only the `gateway:invoke` scope.

- [Preflight](#preflight)
- [Per-request case modules need `messages`](#per-request-case-modules-need-messages)
- [Caching](#caching)
- [`useLearned`: apply and record](#uselearned-apply-and-record)
- [Hosted prompts rendered client-side](#hosted-prompts-rendered-client-side)
- [The placement rule](#the-placement-rule)

## Preflight

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();

const advice = await ur.preflight({
  call_type: 'support-reply',
  artifact_key: 'ticket-4821', // a cluster key: ask for an exposure grant
  budget: { max_usd: 2, max_latency_ms: 4000 }, // optional ceilings for the recommended offer
});

console.log(
  'model:',
  advice.routing.model?.id,
  'fallbacks:',
  advice.routing.fallbacks.map((f) => f.id),
);
console.log('provisional:', advice.provisional, advice.reason ?? '');
if (advice.knowledge !== null) {
  console.log('inject', advice.knowledge.module.tokens, 'tokens', advice.knowledge.placement);
} else {
  console.log('no learned context:', advice.knowledge_reason);
}
console.log('grant:', advice.grant?.arm ?? advice.grant_reason);
```

| Request field  | Meaning                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| `call_type`    | The call type (slug or `ct_*` id). Required.                                                                        |
| `artifact_key` | A cluster key: the artifact this call contributes to. Supply it (or `trace_id`) to receive a grant.                 |
| `trace_id`     | An alternative cluster key.                                                                                         |
| `budget`       | `{ max_usd?, max_latency_ms? }`: ceilings on the recommended offer's input price per 1M tokens and its p95 latency. |
| `messages`     | The messages you are about to send. Needed for per-request case modules (below).                                    |

| Response field     | Meaning                                                                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `routing`          | `mode`, the recommended `model` (`id`, `evidence`), health-ordered `fallbacks`, `why`, `max_age_s`.                                                   |
| `knowledge`        | The learned module to inject (`module.content`, `module.tokens`, …), its `placement` (`after_stable_prefix`) and `delivery`; or `null`.               |
| `knowledge_reason` | Why `knowledge` is `null`, by name: for example `holdout`, `no_learned_module`, `case_query_missing`, `fell_back`.                                    |
| `prompt`           | The active hosted prompt (`version`, `template`, `variables`, `sha256`), or `null` when code-owned.                                                   |
| `grant`            | The exposure grant (`grant_id`, `arm`, `epoch`, …) when a cluster key was given; otherwise `null` with `grant_reason` (for example `no_cluster_key`). |
| `provisional`      | `true` when the advice is not yet backed by confirmed evidence; `reason` says why.                                                                    |

Preflight is advisory. You decide what to call; nothing is proxied and no tokens are sent to the
gateway. When the grant's arm is a holdout, `knowledge` is `null` (`knowledge_reason: 'holdout'`) so
that the comparison stays fair: send the request without learned context.

## Per-request case modules need `messages`

Some call types (classification-style tasks) learn verified **cases** rather than a fixed list: for
each request, the gateway renders the verified cases nearest that request's input (its last user
message). A caller that calls its provider directly must therefore send the messages it is about to
use. Without them, such a call type answers `knowledge: null` with
`knowledge_reason: 'case_query_missing'`. A call type with a static module ignores `messages`.

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();
const messages = [
  { role: 'system' as const, content: 'Classify the invoice: duplicate, new or needs_review.' },
  { role: 'user' as const, content: 'Invoice 77 from Acme, 1,200 USD, same PO as invoice 75.' },
];

const without = await ur.preflight({ call_type: 'invoice-triage' });
console.log(without.knowledge_reason); // 'case_query_missing' for a case module

const withMessages = await ur.preflight({ call_type: 'invoice-triage', messages });
console.log(withMessages.knowledge?.module.content);
```

The messages are used only to render the cases for this response. The SDK includes a digest of
`messages` (never the text) in its cache key, so a different input never reuses another input's cases.

## Caching

The client caches preflight answers per request identity (call type, cluster key, budget and a digest
of `messages`), honouring the gateway's two lifetimes:

| Part                                                        | Lifetime                                                 | How it refreshes                                                              |
| ----------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Config-versioned (model pin, learned module, hosted prompt) | `Cache-Control: private, max-age=5` plus a strong `ETag` | Revalidated with `If-None-Match`; a `304` reuses the cached body.             |
| Live (health-ordered fallbacks)                             | `X-UR-Live-Max-Age` / `routing.max_age_s` (30 seconds)   | Refetched in full when it expires.                                            |
| Grant                                                       | Never cached                                             | Read fresh from the `X-UR-Grant` header on every response, including a `304`. |

Within the config window and without a cluster key, a repeat call is served from memory with no
network request. With a cluster key every call goes to the network, because each unit of work needs
its own fresh grant. Per-call options:

| Option    | Effect                                                 |
| --------- | ------------------------------------------------------ |
| `noCache` | Always fetch; never read or write the cache.           |
| `maxAgeS` | Override the live-part window (seconds).               |
| `now`     | Inject a clock (milliseconds) for deterministic tests. |

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();
const first = await ur.preflight({ call_type: 'support-reply' });
const cached = await ur.preflight({ call_type: 'support-reply' }); // served from memory
const fresh = await ur.preflight({ call_type: 'support-reply' }, { noCache: true });
console.log(first.config_version, cached.config_version, fresh.config_version);
```

The cache is **bounded**: it keeps at most 1000 request identities (least recently used out first)
and sweeps out entries whose live window has passed, so a long-lived client that sees a new trace,
artifact or message on every call does not grow without limit. Change the bound with the client
option `preflightCache: { maxEntries }`; `maxEntries: 0` turns the cache off.

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter({ preflightCache: { maxEntries: 200 } });
const advice = await ur.preflight({ call_type: 'support-reply' });
console.log(advice.config_version);
```

The pure helpers behind this (`decidePreflightCache`, `preflightCacheKey`, `withHeaderGrant`,
`PreflightCache`, …) are exported for callers that keep their own cache.

## `useLearned`: apply and record

`useLearned(params)` preflights once and returns a session with the two actions a direct caller needs:

- `apply(messages)` inserts the learned module at the cache-safe position (right after the leading
  system messages) and returns a new array. With no module (a holdout, or nothing learned yet) the
  messages pass through unchanged.
- `record(outcome)` records an outcome on the artifact named by `artifact_key`, **quoting the grant**:
  it upserts the artifact with `grant_id` and `attestation: 'applied'`, then queues the outcome
  through the durable outcome queue. That is how a call that never went through the gateway is still
  counted in the right arm.

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();
const messages = [
  { role: 'system' as const, content: 'You are a support assistant.' },
  { role: 'user' as const, content: 'My parcel arrived damaged. What now?' },
];

const session = await ur.useLearned({
  call_type: 'support-reply',
  artifact_key: 'ticket-4821',
  messages,
});
const prompt = session.apply(messages);
console.log('send to', session.model, 'with', prompt.length, 'messages; arm:', session.grant?.arm);

// … call your provider with `prompt`, then record what happened:
const receipt = await session.record({ channel: 'behavioral', kind: 'accepted' });
console.log(receipt.status);
```

`apply` always injects the returned module, whatever the call type's `learned_context_delivery`
setting says: that setting controls the gateway on proxied requests, and on this path the gateway never
sees the request. `record` throws an `invalid_request` error when the preflight had no `artifact_key`.
`LearnedRecordOptions` lets you set the artifact `archetype` (default `answer`) and per-call request
options.

## Hosted prompts rendered client-side

When a call type has an active [hosted prompt](./call-types.md#hosted-prompts), `getPrompt(callType)`
returns it (`{ version, template, variables, sha256 }`), or `null` when the call type is code-owned.
It reuses the preflight cache. `renderPrompt(prompt, vars)` substitutes `{{name}}` slots with the same
fail-closed rule the gateway applies: a missing **required** variable throws
`PromptVariablesMissingError` listing the names; a missing optional variable renders as an empty
string.

```ts
import UltraRouter, {
  PromptVariablesMissingError,
  renderPrompt,
  type RenderablePrompt,
} from '@ultrarouter/sdk';

const ur = new UltraRouter();

const hosted = await ur.getPrompt('support-reply');
const prompt: RenderablePrompt = hosted ?? {
  template: 'You are a support assistant for {{brand}}. Answer in {{language}}.',
  variables: [
    { name: 'brand', required: true },
    { name: 'language', required: false },
  ],
};

console.log(renderPrompt(prompt, { brand: 'Acme', language: 'English' }));

try {
  renderPrompt(prompt, { language: 'English' });
} catch (err) {
  if (err instanceof PromptVariablesMissingError) console.log('missing:', err.missing.join(', '));
}
```

`renderHostedPromptResult({ template, variables, vars })` is the non-throwing form: it returns
`{ ok: true, text }` or `{ ok: false, missing }`. Both are also exported from
`@ultrarouter/sdk/context`, so you can render without constructing a client.

## The placement rule

`learnedPlacementIndex(messages)` returns the index the learned module goes to: right after the leading
run of `system` messages (index 0 when there is none). Inserting there keeps the provider's stable
prompt prefix byte-identical, so prompt caching keeps working. `applyLearnedContext(messages, content)`
performs the insertion as a `user` message and never mutates its input.

```ts
import { applyLearnedContext, learnedPlacementIndex } from '@ultrarouter/sdk/context';

const messages = [
  { role: 'system', content: 'Rules.' },
  { role: 'system', content: 'More rules.' },
  { role: 'user', content: 'Question?' },
];
console.log(learnedPlacementIndex(messages)); // 2
console.log(
  applyLearnedContext(messages, 'Learned: prefer the refund policy v3.').map((m) => m.role),
);
// [ 'system', 'system', 'user', 'user' ]
```

## Pitfalls

- **Send `messages` for case modules**, and send the same messages you then `apply` to.
- **Use a cluster key per unit of work** (`artifact_key` or `trace_id`) when you want a grant; a grant
  belongs to that one unit.
- **Do not cache grants yourself.** Each response's grant is current; the SDK reads it fresh every time.
- **A holdout returns no knowledge on purpose.** Do not substitute your own learned context for it.

## Related

- [Call types](./call-types.md) — `learned_context_delivery`, hosted prompt versions
- [Outcomes and artifacts](./outcomes.md) — the queue `record` uses
- [Context runtime](./context-runtime.md) — the pure `@ultrarouter/sdk/context` entry
- API reference: [`UltraRouter.preflight`](./api/sdk.md#ultrarouter), [`LearnedSession`](./api/sdk.md#learnedsession),
  [`renderPrompt`](./api/sdk.md#renderprompt)
