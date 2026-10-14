# Context runtime (`@ultrarouter/sdk/context`)

`@ultrarouter/sdk/context` is a pure library for describing and assembling the context a model call
is built from. Instead of concatenating strings, you describe each piece of context as a typed,
versioned, content-hashed **module**, state what a stage of your application requires in a
**contract**, and **compile**: the result is a **manifest** that records what was admitted, in which
order and slot, and what was refused and why.

It runs anywhere and needs nothing else: no network, no service, no clock, no randomness. The only host
primitive it uses is sha256 from `node:crypto` (Node.js, Bun and Deno provide it). Its one dependency,
`zod`, is bundled into this entry, so the package keeps zero runtime dependencies. Importing the client
(`@ultrarouter/sdk`) never loads this entry, and this entry never needs the client.

You can adopt it in one file and leave in one file: `toMessages(fromMessages(messages))` gives back
exactly the messages you started with.

- [Lift existing messages](#lift-existing-messages)
- [Modules, envelopes and contracts](#modules-envelopes-and-contracts)
- [Compile](#compile)
- [Render and the exit guarantee](#render-and-the-exit-guarantee)
- [Send a declared manifest with a request](#send-a-declared-manifest-with-a-request)
- [Profiles](#profiles)
- [Lint prompt surfaces](#lint-prompt-surfaces)
- [Knowledge packs](#knowledge-packs)
- [Native delivery and SOPs](#native-delivery-and-sops)

## Lift existing messages

`fromMessages(messages)` labels an existing OpenAI-style message array with the same segmenter the
gateway uses, and returns a manifest that can rebuild the input byte for byte.

```ts
import { fromMessages, toMessages } from '@ultrarouter/sdk/context';

const messages = [
  { role: 'system' as const, content: 'You are a support assistant for Acme.' },
  { role: 'user' as const, content: 'Context: refunds are accepted within 30 days of delivery.' },
  { role: 'user' as const, content: 'Can I return a kettle I bought 3 weeks ago?' },
];

const lifted = fromMessages(messages);
for (const label of lifted.labels) {
  console.log(label.messageIndex, label.kind, label.eligible ? 'compressible' : 'protected');
}
console.log(
  'entries:',
  lifted.manifest.entries.length,
  'hash:',
  lifted.manifest.manifestHash.slice(0, 12),
);

// The exit guarantee: the original messages, byte for byte.
const back = toMessages(lifted.manifest);
console.log(JSON.stringify(back) === JSON.stringify(messages)); // true
```

Segment kinds are `system_instructions`, `user_question`, `reference_context`, `few_shot_examples`,
`tool_schemas`, `tool_results`, `history` and `output_contract`. Pass `ur.segments`-style hints as the
second argument to label messages yourself.

## Modules, envelopes and contracts

| Concept    | What it is                                                                                                                                                                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Module`   | One unit of context: `id`, `version`, `kind`, `memoryClass`, `trustClass`, `privacyClass`, `availability`, `contentHash`, `tokenEstimate`, `facets`, optional `slotHint` and `ext`. The body is not part of it: modules are identified by hash. |
| `Envelope` | The identity of one execution: `id`, `tenant`, `stage`, `mode`, `asOf` (the knowledge cutoff availability is judged against), `cutoffs`, `budgets`, `seed`, `pins`, `releases`, `permissionEpoch`. `sealEnvelope` freezes and hashes it.        |
| `Contract` | What one stage needs: `requiredKinds` (covered by envelope pins), `optionalKinds`, `forbiddenKinds`, `budgets`, `limits`, `pinPolicy` (`strict` or `none`) and the `slots`.                                                                     |
| `Manifest` | The compile result: admitted `entries` in order (each with its `slot`), every `refused` item with a reason, `budgets`, and the `envelopeHash`, `scaffoldHash` and `manifestHash`.                                                               |

Trust classes are `authoritative`, `approved_derived` and `untrusted`. Only `trustClass` has meaning for
the compiler: an `untrusted` module is never admitted into the instruction slot. Memory classes
(`working`, `episodic`, `semantic`, `procedural`, extensible with `defineMemoryClasses`) and kinds are
labels the compiler carries and orders by. Each concept has a zod schema (`ModuleSchema`,
`EnvelopeSchema`, `ContractSchema`, `ManifestSchema`) for validating untrusted input.

## Compile

```ts
import {
  compile,
  ULTRAROUTER_PROFILE,
  type Contract,
  type Envelope,
  type Module,
} from '@ultrarouter/sdk/context';

const envelope: Envelope = {
  id: 'run-1',
  tenant: 'acme',
  stage: 'answer',
  mode: 'live',
  asOf: '2026-06-01T00:00:00.000Z',
  cutoffs: {},
  budgets: { tokens: 300 },
  seed: 'run-1',
  // A required kind is covered by pinning an exact module (id + kind + content hash).
  pins: [
    {
      id: 'refund-policy',
      kind: 'policy',
      contentHash: 'sha256:refund-policy-v1',
      purpose: 'refund rules',
    },
  ],
  releases: {},
  permissionEpoch: 'epoch-1',
};

const contract: Contract = {
  stage: 'answer',
  requiredKinds: ['policy'],
  optionalKinds: ['faq', 'history'],
  forbiddenKinds: ['scratchpad'],
  budgets: { tokens: 300 },
  limits: [],
  pinPolicy: 'strict',
  slots: ['instruction', 'reference'],
};

const mod = (
  id: string,
  kind: string,
  memoryClass: string,
  trustClass: Module['trustClass'],
  tokens: number,
): Module => ({
  id,
  version: '1',
  kind,
  memoryClass,
  trustClass,
  privacyClass: 'internal',
  availability: { from: '2026-01-01T00:00:00.000Z', to: null },
  contentHash: `sha256:${id}-v1`,
  tokenEstimate: tokens,
  facets: {},
});

const result = compile(
  envelope,
  contract,
  [
    { module: mod('refund-policy', 'policy', 'procedural', 'authoritative', 120) },
    { module: mod('shipping-faq', 'faq', 'semantic', 'approved_derived', 90), slot: 'reference' },
    { module: mod('old-thread', 'history', 'episodic', 'untrusted', 200) }, // does not fit the budget
    { module: mod('notes', 'scratchpad', 'working', 'approved_derived', 10) }, // a forbidden kind
  ],
  ULTRAROUTER_PROFILE,
);

console.log('ok:', result.ok);
for (const e of result.manifest?.entries ?? [])
  console.log('admitted', e.order, e.moduleId, e.slot, e.mandatory ? '(pinned)' : '');
for (const r of result.refusals)
  console.log('refused', r.moduleId, r.reason, r.fatal ? '(fatal)' : '');
```

Required kinds are covered by **pins**: with `pinPolicy: 'strict'`, every `envelope.pins` entry must
resolve to a candidate with exactly that id, kind and content hash, and the pinned modules are admitted
as mandatory (never shed). Optional kinds are admitted within the budget and limits. With
`pinPolicy: 'none'`, use `optionalKinds` only.

The compiler applies the same generic steps for every profile: stage and planner bounds, pins (by exact
id, kind and hash), required kinds, availability against `asOf`, forbidden kinds, release binding,
trust slotting, limits, budget admission (whole modules are shed, never truncated) and ordering. Each
refusal has a stable `reason` from `CONTEXT_REFUSAL_REASONS`: `STAGE_CONTRACT_MISMATCH`,
`PLANNER_BOUND_EXCEEDED`, `PINNED_CONTEXT_NOT_REQUESTED`, `REQUIRED_CONTEXT_NOT_PINNED`,
`PINNED_CONTEXT_MISMATCH`, `REQUIRED_CONTEXT_MISSING`, `AUTHORITATIVE_CONTEXT_UNTRUSTED`,
`POLICY_RELEASE_MISMATCH`, `FORBIDDEN_KIND`, `BUDGET_EXCEEDED`, `UNTRUSTED_IN_INSTRUCTION_SLOT`,
`AVAILABILITY_REFUSED`, `LIMIT_EXCEEDED`. A fatal refusal (for example a missing required kind) makes
the whole run inadmissible: `ok: false` and `manifest: null`.

Compilation is deterministic: the same inputs always give the same `manifestHash`.

## Render and the exit guarantee

`render(manifest, bodies)` turns a compiled manifest plus the bodies you hold (a `Map` from module id to
text) into chat messages, using the profile's serializer. `toMessages(manifest)` is the exit: for a
lifted manifest it rebuilds the original messages exactly; for a compiled manifest it renders the bodies
you pass. A manifest with neither throws `ContextExitError`.

```ts
import { compile, render, ULTRAROUTER_PROFILE, type Module } from '@ultrarouter/sdk/context';

const policy: Module = {
  id: 'refund-policy',
  version: '3',
  kind: 'policy',
  memoryClass: 'procedural',
  trustClass: 'authoritative',
  privacyClass: 'internal',
  availability: { from: '2026-01-01T00:00:00.000Z', to: null },
  contentHash: 'sha256:refund-policy-v3',
  tokenEstimate: 20,
  facets: {},
};
const result = compile(
  {
    id: 'r',
    tenant: 't',
    stage: 's',
    mode: 'live',
    asOf: '2026-06-01T00:00:00.000Z',
    cutoffs: {},
    budgets: {},
    seed: 'x',
    pins: [],
    releases: {},
    permissionEpoch: 'e',
  },
  {
    stage: 's',
    requiredKinds: [],
    optionalKinds: ['policy'],
    forbiddenKinds: [],
    budgets: {},
    limits: [],
    pinPolicy: 'none',
    slots: ['instruction'],
  },
  [{ module: policy }],
  ULTRAROUTER_PROFILE,
);
if (result.manifest !== null) {
  const bodies = new Map([['refund-policy', 'Refunds are accepted within 30 days of delivery.']]);
  console.log(render(result.manifest, bodies));
}
```

## Send a declared manifest with a request

`toWire(manifest)` converts a manifest to the `ur.manifest` request field: hashes, ranges and labels
only, never bodies. Send it with the exact messages it describes; the gateway verifies every entry hash
against the bytes it receives before doing anything else, and refuses a mismatch with
`manifest_mismatch` (or `manifest_invalid` for a malformed manifest). Declared kinds also drive which
parts compression may touch.

```ts
import UltraRouter from '@ultrarouter/sdk';
import { fromMessages, toWire } from '@ultrarouter/sdk/context';

const ur = new UltraRouter({ defaultModel: 'openai/gpt-5.2-mini' });
const messages = [
  { role: 'system' as const, content: 'You are a support assistant.' },
  { role: 'user' as const, content: 'Where is my order?' },
];

const { manifest } = fromMessages(messages);
const res = await ur.chat.completions.create({ messages, ur: { manifest: toWire(manifest) } });
console.log(res.choices[0]?.message.content);
```

The gateway witnesses a declared manifest; it never authors or reorders context for you.

## Profiles

A `CompatibilityProfile` parameterizes the compiler: the ordering rule (`selection` keeps candidate
order; `volatility` puts stable context first so provider prompt caches stay warm), the vocabularies
(`defineMemoryClasses`, `defineKinds`, `defineRefusals`), extra limits, the budget strategy, the
render serializer and the manifest encoder. Optional rules include `authoritativeKinds` (kinds whose
module must be `authoritative`), a `releaseBinding`, an `availability` policy, `defaultKindLimit` and
`resultCeiling`.

`ULTRAROUTER_PROFILE` is the default: volatility ordering, an open kind vocabulary, a token budget
taken from the contract (else the envelope), and the ultrarouter manifest encoding. Derive your own by
spreading it:

```ts
import { compile, ULTRAROUTER_PROFILE, type CompatibilityProfile } from '@ultrarouter/sdk/context';

const strict: CompatibilityProfile = {
  ...ULTRAROUTER_PROFILE,
  name: 'acme-strict',
  orderRule: 'selection',
  authoritativeKinds: ['policy'],
  availability: { refuseUndated: true },
};

const result = compile(
  {
    id: 'r',
    tenant: 't',
    stage: 's',
    mode: 'live',
    asOf: '2026-06-01T00:00:00.000Z',
    cutoffs: {},
    budgets: {},
    seed: 'x',
    pins: [],
    releases: {},
    permissionEpoch: 'e',
  },
  {
    stage: 's',
    requiredKinds: [],
    optionalKinds: ['policy'],
    forbiddenKinds: [],
    budgets: {},
    limits: [],
    pinPolicy: 'none',
    slots: ['instruction', 'reference'],
  },
  [
    {
      module: {
        id: 'draft-policy',
        version: '1',
        kind: 'policy',
        memoryClass: 'procedural',
        trustClass: 'approved_derived',
        privacyClass: 'internal',
        availability: { from: null, to: null },
        contentHash: 'sha256:draft',
        tokenEstimate: 10,
        facets: {},
      },
    },
  ],
  strict,
);
console.log(result.refusals.map((r) => r.reason)); // why the draft policy was not admitted
```

## Lint prompt surfaces

`lintPromptSurface({ path, contents })` (and `lintPromptSurfaces` for many files) scans source text for
three patterns and returns advisory findings; it never modifies anything:

| Rule                      | Flags                                                                            |
| ------------------------- | -------------------------------------------------------------------------------- |
| `oversized_prompt`        | An inline prompt larger than `maxPromptTokens` (default 2,000 estimated tokens). |
| `untrusted_interpolation` | Untrusted-looking values interpolated into an instruction string.                |
| `inline_exemplars`        | Inline few-shot blocks that belong in exemplar modules.                          |

```ts
import { lintPromptSurface } from '@ultrarouter/sdk/context';

const source = [
  'const system = `You are a helpful assistant. Always answer using: ${userInput}`;',
  'export default system;',
].join('\n');

for (const f of lintPromptSurface({ path: 'prompt.ts', contents: source })) {
  console.log(`${f.severity} line ${f.line} [${f.rule}] ${f.message}`);
}
```

The same scanner is available from the command line as `ur context lint <path…>` (see
[the CLI guide](./cli.md)).

## Knowledge packs

A **knowledge pack** (`*.ur.md`, format `ur.knowledge/1`) is a signed, portable file holding learned
or authored knowledge: a checklist, exemplars, base rates, refuted assertions, or an SOP. It has YAML
frontmatter (identity, trust, slot, `applies_when`, validity, evidence, lineage, consent) followed by
the body sections, and two hashes: `content_hash` (the join key) and `provenance_hash`. You can keep
packs in your repository, review them in pull requests and load them with no service running.

```ts
import { readFileSync } from 'node:fs';
import { LoadPackError, loadPack } from '@ultrarouter/sdk/context';

const text = readFileSync('knowledge/release-checklist.ur.md', 'utf8');

try {
  // Parse, recompute both hashes, check the trust and slot rules, the tenant and export consent.
  const { document, module } = loadPack(text, {
    workspace: 'ws_fixture',
    requireExportConsent: true,
  });
  console.log(document.id, document.kind, document.body.checklist.length, 'checklist items');
  console.log(module.id, module.contentHash === document.contentHash); // a context Module, ready to compile
} catch (err) {
  if (err instanceof LoadPackError) console.log('refused:', err.refusals.join(', '));
  else throw err;
}
```

| Function                                           | What it does                                                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `loadPack(text, ctx?)`                             | Parse and validate, failing closed (`LoadPackError` lists every refusal); returns `{ document, module }`. |
| `parsePack(text)`                                  | Structural parse only (throws `PackRefusedError` on a malformed document).                                |
| `validatePack(doc, ctx?)`                          | Every refusal as data: `{ ok: true, document }` or `{ ok: false, refusals }`.                             |
| `renderPack(doc)`                                  | The canonical text. `renderPack(parsePack(text)) === text` for a valid pack.                              |
| `packContentHash(doc)` / `packProvenanceHash(doc)` | Recompute the hashes (to sign a pack you built).                                                          |

Refusal codes include `CONTENT_HASH_MISMATCH`, `PROVENANCE_HASH_MISMATCH`, `TENANT_MISMATCH`,
`EXPORT_CONSENT_REVOKED`, `UNTRUSTED_IN_INSTRUCTION_SLOT` and `LEARNED_MUST_BE_APPROVED_DERIVED`. A
hand-edited pack fails its hash check: edit the source and re-render instead. In CI,
`ur pack validate <file> [--workspace <id>] [--require-export-consent]` runs the same checks and exits
0 (valid) or 2 (refused).

## Native delivery and SOPs

Two more layers ship in the same entry; their full API is in the [reference](./api/context.md).

- **Native delivery** plans how admitted context can be delivered through a provider's own context
  features rather than as plain messages (`planNativeDelivery`, `NATIVE_FEATURES`,
  `NATIVE_COMPATIBILITY`, `findNativeCompatibility`). When no native channel fits, it falls back to
  rendering the context inline and records why (`NATIVE_FALLBACK_REASONS`).
- **SOPs** (standard operating procedures) compile a reviewed procedure into an immutable executable
  spec (`compileSop`): phases with allowed actions, required policies, budgets and stop conditions, a
  dependency closure and a typed transition graph. Unreviewed prose never compiles:

```ts
import { compileSop } from '@ultrarouter/sdk/context';

const hash = (c: string) => c.repeat(64);
const result = compileSop({
  draft: {
    id: 'refund-sop',
    version: '1',
    proseHash: hash('a'),
    inputSchemaHash: hash('b'),
    outputSchemaHash: hash('c'),
    applicability: { type: 'artifact_present', contract: 'refund_request' },
    phases: [],
    transitions: [],
    dependencies: [],
  },
  review: null, // no review: refused
});
console.log(result.ok ? 'compiled' : result.refusals.map((r) => r.code));
```

## Related

- [Preflight and learned context](./preflight.md) — the placement rule and `useLearned`
- [Chat completions](./chat-completions.md) — the `ur` request extension, including `ur.segments`
- [CLI](./cli.md) — `ur context lint`, `ur pack validate`
- API reference: [`@ultrarouter/sdk/context`](./api/context.md)
