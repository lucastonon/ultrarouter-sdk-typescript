/**
 * Which SDK method covers each operation of the published OpenAPI document, and which test proves
 * it. `scripts/gen-docs.mjs` renders this into `docs/api-coverage.md`; `test/coverage-map.test.ts`
 * fails when an operation is missing from the map, when a listed method does not exist on the
 * client, or when a listed test file does not exist or never mentions the method.
 *
 * Every operation is also reachable through the typed `ur.request(method, path, …)` helper (proven
 * generically in `test/resources.test.ts`), and the mock gateway answers every operation with a
 * schema-valid body (`test/mock-gateway.test.ts`).
 */

/**
 * operationId → { methods: SDK call paths on an `UltraRouter` instance, tests: proving test files,
 * cli?: the `ur` command that uses it }. An empty `methods` list means "use `ur.request()`".
 * @type {Record<string, { methods: string[], tests: string[], cli?: string }>}
 */
export const COVERAGE = {
  // Ops
  healthz: { methods: [], tests: [] },
  readyz: { methods: [], tests: [] },
  echo: { methods: [], tests: [] },
  // Chat, embeddings, models, key
  createChatCompletion: {
    methods: ['chat.completions.create'],
    tests: ['test/client.test.ts', 'test/surface.test.ts'],
  },
  createEmbeddings: {
    methods: ['embeddings.create'],
    tests: ['test/client.test.ts', 'test/surface.test.ts'],
  },
  listModels: { methods: ['models.list'], tests: ['test/client.test.ts', 'test/surface.test.ts'] },
  getModel: {
    methods: ['models.retrieve'],
    tests: ['test/resources.test.ts', 'test/surface.test.ts'],
  },
  getKey: { methods: ['ur.key.get'], tests: ['test/resources.test.ts', 'test/surface.test.ts'] },
  // Native passthrough: the official OpenAI / Anthropic SDKs through the gateway. Opaque passthrough
  // bodies have no dedicated method; reach them with `ur.request()` (methods: [] means that).
  createResponse: { methods: [], tests: ['test/passthrough.test.ts'] },
  createMessage: { methods: [], tests: ['test/passthrough.test.ts'] },
  // Call types
  listCallTypes: {
    methods: ['ur.callTypes.list'],
    tests: ['test/client.test.ts', 'test/surface.test.ts'],
  },
  createCallType: { methods: ['ur.callTypes.create'], tests: ['test/surface.test.ts'] },
  getCallType: {
    methods: ['ur.callTypes.get'],
    tests: ['test/surface.test.ts', 'test/path-encoding.test.ts'],
  },
  updateCallType: {
    methods: ['ur.callTypes.update'],
    tests: ['test/surface.test.ts', 'test/path-encoding.test.ts'],
  },
  enqueueCallTypeEval: {
    methods: ['ur.callTypes.enqueueEval'],
    tests: ['test/client.test.ts', 'test/surface.test.ts'],
  },
  listCallTypeEvals: {
    methods: ['ur.callTypes.listEvals'],
    tests: ['test/resources.test.ts', 'test/surface.test.ts'],
  },
  listCallTypeRecommendations: {
    methods: ['ur.callTypes.recommendations'],
    tests: ['test/resources.test.ts', 'test/surface.test.ts'],
  },
  listHostedPrompts: {
    methods: ['ur.callTypes.prompts.list'],
    tests: ['test/resources.test.ts', 'test/surface.test.ts'],
  },
  createHostedPrompt: {
    methods: ['ur.callTypes.prompts.create'],
    tests: ['test/resources.test.ts', 'test/surface.test.ts'],
  },
  getHostedPrompt: {
    methods: ['ur.callTypes.prompts.get'],
    tests: ['test/resources.test.ts', 'test/surface.test.ts'],
  },
  activateHostedPrompt: {
    methods: ['ur.callTypes.prompts.activate'],
    tests: ['test/resources.test.ts', 'test/surface.test.ts'],
  },
  deactivateHostedPrompt: {
    methods: ['ur.callTypes.prompts.deactivate'],
    tests: ['test/resources.test.ts', 'test/surface.test.ts'],
  },
  getHostedPromptProposal: {
    methods: ['ur.callTypes.prompts.proposal'],
    tests: ['test/resources.test.ts', 'test/surface.test.ts'],
  },
  getVerifiedMemory: {
    methods: ['ur.callTypes.verifiedMemory.get'],
    tests: ['test/resources.test.ts', 'test/surface.test.ts'],
  },
  enableVerifiedMemory: {
    methods: ['ur.callTypes.verifiedMemory.enable'],
    tests: ['test/resources.test.ts', 'test/surface.test.ts'],
  },
  disableVerifiedMemory: {
    methods: ['ur.callTypes.verifiedMemory.disable'],
    tests: ['test/resources.test.ts', 'test/surface.test.ts'],
  },
  // Feedback, generation, audit readiness
  submitFeedback: {
    methods: ['ur.requests.feedback'],
    tests: ['test/client.test.ts', 'test/surface.test.ts'],
  },
  getGeneration: {
    methods: ['ur.generation.get'],
    tests: ['test/client.test.ts', 'test/surface.test.ts'],
  },
  getAuditReadiness: {
    methods: ['ur.autopilot.status'],
    tests: ['test/autopilot.test.ts', 'test/surface.test.ts'],
  },
  // Preflight
  preflight: {
    methods: ['preflight', 'useLearned', 'getPrompt'],
    tests: ['test/preflight.test.ts', 'test/prompt.test.ts', 'test/surface.test.ts'],
  },
  // Bench
  getBenchSuiteStatus: {
    methods: ['ur.bench.status'],
    tests: ['test/bench.test.ts', 'test/surface.test.ts'],
  },
  freezeBenchSuite: {
    methods: ['ur.bench.freeze'],
    tests: ['test/bench.test.ts', 'test/resources.test.ts', 'test/surface.test.ts'],
    cli: 'ur bench run',
  },
  triggerBenchRun: {
    methods: ['ur.bench.run'],
    tests: ['test/bench.test.ts', 'test/surface.test.ts'],
    cli: 'ur bench run',
  },
  getBenchRun: {
    methods: ['ur.bench.get'],
    tests: ['test/surface.test.ts', 'test/path-encoding.test.ts'],
    cli: 'ur bench run',
  },
  getBenchRunReport: {
    methods: ['ur.bench.report'],
    tests: ['test/bench.test.ts', 'test/surface.test.ts'],
  },
  attachBenchExpectations: {
    methods: ['ur.bench.expect'],
    tests: ['test/bench.test.ts', 'test/surface.test.ts'],
  },
  recordBenchSuiteOutcomes: {
    methods: ['ur.bench.record'],
    tests: ['test/bench.test.ts', 'test/surface.test.ts'],
  },
  recordBenchRunOutcomes: {
    methods: ['ur.bench.record'],
    tests: ['test/bench.test.ts', 'test/surface.test.ts'],
  },
  pinBenchBaseline: {
    methods: ['ur.bench.baseline'],
    tests: ['test/surface.test.ts', 'test/path-encoding.test.ts'],
    cli: 'ur bench baseline',
  },
  getBenchCompareGate: {
    methods: ['ur.bench.gate'],
    tests: ['test/surface.test.ts', 'test/path-encoding.test.ts'],
    cli: 'ur bench gate',
  },
  mintBenchShare: { methods: [], tests: [] },
  revokeBenchShare: { methods: [], tests: [] },
  listBenchShares: { methods: [], tests: [] },
  // Artifacts and outcomes
  upsertArtifactType: {
    methods: ['ur.artifactTypes.upsert'],
    tests: ['test/flywheel.test.ts', 'test/surface.test.ts'],
  },
  createArtifact: {
    methods: ['ur.artifacts.create'],
    tests: ['test/flywheel.test.ts', 'test/surface.test.ts'],
  },
  getArtifact: {
    methods: ['ur.artifacts.get'],
    tests: ['test/flywheel.test.ts', 'test/surface.test.ts'],
  },
  listArtifacts: {
    methods: ['ur.artifacts.list'],
    tests: ['test/flywheel.test.ts', 'test/surface.test.ts'],
  },
  recordArtifactFinal: {
    methods: ['ur.artifacts.final'],
    tests: ['test/flywheel.test.ts', 'test/surface.test.ts'],
  },
  recordArtifactOutcomes: {
    methods: ['ur.outcomes.record'],
    tests: ['test/flywheel.test.ts', 'test/surface.test.ts'],
  },
  recordRequestOutcome: {
    methods: ['ur.outcomes.record'],
    tests: ['test/flywheel.test.ts', 'test/surface.test.ts'],
  },
  recordOutcomesBatch: {
    methods: ['ur.outcomes.batch'],
    tests: ['test/flywheel.test.ts', 'test/surface.test.ts'],
    cli: 'ur outcomes import',
  },
  listPendingOutcomes: {
    methods: ['ur.outcomes.pending'],
    tests: ['test/flywheel.test.ts', 'test/surface.test.ts'],
    cli: 'ur outcomes pending',
  },
  // Imports
  createImport: {
    methods: ['ur.imports.create'],
    tests: ['test/flywheel.test.ts', 'test/surface.test.ts'],
    cli: 'ur import',
  },
  getImport: {
    methods: ['ur.imports.get'],
    tests: ['test/flywheel.test.ts', 'test/surface.test.ts'],
  },
  listImports: {
    methods: ['ur.imports.list'],
    tests: ['test/flywheel.test.ts', 'test/surface.test.ts'],
  },
  cancelImport: {
    methods: ['ur.imports.cancel'],
    tests: ['test/flywheel.test.ts', 'test/surface.test.ts'],
  },
  // Reviewer adapter
  getReviewerSetup: {
    methods: ['ur.reviewer.setup'],
    tests: ['test/reviewer.test.ts', 'test/surface.test.ts'],
  },
  runReviewerTest: {
    methods: ['ur.reviewer.test'],
    tests: ['test/reviewer.test.ts', 'test/surface.test.ts'],
  },
  recordReviewerEvents: {
    methods: ['ur.reviewer.send', 'ur.reviewer.flush'],
    tests: ['test/reviewer.test.ts', 'test/surface.test.ts'],
  },
  repairReviewerEvent: { methods: ['ur.reviewer.repair'], tests: ['test/reviewer.test.ts'] },
  getReviewerHealth: {
    methods: ['ur.reviewer.health'],
    tests: ['test/reviewer.test.ts', 'test/surface.test.ts'],
  },
  // Learning status, verdict sources, improvement reads, oracles
  getFlywheelStatus: {
    methods: ['ur.flywheel.status', 'ur.flywheel.calibration'],
    tests: ['test/flywheel.test.ts', 'test/surface.test.ts'],
    cli: 'ur flywheel status',
  },
  listVerdictSources: {
    methods: ['ur.flywheel.sources'],
    tests: ['test/resources.test.ts', 'test/surface.test.ts'],
  },
  issueVerdictSourceCheck: {
    methods: ['ur.flywheel.sourceChecks.issue'],
    tests: ['test/resources.test.ts', 'test/surface.test.ts'],
  },
  gradeVerdictSourceCheck: {
    methods: ['ur.flywheel.sourceChecks.answer'],
    tests: ['test/resources.test.ts', 'test/surface.test.ts'],
  },
  listImprovementReads: {
    methods: ['ur.improvementReads.list'],
    tests: ['test/resources.test.ts', 'test/surface.test.ts'],
  },
  registerOracle: {
    methods: ['ur.oracles.register'],
    tests: ['test/resources.test.ts', 'test/surface.test.ts'],
  },
  getOracle: {
    methods: ['ur.oracles.get'],
    tests: ['test/resources.test.ts', 'test/surface.test.ts'],
  },
  qualifyOracle: {
    methods: ['ur.oracles.qualify'],
    tests: ['test/resources.test.ts', 'test/surface.test.ts'],
  },
  testOracle: {
    methods: ['ur.oracles.test'],
    tests: ['test/resources.test.ts', 'test/surface.test.ts'],
  },
  revokeOracle: {
    methods: ['ur.oracles.revoke'],
    tests: ['test/resources.test.ts', 'test/surface.test.ts'],
  },
  claimOracleJobs: {
    methods: ['ur.oracles.claimJobs'],
    tests: ['test/resources.test.ts', 'test/surface.test.ts'],
  },
  submitOracleVerdicts: {
    methods: ['ur.oracles.submitVerdicts'],
    tests: ['test/resources.test.ts', 'test/surface.test.ts'],
  },
  rotateOracleSecret: { methods: [], tests: [] },
  openVerdictSourceAudit: { methods: [], tests: [] },
  gradeVerdictSourceAudit: { methods: [], tests: [] },
  // Flywheel candidates, plans and confirmations
  listFlywheelCandidates: { methods: [], tests: [] },
  getCandidateConfirmation: { methods: [], tests: [] },
  recordCandidateDecision: {
    methods: [],
    tests: ['contract-tests/flywheel-ci/test-e2e-app-ci-loop.mjs'],
    cli: 'ur flywheel-pr decision',
  },
  evaluateCandidateRollout: {
    methods: [],
    tests: ['test/flywheel-pr.test.ts'],
    cli: 'ur flywheel-pr',
  },
  acceptCostRefusedCandidate: { methods: [], tests: [] },
  listConfirmations: { methods: [], tests: [] },
  decideCandidateConfirmation: { methods: [], tests: [] },
  mintExposureGrant: { methods: [], tests: [] },
  exportKnowledgeBundle: { methods: [], tests: [] },
  getMoatNext: { methods: [], tests: [] },
  getLearningPlan: { methods: [], tests: [] },
  confirmLearningPlan: { methods: [], tests: [] },
  reviewLearningPlan: { methods: [], tests: [] },
  listLearningPlans: { methods: [], tests: [] },
  proposeLearningPlan: { methods: [], tests: [] },
  // Session-only (dashboard): the review queue's Fix with AI, and the owner's experiment packs.
  reviewAssist: { methods: [], tests: [] },
  listExperimentPacks: { methods: [], tests: [] },
  createExperimentPack: { methods: [], tests: [] },
  revokeExperimentPack: { methods: [], tests: [] },
  listPromptCandidates: { methods: [], tests: [] },
  decidePromptCandidate: { methods: [], tests: [] },
  // Workspace administration (dashboard session)
  acceptInvitation: { methods: [], tests: [] },
  createWorkspace: { methods: [], tests: [] },
  renameWorkspace: { methods: [], tests: [] },
  deleteWorkspace: { methods: [], tests: [] },
  listApiKeys: { methods: [], tests: [] },
  createApiKey: { methods: [], tests: [] },
  revokeApiKey: { methods: [], tests: [] },
  rollApiKey: { methods: [], tests: [] },
  patchFlywheelConsents: { methods: [], tests: [] },
  listInvitations: { methods: [], tests: [] },
  createInvitation: { methods: [], tests: [] },
  listMembers: { methods: [], tests: [] },
  changeMemberRole: { methods: [], tests: [] },
  removeMember: { methods: [], tests: [] },
  getModelPolicy: { methods: [], tests: [] },
  putModelPolicy: { methods: [], tests: [] },
  previewModelPolicy: { methods: [], tests: [] },
  getPassthroughPolicy: { methods: [], tests: [] },
  putPassthroughPolicy: { methods: [], tests: [] },
  listFlywheelExperiments: { methods: [], tests: [] },
  createFlywheelExperiment: { methods: [], tests: [] },
  getFlywheelExperiment: { methods: [], tests: [] },
  admitFlywheelExperiment: { methods: [], tests: [] },
  abandonFlywheelExperiment: { methods: [], tests: [] },
  produceFlywheelExperimentCandidate: { methods: [], tests: [] },
  enrolFlywheelExperimentExecution: {
    methods: ['ur.flywheel.experiments.enrol'],
    tests: ['test/flywheel.test.ts', 'test/surface.test.ts'],
  },
  recordFlywheelExperimentExecutionOutcome: {
    methods: ['ur.flywheel.experiments.outcome'],
    tests: ['test/flywheel.test.ts', 'test/surface.test.ts'],
  },
  recordFlywheelExperimentScreenJudgement: { methods: [], tests: [] },
  acknowledgeFlywheelExperimentScreen: { methods: [], tests: [] },
  evaluateFlywheelExperimentScreen: {
    methods: ['ur.flywheel.experiments.evaluateScreen'],
    tests: ['test/flywheel.test.ts', 'test/surface.test.ts'],
  },
  listFlywheelExperimentHolds: { methods: [], tests: [] },
  reconcileFlywheelExperimentHold: { methods: [], tests: [] },
  evaluateFlywheelExperimentTest: {
    methods: ['ur.flywheel.experiments.evaluateTest'],
    tests: ['test/flywheel.test.ts', 'test/surface.test.ts'],
  },
  fundFlywheelExperimentTest: { methods: [], tests: [] },
  recordFlywheelExperimentTestJudgement: { methods: [], tests: [] },
  commitFlywheelExperimentTestManifest: { methods: [], tests: [] },
  listProviderKeys: { methods: [], tests: [] },
  createProviderKey: { methods: [], tests: [] },
  updateProviderKey: { methods: [], tests: [] },
  deleteProviderKey: { methods: [], tests: [] },
  healthCheckProviderKey: { methods: [], tests: [] },
  listCustomProviders: { methods: [], tests: [] },
  createCustomProvider: { methods: [], tests: [] },
  getCustomProvider: { methods: [], tests: [] },
  updateCustomProvider: { methods: [], tests: [] },
  deleteCustomProvider: { methods: [], tests: [] },
  getSiteBrief: { methods: [], tests: [] },
  putSiteBrief: { methods: [], tests: [] },
  getTrainingStatus: { methods: [], tests: [] },
  patchTraining: { methods: [], tests: [] },
};
