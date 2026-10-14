// (diff) — the pure `diffStats(draft, final)` helper + its SHA-256.
// It is the client side of the no-consent `/final` path: only lengths, an edit ratio, a changed-span
// count and a content hash ever leave the process. Deterministic + pure.
import { describe, expect, it } from 'vitest';

import { diffStats, sha256Hex } from '../src/diff-stats.js';

describe('sha256Hex — pure, edge-portable', () => {
  it('matches the canonical NIST test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    // A multi-block message (> 55 bytes forces a second 64-byte block + length padding).
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('hashes UTF-8 (multi-byte) content deterministically', () => {
    expect(sha256Hex('héllo')).toBe(sha256Hex('héllo'));
    expect(sha256Hex('héllo')).not.toBe(sha256Hex('hello'));
  });
});

describe('diffStats — pure draft→final diff', () => {
  it('is all-zero for byte-identical inputs and hashes the final', () => {
    const stats = diffStats('same content', 'same content');
    expect(stats.edit_ratio).toBe(0);
    expect(stats.changed_spans).toBe(0);
    expect(stats.lengths).toEqual({ draft: 12, final: 12 });
    expect(stats.final_hash).toBe(sha256Hex('same content'));
  });

  it('counts TWO separated changed spans and an exact edit ratio', () => {
    // "a1b2c" → "aXbYc": two single-char edits separated by the matched 'b'.
    const stats = diffStats('a1b2c', 'aXbYc');
    expect(stats.changed_spans).toBe(2);
    expect(stats.edit_ratio).toBeCloseTo(0.4, 10);
    expect(stats.lengths).toEqual({ draft: 5, final: 5 });
    expect(stats.final_hash).toBe(sha256Hex('aXbYc'));
  });

  it('treats a brand-new final (empty draft) as one fully-changed span, ratio 1', () => {
    const stats = diffStats('', 'hello');
    expect(stats.edit_ratio).toBe(1);
    expect(stats.changed_spans).toBe(1);
    expect(stats.lengths).toEqual({ draft: 0, final: 5 });
  });

  it('treats a pure append as one changed span with a partial ratio', () => {
    const stats = diffStats('hello', 'hello world');
    expect(stats.changed_spans).toBe(1);
    expect(stats.edit_ratio).toBeCloseTo(0.375, 10);
  });

  it('is deterministic (same inputs ⇒ byte-identical stats)', () => {
    const a = diffStats('the quick brown fox', 'the slow brown cat');
    const b = diffStats('the quick brown fox', 'the slow brown cat');
    expect(a).toEqual(b);
    expect(a.edit_ratio).toBeGreaterThan(0);
    expect(a.edit_ratio).toBeLessThan(1);
  });
});
