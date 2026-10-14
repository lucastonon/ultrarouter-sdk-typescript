// The change → workflow binding matrix and `Needs configuration` on unmapped changes. Drives the
// real built `ur app-ci` bin in detection-only (`--fork`) mode so
// the assertions isolate DETECTION: which configured surface each changed path binds to, which
// workflows a diff touches, and that an unknown/unmapped change is advisory `Needs configuration`
// (a distinct non-success — never a passing quality verdict).
import { writeFileSync } from 'node:fs';

import { mkdtempSync, tmpdir, join, writeConfig, runBin, makeChecker } from './lib.mjs';

const CONFIG = {
  repository: 'acme/app',
  datasetSplit: 'holdout-a',
  evidenceEpoch: 'epoch-2026-09',
  workflows: [
    {
      id: 'wf_checkout',
      objective: 'checkout-accuracy',
      evaluatorVersion: 'eval.v3',
      coverage: 'application',
      testCommand: 'true',
      surfaces: [
        { kind: 'prompt', paths: ['prompts/checkout/**'] },
        { kind: 'tool_schema', paths: ['schemas/checkout/*.json'] },
      ],
    },
    {
      id: 'wf_search',
      objective: 'search-recall',
      evaluatorVersion: 'eval.v2',
      coverage: 'application',
      testCommand: 'true',
      surfaces: [
        { kind: 'model', paths: ['config/models.search.json'] },
        { kind: 'retrieval_config', paths: ['retrieval/search.yaml'] },
        { kind: 'context_module', paths: ['context/search/**'] },
        { kind: 'sop', paths: ['sops/search/**'] },
      ],
    },
  ],
};

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'ur-app-ci-binding-'));
  const configPath = writeConfig(dir, CONFIG);
  const { check, done } = makeChecker('change→workflow binding + Needs configuration');

  const run = (changedFiles, { raw = false } = {}) =>
    runBin(
      [
        'app-ci',
        '--config',
        configPath,
        '--repo',
        'acme/app',
        '--base',
        'aaaa',
        '--head',
        'bbbb',
        '--fork', // detection-only: no harness exec, no secrets, no git needed
        '--no-publish',
        '--json',
        ...(raw ? changedFiles : changedFiles.flatMap((f) => ['--changed-file', f])),
      ],
      { cwd: dir },
    );

  // Each surface kind binds to its configured workflow.
  const cases = [
    { file: 'prompts/checkout/system.txt', wf: 'wf_checkout', kind: 'prompt' },
    { file: 'schemas/checkout/order.json', wf: 'wf_checkout', kind: 'tool_schema' },
    { file: 'config/models.search.json', wf: 'wf_search', kind: 'model' },
    { file: 'retrieval/search.yaml', wf: 'wf_search', kind: 'retrieval_config' },
    { file: 'context/search/policy.md', wf: 'wf_search', kind: 'context_module' },
    { file: 'sops/search/refunds.md', wf: 'wf_search', kind: 'sop' },
  ];
  for (const c of cases) {
    const r = await run([c.file]);
    const wf = r.json?.workflows?.find((w) => w.workflow_id === c.wf);
    check(
      `${c.file} → workflow ${c.wf} (${c.kind})`,
      r.json?.detection?.affected_workflows?.includes(c.wf) === true &&
        wf?.surfaces?.includes(c.kind) === true &&
        r.json?.detection?.needs_configuration === false,
      JSON.stringify(r.json?.detection),
    );
  }

  // A path with no configured surface ⇒ unmapped ⇒ Needs configuration (a non-success outcome).
  const unmapped = await run(['src/unrelated/foo.ts']);
  const configOutcome = unmapped.json?.workflows?.find((w) => w.workflow_id === '__config__');
  check(
    'an unmapped change ⇒ needs_configuration + a __config__ non-success outcome + exit 2',
    unmapped.json?.detection?.needs_configuration === true &&
      unmapped.json?.detection?.unmapped?.includes('src/unrelated/foo.ts') === true &&
      configOutcome?.headline === 'needs_configuration' &&
      configOutcome?.conclusion === 'action_required' &&
      unmapped.code === 2,
    `code=${unmapped.code} ${JSON.stringify(unmapped.json?.detection)}`,
  );

  // A MIXED diff (one mapped + one unmapped) still surfaces Needs configuration AND the mapped wf.
  const mixed = await run(['prompts/checkout/x.txt', 'random/thing.py']);
  check(
    'a mixed diff surfaces the mapped workflow AND needs_configuration (never a silent pass)',
    mixed.json?.detection?.affected_workflows?.includes('wf_checkout') === true &&
      mixed.json?.detection?.needs_configuration === true &&
      mixed.code === 2,
    `code=${mixed.code} ${JSON.stringify(mixed.json?.detection)}`,
  );

  // An EXPLICIT empty change list (an empty --changed-from file) is a genuine "no changes".
  const emptyList = join(dir, 'changed.txt');
  writeFileSync(emptyList, '');
  const noChange = await run(['--changed-from', emptyList], { raw: true });
  check(
    'an explicit empty change list ⇒ no affected workflows + no config surface + exit 0',
    (noChange.json?.detection?.affected_workflows?.length ?? -1) === 0 &&
      noChange.json?.detection?.needs_configuration === false &&
      noChange.code === 0,
    `code=${noChange.code} ${JSON.stringify(noChange.json?.detection)}`,
  );

  // NO change list and revisions git cannot resolve ⇒ discovery failed ⇒ exit 2, never a pass.
  const unknown = await run([]);
  check(
    'no change list + unresolvable revisions ⇒ fail closed (exit 2), never "no changes"',
    unknown.code === 2 && /cannot determine the changed files/.test(unknown.stderr),
    `code=${unknown.code} ${unknown.stderr.trim()}`,
  );

  done();
}

main().catch((e) => {
  console.error('fatal', e);
  process.exit(1);
});
