// Every public export of both entry points carries TSDoc, and every member of an SDK-authored
// exported interface or class does too. (The context runtime's generated files are documented at the
// export level through the documented re-exports in src/context.ts.)
import { describe, expect, it } from 'vitest';

// @ts-expect-error -- plain ESM script without type declarations
import { buildApiModel } from '../scripts/lib/api-model.mjs';

interface ApiExport {
  name: string;
  kind: string;
  source: string;
  doc: string;
  members: { name: string; doc: string }[];
}
interface ApiEntry {
  specifier: string;
  exports: ApiExport[];
}

const model = buildApiModel() as ApiEntry[];

describe('TSDoc coverage', () => {
  for (const entry of model) {
    it(`every export of ${entry.specifier} has TSDoc`, () => {
      const undocumented = entry.exports
        .filter((e) => e.kind !== 'default' && e.doc.trim() === '')
        .map((e) => `${e.name} (${e.source})`);
      expect(undocumented).toEqual([]);
      expect(entry.exports.length).toBeGreaterThan(100);
    });

    it(`every member of an SDK-authored interface or class in ${entry.specifier} has TSDoc`, () => {
      const missing: string[] = [];
      for (const e of entry.exports) {
        if (e.source.startsWith('src/context-runtime/') || e.kind === 'default') continue;
        for (const m of e.members)
          if (m.doc.trim() === '') missing.push(`${e.name}.${m.name} (${e.source})`);
      }
      expect(missing).toEqual([]);
    });
  }
});
