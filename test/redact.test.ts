// No credential reaches a published PR comment or Check Run: whole header values (scheme included),
// JSON / query / URL forms, and known token shapes are removed — through the excerpt parser AND the
// final comment renderer. Every secret below is SYNTHETIC and assembled at runtime, so this file
// itself never matches a secret scanner.
import { describe, expect, it } from 'vitest';

import { parseHarnessOutput, redactExcerpt } from '../src/cli/app-harness.js';
import type { WorkflowOutcome } from '../src/cli/gate.js';
import { buildCheckRun, buildComment } from '../src/cli/pr-comment.js';
import { redactSecrets } from '../src/cli/redact.js';

const join = (...parts: string[]): string => parts.join('');
const SYNTH = join('SYNTHETIC', '_REVIEW', '_TOKEN', '_0123456789');
const tokens = {
  ultrarouter: join('ur_sk_', 'test_', 'A'.repeat(32)),
  openai: join('sk-', 'proj-', 'B'.repeat(40)),
  anthropic: join('sk-', 'ant-', 'api03-', 'C'.repeat(40)),
  githubClassic: join('gh', 'p_', 'D'.repeat(36)),
  githubFine: join('github_', 'pat_', 'E'.repeat(60)),
  npm: join('np', 'm_', 'F'.repeat(36)),
  slack: join('xo', 'xb-', '1234-5678-', 'G'.repeat(20)),
  aws: join('AK', 'IA', 'H'.repeat(16)),
  jwt: join('ey', 'J', 'h'.repeat(20), '.ey', 'J', 'p'.repeat(20), '.', 's'.repeat(20)),
};

const LEAKY_LINES = [
  `Authorization: Bearer ${SYNTH}`,
  `authorization: bearer ${SYNTH}`,
  `Proxy-Authorization: Basic ${SYNTH}`,
  `Authorization: Token ${SYNTH}`,
  `Authorization: ${SYNTH}`,
  `Cookie: session=${SYNTH}; theme=dark`,
  `Set-Cookie: sid=${SYNTH}; HttpOnly`,
  `X-API-Key: ${SYNTH}`,
  `api_key=${SYNTH}&page=2`,
  `{"authorization":"Bearer ${SYNTH}","model":"m"}`,
  `{'Authorization': 'Bearer ${SYNTH}'}`,
  `headers: { authorization: 'Bearer ${SYNTH}' }`,
  `request failed: Bearer ${SYNTH} rejected`,
  `GET https://user:${SYNTH}@example.com/path`,
  `password=${SYNTH}`,
  `client_secret: ${SYNTH}`,
  ...Object.values(tokens).map((t) => `config value ${t} found`),
];

const ALL_SECRETS = [SYNTH, ...Object.values(tokens)];

function assertClean(text: string): void {
  for (const secret of ALL_SECRETS) {
    expect(text).not.toContain(secret);
    // No recognisable tail either (a scheme-only redaction would leave the credential behind).
    expect(text).not.toContain(secret.slice(-12));
  }
}

describe('redactSecrets', () => {
  it.each(LEAKY_LINES)('removes the whole credential from: %s', (line) => {
    const out = redactSecrets(line);
    assertClean(out);
    expect(out).toContain('[redacted]');
  });

  it('removes the scheme with the value (no "[redacted] <token>" remnant)', () => {
    expect(redactSecrets(`Authorization: Bearer ${SYNTH}`)).toBe('Authorization: [redacted]');
    expect(redactSecrets(`Proxy-Authorization: Basic ${SYNTH}`)).toBe(
      'Proxy-Authorization: [redacted]',
    );
  });

  it('is idempotent and leaves ordinary diagnostic text alone', () => {
    const plain =
      'expected status 200, got 503 after 3 tokens; max_tokens: 256; Token budget exceeded; see https://example.com/docs';
    expect(redactSecrets(plain)).toBe(plain);
    const once = redactSecrets(LEAKY_LINES.join('\n'));
    expect(redactSecrets(once)).toBe(once);
  });

  it('removes email addresses', () => {
    expect(redactSecrets('owner jane.doe@example.com failed')).toBe(
      'owner [email redacted] failed',
    );
  });
});

describe('redactExcerpt (the harness excerpt path)', () => {
  it('redacts before truncating, so a cut never exposes a secret tail', () => {
    const long = `${'x'.repeat(190)} Authorization: Bearer ${SYNTH}`;
    const out = redactExcerpt(long);
    assertClean(out);
    expect(out.length).toBeLessThanOrEqual(201);
  });
});

