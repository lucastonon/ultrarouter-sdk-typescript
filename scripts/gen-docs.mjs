#!/usr/bin/env node
/**
 * gen-docs — generate the reference documentation from the sources, or check it is current.
 *
 *   node scripts/gen-docs.mjs           # write the generated files
 *   node scripts/gen-docs.mjs --check   # exit 1 if any generated file is stale or a guide is missing
 *
 * Generated files:
 * - `docs/api/README.md`, `docs/api/sdk.md`, `docs/api/context.md`, `docs/api/learning.md` — the
 *   API reference, built from the TypeScript sources and their TSDoc (every export of
 *   `@ultrarouter/sdk`, `@ultrarouter/sdk/context` and `@ultrarouter/sdk/learning`).
 * - `docs/api-coverage.md` — every operation of `openapi/openapi.yaml` with the SDK method, CLI
 *   command and test that cover it (from `scripts/lib/coverage-map.mjs`).
 * - `llms.txt` (llmstxt.org format) and `llms-full.txt` (every guide concatenated) — entry points for
 *   AI agents, built from the guides listed in `GUIDES` below.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildApiModel } from './lib/api-model.mjs';
import { COVERAGE } from './lib/coverage-map.mjs';
import { loadSpec } from './lib/openapi-validate.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/** The guides, in reading order. Every one must exist; llms.txt / llms-full.txt follow this order. */
export const GUIDES = [
  { file: 'README.md', section: 'Start here' },
  { file: 'AGENTS.md', section: 'Start here' },
  { file: 'docs/README.md', section: 'Start here' },
  { file: 'docs/installation.md', section: 'Guides' },
  { file: 'docs/configuration.md', section: 'Guides' },
  { file: 'docs/chat-completions.md', section: 'Guides' },
  { file: 'docs/streaming.md', section: 'Guides' },
  { file: 'docs/tools.md', section: 'Guides' },
  { file: 'docs/structured-outputs.md', section: 'Guides' },
  { file: 'docs/embeddings.md', section: 'Guides' },
  { file: 'docs/models.md', section: 'Guides' },
  { file: 'docs/errors.md', section: 'Guides' },
  { file: 'docs/retries-timeouts-idempotency.md', section: 'Guides' },
  { file: 'docs/openai-compatibility.md', section: 'Guides' },
  { file: 'docs/passthrough.md', section: 'Guides' },
  { file: 'docs/call-types.md', section: 'ultrarouter resources' },
  { file: 'docs/feedback-and-generation.md', section: 'ultrarouter resources' },
  { file: 'docs/outcomes.md', section: 'ultrarouter resources' },
  { file: 'docs/reviewer.md', section: 'ultrarouter resources' },
  { file: 'docs/learning.md', section: 'ultrarouter resources' },
  { file: 'docs/imports.md', section: 'ultrarouter resources' },
  { file: 'docs/preflight.md', section: 'ultrarouter resources' },
  { file: 'docs/bench.md', section: 'ultrarouter resources' },
  { file: 'docs/context-runtime.md', section: 'ultrarouter resources' },
  { file: 'docs/typed-requests.md', section: 'ultrarouter resources' },
  { file: 'docs/cli.md', section: 'Tools' },
  { file: 'docs/github-action.md', section: 'Tools' },
  { file: 'docs/testing.md', section: 'Guides' },
  { file: 'docs/troubleshooting.md', section: 'Guides' },
  { file: 'docs/api-coverage.md', section: 'Reference' },
  { file: 'docs/api/README.md', section: 'Reference' },
  { file: 'docs/api/sdk.md', section: 'Reference' },
  { file: 'docs/api/context.md', section: 'Reference' },
  { file: 'CHANGELOG.md', section: 'Optional' },
];

const KIND_ORDER = ['default', 'class', 'function', 'const', 'interface', 'type', 'enum'];
const KIND_TITLE = {
  default: 'Default export',
  class: 'Classes',
  function: 'Functions',
  const: 'Constants',
  interface: 'Interfaces',
  type: 'Types',
  enum: 'Enums',
};

