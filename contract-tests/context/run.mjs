#!/usr/bin/env node
// The context-runtime battery. It drives the BUILT `@ultrarouter/sdk/context` subpath
// (../../dist/context.js), not the source, so it proves the shipped artifact: the export and build
// wiring, the bundled `zod`, and the external `node:crypto` all resolve at runtime. It boots
// nothing (the context runtime is pure: no service, no socket) and exits 0 on success, 2 on any
// failure.
//
// The guarantee it checks hardest is the exit byte-identity: `toMessages(fromMessages(m))` is
// byte-identical to `m`, even after the manifest crosses a JSON boundary. The corpus below is
// synthetic and self-contained.
//
// Prereq: `npm run build` at the repository root.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SUBPATH = resolve(HERE, '../../dist/context.js');
const CORE = resolve(HERE, '../../dist/index.js');
const ULTRAROUTER_GOLDEN = resolve(HERE, '../../test/context/fixtures/ultrarouter/default.json');

if (!existsSync(SUBPATH)) {
  console.error(`context battery: the built subpath is missing (${SUBPATH}).`);
  console.error('Build it first: npm run build (at the repository root)');
  process.exit(1);
}

/**
 * Synthetic message arrays covering the shapes the exit must preserve: system + user, multi-turn
 * history, multi-part content with cache breakpoints, tool calls and tool results, null content,
 * extra keys in non-standard order, unicode and empty strings.
 */
const SAMPLES = [
  {
    source: 'system + question',
    messages: [
      { role: 'system', content: 'You are a concise support assistant.' },
      { role: 'user', content: 'Where is order 1042?' },
    ],
  },
  {
    source: 'reference context + history',
    messages: [
      { role: 'system', content: 'Answer only from the reference below.' },
      {
        role: 'user',
        content: 'Reference: the store opens at 9:00 and closes at 18:00 on weekdays.',
      },
      { role: 'assistant', content: 'Understood.' },
      { role: 'user', content: 'When does it close on Tuesday?' },
    ],
  },
  {
    source: 'multi-part content with a cache breakpoint',
    messages: [
      {
        role: 'system',
        content: [
          {
            type: 'text',
            text: 'Long, stable instructions.',
            cache_control: { type: 'ephemeral' },
          },
          { type: 'text', text: 'More instructions.' },
        ],
      },
      { role: 'user', content: [{ type: 'text', text: 'Summarise the policy.' }] },
    ],
  },
  {
    source: 'tool call round trip',
    messages: [
      { role: 'user', content: 'What is the weather in Lisbon?' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'get_weather', arguments: '{"city":"Lisbon"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '{"temp_c":21}' },
      { role: 'assistant', content: 'It is 21 °C in Lisbon.' },
    ],
  },
  {
    source: 'few-shot examples',
    messages: [
      { role: 'system', content: 'Classify the sentiment as positive or negative.' },
      { role: 'user', content: 'I love it.' },
      { role: 'assistant', content: 'positive' },
      { role: 'user', content: 'This is broken.' },
      { role: 'assistant', content: 'negative' },
      { role: 'user', content: 'Works great.' },
    ],
  },
  {
    source: 'developer role, names and key order',
    messages: [
      { content: 'Be brief.', role: 'developer' },
      { name: 'alice', role: 'user', content: 'Hi there' },
    ],
  },
  {
    source: 'unicode and empty content',
    messages: [
      { role: 'system', content: '' },
      { role: 'user', content: 'Olá — ¿qué tal? 你好 🙂' },
    ],
  },
];

const ctx = await import(SUBPATH);
const core = await import(CORE);

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) {
    process.stdout.write(`  ✓ ${name}\n`);
  } else {
    failures += 1;
    process.stdout.write(`  ✗ ${name}${detail ? ` — ${detail}` : ''}\n`);
  }
}

// 0) the shipped surface exports the four helpers
for (const symbol of ['compile', 'fromMessages', 'toMessages', 'render']) {
  check(`built subpath exports ${symbol}`, typeof ctx[symbol] === 'function');
}

// 1) entry separation: the client entry exports none of the runtime
check(
  'the built core @ultrarouter/sdk entry does not export the context runtime',
  !['compile', 'fromMessages', 'toMessages', 'render'].some((s) => typeof core[s] === 'function'),
);

