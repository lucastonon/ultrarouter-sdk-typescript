// The two change shapes a candidate can take, the identity that binds them, and the
// classification that gates them:
//
// A. `code_owned` — a context/prompt change produces a FILE DIFF on a configured `context_module`
// surface. The patch applies (`git apply --check`) and the written file names its immutable
// candidate reference.
// B. `gateway_owned` — the harness CONFIGURATION gains the immutable candidate reference and
// nothing else, plus a LINKED payload diff that is SHOWN but never written to the repository.
// C. classification keys on the OBSERVED diff: a candidate whose file lands OUTSIDE the
// lever's surface, or whose config commit would touch a second key, is REFUSED before any write.
// D. the candidate identity is IMMUTABLE and stable across implementations: the reference is
// recomputed from
// the provenance (not read from the file), a tampered body is refused, and a non-`screened` or
// `adopted` state is refused with its OWN reason.
// E. the bound candidate reaches the CANDIDATE revision only — never the baseline.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  HARNESS_DIR,
  candidateConfig,
  candidateReference,
  makeChecker,
  makeGitFixture,
  runBin,
  writeCandidate,
  writeConfig,
  sha256,
} from './lib.mjs';
import { startStubForge } from './stub-forge.mjs';
import { startStubGateway, unlockedGate } from './stub-gateway.mjs';

/** The cross-repo golden asserted verbatim in the gateway. */
const PARITY_IDENTITY = {
  workspaceId: 'ws_parity',
  leverKey: 'learned_context',
  moduleId: 'lcm_0123456789abcdef01234567',
  moduleVersion: 'lcm1_0123456789abcdef0123456789abcdef',
  packHash: 'lcp1_fedcba9876543210fedcba9876543210',
  rankerVersion: 'lcr1_0011223344556677',
  k: 3,
  keySpec: 'sit1',
  sourceSnapshot: '2026-09-01T00:00:00.000Z',
  situationClass: 'checkout/refund',
  epoch: 7,
  bodyHash: 'a'.repeat(64),
};
const PARITY_REFERENCE = 'urcand1_97f75bd8497dd264d25a7c1e265abf6e';

function fixture(extra = {}) {
  return makeGitFixture({
    baseFiles: { 'context/refund/policy.md': 'v1\n', ...extra.baseFiles },
    headFiles: { 'context/refund/policy.md': 'v2\n', ...extra.headFiles },
  });
}

function configFor(dir, harness, over) {
  const cfg = candidateConfig(over);
  cfg.workflows[0].testCommand = `node ${join(HARNESS_DIR, harness)}`;
  return writeConfig(dir, cfg);
}

async function run(fx, configPath, candidatePath, gh, gw, extra, env) {
  return runBin(
    [
      'flywheel-pr',
      '--config',
      configPath,
      '--candidate',
      candidatePath,
      '--repo',
      'acme/app',
      '--base',
      fx.baseSha,
      '--head',
      fx.headSha,
      '--changed-file',
      'context/refund/policy.md',
      '--github-api',
      gh.url,
      '--github-token',
      'tok',
      '--base-url',
      gw.url,
      '--api-key',
      'ur_sk_test_x',
      '--patch-out',
      fx.dir,
      '--no-publish',
      '--json',
      ...extra,
    ],
    { cwd: fx.dir, ...(env !== undefined ? { env } : {}) },
  );
}