const cell = (text) => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/** Turn TSDoc `{@link X}` / `{@link X.y}` into code spans (linked when `X` is on the same page). */
function links(text, names) {
  return text.replace(
    /\{@link\s+((?:import\s*\([^)]*\)\.)?[^}\s|]+)(?:\s*\|\s*([^}]+))?\}/g,
    (_m, target, label) => {
      const shown = (label ?? target).replace(/^import\s*\([^)]*\)\./, '');
      const base = target.replace(/^import\s*\([^)]*\)\./, '').split('.')[0];
      return names.has(base) ? `[\`${shown}\`](#${anchor(base)})` : `\`${shown}\``;
    },
  );
}
/** The GitHub heading anchor of an export-name heading (letters, digits, `_` and `-` survive). */
const anchor = (name) => name.toLowerCase().replace(/[^a-z0-9_-]/g, '');

// ─────────────────────────────── API reference ───────────────────────────────

export function renderEntryPage(entry) {
  const names = new Set(entry.exports.map((e) => e.name));
  const lines = [];
  lines.push(`# API reference: \`${entry.specifier}\``);
  lines.push('');
  lines.push(
    `Generated from the TypeScript sources and their TSDoc by \`scripts/gen-docs.mjs\` (do not edit by hand). Version ${PKG.version}. ${String(entry.exports.length)} exports.`,
  );
  lines.push('');
  lines.push(
    `\`\`\`ts\nimport ${entry.slug === 'sdk' ? 'UltraRouter, { /* named exports */ }' : '{ /* named exports */ }'} from '${entry.specifier}';\n\`\`\``,
  );
  lines.push('');
  lines.push('## Contents');
  lines.push('');
  for (const kind of KIND_ORDER) {
    const items = entry.exports.filter((e) => e.kind === kind);
    if (items.length === 0) continue;
    lines.push(
      `- **${KIND_TITLE[kind]}:** ${items.map((e) => `[\`${e.name}\`](#${anchor(e.name)})`).join(', ')}`,
    );
  }
  lines.push('');
  for (const kind of KIND_ORDER) {
    const items = entry.exports.filter((e) => e.kind === kind);
    if (items.length === 0) continue;
    lines.push(`## ${KIND_TITLE[kind]}`);
    lines.push('');
    for (const e of items) {
      lines.push(`### ${e.name}`);
      lines.push('');
      lines.push(`${e.kind} · \`${e.source}\``);
      lines.push('');
      if (e.kind === 'default') {
        lines.push('The default export is the [`UltraRouter`](#ultrarouter) class.');
        lines.push('');
        continue;
      }
      if (e.doc !== '') {
        lines.push(links(e.doc, names));
        lines.push('');
      }
      lines.push('```ts signature');
      lines.push(e.signature.replace(/^export (declare )?/, ''));
      lines.push('```');
      lines.push('');
      if (e.members.length > 0) {
        lines.push('| Member | Description |');
        lines.push('| --- | --- |');
        for (const m of e.members)
          lines.push(`| \`${cell(m.text)}\` | ${cell(links(m.doc, names))} |`);
        lines.push('');
      }
      for (const example of e.examples) {
        lines.push('**Example**');
        lines.push('');
        lines.push(example.trim());
        lines.push('');
      }
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export function renderApiIndex(model) {
  const lines = ['# API reference', ''];
  lines.push(
    `Generated from the TypeScript sources by \`scripts/gen-docs.mjs\`. Version ${PKG.version}. The package has two entry points:`,
  );
  lines.push('');
  for (const entry of model) {
    lines.push(
      `- [\`${entry.specifier}\`](./${entry.slug}.md) — ${String(entry.exports.length)} exports`,
    );
  }
  lines.push('');
  lines.push(
    'See also [API coverage](../api-coverage.md): every HTTP operation and the method that calls it.',
  );
  return `${lines.join('\n')}\n`;
}

// ─────────────────────────────── coverage table ───────────────────────────────

export function renderCoverage() {
  const spec = loadSpec();
  const rows = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const op = item[method];
      if (op === undefined) continue;
      const sec = (op.security ?? []).map((s) => Object.keys(s)[0]);
      const auth =
        sec.length === 0 ? 'none' : sec.includes('bearerAuth') ? 'API key' : 'dashboard session';
      const cov = COVERAGE[op.operationId];
      rows.push({
        method: method.toUpperCase(),
        path,
        opId: op.operationId,
        auth,
        cov,
        tag: (op.tags ?? ['Other'])[0],
      });
    }
  }
  const curated = rows.filter((r) => (r.cov?.methods.length ?? 0) > 0).length;
  const keyRows = rows.filter((r) => r.auth !== 'dashboard session');
  const lines = ['# API coverage', ''];
  lines.push(
    `Every operation in the published OpenAPI document (\`openapi/openapi.yaml\`) and how this SDK reaches it. Generated by \`scripts/gen-docs.mjs\` from \`scripts/lib/coverage-map.mjs\`; \`test/coverage-map.test.ts\` keeps it complete.`,
  );
  lines.push('');
  lines.push(
    `- ${String(rows.length)} operations; ${String(keyRows.length)} accept an API key (or no auth), ${String(rows.length - keyRows.length)} need a dashboard session.`,
  );
  lines.push(
    `- ${String(curated)} have a dedicated SDK method. Every API-key operation is also callable, fully typed, with [\`ur.request()\`](./typed-requests.md).`,
  );
  lines.push(
    '- Dashboard-session operations (workspace administration, consents, model policy, provider keys) are not callable with an API key; use the dashboard.',
  );
  lines.push(
    '- Every operation is exercised against the local mock gateway with schema validation in `test/mock-gateway.test.ts`; generic `ur.request()` behaviour is proven in `test/resources.test.ts`.',
  );
  lines.push('');
  const byTag = new Map();
  for (const r of rows) {
    if (!byTag.has(r.tag)) byTag.set(r.tag, []);
    byTag.get(r.tag).push(r);
  }
  for (const [tag, list] of [...byTag.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`## ${tag}`);
    lines.push('');
    lines.push('| Operation | Auth | SDK | CLI | Tests |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const r of list) {
      const methods =
        r.cov === undefined
          ? '(unmapped)'
          : r.cov.methods.length > 0
            ? r.cov.methods.map((m) => `\`${m}()\``).join(', ')
            : r.auth === 'dashboard session'
              ? 'dashboard only'
              : `\`ur.request('${r.method.toLowerCase()}', '${r.path}')\``;
      const cli = r.cov?.cli !== undefined ? `\`${r.cov.cli}\`` : '';
      const tests = (r.cov?.tests ?? []).map((t) => `\`${t}\``).join(', ');
      lines.push(
        `| \`${r.method} ${r.path}\` (${r.opId}) | ${r.auth} | ${cell(methods)} | ${cell(cli)} | ${cell(tests)} |`,
      );
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

// ─────────────────────────────── llms.txt / llms-full.txt ───────────────────────────────

/** The H1 title and the first prose paragraph of a Markdown file. */
function titleAndSummary(text) {
  const lines = text.split('\n');
  const title = (lines.find((l) => l.startsWith('# ')) ?? '# Untitled').slice(2).trim();
  let summary = '';
  let inFence = false;
  for (const raw of lines) {
    const l = raw.trim();
    if (l.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (
      inFence ||
      l === '' ||
      l.startsWith('#') ||
      l.startsWith('<!--') ||
      l.startsWith('|') ||
      l.startsWith('[!') ||
      l.startsWith('![') ||
      l.startsWith('>') ||
      l.startsWith('- ') ||
      l.startsWith('* ')
    ) {
      if (summary !== '' && l === '') break;
      continue;
    }
    summary += `${summary === '' ? '' : ' '}${l}`;
  }
  summary = summary
    .replace(/\s+/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
  const sentence = /^(.{40,240}?[.!?])(\s|$)/.exec(summary)?.[1];
  if (sentence !== undefined) return { title, summary: sentence };
  if (summary.length <= 240) return { title, summary };
  return { title, summary: `${summary.slice(0, summary.lastIndexOf(' ', 240))} …` };
}

function renderLlms(read) {
  const lines = [];
  lines.push('# ultrarouter TypeScript SDK (@ultrarouter/sdk)');
  lines.push('');
  lines.push(
    `> The official TypeScript SDK for ultrarouter, an OpenAI-compatible LLM gateway and router. Version ${PKG.version}, MIT licensed, zero runtime dependencies, ESM and CommonJS, Node.js 20+ and Deno 2 (tested; Bun and edge runtimes untested).`,
  );
  lines.push('');
  lines.push(
    'The package is not on the npm registry yet: build it from the GitHub source and install the tarball (`npm ci && npm run build && npm pack`, then `npm install ./ultrarouter-sdk-<version>.tgz`). Configure with the `ULTRAROUTER_API_KEY` and `ULTRAROUTER_BASE_URL` (required: your own deployment) environment variables. `new UltraRouter()` exposes `chat.completions.create`, `embeddings.create`, `models.list` / `models.retrieve` (the OpenAI shapes), the ultrarouter resources under `ur.*`, a typed `request()` for any API operation, and `asOpenAI()` for the official `openai` client. The `@ultrarouter/sdk/context` entry is a pure context runtime. The package also ships the `ur` CLI and a GitHub Action. Agents: read AGENTS.md first.',
  );
  lines.push('');
  const sections = new Map();
  for (const g of GUIDES) {
    if (!sections.has(g.section)) sections.set(g.section, []);
    sections.get(g.section).push(g);
  }
  const order = ['Start here', 'Guides', 'ultrarouter resources', 'Tools', 'Reference', 'Optional'];
  for (const name of order) {
    const list = sections.get(name);
    if (list === undefined) continue;
    lines.push(`## ${name}`);
    lines.push('');
    for (const g of list) {
      const { title, summary } = titleAndSummary(read(g.file));
      lines.push(`- [${title}](${g.file})${summary !== '' ? `: ${summary}` : ''}`);
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function renderLlmsFull(read) {
  const parts = [
    `# ultrarouter TypeScript SDK (@ultrarouter/sdk) ${PKG.version} — full documentation\n\nEvery guide of this package concatenated in reading order, for AI agents (the generated API reference pages are linked, not inlined). The same files ship in the package and live at https://github.com/lucastonon/ultrarouter-sdk-typescript. Each file starts with a \`<!-- file: path -->\` marker.\n`,
  ];
  for (const g of GUIDES) {
    // The generated API reference pages are linked from llms.txt rather than inlined: they are large
    // and derived entirely from the TSDoc that the guides already explain.
    if (g.file.startsWith('docs/api/')) continue;
    parts.push(`\n<!-- file: ${g.file} -->\n\n${read(g.file).trim()}\n`);
  }
  parts.push(
    '\n<!-- API reference -->\n\nThe complete, generated API reference is in docs/api/sdk.md (`@ultrarouter/sdk`), docs/api/context.md (`@ultrarouter/sdk/context`) and docs/api/learning.md (`@ultrarouter/sdk/learning`).\n',
  );
  return parts.join('');
}

// ─────────────────────────────── main ───────────────────────────────

/** Build every generated file in memory: path → content. */
export function generate() {
  const model = buildApiModel();
  const out = new Map();
  out.set('docs/api/README.md', renderApiIndex(model));
  for (const entry of model) out.set(`docs/api/${entry.slug}.md`, renderEntryPage(entry));
  out.set('docs/api-coverage.md', renderCoverage());
  const read = (file) => out.get(file) ?? readFileSync(join(ROOT, file), 'utf8');
  const missing = GUIDES.map((g) => g.file).filter(
    (f) => !out.has(f) && !existsSync(join(ROOT, f)),
  );
  if (missing.length > 0) {
    throw new Error(`gen-docs: missing guide(s): ${missing.join(', ')}`);
  }
  out.set('llms.txt', renderLlms(read));
  out.set('llms-full.txt', renderLlmsFull(read));
  return out;
}

function main(argv) {
  const check = argv.includes('--check');
  let files;
  try {
    files = generate();
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
  const stale = [];
  for (const [file, content] of files) {
    const path = join(ROOT, file);
    const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (current === content) continue;
    if (check) stale.push(file);
    else {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
      process.stdout.write(`wrote ${file}\n`);
    }
  }
  if (check) {
    if (stale.length > 0) {
      process.stderr.write(
        `gen-docs --check: stale generated file(s): ${stale.join(', ')}\nRun: npm run docs:gen\n`,
      );
      return 1;
    }
    process.stdout.write(`gen-docs --check: ok (${String(files.size)} generated files current)\n`);
  }
  return 0;
}

if (
  process.argv[1] !== undefined &&
  relative(process.argv[1], fileURLToPath(import.meta.url)) === ''
) {
  process.exitCode = main(process.argv.slice(2));
}
