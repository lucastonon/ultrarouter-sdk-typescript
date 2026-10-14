// Every relative link in the published Markdown (README, AGENTS.md, CHANGELOG, CONTRIBUTING,
// SECURITY, docs/, examples/README.md, contract-tests/README.md) points at a file that exists, and
// every `#anchor` into a Markdown file names a heading that exists there.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function markdownFiles(): string[] {
  const out = [
    'README.md',
    'AGENTS.md',
    'CHANGELOG.md',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'examples/README.md',
    'contract-tests/README.md',
  ].filter((f) => existsSync(join(ROOT, f)));
  const walk = (dir: string): void => {
    for (const name of readdirSync(join(ROOT, dir)).sort()) {
      const rel = join(dir, name);
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
      else if (name.endsWith('.md')) out.push(rel);
    }
  };
  walk('docs');
  return out;
}

/** GitHub-style heading anchors of a Markdown text. */
function anchors(text: string): Set<string> {
  const set = new Set<string>();
  const counts = new Map<string, number>();
  let inFence = false;
  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('```')) inFence = !inFence;
    if (inFence) continue;
    const m = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (m === null) continue;
    const base = (m[1] ?? '')
      .replace(/`/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .trim()
      .replace(/\s/g, '-');
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    set.add(n === 0 ? base : `${base}-${String(n)}`);
  }
  return set;
}

/** Relative link targets in a Markdown text (code spans and fences excluded). */
function links(text: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('```')) inFence = !inFence;
    if (inFence) continue;
    const noCode = line.replace(/`[^`]*`/g, '');
    for (const m of noCode.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = m[1] ?? '';
      if (/^(https?:|mailto:)/.test(target)) continue;
      out.push(target);
    }
  }
  return out;
}

describe('documentation links', () => {
  for (const file of markdownFiles()) {
    it(`${file}: every relative link resolves`, () => {
      const text = readFileSync(join(ROOT, file), 'utf8');
      const broken: string[] = [];
      for (const target of links(text)) {
        const [path, hash] = target.split('#') as [string, string | undefined];
        const resolved = path === '' ? file : normalize(join(dirname(file), path));
        if (!existsSync(join(ROOT, resolved))) {
          broken.push(`${target} (no file ${relative(ROOT, join(ROOT, resolved))})`);
          continue;
        }
        if (hash !== undefined && hash !== '' && resolved.endsWith('.md')) {
          if (!anchors(readFileSync(join(ROOT, resolved), 'utf8')).has(hash))
            broken.push(`${target} (no heading #${hash})`);
        }
      }
      expect(broken).toEqual([]);
    });
  }
});
