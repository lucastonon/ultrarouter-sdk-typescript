# History imports

You do not have to route traffic through the gateway before ultrarouter can see it. A **history
import** uploads what you already have, so reads such as [improvement reads](./learning.md#improvement-reads)
have data from the first day:

- a **usage-only** export (per-model request and token summaries, spend), or
- **intact traces** (request, response, when it happened, and optionally an outcome).

Every import is first a **preview**: a capability report that says what would be accepted, deduplicated,
rejected or unsupported, with nothing stored. You commit only when the report looks right.

Needs an API key with the `outcomes:write` scope. The same flow is available from the command line as
`ur import` (see [the CLI guide](./cli.md)).

## Preview, then commit

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();

// Per-model usage summaries exported from your previous provider or proxy.
const records = [
  {
    model: 'openai/gpt-5.2-mini',
    requests: 1200,
    input_tokens: 840000,
    output_tokens: 210000,
    cost_micro_usd: 630000,
  },
  {
    model: 'anthropic/claude-sonnet-4.6',
    requests: 300,
    input_tokens: 410000,
    output_tokens: 95000,
    cost_micro_usd: 2655000,
  },
];

// 1. Preview: the capability report, nothing stored.
const preview = await ur.ur.imports.create({ format: 'usage_summary', mode: 'preview', records });
const report = preview.report; // the capability report (every field optional on an import)
console.log(
  preview.status,
  report.import_class,
  `accepted=${report.accepted ?? 0} rejected=${report.rejected ?? 0}`,
);
for (const err of report.parse_errors ?? []) console.log(`line ${err.line}: ${err.message}`);

// 2. Commit: the same call without `mode` (or with `mode: 'commit'`).
const committed = await ur.ur.imports.create({ format: 'usage_summary', records });
console.log(committed.id, committed.status, committed.accepted_count, 'of', committed.record_count);
```

## Request fields

| Field            | Meaning                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| `format`         | The adapter that parses your records, e.g. `usage_summary` or `openai_chat_jsonl`. Required.             |
| `format_version` | Pin an adapter version (defaults to the latest for the format).                                          |
| `mode`           | `preview` (report only, nothing stored) or `commit` (the default).                                       |
| `records`        | The records as an array, or…                                                                             |
| `jsonl`          | …the same records as newline-delimited JSON.                                                             |
| `import_id`      | Resume an existing import. Records are deduplicated by content hash, so a resume never double-ingests.   |
| `call_type_id`   | The call type (a `ct_*` id) intact-trace history belongs to. Without it the history is imported unbound. |

The record fields themselves are defined by the adapter `format`; preview first and read the report's
`parse_errors`, `unsupported_fields` and `reasons` to see how your export is understood.

## What gets stored

- A **usage-only** import never produces a prompt, an output, a quality figure or a replayable case.
  It contributes counts and spend only (`report.usage_exposure`).
- **Intact traces** may carry request and response bodies. Bodies are stored only when your workspace
  granted corrections consent, and they are redacted on ingest. Without consent, only metadata is kept
  (`report.bodies_stored` tells you how many bodies were stored).
- An upload never authorizes paid analysis by itself.

The capability report (`ImportCapabilityReport`, available as `import.report`, where every field is
optional) holds counts and reasons only, never a body:

| Field                                                              | Meaning                                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `import_class`                                                     | `usage_only` or `intact_trace` (pinned by the adapter).                        |
| `record_count`, `accepted`, `duplicate`, `rejected`, `unsupported` | What happened to your records.                                                 |
| `parse_errors`                                                     | `{ line, message }` per unparseable record.                                    |
| `unsupported_fields`                                               | Fields the adapter ignores.                                                    |
| `replayable`                                                       | Whether the import can back offline replays.                                   |
| `bodies_stored`, `redacted`                                        | Body handling under consent.                                                   |
| `usage_exposure`                                                   | Per-model requests, tokens and cost from a usage import.                       |
| `class_truth`, `binding_truth`                                     | Plain-language statements of what this class of import can and cannot support. |

## Manage imports

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();

const page = await ur.ur.imports.list({ limit: 20 });
for (const imp of page.data) console.log(imp.id, imp.format, imp.status, imp.accepted_count);

const first = page.data[0];
if (first !== undefined) {
  const detail = await ur.ur.imports.get(first.id);
  console.log(detail.report.class_truth ?? '');
  // Cancel a non-terminal import (preview / running).
  if (detail.status === 'running') await ur.ur.imports.cancel(detail.id);
}
```

`status` is one of `preview`, `running`, `completed`, `cancelled` or `failed`. `list` is keyset
paginated: pass `next_cursor` back as `cursor`.

## Pitfalls

- **Preview before you commit.** The preview is free and stores nothing.
- **Bind intact traces to a call type** with `call_type_id`; unbound history never counts toward a
  call type's readiness.
- **Do not include personal data** you would not send in a request; consented bodies are redacted on
  ingest, but the safest data is data you never upload.

## Related

- [CLI: `ur import`](./cli.md) — the same flow from a file, for scripts and CI
- [Outcomes and artifacts](./outcomes.md) — record outcomes for live traffic
- [Learning status](./learning.md) — see imports reflected in status and improvement reads
- API reference: [`ImportsResource`](./api/sdk.md#importsresource)
