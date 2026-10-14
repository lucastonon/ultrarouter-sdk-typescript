/**
 * The exit is a pure function: `toMessages(fromMessages(m))` is byte-identical to `m` for every
 * sample in the synthetic corpus. Content is rebuilt from the manifest's segments (the labels are
 * lossless) and non-content keys are restored in their original order, so a caller can stop using the
 * context runtime at any time. Equality is asserted structurally and as JSON bytes.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { PromptMessage } from '../../src/context-runtime/_core/compression/segment-types.js';
import { fromMessages, toMessages } from '../../src/context.js';

interface Corpus {
  readonly samples: readonly { readonly name: string; readonly messages: PromptMessage[] }[];
}

const corpus = JSON.parse(
  readFileSync(new URL('./fixtures/messages.json', import.meta.url), 'utf8'),
) as Corpus;

describe('toMessages(fromMessages(m)) is byte-identical', () => {
  for (const sample of corpus.samples) {
    it(`${sample.name} round-trips`, () => {
      const lifted = fromMessages(sample.messages);
      const roundTripped = toMessages(lifted.manifest);
      expect(roundTripped).toEqual(sample.messages);
      expect(JSON.stringify(roundTripped)).toBe(JSON.stringify(sample.messages));
    });

    it(`${sample.name} round-trips across a JSON boundary`, () => {
      const wire = JSON.parse(JSON.stringify(fromMessages(sample.messages).manifest)) as ReturnType<
        typeof fromMessages
      >['manifest'];
      expect(JSON.stringify(toMessages(wire))).toBe(JSON.stringify(sample.messages));
    });
  }

  it('rebuilds string content from the segments, not from a stored copy', () => {
    const messages: PromptMessage[] = [
      { role: 'system', content: 'stable header' },
      { role: 'user', content: 'the live question' },
    ];
    const lifted = fromMessages(messages);
    const texts = lifted.manifest.entries.map((entry) => (entry.ext as { text?: unknown }).text);
    expect(texts).toContain('stable header');
    expect(texts).toContain('the live question');
    expect(toMessages(lifted.manifest)).toEqual(messages);
  });
});
