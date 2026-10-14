// The CLI and GitHub Action docs must stay complete: every command and flag the CLI accepts, and
// every action input and output, is documented. A new flag or input without docs fails here.
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const read = (rel: string): string => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

const cliSource = read('src/cli/index.ts');
const cliDoc = read('docs/cli.md');
const actionDoc = read('docs/github-action.md');

/** The USAGE text printed by `ur --help`. */
function usageText(): string {
  const m = /const USAGE = `([\s\S]*?)`;/.exec(cliSource);
  if (m === null || m[1] === undefined) throw new Error('USAGE not found in src/cli/index.ts');
  return m[1];
}

/** Every `--flag` token in a text. */
function flagsIn(text: string): Set<string> {
  return new Set([...text.matchAll(/--([a-z][a-z-]*)/g)].map((m) => m[1] ?? ''));
}

/** `true` when `flag` appears in the doc as a flag (not merely as a prefix of a longer flag). */
function documents(doc: string, flag: string): boolean {
  return new RegExp(`--${flag}(?![a-z-])`).test(doc);
}

describe('docs/cli.md covers the CLI', () => {
  it('documents every command in the usage text', () => {
    const commands = usageText()
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('ur '))
      .map((l) => l.split(/\s+(?=\[|<|--|\|)/)[0] ?? l);
    expect(commands.length).toBeGreaterThanOrEqual(14);
    for (const command of commands) {
      expect(cliDoc, `missing command: ${command}`).toContain(command);
    }
  });

  it('documents every flag in the usage text', () => {
    for (const flag of flagsIn(usageText())) {
      expect(documents(cliDoc, flag), `missing flag in docs/cli.md: --${flag}`).toBe(true);
    }
  });

  it('documents every flag the CLI actually parses (even ones the usage text omits)', () => {
    const parsed = new Set(
      [...cliSource.matchAll(/(?:flagValue|flagValues|hasFlag)\(\s*\w+\s*,\s*'([a-z-]+)'/g)].map(
        (m) => m[1] ?? '',
      ),
    );
    expect(parsed.size).toBeGreaterThan(40);
    for (const flag of parsed) {
      expect(documents(cliDoc, flag), `parsed but undocumented flag: --${flag}`).toBe(true);
      expect(flagsIn(usageText()).has(flag), `parsed but missing from ur --help: --${flag}`).toBe(
        true,
      );
    }
  });

  it('documents the exit codes and every versioned JSON schema tag', () => {
    for (const code of ['`0`', '`1`', '`2`']) expect(cliDoc).toContain(code);
    for (const tag of [...cliSource.matchAll(/'(ur\.[a-z-]+(?:\.[a-z-]+)*\.v\d+)'/g)].map(
      (m) => m[1] ?? '',
    )) {
      if (tag.startsWith('ur.flywheel.rollout') || tag.startsWith('ur.appci')) continue; // wire formats, not CLI output
      expect(cliDoc, `missing JSON schema tag: ${tag}`).toContain(tag);
    }
    for (const file of ['src/cli/gate.ts', 'src/cli/context-lint.ts']) {
      for (const m of read(file).matchAll(/'(ur\.[a-z-]+\.v\d+)'/g)) {
        expect(cliDoc, `missing JSON schema tag: ${m[1] ?? ''}`).toContain(m[1] ?? '');
      }
    }
  });
});

describe('docs/github-action.md covers action.yml', () => {
  const actionYml = read('action.yml');

  /** The keys of a top-level YAML mapping section (`inputs:` / `outputs:`), two-space indented. */
  function keysOf(section: string): string[] {
    const start = actionYml.indexOf(`\n${section}:\n`);
    if (start === -1) return [];
    const body = actionYml.slice(start + section.length + 3);
    const end = body.search(/\n[a-z]/);
    return [...(end === -1 ? body : body.slice(0, end)).matchAll(/^ {2}([a-z][a-z0-9-]*):/gm)].map(
      (m) => m[1] ?? '',
    );
  }

  it('documents every input', () => {
    const inputs = keysOf('inputs');
    expect(inputs.length).toBeGreaterThanOrEqual(25);
    for (const input of inputs) {
      expect(actionDoc, `undocumented action input: ${input}`).toContain(`\`${input}\``);
    }
  });

  it('documents every output (or that there are none)', () => {
    const outputs = keysOf('outputs');
    if (outputs.length === 0) expect(actionDoc).toMatch(/declares no `outputs:`/);
    for (const output of outputs) {
      expect(actionDoc, `undocumented action output: ${output}`).toContain(`\`${output}\``);
    }
  });

  it('documents every mode the dispatch guard accepts', () => {
    for (const mode of ['bench', 'app-ci', 'flywheel-pr']) {
      expect(actionYml).toContain(`inputs.mode == '${mode}'`);
      expect(actionDoc).toContain(`mode: ${mode}`);
    }
  });
});