// 2) the exit byte-identity, over the synthetic corpus, through a JSON boundary
const corpus = { samples: SAMPLES };
let roundTripped = 0;
for (const [index, sample] of corpus.samples.entries()) {
  const lifted = ctx.fromMessages(sample.messages);
  const manifest = JSON.parse(JSON.stringify(lifted.manifest)); // serialize → parse (offline)
  const exited = ctx.toMessages(manifest);
  const identical = JSON.stringify(exited) === JSON.stringify(sample.messages);
  if (identical) roundTripped += 1;
  else check(`sample #${index} (${sample.source}) round-trips byte-identically`, false);
}
check(
  `all ${String(corpus.samples.length)} synthetic samples round-trip byte-identically`,
  roundTripped === corpus.samples.length,
  `${String(roundTripped)}/${String(corpus.samples.length)}`,
);

// 3) compile → render → JSON → toMessages (the bundled zod works)
const module = {
  id: 'sop',
  version: '1',
  kind: 'sop',
  memoryClass: 'semantic',
  trustClass: 'approved_derived',
  privacyClass: 'workspace_private',
  availability: { from: null, to: null },
  contentHash: 'hash:sop',
  tokenEstimate: 10,
  facets: {},
  slotHint: 'instruction',
};
const envelope = {
  id: 'env-1',
  tenant: 't1',
  stage: 's1',
  mode: 'live',
  asOf: '2026-04-01T00:00:00.000Z',
  cutoffs: {},
  budgets: {},
  seed: 'seed',
  pins: [],
  releases: {},
  permissionEpoch: 'e1',
};
const contract = {
  stage: 's1',
  requiredKinds: [],
  optionalKinds: ['sop'],
  forbiddenKinds: [],
  budgets: {},
  limits: [],
  pinPolicy: 'none',
  slots: ['instruction', 'reference', 'exemplar'],
};
const compiled = ctx.compile(
  envelope,
  contract,
  [{ module, slot: 'instruction' }],
  ctx.ULTRAROUTER_PROFILE,
);
check(
  'compile admits a module and stamps a sha256 manifest hash (bundled zod OK)',
  compiled.ok === true && /^[0-9a-f]{64}$/.test(compiled.manifest?.manifestHash ?? ''),
);
if (compiled.ok && compiled.manifest !== null) {
  const bodies = new Map([['sop', 'Follow the refund policy exactly.']]);
  const rendered = ctx.render(compiled.manifest, bodies);
  const exported = JSON.parse(JSON.stringify({ manifest: compiled.manifest, bodies: [...bodies] }));
  const exited = ctx.toMessages(exported.manifest, new Map(exported.bodies));
  check(
    'render → JSON → toMessages reproduces the rendered messages offline',
    JSON.stringify(exited) === JSON.stringify(rendered),
  );
}

// 4) the default-profile golden: `ULTRAROUTER_PROFILE` is the profile whose manifests the gateway
// verifies (`ur.manifest`). The built subpath must reproduce the committed golden bytes and sha256
// exactly; a reversed canonical-JSON key order would change the bytes at every nesting depth (a
// 64-hex shape check alone could not see it).
const golden = JSON.parse(readFileSync(ULTRAROUTER_GOLDEN, 'utf8'));
{
  const { envelope, contract, candidates } = golden.input;
  const result = ctx.compile(envelope, contract, candidates, ctx.ULTRAROUTER_PROFILE);
  check(
    'the default profile compiles the golden input to a manifest',
    result.ok === true && result.manifest !== null,
  );
  if (result.ok && result.manifest !== null) {
    const { manifestHash, ...withoutHash } = result.manifest;
    const encoded = ctx.ULTRAROUTER_PROFILE.manifestEncoder(withoutHash, { envelope, contract });
    check(
      'default-profile manifest bytes match the golden byte-for-byte',
      encoded.bytes === golden.golden.bytes,
      `${String(encoded.bytes.length)} vs ${String(golden.golden.bytes.length)} bytes`,
    );
    check(
      'default-profile manifest sha256 matches the golden',
      encoded.hash === golden.golden.hash && manifestHash === golden.golden.hash,
    );
    const itemRefs = result.manifest.entries.map((entry) => entry.ext?.ref ?? entry.moduleId);
    check(
      'default-profile item refs match the golden',
      JSON.stringify(itemRefs) === JSON.stringify(golden.golden.itemRefs),
    );
    const refusalCodes = result.manifest.refused.filter((r) => !r.fatal).map((r) => r.code);
    check(
      'default-profile non-fatal refusal codes match the golden',
      JSON.stringify(refusalCodes) === JSON.stringify(golden.golden.refusalCodes),
    );
  }
}

if (failures > 0) {
  process.stderr.write(`\ncontext battery: ${String(failures)} check(s) FAILED\n`);
  process.exit(2);
}
process.stdout.write(
  `\n✓ context-runtime battery passed (built subpath: exit byte-identity, entry separation, default-profile golden)\n`,
);
