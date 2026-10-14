---
ur_format: "ur.knowledge/1"
id: "pack_release_checklist"
version: 3
kind: "sop"
memory_class: "procedural"
trust_class: "authoritative"
slot: "instruction"
descriptor: "release/checklist (v1.2)"
applies_when: {"type":"all","of":[{"type":"call_type_is","callTypeId":"release-notes"},{"type":"any","of":[{"type":"facet_eq","facet":"channel","value":"stable"},{"type":"facet_in","facet":"channel","values":["beta","rc"]}]},{"type":"not","of":{"type":"archetype_is","archetype":"draft"}}]}
phase: ["plan","build","verify","ship"]
single_use: false
native_delivery: "inline"
token_estimate: 180
validity:
  from: "2026-01-01T00:00:00.000Z"
  to: null
  epoch_binding: "v1.2"
  invalidation_triggers: ["ruleset/release/checks:changed","rubric/release-quality:changed"]
evidence:
  n: 48
  clusters: 12
  interval: [0.71,0.9]
  evidence_tier: "authored"
  arm_sources: ["fixture_baseline","fixture_candidate"]
  window: {"start":"2026-01-01T00:00:00.000Z","end":"2026-03-31T00:00:00.000Z"}
lineage:
  fact_ids: ["fact_release_checklist_changelog","fact_release_checklist_rollback","fact_release_checklist_smoke","fact_release_exemplar_good","fact_release_exemplar_bad","fact_release_base_rate_verify","fact_release_refuted_friday"]
  rollup_digest: "4588e39e7814102a7148693d0dae13959ae772c008df37146745af9a0d4f565a"
  ranker_version: "ranker_fixture_v1"
consent:
  workspace: "ws_fixture"
  export_consent: true
  redaction_version: "redact1"
sop: {"name":"release/checklist","version_label":"v1.2","phases":[{"id":"plan","allowed_action_names":["read_spec","write_notes"],"required_policy_ids":["ruleset/release/checks"],"artifact_contracts":["release_plan"]},{"id":"build","allowed_action_names":["run_build","write_notes"],"required_policy_ids":["ruleset/release/checks"],"artifact_contracts":["build_log"]},{"id":"verify","allowed_action_names":["run_tests","run_smoke","write_notes"],"required_policy_ids":["ruleset/release/checks"],"artifact_contracts":["test_report","smoke_report"]},{"id":"ship","allowed_action_names":["tag_release","publish_notes"],"required_policy_ids":["ruleset/release/checks"],"artifact_contracts":["release_notes"]}],"dependencies":[{"kind":"PACKET","id":"packet/release/basics"},{"kind":"POLICY","id":"ruleset/release/checks"},{"kind":"RUBRIC","id":"rubric/release-quality"}],"transitions":{"forward":"linear","backward":["build"]},"invariant_phrases":["never skip the verify phase","every change ships with a rollback note"]}
content_hash: "085a7b4f03fc426fe692ba4cb70599e6112d7b724a771cf62fc31cf7ed5c1ac0"
provenance_hash: "be3da82ea0c0f4335d963a46068c5d3cd72e599507164a1d5d4ea99e76e695de"
---

## checklist
- {"fact_id":"fact_release_checklist_changelog","text":"Write the changelog entry before tagging the release."}
- {"fact_id":"fact_release_checklist_rollback","text":"Every change ships with a rollback note."}
- {"fact_id":"fact_release_checklist_smoke","text":"Run the smoke suite against the release candidate."}

## exemplars
- {"fact_id":"fact_release_exemplar_good","outcome":"release_succeeded","polarity":"positive","rendering":"Release notes listed every user-visible change and linked the rollback steps.","outcome_event_ids":["evt_fixture_release_001","evt_fixture_release_002"]}
- {"fact_id":"fact_release_exemplar_bad","outcome":"release_rolled_back","polarity":"negative","rendering":"Release skipped the verify phase and shipped an untested migration.","outcome_event_ids":["evt_fixture_release_003"]}

## base_rates
- {"fact_id":"fact_release_base_rate_verify","subject":"releases that completed the verify phase","rate":0.82,"n":48,"interval":[0.71,0.9]}

## refuted
- {"fact_id":"fact_release_refuted_friday","assertion":"Releases on Fridays fail more often.","refuting_outcome_id":"evt_fixture_release_004"}