function outcome(over: Partial<WorkflowOutcome> = {}): WorkflowOutcome {
  return {
    workflowId: 'wf_checkout',
    headline: 'regression_found',
    conclusion: 'failure',
    coverage: 'application',
    surfaces: ['prompt'],
    application: {
      coverage: 'application',
      baselineOutcome: 'passed',
      candidateOutcome: 'failed',
      sample: 10,
      passed: 8,
      failed: 2,
      qualityPoint: null,
      qualityLow: null,
      qualityHigh: null,
      costUsd: null,
      latencyMs: null,
      debugFailures: [],
    },
    gate: null,
    gateVerdict: null,
    evidenceHash: 'a'.repeat(64),
    stale: false,
    reasons: [],
    nextAction: 'fix the failing workflow',
    evidenceUrl: null,
    ...over,
  } as WorkflowOutcome;
}

describe('the final PR-comment renderer', () => {
  it('harness output → parsed excerpts → comment: no credential survives', () => {
    const parsed = parseHarnessOutput(
      JSON.stringify({ status: 'failed', debugFailures: LEAKY_LINES.slice(0, 3) }),
    );
    expect(parsed?.debugFailures).toHaveLength(3);
    const base = outcome();
    const body = buildComment({
      ...base,
      application: { ...base.application!, debugFailures: parsed?.debugFailures ?? [] },
    });
    assertClean(body);
    expect(body).toContain('Authorization: [redacted]');
  });

  it('redacts even text that bypassed the excerpt parser (reasons, next action, extensions)', () => {
    const base = outcome();
    const body = buildComment(
      {
        ...base,
        reasons: [`harness said Authorization: Bearer ${SYNTH}`],
        nextAction: `retry with token=${SYNTH}`,
        application: { ...base.application!, debugFailures: LEAKY_LINES },
      },
      [`### candidate\n\nconfig value ${tokens.githubFine} found`],
    );
    assertClean(body);
    const check = buildCheckRun(
      { ...base, application: { ...base.application!, debugFailures: LEAKY_LINES } },
      'f'.repeat(40),
    );
    assertClean(check.output.summary);
  });
});

// ── Credential-bearing HEADER LINES are redacted in full; assignments and query parameters only lose
// their own value. Every value below is synthetic and assembled at runtime. ──

const S = {
  one: join('SYNTHETIC', '_COOKIE', '_ONE'),
  two: join('SYNTHETIC', '_COOKIE', '_TWO'),
  three: join('SYNTHETIC', '_COOKIE', '_THREE'),
  key: join('SYNTHETIC', '_QUOTED', '_KEY'),
  single: join('SYNTHETIC', '_SINGLE', '_KEY'),
  amz: join('SYNTHETIC', '_AMZ', '_SESSION'),
  hub: join('SYNTHETIC', '_HUB', '_SECRET'),
  digest: join('SYNTHETIC', '_DIGEST', '_RESPONSE'),
  negotiate: join('SYNTHETIC', 'NEGOTIATE', 'BLOB'),
  words: join('SYNTHETIC', ' TWO ', 'WORDS'),
  escaped: join('SYNTHETIC', '_ESCAPED', '_JSON'),
  numeric: join('9', '8765', '4321'),
  flag: join('SYNTHETIC', '_FLAG', '_VALUE'),
  query: join('SYNTHETIC', '_QUERY', '_TOKEN'),
  csrf: join('SYNTHETIC', '_CSRF'),
  array: join('SYNTHETIC', '_ARRAY', '_ITEM'),
};
const HEADER_SECRETS = Object.values(S);