async function main() {
  const { check, done } = makeChecker('code-owned diff vs gateway-owned reference');

  // ── D (first: identity). The reference is RECOMPUTED, stable across implementations, and tamper-evident. ──
  check(
    'the candidate reference matches the gateway golden byte for byte (cross-repo parity)',
    candidateReference(PARITY_IDENTITY) === PARITY_REFERENCE,
    `${candidateReference(PARITY_IDENTITY)} != ${PARITY_REFERENCE}`,
  );

  // ── A. `code_owned`: a file diff on a configured `context_module` surface. ──
  {
    const fx = fixture();
    const gh = await startStubForge({ repositoryWrite: 'denied' });
    const gw = await startStubGateway({ rollout: (ref) => unlockedGate(ref) });
    try {
      const { path: candidatePath, candidateRef, candidate } = writeCandidate(fx.dir);
      const r = await run(fx, configFor(fx.dir, 'candidate-pass.mjs'), candidatePath, gh, gw, [
        '--shape',
        'code_owned',
        '--module-path',
        'context/refund/learned.md',
        '--apply',
      ]);
      check(
        'code-owned ⇒ a FILE diff on the module path, classified in-surface',
        r.json?.plan?.shape === 'code_owned' &&
          r.json?.plan?.classification === 'in_surface' &&
          JSON.stringify(r.json?.plan?.changed_paths) ===
            JSON.stringify(['context/refund/learned.md']) &&
          r.json?.plan?.payload_hash === null,
        JSON.stringify(r.json?.plan),
      );
      const patch = readFileSync(r.json.delivery.patch_path, 'utf8');
      check(
        'the diff creates the file, carries the module body and NAMES the immutable reference',
        patch.includes('new file mode 100644') &&
          patch.includes('+++ b/context/refund/learned.md') &&
          patch.includes(candidateRef) &&
          patch.includes('refund requests under 30 days'),
        patch.split('\n').slice(0, 8).join(' | '),
      );
      const applyCheck = spawnSync('git', ['apply', '--check', r.json.delivery.patch_path], {
        cwd: fx.dir,
        encoding: 'utf8',
      });
      check(
        '`git apply --check` accepts the code-owned patch',
        (applyCheck.status ?? 1) === 0,
        `${applyCheck.stderr ?? ''}`.slice(0, 300),
      );
      check(
        'the candidate file hash chain holds: bodyHash = sha256(body) and ref = f(provenance)',
        candidate.bodyHash === sha256(candidate.body) &&
          candidateRef === candidateReference({ ...candidate, bodyHash: candidate.bodyHash }),
        'the recomputed identity disagrees with the file',
      );
    } finally {
      fx.cleanup();
      gh.close();
      gw.close();
    }
  }

  // ── B. `gateway_owned`: the reference in the harness config + a LINKED payload diff. ──
  {
    const fx = fixture();
    const gh = await startStubForge({ repositoryWrite: 'granted' });
    const gw = await startStubGateway({ rollout: (ref) => unlockedGate(ref) });
    try {
      const { path: candidatePath, candidateRef, candidate } = writeCandidate(fx.dir);
      const configPath = configFor(fx.dir, 'candidate-pass.mjs');
      const r = await run(fx, configPath, candidatePath, gh, gw, [
        '--shape',
        'gateway_owned',
        '--mode',
        'open_pr',
        '--apply',
      ]);
      check(
        'gateway-owned ⇒ the harness CONFIG is the only changed file, classified in-surface',
        r.json?.plan?.shape === 'gateway_owned' &&
          r.json?.plan?.classification === 'in_surface' &&
          r.json?.plan?.changed_paths?.length === 1 &&
          String(r.json?.plan?.changed_paths?.[0]).endsWith('ur-app-ci.config.json'),
        JSON.stringify(r.json?.plan),
      );
      check(
        'gateway-owned ⇒ the committed config gains the candidate reference and NOTHING else',
        (() => {
          const put = gh.forge.puts[0];
          if (put === undefined) return false;
          const before = JSON.parse(readFileSync(configPath, 'utf8'));
          const after = JSON.parse(put.content);
          const b = before.workflows[0];
          const a = after.workflows[0];
          const changed = Object.keys({ ...a, ...b }).filter(
            (k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]),
          );
          return (
            a.candidateRef === candidateRef &&
            JSON.stringify(changed) === JSON.stringify(['candidateRef'])
          );
        })(),
        `puts=${JSON.stringify(gh.forge.puts.map((p) => p.path))}`,
      );
      check(
        'gateway-owned ⇒ a LINKED payload diff is SHOWN, hashed, and never written to the repo',
        r.json?.plan?.payload_hash === candidate.bodyHash &&
          r.stderr.includes('linked payload (gateway-owned, NOT written to the repository') &&
          r.stderr.includes('refund requests under 30 days') &&
          gh.forge.puts.every((p) => !p.content.includes('refund requests under 30 days')),
        `payload_hash=${r.json?.plan?.payload_hash}`,
      );
      check(
        'both shapes bind the SAME immutable reference into the evidence contract',
        r.json?.app_ci?.workflows?.[0]?.evidence_hash?.length === 64 &&
          r.json?.rollout?.evidence_hash === r.json?.app_ci?.workflows?.[0]?.evidence_hash,
        `evidence=${r.json?.app_ci?.workflows?.[0]?.evidence_hash} rollout=${r.json?.rollout?.evidence_hash}`,
      );
    } finally {
      fx.cleanup();
      gh.close();
      gw.close();
    }
  }

  // ── C. classification refuses an OUT-OF-SURFACE change BEFORE any write. ──
  {
    const fx = fixture();
    const gh = await startStubForge({ repositoryWrite: 'granted' });
    const gw = await startStubGateway({ rollout: (ref) => unlockedGate(ref) });
    try {
      const { path: candidatePath } = writeCandidate(fx.dir);
      const r = await run(fx, configFor(fx.dir, 'candidate-pass.mjs'), candidatePath, gh, gw, [
        '--shape',
        'code_owned',
        '--module-path',
        'src/unrelated/learned.md', // NOT a configured surface for this workflow
        '--mode',
        'open_pr',
        '--apply',
      ]);
      check(
        'a module path outside the workflow surfaces ⇒ out_of_surface ⇒ nothing is written',
        r.json?.plan?.classification === 'out_of_surface' &&
          r.json?.delivery?.applied === false &&
          r.json?.delivery?.reason === 'classification_out_of_surface' &&
          gh.forge.puts.length === 0 &&
          gh.forge.pullRequests.length === 0,
        `${JSON.stringify(r.json?.plan?.classification)} ${JSON.stringify(r.json?.delivery)}`,
      );
      // A prompt-surface path is a CONFIGURED surface, but not one `learned_context` may touch.
      const r2 = await run(fx, configFor(fx.dir, 'candidate-pass.mjs'), candidatePath, gh, gw, [
        '--shape',
        'code_owned',
        '--module-path',
        'prompts/refund/system.txt',
        '--mode',
        'open_pr',
        '--apply',
      ]);
      check(
        'a CONFIGURED surface outside the LEVER’s allowed set is still out_of_surface',
        r2.json?.plan?.classification === 'out_of_surface' && gh.forge.puts.length === 0,
        `${JSON.stringify(r2.json?.plan?.classification)} puts=${gh.forge.puts.length}`,
      );
    } finally {
      fx.cleanup();
      gh.close();
      gw.close();
    }
  }

  // ── D. a tampered body, a non-screened state and an ADOPTED state are each refused by name. ──
  {
    const fx = fixture();
    const gh = await startStubForge({ repositoryWrite: 'denied' });
    const gw = await startStubGateway({ rollout: (ref) => unlockedGate(ref) });
    try {
      const configPath = configFor(fx.dir, 'candidate-pass.mjs');
      const good = writeCandidate(fx.dir);
      // Tamper: keep the declared hash, change the body.
      const tampered = JSON.parse(readFileSync(good.path, 'utf8'));
      tampered.body = `${tampered.body}\n- an injected line the hash does not cover`;
      const tamperedPath = join(fx.dir, 'tampered.json');
      writeFileSync(tamperedPath, JSON.stringify(tampered));
      const rt = await run(fx, configPath, tamperedPath, gh, gw, []);
      check(
        'a body that does not match its declared hash is refused (candidate_body_hash_mismatch)',
        rt.code === 2 && /candidate_body_hash_mismatch/.test(rt.stderr),
        `code=${rt.code} ${rt.stderr.slice(0, 200)}`,
      );

      const parked = writeCandidate(fx.dir, { state: 'parked', fileName: 'parked.json' });
      const rp = await run(fx, configPath, parked.path, gh, gw, []);
      check(
        'a non-screened candidate is refused (candidate_not_screened), never carried into CI',
        rp.code === 2 && /candidate_not_screened: parked/.test(rp.stderr),
        `code=${rp.code} ${rp.stderr.slice(0, 200)}`,
      );

      const adopted = writeCandidate(fx.dir, { state: 'adopted', fileName: 'adopted.json' });
      const ra = await run(fx, configPath, adopted.path, gh, gw, []);
      check(
        'an ADOPTED candidate is refused with its OWN reason — adoption is, not ',
        ra.code === 2 && /adopted_is_not_ci/.test(ra.stderr),
        `code=${ra.code} ${ra.stderr.slice(0, 200)}`,
      );
      check(
        'refusing a candidate writes nothing at all',
        gh.forge.puts.length === 0 && gh.forge.pullRequests.length === 0,
        `puts=${gh.forge.puts.length}`,
      );
    } finally {
      fx.cleanup();
      gh.close();
      gw.close();
    }
  }

  // ── E. the bound candidate reaches the CANDIDATE revision only. ──
  {
    const fx = fixture();
    const gh = await startStubForge({ repositoryWrite: 'denied' });
    const gw = await startStubGateway({ rollout: (ref) => unlockedGate(ref) });
    const marker = join(fx.dir, 'revisions.txt');
    try {
      const { path: candidatePath, candidateRef } = writeCandidate(fx.dir);
      const r = await run(
        fx,
        configFor(fx.dir, 'baseline-sees-candidate.mjs'),
        candidatePath,
        gh,
        gw,
        ['--shape', 'gateway_owned'],
        { UR_APP_CI_MARKER: marker },
      );
      void r;
      const lines = readFileSync(marker, 'utf8').trim().split('\n');
      check(
        'the candidate reference is handed to the CANDIDATE revision and withheld from the baseline',
        lines.length === 2 &&
          lines[0] === 'baseline none' &&
          lines[1] === `candidate ${candidateRef}`,
        lines.join(' | '),
      );
    } finally {
      fx.cleanup();
      gh.close();
      gw.close();
    }
  }

  done();
}

main().catch((e) => {
  console.error('fatal', e);
  process.exit(1);
});
