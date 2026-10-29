// (· SEC) — every public client method that puts an id into a URL
// PATH SEGMENT must percent-encode it, so an adversarial id (`/`, `?`, `#`, `%`, `..`) can never
// escape its segment and address another route under the same key. The table enumerates EVERY such
// method; the completeness check derives the set of path-segment interpolation sites straight from
// `src/client.ts`, so a NEW id-taking method with no row here fails RED (proven in this file).
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { UltraRouter } from '../src/client.js';
import type { FetchLike } from '../src/types.js';

const BASE = 'http://gw';

// The adversarial id: a `/` (segment escape), `?` (query injection), `#` (fragment), a raw `%` and an
// already-`%2F`-encoded `/`, and a trailing `..` (traversal). encodeURIComponent must neutralise all.
const ADV = 'a/b?c#d%2F..';
const ENC = encodeURIComponent(ADV); // a%2Fb%3Fc%23d%252F..

/** A fetch that records the URL it was called with and returns a permissive JSON body. */
function recordingFetch(): { fetch: FetchLike; url: () => string } {
  let seen: string | undefined;
  const fetch: FetchLike = async (url) => {
    seen = String(url);
    // Permissive shape so envelope-unwrapping + outcome-queue senders resolve without throwing;
    // the assertion only ever reads the captured URL, not the parsed body.
    return new Response(JSON.stringify({ data: [{}] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return {
    fetch,
    url: () => {
      if (seen === undefined) throw new Error('no request captured');
      return seen;
    },
  };
}

/** One id-taking public method: the wire PATTERN it builds (`{}` = the encoded id slot) + how to call it. */
interface Row {
  /** A stable label for the failure message. */
  readonly label: string;
  /** The canonical path pattern (query stripped), `{}` marking each path-segment id slot. */
  readonly pattern: string;
  /** Invoke the method on `ur` with the adversarial id. Errors are irrelevant — only the URL matters. */
  readonly invoke: (ur: UltraRouter) => Promise<unknown>;
  /** Override the expected wire path (model ids keep their provider `/` separator). */
  readonly expected?: string;
  /** A strict namespace grammar rejects the adversarial id before transport. */
  readonly rejectsInvalidId?: boolean;
}

const OUTCOME = { channel: 'mechanical', kind: 'tool_success' } as const;

const TABLE: readonly Row[] = [
  {
    label: 'knowledge.get',
    pattern: '/v1/knowledge/{}',
    invoke: (ur) => ur.ur.knowledge.get(ADV),
    rejectsInvalidId: true,
  },
  {
    label: 'callTypes.get',
    pattern: '/v1/call-types/{}',
    invoke: (ur) => ur.ur.callTypes.get(ADV),
  },
  {
    label: 'callTypes.update',
    pattern: '/v1/call-types/{}',
    invoke: (ur) => ur.ur.callTypes.update(ADV, {}),
  },
  {
    label: 'callTypes.enqueueEval',
    pattern: '/v1/call-types/{}/evals',
    invoke: (ur) => ur.ur.callTypes.enqueueEval(ADV),
  },
  {
    label: 'requests.feedback',
    pattern: '/v1/requests/{}/feedback',
    invoke: (ur) => ur.ur.requests.feedback(ADV, { rating: 1 }),
  },
  {
    label: 'bench.status',
    pattern: '/v1/bench/suites/{}/status',
    invoke: (ur) => ur.ur.bench.status(ADV),
  },
  {
    label: 'bench.freeze',
    pattern: '/v1/bench/suites/{}/freeze',
    invoke: (ur) => ur.ur.bench.freeze(ADV),
  },
  {
    label: 'bench.run',
    pattern: '/v1/bench/suites/{}/runs',
    invoke: (ur) => ur.ur.bench.run({ suite: ADV, max_cost_usd: 1 }),
  },
  { label: 'bench.get', pattern: '/v1/bench/runs/{}', invoke: (ur) => ur.ur.bench.get(ADV) },
  {
    label: 'bench.report',
    pattern: '/v1/bench/runs/{}/report',
    invoke: (ur) => ur.ur.bench.report(ADV),
  },
  {
    label: 'bench.expect',
    pattern: '/v1/bench/suites/{}/expectations',
    invoke: (ur) => ur.ur.bench.expect(ADV, []),
  },
  {
    label: 'bench.record(run)',
    pattern: '/v1/bench/runs/{}/outcomes',
    invoke: (ur) => ur.ur.bench.record({ run: ADV }, []),
  },
  {
    label: 'bench.record(suite)',
    pattern: '/v1/bench/suites/{}/outcomes',
    invoke: (ur) => ur.ur.bench.record({ suite: ADV }, []),
  },
  {
    label: 'bench.baseline',
    pattern: '/v1/bench/runs/{}/baseline',
    invoke: (ur) => ur.ur.bench.baseline(ADV),
  },
  { label: 'bench.gate', pattern: '/v1/bench/runs/{}/gate', invoke: (ur) => ur.ur.bench.gate(ADV) },
  { label: 'artifacts.get', pattern: '/v1/artifacts/{}', invoke: (ur) => ur.ur.artifacts.get(ADV) },
  {
    label: 'artifacts.final',
    pattern: '/v1/artifacts/{}/final',
    invoke: (ur) => ur.ur.artifacts.final(ADV, {}),
  },
  {
    label: 'outcomes.record(request)',
    pattern: '/v1/requests/{}/outcomes',
    invoke: (ur) => ur.ur.outcomes.record({ request: ADV }, OUTCOME),
  },
  {
    label: 'outcomes.record(artifact)',
    pattern: '/v1/artifacts/{}/outcomes',
    invoke: (ur) => ur.ur.outcomes.record({ artifact: ADV }, OUTCOME),
  },
  { label: 'imports.get', pattern: '/v1/imports/{}', invoke: (ur) => ur.ur.imports.get(ADV) },
  {
    label: 'imports.cancel',
    pattern: '/v1/imports/{}/cancel',
    invoke: (ur) => ur.ur.imports.cancel(ADV),
  },
  {
    label: 'models.retrieve',
    pattern: '/v1/models/{}',
    invoke: (ur) => ur.models.retrieve(ADV),
    // Each `/`-separated part is encoded and the separator kept (`a` / `b?c#d%2F..`).
    expected: `${BASE}/v1/models/a/${encodeURIComponent('b?c#d%2F..')}`,
  },
  {
    label: 'callTypes.listEvals',
    pattern: '/v1/call-types/{}/evals',
    invoke: (ur) => ur.ur.callTypes.listEvals(ADV),
  },
  {
    label: 'callTypes.recommendations',
    pattern: '/v1/call-types/{}/recommendations',
    invoke: (ur) => ur.ur.callTypes.recommendations(ADV),
  },
  {
    label: 'prompts.list',
    pattern: '/v1/call-types/{}/prompts',
    invoke: (ur) => ur.ur.callTypes.prompts.list(ADV),
  },
  {
    label: 'prompts.create',
    pattern: '/v1/call-types/{}/prompts',
    invoke: (ur) => ur.ur.callTypes.prompts.create(ADV, { template: 't', variables: [] } as never),
  },
  {
    label: 'prompts.get',
    pattern: '/v1/call-types/{}/prompts/{}',
    invoke: (ur) => ur.ur.callTypes.prompts.get(ADV, ADV),
  },
  {
    label: 'prompts.activate',
    pattern: '/v1/call-types/{}/prompts/{}/activate',
    invoke: (ur) => ur.ur.callTypes.prompts.activate(ADV, ADV),
  },
  {
    label: 'prompts.deactivate',
    pattern: '/v1/call-types/{}/prompts/deactivate',
    invoke: (ur) => ur.ur.callTypes.prompts.deactivate(ADV),
  },
  {
    label: 'prompts.proposal',
    pattern: '/v1/call-types/{}/prompts/proposal',
    invoke: (ur) => ur.ur.callTypes.prompts.proposal(ADV),
  },
  {
    label: 'verifiedMemory.get',
    pattern: '/v1/call-types/{}/verified-memory',
    invoke: (ur) => ur.ur.callTypes.verifiedMemory.get(ADV),
  },
  {
    label: 'verifiedMemory.enable',
    pattern: '/v1/call-types/{}/verified-memory/enable',
    invoke: (ur) => ur.ur.callTypes.verifiedMemory.enable(ADV),
  },
  {
    label: 'verifiedMemory.disable',
    pattern: '/v1/call-types/{}/verified-memory/disable',
    invoke: (ur) => ur.ur.callTypes.verifiedMemory.disable(ADV),
  },
  {
    label: 'sourceChecks.answer',
    pattern: '/v1/flywheel/source-checks/{}/verdicts',
    invoke: (ur) => ur.ur.flywheel.sourceChecks.answer(ADV, { verdicts: [] } as never),
  },
  {
    label: 'oracles.get',
    pattern: '/v1/flywheel/oracles/{}',
    invoke: (ur) => ur.ur.oracles.get(ADV),
  },
  {
    label: 'oracles.qualify',
    pattern: '/v1/flywheel/oracles/{}/qualify',
    invoke: (ur) => ur.ur.oracles.qualify(ADV, { examples: [] } as never),
  },
  {
    label: 'oracles.test',
    pattern: '/v1/flywheel/oracles/{}/test',
    invoke: (ur) => ur.ur.oracles.test(ADV),
  },
  {
    label: 'oracles.revoke',
    pattern: '/v1/flywheel/oracles/{}/revoke',
    invoke: (ur) => ur.ur.oracles.revoke(ADV),
  },
  {
    label: 'oracles.claimJobs',
    pattern: '/v1/flywheel/oracles/{}/jobs/claim',
    invoke: (ur) => ur.ur.oracles.claimJobs(ADV, {}, { secret: 's' }),
  },
  {
    label: 'oracles.submitVerdicts',
    pattern: '/v1/flywheel/oracles/{}/verdicts',
    invoke: (ur) => ur.ur.oracles.submitVerdicts(ADV, { verdicts: [] } as never, { secret: 's' }),
  },
  {
    label: 'experiments.enrol',
    pattern: '/v1/flywheel/experiments/{}/executions',
    invoke: (ur) =>
      ur.ur.flywheel.experiments.enrol(ADV, { phase: 'screen', pair_key: 'p', slot: 0 }),
  },
  {
    label: 'experiments.outcome',
    pattern: '/v1/flywheel/experiments/{}/executions/{}/outcome',
    invoke: (ur) =>
      ur.ur.flywheel.experiments.outcome(ADV, ADV, {
        terminal: 'delivered',
        reason_codes: [],
        reason_vocab: 'rv',
        receipts: [
          {
            ordinal: 0,
            stage: 'writer',
            call_type: 'ct',
            request_id: 'req_1',
            extractor_version: 'ex',
            numbers: {},
          },
        ],
        final_content_hash: 'h',
        request_ids: ['req_1'],
      }),
  },
  {
    label: 'experiments.evaluateScreen',
    pattern: '/v1/flywheel/experiments/{}/screen/evaluate',
    invoke: (ur) => ur.ur.flywheel.experiments.evaluateScreen(ADV),
  },
  {
    label: 'experiments.evaluateTest',
    pattern: '/v1/flywheel/experiments/{}/test/evaluate',
    invoke: (ur) => ur.ur.flywheel.experiments.evaluateTest(ADV),
  },
  {
    label: 'outcomes.receipt',
    pattern: '/v1/outcome-receipts/{}',
    invoke: (ur) => ur.ur.outcomes.receipt(ADV),
  },
  {
    label: 'outcomes.receiptsForRequest',
    pattern: '/v1/requests/{}/outcome-receipts',
    invoke: (ur) => ur.ur.outcomes.receiptsForRequest(ADV),
  },
  {
    label: 'learning.status',
    pattern: '/v1/call-types/{}/learning',
    invoke: (ur) => ur.ur.learning.status(ADV),
  },
  {
    label: 'learning.toolDocumentation',
    pattern: '/v1/call-types/{}/learning/tool-documentation',
    invoke: (ur) => ur.ur.learning.toolDocumentation(ADV),
  },
  {
    label: 'learning.putToolDocumentation',
    pattern: '/v1/call-types/{}/learning/tool-documentation',
    invoke: (ur) => ur.ur.learning.putToolDocumentation(ADV, { tools: [] }),
  },
  {
    label: 'learning.enable',
    pattern: '/v1/call-types/{}/learning/enable',
    invoke: (ur) => ur.ur.learning.enable(ADV, { reflection_model: 'm' }),
  },
  {
    label: 'learning.pause',
    pattern: '/v1/call-types/{}/learning/pause',
    invoke: (ur) => ur.ur.learning.pause(ADV),
  },
  {
    label: 'learning.resume',
    pattern: '/v1/call-types/{}/learning/resume',
    invoke: (ur) => ur.ur.learning.resume(ADV),
  },
  {
    label: 'learning.disable',
    pattern: '/v1/call-types/{}/learning/disable',
    invoke: (ur) => ur.ur.learning.disable(ADV),
  },
  {
    label: 'learning.versions',
    pattern: '/v1/call-types/{}/learning/versions',
    invoke: (ur) => ur.ur.learning.versions(ADV),
  },
  {
    label: 'learning.version',
    pattern: '/v1/call-types/{}/learning/versions/{}',
    invoke: (ur) => ur.ur.learning.version(ADV, ADV),
  },
  {
    label: 'learning.rollback',
    pattern: '/v1/call-types/{}/learning/rollback',
    invoke: (ur) => ur.ur.learning.rollback(ADV, { version_id: ADV }),
  },
  {
    label: 'learning.promote',
    pattern: '/v1/call-types/{}/learning/versions/{}/promote',
    invoke: (ur) => ur.ur.learning.promote(ADV, ADV),
  },
  {
    label: 'learning.reject',
    pattern: '/v1/call-types/{}/learning/versions/{}/reject',
    invoke: (ur) => ur.ur.learning.reject(ADV, ADV),
  },
  {
    label: 'learning.evaluations',
    pattern: '/v1/call-types/{}/learning/evaluations',
    invoke: (ur) => ur.ur.learning.evaluations(ADV),
  },
];

/** The exact wire path a row must produce: its pattern with the encoded id spliced into every `{}` slot. */
function expectedPath(pattern: string): string {
  return BASE + pattern.split('{}').join(ENC);
}

/**
 * Derive the set of path-segment id patterns straight from the client source — this is the completeness
 * oracle. A `/v1/…` template literal contributes a pattern for every `${…}` interpolation that sits in a
 * PATH segment: it is immediately preceded by `/` and occurs before the first literal `?` (a query
 * interpolation like `?id=${…}`, and a query-string appender like `models${suffix}`, are excluded). A new
 * id-taking method therefore ADDS a pattern the table has not declared, and this check goes RED.
 */
function scanPathIdPatterns(source: string): Set<string> {
  const patterns = new Set<string>();
  const literalRe = /`(\/v1\/[^`]*)`/g;
  const interpRe = /\$\{[^}]*\}/g;
  let lit: RegExpExecArray | null;
  while ((lit = literalRe.exec(source)) !== null) {
    const prefix = lit[1]!.split('?')[0]!; // the path portion (query interpolations dropped)
    const interps = prefix.match(interpRe);
    if (interps === null) continue; // no interpolation in the path → not an id-taking template
    let allSlashPreceded = true;
    let m: RegExpExecArray | null;
    interpRe.lastIndex = 0;
    while ((m = interpRe.exec(prefix)) !== null) {
      if (prefix[m.index - 1] !== '/') {
        allSlashPreceded = false; // e.g. `models${suffix}` — a query-string appender, not a path id
        break;
      }
    }
    if (!allSlashPreceded) continue;
    patterns.add(prefix.replace(interpRe, '{}'));
  }
  return patterns;
}

describe('every path-id method percent-encodes its id', () => {
  for (const row of TABLE) {
    it(`${row.label} → ${row.pattern} encodes the adversarial id`, async () => {
      const rec = recordingFetch();
      const ur = new UltraRouter({ apiKey: 'k', baseURL: BASE, fetch: rec.fetch });
      if (row.rejectsInvalidId === true) {
        await expect(row.invoke(ur)).rejects.toMatchObject({ code: 'invalid_request', status: 0 });
        expect(() => rec.url()).toThrow('no request captured');
        return;
      }
      await row.invoke(ur).catch(() => undefined);
      // Compare the PATH portion (before any real query separator); the id's own `?` is `%3F`, so the
      // only literal `?` that can survive is a genuine query (e.g. bench.report's `?format=json`).
      const pathOnWire = rec.url().split('?')[0];
      expect(pathOnWire).toBe(row.expected ?? expectedPath(row.pattern));
      // Defence-in-depth: the id may never inject a bare separator into the wire path (model ids
      // deliberately keep their provider separator, and are checked by their explicit expectation).
      if (row.expected === undefined) expect(pathOnWire).not.toContain('/a/b'); // the raw `/` must be %2F
      expect(rec.url()).not.toContain('#'); // the raw `#` must be %23
    });
  }

  it('the table is COMPLETE — every path-id site in client.ts has a row (add one ⇒ RED)', () => {
    const source = readFileSync(new URL('../src/client.ts', import.meta.url), 'utf8');
    const fromSource = scanPathIdPatterns(source);
    const fromTable = new Set(TABLE.map((r) => r.pattern));
    expect(fromSource.size).toBeGreaterThan(0);
    expect(fromTable).toEqual(fromSource);
  });

  // generation.get puts its id in a QUERY param, not a path segment, so it is not in the path table —
  // but it must still encode (an unencoded `&`/`#` would inject/truncate the query). Parity with Python.
  it('generation.get encodes its query id too', async () => {
    const rec = recordingFetch();
    const ur = new UltraRouter({ apiKey: 'k', baseURL: BASE, fetch: rec.fetch });
    await ur.ur.generation.get(ADV).catch(() => undefined);
    expect(rec.url()).toBe(`${BASE}/v1/generation?id=${ENC}`);
  });
});
