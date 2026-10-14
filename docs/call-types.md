# Call types

A **call type** is a stable name for one kind of request your application makes, for example
`support-reply` or `invoice-triage`. The gateway groups traffic by call type, and each call type
carries its own configuration (model pin, routing, compression, fallbacks, provider preferences),
its eval history, its hosted prompt versions and its learning settings.

You attach a request to a call type with `call_type` (per call) or `defaults.callType` (per client).
Everything on this page lives under `ur.ur.callTypes` and needs an API key with the `config:read`
scope (reads) or `config:write` scope (writes).

- [Tag requests with a call type](#tag-requests-with-a-call-type)
- [Create, read and update](#create-read-and-update)
- [Configuration fields](#configuration-fields)
- [Evals and recommendations](#evals-and-recommendations)
- [Hosted prompts](#hosted-prompts)
- [Verified memory](#verified-memory)
- [Autopilot readiness](#autopilot-readiness)

## Tag requests with a call type

```ts
import UltraRouter from '@ultrarouter/sdk';

// Every call from this client is attributed to `support-reply` unless a call overrides it.
const ur = new UltraRouter({
  defaultModel: 'openai/gpt-5.2-mini',
  defaults: { callType: 'support-reply' },
});

const reply = await ur.chat.completions.create({
  messages: [{ role: 'user', content: 'Where is my order 4821?' }],
});
console.log(reply.ur.call_type, reply.ur.request_id);

// A per-call value wins over the client default.
const triage = await ur.chat.completions.create({
  call_type: 'invoice-triage',
  messages: [{ role: 'user', content: 'Is invoice 77 a duplicate?' }],
});
console.log(triage.ur.call_type);
```

Use a slug that names the _task_, not the model or the prompt version: the slug is what evals,
recommendations and learning are keyed on, so it should stay the same when you change models.

## Create, read and update

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();

// Create (needs `config:write`). The initial config is optional.
const created = await ur.ur.callTypes.create({
  slug: 'support-reply',
  config: { model_pin: 'openai/gpt-5.2-mini', fallbacks: ['anthropic/claude-sonnet-4.6'] },
});
console.log(created.id, created.current_config_version);

// Read one by slug or by `ct_*` id, or list them all.
const one = await ur.ur.callTypes.get('support-reply');
const all = await ur.ur.callTypes.list();
console.log(one.slug, all.data.length);

// Update = append a new immutable config version. Omitted fields keep their value; an explicit
// `null` clears a field.
const updated = await ur.ur.callTypes.update('support-reply', {
  compression_mode: 'semantic_safe',
});
console.log(updated.current_config_version, updated.config?.compression_mode);
```

Config versions are immutable: every `update` appends a version and repoints the call type to it, so
you can always tell which configuration served a request. The gateway picks up a change within one
config-cache window (a few seconds).

## Configuration fields

`CallTypeConfigBody` (sent to `create({ config })` and `update(id, config)`):

| Field                      | Type                                                                                                                              | Meaning                                                                                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `model_pin`                | `string \| null`                                                                                                                  | Pin a model for this call type. `null` clears the pin.                                                                                        |
| `router_mode`              | `'pinned' \| 'auto' \| 'candidates' \| 'off' \| null`                                                                             | How the router treats this call type.                                                                                                         |
| `compression_mode`         | `'off' \| 'semantic_safe' \| 'adaptive' \| null`                                                                                  | Compression tier. `off` (the default) never rewrites what the model sees. `lossless` / `auto` are deprecated legacy aliases that still parse. |
| `fallbacks`                | `string[] \| null`                                                                                                                | Ordered fallback model ids.                                                                                                                   |
| `provider_prefs`           | `object \| null`                                                                                                                  | Provider preferences (same shape as the per-request `provider`).                                                                              |
| `learned_context_delivery` | `'gateway_inject_after_stable_prefix' \| 'off'`                                                                                   | Whether the gateway injects learned context on proxied requests, or leaves it to callers using [`useLearned`](./preflight.md).                |
| `case_precedents_enabled`  | `boolean`                                                                                                                         | Serve per-request case precedents (verified past cases similar to the current input) into the learned slot. Default `false`.                  |
| `self_improve_mode`        | `'off' \| 'assist' \| 'autopilot'`                                                                                                | `off` records outcomes only; `assist` proposes tested improvements to your inbox; `autopilot` adopts passed improvements within guardrails.   |
| `self_improve_guardrails`  | `{ max_cost_per_success_micro_usd?: number \| null; surfaces?: ('knowledge_injection' \| 'model_routing' \| 'hosted_prompt')[] }` | The cost budget per successful task (integer micro-USD) and the surfaces autopilot may change.                                                |

The returned `CallType` carries the active `config` (a `CallTypeConfigVersion`), the
`current_config_version` number and the read-only lifecycle fields (`lifecycle_state`,
`lifecycle_reason`, `lifecycle_transitioned_at`). The lifecycle state is informational: it never
changes how a request is served by itself.

## Evals and recommendations

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();

// Trigger an eval run. `mode: 'task'` evaluates whole traces instead of single requests.
const trigger = await ur.ur.callTypes.enqueueEval('support-reply', { mode: 'request' });
if (trigger.enqueued) {
  console.log('enqueued run', trigger.run_id, 'candidates:', trigger.candidate_count);
} else {
  // A documented no-op, e.g. `no_golden_set`, `no_candidates` or `deduped`.
  console.log('not enqueued:', trigger.reason, trigger.prior_run_id ?? '');
}

// Every run with its candidates and the immutable run spec it executed.
const runs = await ur.ur.callTypes.listEvals('support-reply');
for (const run of runs.data) {
  console.log(
    run.id,
    run.status,
    run.candidates.map((c) => `${c.model}:${String(c.passed)}`),
  );
}

// The eval-backed model recommendations for the call type.
const recommendations = await ur.ur.callTypes.recommendations('support-reply');
console.log(Object.keys(recommendations));
```

`enqueueEval` resolves to one of two shapes, discriminated by `enqueued`:

| `enqueued` | Fields                                                            | Meaning                                                                                      |
| ---------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `true`     | `run_id`, `candidate_count`                                       | A run was queued.                                                                            |
| `false`    | `reason`, `deduped`, optional `prior_run_id`, `trigger`, `status` | Nothing new was queued. A deduplicated trigger names the run it joined so you can follow it. |

The recommendations route does not publish a response schema yet, so `recommendations()` returns
an open object (`Record<string, unknown>`). Inspect it rather than relying on fixed fields.

## Hosted prompts

A hosted prompt moves a call type's system prompt out of your code and into versioned, immutable
gateway records. Versions are created inactive; activating one makes it the call type's prompt, and
activating an older version is the rollback.

```ts
import UltraRouter, { renderPrompt } from '@ultrarouter/sdk';

const ur = new UltraRouter();

// 1. Create a version (inactive until activated).
const v = await ur.ur.callTypes.prompts.create('support-reply', {
  template: 'You are a support assistant for {{brand}}. Answer in {{language}}.',
  variables: [
    { name: 'brand', required: true },
    { name: 'language', required: false },
  ],
});
console.log('created version', v.version, v.content_sha256);

// 2. Activate it. With `gateway_apply: true` the gateway renders the template and sends it as the
//    leading system instruction on proxied requests; with `false` you fetch and render it yourself.
const pointer = await ur.ur.callTypes.prompts.activate('support-reply', v.version, {
  gateway_apply: false,
});
console.log('active version', pointer.active_version, 'config version', pointer.config_version);

// 3. Render it client-side with the same fail-closed rule the gateway applies.
const active = await ur.getPrompt('support-reply');
const template = active ?? {
  template: v.template,
  variables: v.variables.map((x) => ({ name: x.name, required: x.required ?? false })),
};
console.log(renderPrompt(template, { brand: 'Acme' }));

// List every version, read one, or go back to the code-owned prompt.
const versions = await ur.ur.callTypes.prompts.list('support-reply');
console.log(versions.data.length, versions.active_version);
await ur.ur.callTypes.prompts.deactivate('support-reply');
```

| Method                                           | Route                                                 | Notes                                                                                                                                                                |
| ------------------------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prompts.list(callTypeId)`                       | `GET /v1/call-types/{id}/prompts`                     | Every version plus `active_version` and `gateway_apply`.                                                                                                             |
| `prompts.create(callTypeId, params)`             | `POST /v1/call-types/{id}/prompts`                    | `{ template, variables? }`. Creates an inactive version.                                                                                                             |
| `prompts.get(callTypeId, version)`               | `GET /v1/call-types/{id}/prompts/{version}`           | One immutable version.                                                                                                                                               |
| `prompts.activate(callTypeId, version, params?)` | `POST /v1/call-types/{id}/prompts/{version}/activate` | `{ gateway_apply?: boolean }`. Writes a new config version.                                                                                                          |
| `prompts.deactivate(callTypeId)`                 | `POST /v1/call-types/{id}/prompts/deactivate`         | Back to the code-owned prompt (your messages pass through untouched).                                                                                                |
| `prompts.proposal(callTypeId)`                   | `GET /v1/call-types/{id}/prompts/proposal`            | A suggested first version derived from consented captured traffic, or `available: false` with a named `reason`. Nothing is applied until you create and activate it. |

When the gateway applies a hosted prompt (`gateway_apply: true`), pass the variable values per
request in `ur.prompt_vars`. A missing required variable is refused before dispatch with the
`prompt_variables_missing` error; it is never replaced by an empty string.

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter({ defaultModel: 'openai/gpt-5.2-mini' });
const res = await ur.chat.completions.create({
  call_type: 'support-reply',
  messages: [{ role: 'user', content: 'Where is my order?' }],
  ur: { prompt_vars: { brand: 'Acme', language: 'English' } },
});
console.log(res.choices[0]?.message.content);
```

See [Preflight and learned context](./preflight.md#hosted-prompts-rendered-client-side) for
`getPrompt` and `renderPrompt` in detail.

## Verified memory

Verified memory lets the gateway answer a request directly from the call type's verified past
outcomes, without calling a model, when a calibrated similarity rule says it is safe. It applies only
to label-style call types (one instruction plus one text user turn) and only to requests whose
meaning the stored answer captures; every other request reaches the model as usual. An answered
request carries `ur.verified_memory` in its response and `ur.routing.engine === 'verified_memory'`.

Enabling it requires an authorisation on your workspace that ultrarouter grants; without it
`enable` fails with a `permission` error. Disabling is always allowed and is the kill switch.

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();

const status = await ur.ur.callTypes.verifiedMemory.get('ticket-classifier');
console.log(
  'enabled:',
  status.enabled,
  'servable:',
  status.servable?.ok,
  status.servable?.reason ?? '',
);

// Calibrates against the declared precision target and enables only if an operating point clears it.
const enabled = await ur.ur.callTypes.verifiedMemory.enable('ticket-classifier', {
  target_precision: 0.97,
});
console.log('enabled:', enabled.enabled, enabled.reason ?? '');

// The kill switch: every request reaches the model again within one config-cache window.
const disabled = await ur.ur.callTypes.verifiedMemory.disable('ticket-classifier');
console.log('changed:', disabled.changed);
```

| Method                                      | Result                                                                                                                                                                                                                       |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get(callTypeId)`                           | `enabled`, the frozen `setting`, `servable` (`{ ok, reason }`, or `null` when nothing is enabled), the live pool status and `post_pin` accounting (answered / correct / wrong / unknown).                                    |
| `enable(callTypeId, { target_precision? })` | `enabled: true` with the frozen setting, or `enabled: false` with a named `reason` (for example `pool_empty` or `calibration_below_target`) and nothing written. `target_precision` is between 0.8 and 0.999 (default 0.95). |
| `disable(callTypeId)`                       | Appends a config version with memory off. `changed: false` when it was already off (idempotent).                                                                                                                             |

The calibration figures are an in-sample read of the chosen operating point, not an independent
precision guarantee; `post_pin` reports what happened after enabling.

## Autopilot readiness

`ur.ur.autopilot.status()` reads the read-only readiness rollup (`GET /v1/audit/readiness`): the call
types the gateway inferred, their lifecycle state, evidence gaps and what each one needs next. It never
changes how anything is served.

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter({ autopilot: 'audit' });
const readiness = await ur.ur.autopilot.status();
console.log(ur.ur.autopilot.mode, readiness.state, readiness.total_requests);
for (const ct of readiness.call_types) {
  console.log(ct.slug, ct.lifecycle_state, ct.evidence_gaps.join(', '));
}
```

The `autopilot` client option (`audit`, `recommend`, `auto`) is described in
[Configuration](./configuration.md).

## Pitfalls

- **Renaming a slug starts a new history.** Evals, recommendations and learning are keyed on the call
  type; keep slugs stable across model and prompt changes.
- **`update` is a partial update.** Send only the fields you want to change; `null` clears a field.
- **Activation is not instant everywhere.** A config change becomes visible to the gateway within one
  config-cache window (a few seconds), not mid-request.
- **Hosted prompt variables fail closed.** A required variable that is missing is an error, never a
  blank.

## Related

- [Preflight and learned context](./preflight.md) — `getPrompt`, `renderPrompt`, `useLearned`
- [Feedback, generation stats and key info](./feedback-and-generation.md)
- [Outcomes and artifacts](./outcomes.md)
- [Bench](./bench.md) — evaluate a call type against a pinned baseline in CI
- API reference: [`CallTypesResource`](./api/sdk.md#calltypesresource),
  [`HostedPromptsResource`](./api/sdk.md#hostedpromptsresource),
  [`VerifiedMemoryResource`](./api/sdk.md#verifiedmemoryresource)