/** [input, the exact redacted output]. */
const HEADER_CASES: [string, string][] = [
  // The two reproduced leaks.
  [`Cookie: first=${S.one}; session=${S.two}`, 'Cookie: [redacted]'],
  [`X-API-Key: "${S.key}"`, 'X-API-Key: [redacted]'],
  // Every pair of a cookie header, whatever the separator.
  [`cookie: a=${S.one}; b=${S.two}; c=${S.three}`, 'cookie: [redacted]'],
  [`Set-Cookie: sid=${S.one}; Path=/; HttpOnly, theme=${S.two}`, 'Set-Cookie: [redacted]'],
  // Any authorization scheme, including ones with quoted parameters.
  [`Authorization: Negotiate ${S.negotiate}`, 'Authorization: [redacted]'],
  [
    `Proxy-Authorization: Digest username="u", response="${S.digest}"`,
    'Proxy-Authorization: [redacted]',
  ],
  // API-key / *-Token / *-Secret style headers, quoted or not.
  [`api-key: '${S.single}'`, 'api-key: [redacted]'],
  [`X-Amz-Security-Token: ${S.amz}`, 'X-Amz-Security-Token: [redacted]'],
  [`X-Hub-Secret: "${S.hub}"`, 'X-Hub-Secret: [redacted]'],
  [`X-CSRF-Token:${S.csrf}`, 'X-CSRF-Token:[redacted]'],
  // A header line inside a log prefix or a quoted curl argument.
  [`> cookie: a=${S.one}; b=${S.two}`, '> cookie: [redacted]'],
  [`curl -H 'X-API-Key: ${S.key}' https://example.com/v1`, "curl -H 'X-API-Key: [redacted]"],
  // Assignments and query parameters: only their own value, quoted values whole.
  [`password="${S.words}" retries=3`, 'password="[redacted]" retries=3'],
  [`token='${S.words}'`, "token='[redacted]'"],
  [`session=${S.one}; theme=dark`, 'session=[redacted]; theme=dark'],
  [`GET /v1/x?access_token=${S.query}&page=2`, 'GET /v1/x?access_token=[redacted]&page=2'],
  // JSON, escaped JSON (a JSON document inside a JSON string), bare and array values.
  [`{"x-api-key":"${S.key}","model":"m"}`, '{"x-api-key":"[redacted]","model":"m"}'],
  [`{\\"x-api-key\\":\\"${S.escaped}\\"}`, '{\\"x-api-key\\":\\"[redacted]\\"}'],
  [`{"password": ${S.numeric}, "retries": 3}`, '{"password": [redacted], "retries": 3}'],
  [`{"credentials": ["${S.array}", "${S.two}"]}`, '{"credentials": [redacted]'],
  // CLI flags.
  [`ur bench run s --api-key ${S.flag} --json`, 'ur bench run s --api-key [redacted] --json'],
  [`ur bench run s --token=${S.flag}`, 'ur bench run s --token=[redacted]'],
];

describe('credential-bearing header lines (the whole value) vs assignments (their own value)', () => {
  it.each(HEADER_CASES)('%s', (input, expected) => {
    expect(redactSecrets(input)).toBe(expected);
  });

  it('leaves ordinary headers, counters and prose alone', () => {
    const plain = [
      'Content-Type: application/json',
      'X-Request-Id: req_0123',
      'max_tokens: 256; tokens: 12; token_count=4',
      'the tokenizer failed: Token budget exceeded',
      'author: someone; authored=yes',
    ].join('\n');
    expect(redactSecrets(plain)).toBe(plain);
  });

  it('is idempotent on every case, and on all of them joined', () => {
    for (const [input] of HEADER_CASES) {
      const once = redactSecrets(input);
      expect(redactSecrets(once)).toBe(once);
    }
    const all = HEADER_CASES.map(([i]) => i).join('\n');
    const once = redactSecrets(all);
    expect(redactSecrets(once)).toBe(once);
    for (const secret of HEADER_SECRETS) expect(once).not.toContain(secret);
  });

  it('a literal "[redacted]" in the input cannot shield the credential after it', () => {
    const out = redactSecrets(`Cookie: [redacted]; session=${S.two}\ntoken=[redacted]${S.one}`);
    expect(out).toBe('Cookie: [redacted]\ntoken=[redacted]');
  });
});

describe('header lines through the FINAL renderers (PR comment + Check Run)', () => {
  const leaky = HEADER_CASES.map(([input]) => input);

  function assertNoHeaderSecret(text: string): void {
    for (const secret of HEADER_SECRETS) expect(text).not.toContain(secret);
  }

  it('excerpts parsed from harness output, then rendered: no cookie pair or quoted key survives', () => {
    const parsed = parseHarnessOutput(
      JSON.stringify({ status: 'failed', debugFailures: [leaky[0], leaky[1], leaky[2]] }),
    );
    const base = outcome();
    const body = buildComment({
      ...base,
      application: { ...base.application!, debugFailures: parsed?.debugFailures ?? [] },
    });
    assertNoHeaderSecret(body);
    expect(body).toContain('Cookie: [redacted]');
    expect(body).toContain('X-API-Key: [redacted]');
    expect(redactSecrets(body)).toBe(body);
  });

  it('raw text that bypassed the excerpt parser: reasons, next action, debug failures, sections', () => {
    const base = outcome();
    const rendered = {
      ...base,
      reasons: leaky.slice(0, 4),
      nextAction: leaky[4]!,
      application: { ...base.application!, debugFailures: leaky },
    };
    const sections = [`### candidate\n\n${leaky.join('\n')}`];
    const body = buildComment(rendered, sections);
    assertNoHeaderSecret(body);
    expect(redactSecrets(body)).toBe(body);
    const check = buildCheckRun(rendered, 'f'.repeat(40), sections);
    assertNoHeaderSecret(check.output.summary);
    assertNoHeaderSecret(check.output.title);
    expect(redactSecrets(check.output.summary)).toBe(check.output.summary);
  });
});

