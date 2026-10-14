/**
 * `fromMessages` labels are the gateway segmenter's labels, produced by the same code path: for every
 * sample in the synthetic corpus (`fixtures/messages.json`) the lifted labels must equal the
 * message-origin parts of a fresh `segment` call (index, kind and lossy eligibility aligned), so a
 * divergence in the lift path fails here.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { segment } from '../../src/context-runtime/_core/compression/segment.js';
import type { PromptMessage } from '../../src/context-runtime/_core/compression/segment-types.js';
import { fromMessages } from '../../src/context.js';

interface Corpus {
  readonly samples: readonly { readonly name: string; readonly messages: PromptMessage[] }[];
}

const corpus = JSON.parse(
  readFileSync(new URL('./fixtures/messages.json', import.meta.url), 'utf8'),
) as Corpus;

describe('fromMessages exposes the gateway segmenter labels', () => {
  it('has a broad corpus', () => {
    expect(corpus.samples.length).toBeGreaterThanOrEqual(12);
  });

  for (const sample of corpus.samples) {
    it(`${sample.name}: labels match the segmenter`, () => {
      const lifted = fromMessages(sample.messages);
      const parts = segment({ messages: sample.messages }).parts.filter(
        (part) => part.origin === 'message',
      );
      expect(lifted.labels.map((label) => label.kind)).toEqual(parts.map((part) => part.kind));
      expect(lifted.labels.map((label) => label.messageIndex)).toEqual(
        parts.map((part) => part.messageIndex),
      );
      expect(lifted.labels.map((label) => label.eligible)).toEqual(
        parts.map((part) => part.eligible),
      );
      // The manifest entries carry the same labels, in order.
      expect(lifted.manifest.entries.map((entry) => entry.kind)).toEqual(
        parts.map((part) => part.kind),
      );
    });
  }
});
