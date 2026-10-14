#!/usr/bin/env node
/**
 * docs-claims — keep customer-facing copy honest. Scans `README.md`, `AGENTS.md`, `CHANGELOG.md`,
 * `llms.txt`, `llms-full.txt` and `docs/**\/*.md` and fails on:
 *
 * - `lossless`        — reserved for byte-preserving transport or storage; a model-visible prompt
 *                       rewrite is never "lossless". Allowed only when the line says it is a
 *                       deprecated / legacy alias or otherwise negates the claim.
 * - `grade-claim`     — "<vendor>-grade" style borrowed-credibility claims.
 * - `measured-cost`   — "measured" applied to cost or savings without a provenance qualifier
 *                       (provider-reported, replayable, invoice, reconciled) or a negation.
 * - `savings-percent` — a savings percentage without an estimate / illustrative qualifier in the
 *                       same clause.
 * - `never-train`     — a blanket first-person promise never to train on customer data.
 * - `ga-claim`        — copy implying the hosted service is generally available.
 *
 * A legitimate mention can be allowed on its line with `<!-- claims-allow: <id> — <reason> -->`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

// "lossless" is fine for byte-preserving reconstruction (the context runtime's exit rebuilds the
// exact original messages from its segments), never for a model-visible prompt rewrite.
const LOSSLESS_OK =
  /(deprecat|legacy|alias|not a guarantee|is not lossless|never lossless|byte-preserv|byte-identical|segments are lossless|transport|storage)/i;
const MEASURED_COST =
  /\bmeasured\b[^.]{0,60}\b(cost|saving|savings|spend|cheaper|price)\b|\b(cost|saving|savings|spend|price)\b[^.]{0,60}\bmeasured\b/i;
const MEASURED_OK = /(provider[- ]reported|replayable|invoice|reconcil|\bnot\b|\bnever\b|isn'?t)/i;
const SAVINGS_TERM =
  /(saving|saved|\bsaves?\b|cheaper|reduc(?:e|es|ed|ing|tion)\b|discount|\bcuts?\b|\bcutting\b|\blower(?:s|ed|ing)?\b|less spend)/i;
const PERCENT = /(\d+(?:\.\d+)?)\s?%/g;
const PCT_OK =
  /(estimat|project|up to|typical|example|illustrat|hypothetical|approx|roughly|~|±|target|threshold|margin|confidence|provider[- ]?report|reconcil)/i;
const NEVER_TRAIN =
  /\b(we|ultrarouter)\b[^.]{0,40}\b(never|don'?t|do not|will not|won'?t)\b[^.]{0,30}\btrain/i;
const GRADE = /\b[A-Z][A-Za-z]+[\s-]grade\b/;
const GA = /\b(generally available|general availability|production[- ]ready service|GA release)\b/i;

/** The files the lint covers (relative to the repo root). */
export function claimFiles() {
  const out = ['README.md', 'AGENTS.md', 'CHANGELOG.md', 'llms.txt', 'llms-full.txt'].filter(
    (f) => {
      try {
        return statSync(join(ROOT, f)).isFile();
      } catch {
        return false;
      }
    },
  );
  const walk = (dir) => {
    for (const name of readdirSync(join(ROOT, dir)).sort()) {
      const rel = join(dir, name);
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
      else if (name.endsWith('.md')) out.push(rel);
    }
  };
  walk('docs');
  return out;
}

/**
 * Lint one text. Returns `{ line, rule, text }` findings.
 * @param {string} text
 */
export function lintClaims(text) {
  const findings = [];
  const lines = text.split('\n');
  let inFence = false;
  lines.forEach((raw, i) => {
    // Code is not copy: inside a fenced block only comments are linted, and inline code spans are
    // dropped from prose (an enum literal such as `'lossless'` is not a claim).
    if (/^\s*```/.test(raw)) {
      inFence = !inFence;
      return;
    }
    const comment = /(?:\/\/|^\s*#)\s?(.*)$/.exec(raw)?.[1];
    if (inFence && comment === undefined) return;
    const line = inFence ? (comment ?? '') : raw.replace(/`[^`]*`/g, '``');
    const allow = /claims-allow:\s*([a-z-]+)/.exec(`${lines[i - 1] ?? ''} ${line}`)?.[1];
    const hit = (rule) => {
      if (allow !== rule) findings.push({ line: i + 1, rule, text: line.trim().slice(0, 160) });
    };
    if (/\blossless\b/i.test(line) && !LOSSLESS_OK.test(line)) hit('lossless');
    if (GRADE.test(line) && !/\b(production|enterprise|commercial)[\s-]grade\b/i.test(line))
      hit('grade-claim');
    if (MEASURED_COST.test(line) && !MEASURED_OK.test(line)) hit('measured-cost');
    if (SAVINGS_TERM.test(line)) {
      for (const m of line.matchAll(PERCENT)) {
        const clause = line.slice(Math.max(0, (m.index ?? 0) - 80), (m.index ?? 0) + 80);
        if (!PCT_OK.test(clause)) hit('savings-percent');
      }
    }
    if (NEVER_TRAIN.test(line)) hit('never-train');
    if (GA.test(line) && !/\bnot\b/i.test(line)) hit('ga-claim');
  });
  return findings;
}

function main() {
  let total = 0;
  for (const file of claimFiles()) {
    for (const f of lintClaims(readFileSync(join(ROOT, file), 'utf8'))) {
      total += 1;
      process.stderr.write(`${file}:${String(f.line)}: [${f.rule}] ${f.text}\n`);
    }
  }
  if (total > 0) {
    process.stderr.write(`docs-claims: ${String(total)} finding(s)\n`);
    return 1;
  }
  process.stdout.write(`docs-claims: ok (${String(claimFiles().length)} file(s))\n`);
  return 0;
}

if (
  process.argv[1] !== undefined &&
  relative(process.argv[1], fileURLToPath(import.meta.url)) === ''
) {
  process.exitCode = main();
}