describe('untrusted output cannot make redaction quadratic', () => {
  // Long runs of name/email/URL characters with nothing to redact. A pattern that may start anywhere
  // inside such a run re-scans it from every position (seconds at this size); every pattern here may
  // only start where its first character class does not continue, so this is milliseconds.
  it.each([
    ['a-a-a-…', 'a-'.repeat(128_000)],
    ['ab.cd_…', 'ab.cd_'.repeat(64_000)],
    ['dashes', '-'.repeat(256_000)],
  ])('%s (256 KiB) redacts in well under a second', (_name, text) => {
    const started = performance.now();
    expect(redactSecrets(text)).toBe(text);
    expect(performance.now() - started).toBeLessThan(5_000);
  });
});

// ── Encoded JSON: an escaped quote inside a value is never its closing delimiter, at any nesting
// level (a JSON document serialized into a JSON string, and again). ──

describe('escape-aware quoted values (single-, double- and triple-encoded JSON)', () => {
  const first = join('FIRST', '_SYNTHETIC');
  const last = join('LAST', '_SYNTHETIC');
  const tail = join('TAIL', '_SYNTHETIC');
  const value = `${first}"${last}`;
  const encode = (v: unknown, times: number): string => {
    let out = JSON.stringify(v);
    for (let i = 1; i < times; i += 1) out = JSON.stringify(out);
    return out;
  };
  const secretsIn = (text: string): string[] => [first, last, tail].filter((s) => text.includes(s));

  const ENCODED: [string, string][] = [];
  for (const times of [1, 2, 3, 4]) {
    ENCODED.push([
      `${String(times)}× encoded password with a quote`,
      encode({ password: value }, times),
    ]);
    ENCODED.push([
      `${String(times)}× encoded api_key with a backslash before the closing quote`,
      encode({ api_key: `${first}\\`, model: 'm' }, times),
    ]);
    ENCODED.push([
      `${String(times)}× encoded token with a quote and a backslash-quote`,
      encode({ token: `${first}\\"${last}"${tail}` }, times),
    ]);
    ENCODED.push([
      `${String(times)}× encoded nested headers object`,
      encode(
        { request: { headers: { 'x-api-key': value, cookie: `a=${first}; b="${last}"` } } },
        times,
      ),
    ]);
  }
  ENCODED.push(['single-quoted with an escaped quote', `{'password': '${first}\\'${last}'}`]);
  ENCODED.push(['an assignment with an escaped quote', `password="${first}\\"${last}" next=1`]);
  ENCODED.push(['a flag with an escaped quote', `--password "${first}\\"${last}" --json`]);

  it.each(ENCODED)('%s: no part of the value survives', (_name, text) => {
    const out = redactSecrets(text);
    expect(secretsIn(out)).toEqual([]);
    expect(redactSecrets(out)).toBe(out);
  });

  it('keeps the structure after a correctly closed encoded value', () => {
    expect(redactSecrets(encode({ password: value, model: 'm' }, 2))).toBe(
      '"{\\"password\\":\\"[redacted]\\",\\"model\\":\\"m\\"}"',
    );
    expect(redactSecrets(encode({ api_key: `${first}\\`, model: 'm' }, 1))).toBe(
      '{"api_key":"[redacted]","model":"m"}',
    );
  });

  it.each(ENCODED)('%s: through buildComment and buildCheckRun', (_name, text) => {
    const base = outcome();
    const rendered = {
      ...base,
      reasons: [text],
      nextAction: text,
      application: { ...base.application!, debugFailures: [text] },
    };
    const body = buildComment(rendered, [`### candidate\n\n${text}`]);
    expect(secretsIn(body)).toEqual([]);
    const check = buildCheckRun(rendered, 'f'.repeat(40), [`### candidate\n\n${text}`]);
    expect(secretsIn(check.output.summary)).toEqual([]);
    // The harness excerpt path too.
    const parsed = parseHarnessOutput(JSON.stringify({ status: 'failed', debugFailures: [text] }));
    expect(secretsIn(parsed?.debugFailures?.join('\n') ?? '')).toEqual([]);
  });
});

describe('repeated fields on one line stay linear', () => {
  it.each([
    ['assignments', 'token=a '.repeat(32_768)],
    ['query parameters', `GET /x?${'api_key=v&'.repeat(28_000)}`],
    ['header-style fields', 'password: '.repeat(25_000)],
    ['quoted JSON fields', '"token":"v",'.repeat(20_000)],
    ['unclosed quoted values', 'token="v '.repeat(28_000)],
    ['flags', '--token v '.repeat(25_000)],
    ['JSON-Web-Token look-alikes', 'eyJabcdefghij-'.repeat(18_000)],
  ])('%s (~256 KiB on one line) redact in well under a second', (_name, text) => {
    const started = performance.now();
    redactSecrets(text);
    expect(performance.now() - started).toBeLessThan(5_000);
  });
});
