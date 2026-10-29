# API reference: `@ultrarouter/sdk`

Generated from the TypeScript sources and their TSDoc by `scripts/gen-docs.mjs` (do not edit by hand). Version 0.1.0. 366 exports.

```ts
import UltraRouter, { /* named exports */ } from '@ultrarouter/sdk';
```

## Contents

- **Default export:** [`default`](#default)
- **Classes:** [`FileOutcomeStore`](#fileoutcomestore), [`LearningError`](#learningerror), [`MemoryOutcomeStore`](#memoryoutcomestore), [`ModelUnpricedError`](#modelunpricederror), [`OutcomeQueue`](#outcomequeue), [`OutcomeStoreError`](#outcomestoreerror), [`PreflightCache`](#preflightcache), [`PromptVariablesMissingError`](#promptvariablesmissingerror), [`ReceiptWaitTimeoutError`](#receiptwaittimeouterror), [`ReviewerQueue`](#reviewerqueue), [`UltraRouter`](#ultrarouter), [`UltraRouterError`](#ultraroutererror)
- **Functions:** [`applyLearnedContext`](#applylearnedcontext), [`artifactListQueryString`](#artifactlistquerystring), [`assertEpisodeKey`](#assertepisodekey), [`assertRequestId`](#assertrequestid), [`attachRequestId`](#attachrequestid), [`bindArtifactKey`](#bindartifactkey), [`correlationHeaders`](#correlationheaders), [`decidePreflightCache`](#decidepreflightcache), [`diffStats`](#diffstats), [`importListQueryString`](#importlistquerystring), [`isDefinitiveRejection`](#isdefinitiverejection), [`isGatewayErrorCode`](#isgatewayerrorcode), [`isOutcomeReceiptRecord`](#isoutcomereceiptrecord), [`isRetryableStatus`](#isretryablestatus), [`isTerminalReceiptState`](#isterminalreceiptstate), [`isUltraRouterError`](#isultraroutererror), [`isValidRequestId`](#isvalidrequestid), [`learnedPlacementIndex`](#learnedplacementindex), [`learningErrorReason`](#learningerrorreason), [`mintEpisodeKey`](#mintepisodekey), [`mintRequestId`](#mintrequestid), [`normalizeOutcomeTarget`](#normalizeoutcometarget), [`outcomeIdempotencyKey`](#outcomeidempotencykey), [`parseGrantHeader`](#parsegrantheader), [`parseLearningRefusal`](#parselearningrefusal), [`parseMaxAgeSeconds`](#parsemaxageseconds), [`parseOutcomeReceipt`](#parseoutcomereceipt), [`parseOutcomeReceiptList`](#parseoutcomereceiptlist), [`pendingQueryString`](#pendingquerystring), [`planOutcomeReport`](#planoutcomereport), [`preflightCacheKey`](#preflightcachekey), [`preflightHasClusterKey`](#preflighthasclusterkey), [`readRequestId`](#readrequestid), [`renderHostedPromptResult`](#renderhostedpromptresult), [`renderPrompt`](#renderprompt), [`reportSourceEventId`](#reportsourceeventid), [`reviewerSignatureHeaders`](#reviewersignatureheaders), [`reviewerSignedPayload`](#reviewersignedpayload), [`reviewerVerdictAction`](#reviewerverdictaction), [`sha256Hex`](#sha256hex), [`signReviewerPayload`](#signreviewerpayload), [`toLearningError`](#tolearningerror), [`ulid`](#ulid), [`withHeaderGrant`](#withheadergrant)
- **Constants:** [`DEFAULT_MAX_RETRIES`](#default_max_retries), [`DEFAULT_PREFLIGHT_CACHE_MAX_ENTRIES`](#default_preflight_cache_max_entries), [`DEFAULT_TIMEOUT_MS`](#default_timeout_ms), [`EPISODE_HEADER`](#episode_header), [`EPISODE_KEY_MAX_LENGTH`](#episode_key_max_length), [`EVENT_REJECTION_CODES`](#event_rejection_codes), [`EXPERIMENT_EXECUTION_HEADER`](#experiment_execution_header), [`GATEWAY_ERROR_CODES`](#gateway_error_codes), [`GATEWAY_ERROR_TAXONOMY`](#gateway_error_taxonomy), [`LEARNED_MESSAGE_ROLE`](#learned_message_role), [`LEARNING_ERROR_ACTIONS`](#learning_error_actions), [`LEARNING_ERROR_CODES`](#learning_error_codes), [`ORACLE_SIGNATURE_HEADER`](#oracle_signature_header), [`ORACLE_TIMESTAMP_HEADER`](#oracle_timestamp_header), [`OUTCOME_SOURCES`](#outcome_sources), [`OUTCOME_VERDICT_VALUES`](#outcome_verdict_values), [`OUTCOME_VERDICTS`](#outcome_verdicts), [`OUTCOME_VERDICTS_SCHEMA_VERSION`](#outcome_verdicts_schema_version), [`PREFLIGHT_DEFAULT_CONFIG_MAX_AGE_S`](#preflight_default_config_max_age_s), [`PREFLIGHT_DEFAULT_LIVE_MAX_AGE_S`](#preflight_default_live_max_age_s), [`PREFLIGHT_GRANT_HEADER`](#preflight_grant_header), [`PREFLIGHT_LIVE_MAX_AGE_HEADER`](#preflight_live_max_age_header), [`PROMPT_VARIABLES_MISSING_CODE`](#prompt_variables_missing_code), [`RECEIPT_WAIT_DEFAULTS`](#receipt_wait_defaults), [`REPORT_IDENTITY_VERSION`](#report_identity_version), [`REQUEST_ID_HEADER`](#request_id_header), [`REQUEST_ID_PATTERN`](#request_id_pattern), [`REVIEWER_SIGNATURE_HEADER`](#reviewer_signature_header), [`REVIEWER_TIMESTAMP_HEADER`](#reviewer_timestamp_header), [`TERMINAL_RECEIPT_STATES`](#terminal_receipt_states), [`VERSION`](#version)
- **Interfaces:** [`ApiRequestInit`](#apirequestinit), [`ArtifactListQuery`](#artifactlistquery), [`ArtifactScope`](#artifactscope), [`ArtifactsResource`](#artifactsresource), [`AsOpenAI`](#asopenai), [`AutopilotCallType`](#autopilotcalltype), [`AutopilotCostProvenance`](#autopilotcostprovenance), [`AutopilotCoverage`](#autopilotcoverage), [`AutopilotStatus`](#autopilotstatus), [`BenchResource`](#benchresource), [`BenchRunParams`](#benchrunparams), [`CallType`](#calltype), [`CallTypeConfigBody`](#calltypeconfigbody), [`CallTypeConfigVersion`](#calltypeconfigversion), [`CallTypeListResponse`](#calltypelistresponse), [`CallTypesResource`](#calltypesresource), [`ChatChoice`](#chatchoice), [`ChatCompletion`](#chatcompletion), [`ChatCompletionChunk`](#chatcompletionchunk), [`ChatCompletionCreateParams`](#chatcompletioncreateparams), [`ChatCompletionsCreate`](#chatcompletionscreate), [`ChatContentPart`](#chatcontentpart), [`ChatMessage`](#chatmessage), [`ChatResource`](#chatresource), [`CompressionOptions`](#compressionoptions), [`CorrelationOptions`](#correlationoptions), [`CreateCallTypeParams`](#createcalltypeparams), [`CreateEmbeddingResponse`](#createembeddingresponse), [`DiffStats`](#diffstats), [`DurableEntry`](#durableentry), [`Embedding`](#embedding), [`EmbeddingCreateParams`](#embeddingcreateparams), [`EmbeddingsResource`](#embeddingsresource), [`EmbeddingUrBlock`](#embeddingurblock), [`ExperimentOutcomeOptions`](#experimentoutcomeoptions), [`ExperimentsResource`](#experimentsresource), [`Feedback`](#feedback), [`FeedbackEnvelope`](#feedbackenvelope), [`FeedbackParams`](#feedbackparams), [`FlywheelResource`](#flywheelresource), [`GatewayErrorEnvelope`](#gatewayerrorenvelope), [`GenerationOutcome`](#generationoutcome), [`GenerationStats`](#generationstats), [`HostedPromptsResource`](#hostedpromptsresource), [`HostedPromptVariable`](#hostedpromptvariable), [`ImportListQuery`](#importlistquery), [`ImportsResource`](#importsresource), [`LearnedMessage`](#learnedmessage), [`LearnedRecordOptions`](#learnedrecordoptions), [`LearnedSession`](#learnedsession), [`LearningResource`](#learningresource), [`Model`](#model), [`ModelListQuery`](#modellistquery), [`ModelPricing`](#modelpricing), [`ModelsListResponse`](#modelslistresponse), [`ModelsResource`](#modelsresource), [`OpenAICompatConfig`](#openaicompatconfig), [`OracleSigningOptions`](#oraclesigningoptions), [`OraclesResource`](#oraclesresource), [`OutcomeFlushReport`](#outcomeflushreport), [`OutcomeNotReported`](#outcomenotreported), [`OutcomeQueueDeps`](#outcomequeuedeps), [`OutcomeReported`](#outcomereported), [`OutcomeReportParams`](#outcomereportparams), [`OutcomeSourceMapping`](#outcomesourcemapping), [`OutcomesResource`](#outcomesresource), [`OutcomeStore`](#outcomestore), [`OutcomeVerdictMapping`](#outcomeverdictmapping), [`PendingOutcomesQuery`](#pendingoutcomesquery), [`PreflightCacheEntry`](#preflightcacheentry), [`PreflightCacheOptions`](#preflightcacheoptions), [`PreflightRequestOptions`](#preflightrequestoptions), [`ProviderPreferences`](#providerpreferences), [`QueuedOutcome`](#queuedoutcome), [`QueuedReviewerEvent`](#queuedreviewerevent), [`ReasoningOptions`](#reasoningoptions), [`RenderablePrompt`](#renderableprompt), [`RequestCorrelation`](#requestcorrelation), [`RequestOptions`](#requestoptions), [`ReviewerDeliveryOptions`](#reviewerdeliveryoptions), [`ReviewerFlushReport`](#reviewerflushreport), [`ReviewerQueueDeps`](#reviewerqueuedeps), [`ReviewerResource`](#reviewerresource), [`SegmentHint`](#segmenthint), [`SourceChecksResource`](#sourcechecksresource), [`StreamCorrelation`](#streamcorrelation), [`UltraRouterDefaults`](#ultrarouterdefaults), [`UltraRouterOptions`](#ultrarouteroptions), [`UrCompressionBlock`](#urcompressionblock), [`UrNamespace`](#urnamespace), [`UrRequestOptions`](#urrequestoptions), [`UrResponseBlock`](#urresponseblock), [`UrRoutingBlock`](#urroutingblock), [`Usage`](#usage), [`VerifiedMemoryResource`](#verifiedmemoryresource), [`WaitForReceiptOptions`](#waitforreceiptoptions)
- **Types:** [`ActivateHostedPromptParams`](#activatehostedpromptparams), [`AnswerSourceCheckParams`](#answersourcecheckparams), [`ApiOperation`](#apioperation), [`ApiPath`](#apipath), [`ApiResponse`](#apiresponse), [`Artifact`](#artifact), [`ArtifactArchetype`](#artifactarchetype), [`ArtifactClaim`](#artifactclaim), [`ArtifactEnvelope`](#artifactenvelope), [`ArtifactListResponse`](#artifactlistresponse), [`ArtifactObjective`](#artifactobjective), [`ArtifactObjectiveMetric`](#artifactobjectivemetric), [`ArtifactObjectivePredicate`](#artifactobjectivepredicate), [`ArtifactType`](#artifacttype), [`ArtifactTypeEnvelope`](#artifacttypeenvelope), [`ArtifactTypeUpsertParams`](#artifacttypeupsertparams), [`AutopilotMode`](#autopilotmode), [`BatchOutcomeInput`](#batchoutcomeinput), [`BatchOutcomeResult`](#batchoutcomeresult), [`BatchOutcomesResponse`](#batchoutcomesresponse), [`BenchBaseline`](#benchbaseline), [`BenchCompareGate`](#benchcomparegate), [`BenchDatasetFreeze`](#benchdatasetfreeze), [`BenchExpectationInput`](#benchexpectationinput), [`BenchExpectations`](#benchexpectations), [`BenchFreezeParams`](#benchfreezeparams), [`BenchInitTag`](#benchinittag), [`BenchOutcomeInput`](#benchoutcomeinput), [`BenchOutcomes`](#benchoutcomes), [`BenchOutcomeTarget`](#benchoutcometarget), [`BenchReport`](#benchreport), [`BenchReportFormat`](#benchreportformat), [`BenchRun`](#benchrun), [`BenchRunMode`](#benchrunmode), [`BenchRunTrigger`](#benchruntrigger), [`BenchSelectionMode`](#benchselectionmode), [`BenchSuiteStatus`](#benchsuitestatus), [`BenchTag`](#benchtag), [`CallTypeImprovementReads`](#calltypeimprovementreads), [`CallTypeRecommendations`](#calltyperecommendations), [`ChatCompletionStream`](#chatcompletionstream), [`ChatRole`](#chatrole), [`ClaimInput`](#claiminput), [`ClaimOracleJobsParams`](#claimoraclejobsparams), [`CompressionMode`](#compressionmode), [`CompressionOption`](#compressionoption), [`CreateArtifactParams`](#createartifactparams), [`CreateHostedPromptParams`](#createhostedpromptparams), [`DeepReadonly`](#deepreadonly), [`EnableLearningParams`](#enablelearningparams), [`EnableVerifiedMemoryParams`](#enableverifiedmemoryparams), [`EnqueueEvalParams`](#enqueueevalparams), [`EnqueueEvalResponse`](#enqueueevalresponse), [`EnrolExperimentExecutionParams`](#enrolexperimentexecutionparams), [`EvalRunList`](#evalrunlist), [`ExperimentExecution`](#experimentexecution), [`ExperimentExecutionOutcome`](#experimentexecutionoutcome), [`ExperimentExecutionOutcomeDryRun`](#experimentexecutionoutcomedryrun), [`ExperimentScreenEvaluation`](#experimentscreenevaluation), [`ExperimentTestEvaluation`](#experimenttestevaluation), [`FetchLike`](#fetchlike), [`FinalizedOutcomeEvent`](#finalizedoutcomeevent), [`FinalParams`](#finalparams), [`FinalResponse`](#finalresponse), [`FlywheelCalibration`](#flywheelcalibration), [`FlywheelStatus`](#flywheelstatus), [`FlywheelUsage`](#flywheelusage), [`GatewayErrorCode`](#gatewayerrorcode), [`HostedPromptList`](#hostedpromptlist), [`HostedPromptPointer`](#hostedpromptpointer), [`HostedPromptProposal`](#hostedpromptproposal), [`HostedPromptVersion`](#hostedpromptversion), [`HttpMethod`](#httpmethod), [`Import`](#import), [`ImportCapabilityReport`](#importcapabilityreport), [`ImportEnvelope`](#importenvelope), [`ImportListResponse`](#importlistresponse), [`ImportParams`](#importparams), [`ImprovementReads`](#improvementreads), [`IssueSourceCheckParams`](#issuesourcecheckparams), [`KeyInfo`](#keyinfo), [`LearnedContextDelivery`](#learnedcontextdelivery), [`LearningArmEvidence`](#learningarmevidence), [`LearningControlAction`](#learningcontrolaction), [`LearningControlResult`](#learningcontrolresult), [`LearningErrorReason`](#learningerrorreason), [`LearningEvaluation`](#learningevaluation), [`LearningEvaluationDecision`](#learningevaluationdecision), [`LearningEvaluationList`](#learningevaluationlist), [`LearningEvidence`](#learningevidence), [`LearningLesson`](#learninglesson), [`LearningObjective`](#learningobjective), [`LearningPromotionMode`](#learningpromotionmode), [`LearningPromotionPolicy`](#learningpromotionpolicy), [`LearningReceiptCounts`](#learningreceiptcounts), [`LearningRollbackParams`](#learningrollbackparams), [`LearningState`](#learningstate), [`LearningStatus`](#learningstatus), [`LearningToolDocumentation`](#learningtooldocumentation), [`LearningVersion`](#learningversion), [`LearningVersionDetail`](#learningversiondetail), [`LearningVersionList`](#learningversionlist), [`LearningVersionRef`](#learningversionref), [`LearningVersionState`](#learningversionstate), [`ModelDetail`](#modeldetail), [`OpenAIConstructor`](#openaiconstructor), [`OperationId`](#operationid), [`OperationQuery`](#operationquery), [`OperationRequestBody`](#operationrequestbody), [`OperationResponse`](#operationresponse), [`Oracle`](#oracle), [`OracleJobClaim`](#oraclejobclaim), [`OracleQualification`](#oraclequalification), [`OracleRegistration`](#oracleregistration), [`OracleRevocation`](#oraclerevocation), [`OracleTestResult`](#oracletestresult), [`OracleVerdictsResult`](#oracleverdictsresult), [`OutcomeChannel`](#outcomechannel), [`OutcomeEpisodeAssociation`](#outcomeepisodeassociation), [`OutcomeEpisodeVerdict`](#outcomeepisodeverdict), [`OutcomeInput`](#outcomeinput), [`OutcomeReceipt`](#outcomereceipt), [`OutcomeReceiptEpisode`](#outcomereceiptepisode), [`OutcomeReceiptList`](#outcomereceiptlist), [`OutcomeReceiptRecord`](#outcomereceiptrecord), [`OutcomeReceiptState`](#outcomereceiptstate), [`OutcomeReportPlan`](#outcomereportplan), [`OutcomeReportResult`](#outcomereportresult), [`OutcomeResult`](#outcomeresult), [`OutcomeSender`](#outcomesender), [`OutcomeSource`](#outcomesource), [`OutcomeTarget`](#outcometarget), [`OutcomeTeaches`](#outcometeaches), [`OutcomeVerdict`](#outcomeverdict), [`PendingClaim`](#pendingclaim), [`PendingClaimsResponse`](#pendingclaimsresponse), [`PreflightCacheDecision`](#preflightcachedecision), [`PreflightGrant`](#preflightgrant), [`PreflightKnowledge`](#preflightknowledge), [`PreflightParams`](#preflightparams), [`PreflightPrompt`](#preflightprompt), [`PreflightResponse`](#preflightresponse), [`PreflightRouting`](#preflightrouting), [`PutLearningToolDocumentationParams`](#putlearningtooldocumentationparams), [`QualifyOracleParams`](#qualifyoracleparams), [`ReasoningEffort`](#reasoningeffort), [`RecordExperimentOutcomeParams`](#recordexperimentoutcomeparams), [`RecordOutcomesResponse`](#recordoutcomesresponse), [`RegisterOracleParams`](#registeroracleparams), [`RenderPromptResult`](#renderpromptresult), [`RequestOutcomeResult`](#requestoutcomeresult), [`ResponseFormat`](#responseformat), [`ReviewerBackfill`](#reviewerbackfill), [`ReviewerDecision`](#reviewerdecision), [`ReviewerEvent`](#reviewerevent), [`ReviewerEventResult`](#reviewereventresult), [`ReviewerEventsResponse`](#reviewereventsresponse), [`ReviewerFinal`](#reviewerfinal), [`ReviewerHealth`](#reviewerhealth), [`ReviewerRepairResult`](#reviewerrepairresult), [`ReviewerSender`](#reviewersender), [`ReviewerSetup`](#reviewersetup), [`ReviewerTestResult`](#reviewertestresult), [`ReviewerTestScenario`](#reviewertestscenario), [`RouterMode`](#routermode), [`SegmentHintKind`](#segmenthintkind), [`SelfImproveGuardrails`](#selfimproveguardrails), [`SourceCheck`](#sourcecheck), [`SourceCheckGrade`](#sourcecheckgrade), [`SubmitOracleVerdictsParams`](#submitoracleverdictsparams), [`SuccessBody`](#successbody), [`TestOracleParams`](#testoracleparams), [`UrBenchEcho`](#urbenchecho), [`UrContextModule`](#urcontextmodule), [`UrManifest`](#urmanifest), [`UrManifestEntry`](#urmanifestentry), [`UrManifestRange`](#urmanifestrange), [`UrVerifiedMemoryBlock`](#urverifiedmemoryblock), [`VerdictSources`](#verdictsources), [`VerifiedMemoryDisableResult`](#verifiedmemorydisableresult), [`VerifiedMemoryEnableResult`](#verifiedmemoryenableresult), [`VerifiedMemoryStatus`](#verifiedmemorystatus)

## Default export

### default

default · `src/client.ts`

The default export is the [`UltraRouter`](#ultrarouter) class.

## Classes

### FileOutcomeStore

class · `src/flywheel-queue.ts`

A Node file-backed store for CROSS-RESTART durability (opt-in). It serializes the whole queue
to a JSON file, rewriting it atomically (a temporary file with mode `0600`, then a rename) on
every mutation and reading it back on first use. `node:fs/promises` is imported LAZILY (see
`loadNodeFs`) so the SDK core stays edge-portable and zero-dep. Mutations are serialized
through an internal promise chain (no concurrent writes); point two clients at two files.

The store starts empty ONLY when the file does not exist. A file that cannot be read, is not valid
JSON, or does not hold a list of entries throws [`OutcomeStoreError`](#outcomestoreerror) on every operation and is
never overwritten, so the events in it can be recovered.

```ts signature
class FileOutcomeStore
```

| Member | Description |
| --- | --- |
| `constructor(path: string)` | Persist the queue as JSON at `path` (created, with its directory, on first write). |
| `append(entry: T): Promise<void>` | Persist a new entry. |
| `update(entry: T): Promise<void>` | Persist an updated entry. |
| `remove(id: string): Promise<void>` | Remove an entry by id. |
| `list(): Promise<T[]>` | Every queued entry, in insertion order. |

### LearningError

class · `src/learning-controls.ts`

A learning control refused for a reason you can act on: `reason` names it, `refusal` is the
gateway's named refusal (or code), `detail` its parenthesized sub-reason when there is one, and
`action` says what to do. It is an [`UltraRouterError`](#ultraroutererror), so `code`, `status`, `requestId` and
`retryable` are the gateway's.

```ts signature
class LearningError
```

| Member | Description |
| --- | --- |
| `readonly reason: LearningErrorReason` | Why the control was refused. |
| `readonly refusal: string` | The named refusal (the first token of the message, e.g. `no_rollback_target`) or the error code. |
| `readonly detail: string \| null` | The parenthesized sub-reason (e.g. `no_workspace_key`), or `null`. |
| `readonly action: string` | What to do about it. |
| `constructor(cause: UltraRouterError, reason: LearningErrorReason, refusal: string, detail: string \| null)` | Wrap a gateway error with its learning reason. |

### MemoryOutcomeStore

class · `src/flywheel-queue.ts`

The default in-process store (durable for the lifetime of the client — survives transient
send failures across retries/flush). Insertion order is preserved so flush replays FIFO.

```ts signature
class MemoryOutcomeStore
```

| Member | Description |
| --- | --- |
| `append(entry: T): void` | Store a new entry. |
| `update(entry: T): void` | Replace an existing entry. |
| `remove(id: string): void` | Remove an entry by id. |
| `list(): T[]` | Every queued entry, in insertion order. |

### ModelUnpricedError

class · `src/errors.ts`

The typed error for `model_unpriced`: the gateway refused the call because the requested model
has no price it can bill against. It is a permission-class refusal (HTTP 403) raised before any
provider is called, and it is never retried.

```ts signature
class ModelUnpricedError
```

| Member | Description |
| --- | --- |
| `readonly code: 'model_unpriced'` | Always `model_unpriced`. |
| `readonly retryable: false` | Always `false`: retrying cannot succeed until the model is priced. |
| `constructor(opts: { message: string; status: number; requestId?: string \| undefined; providerCode?: string \| undefined; envelope?: GatewayErrorEnvelope \| undefined; })` | Create a `model_unpriced` error (`retryable` is always `false`). |

**Example**

```ts
import UltraRouter, { ModelUnpricedError } from "@ultrarouter/sdk";

const ur = new UltraRouter();
try {
  await ur.chat.completions.create({
    model: "example/unpriced-model",
    messages: [{ role: "user", content: "hi" }],
  });
} catch (err) {
  if (err instanceof ModelUnpricedError) {
    console.log(`pick a priced model: ${err.message}`);
  }
}
```

### OutcomeQueue

class · `src/flywheel-queue.ts`

The durable outcome queue. `enqueue` persists then best-effort delivers; `flush` drains
everything still queued (the end-of-execution safety net, and `withArtifact`'s finally step).

```ts signature
class OutcomeQueue
```

| Member | Description |
| --- | --- |
| `constructor(deps: OutcomeQueueDeps)` | Create a queue over a store and a sender. |
| `enqueue(target: OutcomeTarget, outcome: OutcomeInput, options?: RequestOptions): Promise<OutcomeReceipt>` | Finalize an outcome (fix `observed_at` + `source_event_id`), PERSIST it, THEN attempt a single best-effort delivery. Only a definitive refusal of the event ([`isDefinitiveRejection`](#isdefinitiverejection)) drops it; every other failure leaves the identical entry in place for `flush`. A delivery failure never throws; a store that cannot persist does. |
| `enqueueStable(entryId: string, target: OutcomeTarget, outcome: OutcomeInput & { source_event_id: string }, options?: RequestOptions): Promise<OutcomeReceipt>` | Like `enqueue`, under a caller-chosen stable entry id (so the Idempotency-Key, derived from the entry id, is stable too). A repeat of the same identity never creates a second event: - an entry with that id still in the store is replayed verbatim; - an entry delivered earlier by this queue is replayed with its original bytes (`observed_at` included) unless the caller now sends a different payload; - a different payload under the same `source_event_id` is sent as its own entry, so the gateway answers it as a conflict instead of it silently replacing the first; - concurrent calls for one id share one send. |
| `flush(options?: RequestOptions): Promise<OutcomeFlushReport>` | Drain every queued outcome, replaying each stored event verbatim (same `source_event_id`, same `observed_at`, same Idempotency-Key). Delivered and definitively refused entries are removed; everything else stays for the next flush. |
| `size(): Promise<number>` | The number of outcomes still durably queued (awaiting a successful flush). |

### OutcomeStoreError

class · `src/flywheel-queue.ts`

A [`FileOutcomeStore`](#fileoutcomestore) file that cannot be read, is not valid JSON, does not hold a list of
queue entries, or cannot be written. The file is never overwritten after a failed read, so its
events can be recovered by hand.

```ts signature
class OutcomeStoreError
```

| Member | Description |
| --- | --- |
| `readonly path: string` | The queue file this error is about. |
| `constructor(path: string, message: string)` | Create the error for a queue file. |

### PreflightCache

class · `src/preflight.ts`

The client-side preflight cache: one entry per request identity, honouring the two lifetimes with
the grant NEVER stored (it is re-read from `X-UR-Grant` on every response). BOUNDED: at most
`maxEntries` identities, least recently used evicted first, and entries past their live window
(when a fresh fetch is needed anyway) are swept out — so a long-lived client that sees unique
trace / artifact / message identities does not grow without limit. A per-call `maxAgeS` larger
than an entry's own live window cannot revive an entry that was already swept (it is fetched
again).

```ts signature
class PreflightCache
```

| Member | Description |
| --- | --- |
| `constructor(options: PreflightCacheOptions = {})` | Create a cache bounded by `maxEntries`. |
| `get size(): number { return this.entries.size; }` | The number of cached identities. |
| `get(key: string): PreflightCacheEntry \| undefined` | The entry for a cache key, if any (marks it most recently used). |
| `set(key: string, entry: PreflightCacheEntry): void` | Store an entry under a cache key, evicting expired and then least recently used entries. |
| `clear(): void` | Drop every entry. |

### PromptVariablesMissingError

class · `src/prompt-render.ts`

A NAMED missing-required-variable refusal (the SDK face of the gateway's `prompt_variables_missing`
error). Lists the missing variable names — never a silent blank. `code` matches the gateway.

```ts signature
class PromptVariablesMissingError
```

| Member | Description |
| --- | --- |
| `readonly code: string` | Always `prompt_variables_missing`. |
| `readonly missing: readonly string[]` | The missing variable names, sorted. |
| `constructor(missing: readonly string[])` | Create the error from the missing variable names. |

### ReceiptWaitTimeoutError

class · `src/outcome-receipts.ts`

`waitForReceipt` ran out of time before the receipt reached a final state. The receipt is still
durable on the gateway; read it again later with `ur.ur.outcomes.receipt(id)`.

```ts signature
class ReceiptWaitTimeoutError
```

| Member | Description |
| --- | --- |
| `readonly receiptId: string` | The receipt that was being waited on. |
| `readonly lastReceipt: OutcomeReceiptRecord \| null` | The last receipt read before time ran out, or `null` when no read succeeded. |
| `constructor(receiptId: string, timeoutMs: number, lastReceipt: OutcomeReceiptRecord \| null)` | Create the error. |

### ReviewerQueue

class · `src/reviewer.ts`

The durable reviewer-event queue. `enqueue` persists the event BEFORE any byte hits the network;
`flush` drains everything still queued in FIFO order, in batches; a repairable refusal becomes a
DEAD LETTER that stays in the store (a human's decision is never discarded because our join was
not ready yet), and `deadLetters()` lists them for `repair()`.

```ts signature
class ReviewerQueue
```

| Member | Description |
| --- | --- |
| `constructor(deps: ReviewerQueueDeps)` | Create a queue over a store and a sender. |
| `enqueue(event: ReviewerEvent, opts: { backfill?: ReviewerBackfill; reviewerSystem?: string } = {}): Promise<string>` | Persist one reviewer event. Durable FIRST — the network is never touched here, so a crash after `enqueue` loses nothing and `flush()` sends it. Returns the queue-entry id. |
| `pending(): Promise<QueuedReviewerEvent[]>` | Every entry still awaiting delivery (dead letters excluded). |
| `deadLetters(): Promise<QueuedReviewerEvent[]>` | Every entry the server refused with a repairable reason. |
| `size(): Promise<number>` | Total entries in the store (queued + dead-lettered). |
| `flush(options?: RequestOptions): Promise<ReviewerFlushReport>` | Drain the queue. Entries are grouped by `(backfill id, reviewer system)` so a declared backfill's progress stays coherent, then sent in batches of at most [`ReviewerQueueDeps.batchSize`](#reviewerqueuedeps). Per event, and only on a verdict that validates ([`reviewerVerdictAction`](#reviewerverdictaction)): `accepted` / `duplicate` ⇒ removed; `rejected` / `unsupported` with `repairable: true` ⇒ kept as a dead letter; `rejected` / `unsupported` with `repairable: false` and a named `reason` ⇒ dropped (re-sending the identical payload can never change it). A missing or malformed verdict keeps the event queued. Events are only ever removed by those per-event verdicts: a failed delivery never removes one. A failure whose outcome is unknown (a timeout, a cancellation, a connection failure, a 408/429/5xx answer, a success whose `data` is not a list) leaves the whole batch queued and ends this flush; any other non-retryable 4xx answer (a 401/403, a bad signature, an invalid batch, an HTML 400 from a proxy) also leaves it queued and is THROWN rather than swallowed. |
| `clearDeadLetter(entryId: string): Promise<void>` | Clear a dead letter once its repair succeeded. |

### UltraRouter

class · `src/client.ts`

The ultrarouter client.

```ts signature
class UltraRouter
```

| Member | Description |
| --- | --- |
| `readonly baseURL: string` | The resolved gateway base URL (no trailing slash, no `/v1`). |
| `readonly chat: ChatResource` | OpenAI-compatible chat completions (`chat.completions.create`). |
| `readonly embeddings: EmbeddingsResource` | OpenAI-compatible embeddings (`embeddings.create`). |
| `readonly models: ModelsResource` | The model catalog (`models.list`, `models.retrieve`). |
| `readonly autopilotMode: AutopilotMode \| undefined` | The configured Autopilot intent, or `undefined` for a plain pass-through client. |
| `readonly ur: UrNamespace` | The ultrarouter resources. |
| `readonly recordOutcome: OutcomesResource['record']` | Alias of `ur.outcomes.record`: durably record one outcome on an artifact or a request. |
| `constructor(options: UltraRouterOptions = {})` | Create a client. The API key falls back to `ULTRAROUTER_API_KEY` then `UR_API_KEY`, and the gateway base URL to `ULTRAROUTER_BASE_URL` then `UR_BASE_URL`. There is no hosted default, so a base URL is required (for example `http://localhost:8080` for a local gateway). |
| `request(method: M, path: P, init: ApiRequestInit<M, P> & RequestOptions = {}): Promise<ApiResponse<M, P>>` | Call any operation in the published OpenAPI document with full typing, including the ones that have no dedicated method. Path placeholders are filled from `init.path` (percent-encoded), the query from `init.query`, the JSON body from `init.body`; the result is the typed success body. Retries, timeouts and idempotency follow the same rules as every other method. |
| `withArtifact(key: string, fn: (scope: ArtifactScope) => Promise<T> \| T): Promise<T>` | Run `fn` with a scope bound to one artifact `key`: chat and embeddings calls carry `ur.artifact = key`, `scope.record` / `scope.final` target the artifact, and the durable outcome queue is flushed when `fn` settles (success or throw). The artifact is upserted lazily on the first `record` / `final`, so a chat-only scope makes no extra call. Resolves to `fn`'s result. |
| `preflight(params: PreflightParams, options: PreflightRequestOptions = {}): Promise<PreflightResponse>` | Ask the gateway, before a call you make directly to a provider, which model and fallbacks to use and which learned knowledge to inject (and where). With a cluster key (`artifact_key` or `trace_id`) the response also carries an exposure grant. Pass `messages` (the messages you are about to send) when the call type learns per-request cases: the gateway renders the cases nearest that input. Without `messages` such a call type answers `knowledge: null` with `knowledge_reason: "case_query_missing"`. The messages are used only for that rendering. The client honours the gateway's two cache lifetimes: the config-versioned part is revalidated with `ETag` / `If-None-Match` (a 304 reuses the cached body), the health-ordered fallbacks expire after the live window (`X-UR-Live-Max-Age`, 30 s by default), and the grant is never cached — it is read fresh from the `X-UR-Grant` header on every response, including a 304. `noCache: true` bypasses the cache; `maxAgeS` overrides the live window. |
| `getPrompt(callType: string, options: PreflightRequestOptions = {}): Promise<PreflightPrompt \| null>` | Read the active hosted prompt for a call type (`{ version, template, variables, sha256 }`), or `null` when the call type is code-owned. It reuses [`UltraRouter.preflight`](#ultrarouter); render it with [`renderPrompt`](#renderprompt), which applies the same fail-closed `{{name}}` substitution as the gateway. |
| `useLearned(params: PreflightParams, options: PreflightRequestOptions = {}): Promise<LearnedSession>` | A stateful wrapper over [`UltraRouter.preflight`](#ultrarouter) for callers that call their model directly. It preflights once, then `apply(messages)` inserts the learned module at the cache-safe position (right after the leading system messages) and `record(outcome)` records an outcome that quotes the exposure grant (it upserts the artifact named by `artifact_key` with the grant, then queues the outcome). Include `messages` in `params` when the call type learns per-request cases. |
| `asOpenAI(): OpenAICompatConfig asOpenAI(ctor: OpenAIConstructor<T>): T asOpenAI(ctor?: OpenAIConstructor<T>): OpenAICompatConfig \| T` | Return an OpenAI-client-compatible configuration (`{ baseURL, apiKey, defaultHeaders? }`, with `/v1` appended) or, given the `OpenAI` constructor, a ready client instance pointed at the gateway. `openai` is not a dependency of this SDK. |

**Example**

```ts
import UltraRouter from "@ultrarouter/sdk";

// Reads ULTRAROUTER_API_KEY (or UR_API_KEY) and ULTRAROUTER_BASE_URL (or UR_BASE_URL).
const ur = new UltraRouter({ defaultModel: "openai/gpt-5.2-mini" });
const res = await ur.chat.completions.create({
  messages: [{ role: "user", content: "Say hello in one word." }],
});
console.log(res.choices[0]?.message.content, res.ur.cost_usd);
```

### UltraRouterError

class · `src/errors.ts`

A structured gateway or transport error. Every method on the client rejects with this class
(or a subclass such as [`ModelUnpricedError`](#modelunpricederror)).

```ts signature
class UltraRouterError
```

| Member | Description |
| --- | --- |
| `readonly code: string` | The stable error code: one of [`GATEWAY_ERROR_CODES`](#gateway_error_codes); `connection`, `timeout` or `aborted` for a transport failure, a deadline or a caller abort; `configuration` for a missing client setting the SDK needs before it can send anything (today, no gateway base URL); `invalid_response` for an unparseable response; `invalid_request` for a request refused before sending; or `http_<status>` when a non-gateway component (a proxy, a load balancer) answered without the JSON envelope. |
| `readonly status: number` | HTTP status of the failed response (`0` for a transport or timeout error). |
| `readonly requestId: string \| undefined` | The gateway correlation id (`req_…`) when the gateway produced the error. Quote it in support requests. |
| `readonly retryable: boolean` | Whether the same request may be safely retried as-is. The SDK only auto-retries retryable errors. |
| `readonly providerCode: string \| undefined` | The raw upstream provider error code, when a provider produced the failure. |
| `readonly envelope: GatewayErrorEnvelope \| undefined` | The validated gateway error envelope this error was decoded from: present only when the response body was a well-formed `{ error: { code, message, request_id, retryable } }` envelope ([`GatewayErrorEnvelope`](#gatewayerrorenvelope)); `undefined` for a transport failure, a client-side check, or an answer without that envelope (for example an HTML error page from a proxy). The durable outcome queue drops an event only on a rejection that carries one (`isDefinitiveRejection`). |
| `constructor(opts: { code: string; message: string; status: number; requestId?: string \| undefined; retryable: boolean; providerCode?: string \| undefined; envelope?: GatewayErrorEnvelope \| undefined; })` | Create an error. Usually you receive one from the client rather than constructing it. |

**Example**

```ts
import UltraRouter, { UltraRouterError } from "@ultrarouter/sdk";

const ur = new UltraRouter();
try {
  await ur.chat.completions.create({
    model: "example/unpriced-model",
    messages: [{ role: "user", content: "hi" }],
  });
} catch (err) {
  if (err instanceof UltraRouterError) {
    console.log(err.code, err.status, err.retryable, err.requestId);
  }
}
```

## Functions

### applyLearnedContext

function · `src/learned-placement.ts`

Insert the learned block into a customer's messages at [`learnedPlacementIndex`](#learnedplacementindex) — the SAME
splice the gateway inject seam performs (`[...before, { role: 'user', content: body },...after]`).
PURE: returns a NEW array and never mutates the input. When `content` is null/empty (a holdout, or
no learned module) the messages pass through UNCHANGED (byte-identical) — the runtime never adds a
module the platform withheld.

```ts signature
function applyLearnedContext<M extends {
    readonly role?: unknown;
}>(messages: readonly M[], content: string | null | undefined): (M | LearnedMessage)[]
```

### artifactListQueryString

function · `src/artifacts.ts`

Build the `/v1/artifacts` query string (empty when no filters).

```ts signature
function artifactListQueryString(query: ArtifactListQuery = {}): string
```

### assertEpisodeKey

function · `src/correlation.ts`

Throw `invalid_request` unless `value` can travel as the `x-ur-artifact` header.

```ts signature
function assertEpisodeKey(value: unknown): asserts value is string
```

### assertRequestId

function · `src/correlation.ts`

Throw `invalid_request` unless `value` is an acceptable client request id.

```ts signature
function assertRequestId(value: unknown): asserts value is string
```

### attachRequestId

function · `src/correlation.ts`

Attach a non-enumerable `requestId` to a result object.

```ts signature
function attachRequestId<T extends object, V extends string | null>(target: T, requestId: V): T & {
    readonly requestId: V;
}
```

### bindArtifactKey

function · `src/artifacts.ts`

Bind a chat/embeddings request to an artifact key via the `ur.artifact` request option
(the DECLARED pre-dispatch assembly key; `X-UR-Artifact` equivalent). Returns
a COPY with `ur.artifact` set; an explicit per-call `ur.artifact` already on the params
WINS (the caller can override the scope binding). Used by `withArtifact`.

```ts signature
function bindArtifactKey<T extends {
    ur?: UrRequestOptions;
}>(params: T, key: string): T
```

### correlationHeaders

function · `src/correlation.ts`

The correlation headers for any HTTP client, validated: `x-ur-request-id` for `requestId`,
`x-ur-artifact` for `episodeKey`. Pass them as per-call headers to the official `openai` client
(`{ headers: correlationHeaders({ requestId, episodeKey }) }`) or to `fetch`.

```ts signature
function correlationHeaders(options: CorrelationOptions): Record<string, string>
```

### decidePreflightCache

function · `src/preflight.ts`

Decide how to serve a preflight call from the two-lifetime cache (PURE — every input explicit):
- no entry ⇒ `fetch`;
- the LIVE part expired (`age ≥ liveMaxAge`) ⇒ `fetch` (a full refetch re-pulls the fallbacks; a
304 must never resurrect a stale live part);
- LIVE still fresh + NO cluster key + the CONFIG part still fresh (`age < configMaxAge`) ⇒ `fresh`
(the grant would be null anyway, and the config part is guaranteed current — no network);
- otherwise ⇒ `revalidate` (a cluster key MUST hit the network for a fresh grant, and past the
config window the config part is revalidated by ETag).

```ts signature
function decidePreflightCache(entry: PreflightCacheEntry | undefined, nowMs: number, hasClusterKey: boolean, liveMaxAgeOverrideS?: number): PreflightCacheDecision
```

### diffStats

function · `src/diff-stats.ts`

Compute the pure diff statistics between a `draft` and its human-approved `final`.
Deterministic and side-effect-free. The `final_hash` is a SHA-256 hex digest of the
final's UTF-8 bytes; `edit_ratio` and `changed_spans` come from a character-level
diff (common prefix/suffix trim, then a bounded LCS over the differing middle).

```ts signature
function diffStats(draft: string, final: string): DiffStats
```

### importListQueryString

function · `src/imports.ts`

Build the `/v1/imports` query string (empty when no filters).

```ts signature
function importListQueryString(query: ImportListQuery = {}): string
```

### isDefinitiveRejection

function · `src/flywheel-queue.ts`

Whether an error is the server DEFINITIVELY refusing an event, so a durable queue may drop it. All
of these must hold:

1. the status is a 4xx other than 401, 403, 408 and 429 (those four keep the event unconditionally);
2. the response body was a well-formed gateway error envelope ([`UltraRouterError.envelope`](#ultraroutererror):
   `code`, `message`, `request_id` and `retryable` present with their types), whose code is the
   error's code;
3. the code is one of [`EVENT_REJECTION_CODES`](#event_rejection_codes), non-retryable in the taxonomy, and the status is
   the one the taxonomy assigns it (400, 404, 409);
4. the envelope says `retryable: false`.

Everything else keeps the event queued: timeouts (the SDK's own deadline included), cancellation,
connection failures, 5xx answers, an answer without the envelope (an HTML 400 from a proxy, an
empty or unreadable body), an unknown or contradictory code, and a malformed success.

```ts signature
function isDefinitiveRejection(err: unknown): boolean
```

### isGatewayErrorCode

function · `src/errors.ts`

Type guard: is `value` one of the stable [`GatewayErrorCode`](#gatewayerrorcode)s?

```ts signature
function isGatewayErrorCode(value: string): value is GatewayErrorCode
```

### isOutcomeReceiptRecord

function · `src/outcome-receipts.ts`

Whether a value looks like a receipt: an object with string `id` and `status`.

```ts signature
function isOutcomeReceiptRecord(value: unknown): value is OutcomeReceiptRecord
```

### isRetryableStatus

function · `src/errors.ts`

HTTP statuses the SDK treats as retryable when a response carries no gateway error code:
408, 429 and every 5xx.

```ts signature
function isRetryableStatus(status: number): boolean
```

### isTerminalReceiptState

function · `src/outcome-receipts.ts`

Whether a receipt state is final (anything but `pending`).

```ts signature
function isTerminalReceiptState(state: string): boolean
```

### isUltraRouterError

function · `src/errors.ts`

Type guard for SDK errors, optionally narrowed to one code.

```ts signature
function isUltraRouterError(err: unknown, code?: string): err is UltraRouterError
```

**Example**

```ts
import { isUltraRouterError } from "@ultrarouter/sdk";

function describe(err: unknown): string {
  if (isUltraRouterError(err, "rate_limited")) return "slow down";
  if (isUltraRouterError(err)) return `${err.code} (${String(err.status)})`;
  return "unexpected error";
}
console.log(describe(new Error("boom")));
```

### isValidRequestId

function · `src/correlation.ts`

Whether `value` is a request id the gateway accepts from a client.

```ts signature
function isValidRequestId(value: unknown): value is string
```

### learnedPlacementIndex

function · `src/learned-placement.ts`

The CACHE-SAFE placement index ("cache-placed after the stable prefix"). The learned
block is inserted immediately AFTER the leading run of `system` messages, so (a) the provider's
stable prefix stays byte-identical, and (b) the learned block — itself stable for a call type —
EXTENDS that prefix rather than invalidating it. A conversation with no leading system message
places the block FIRST (index 0), still ahead of every volatile turn.

```ts signature
function learnedPlacementIndex(messages: readonly {
    readonly role?: unknown;
}[]): number
```

### learningErrorReason

function · `src/learning-controls.ts`

The [`LearningErrorReason`](#learningerrorreason) for a named refusal or an error code, or `null`.

```ts signature
function learningErrorReason(token: string): LearningErrorReason | null
```

### mintEpisodeKey

function · `src/correlation.ts`

Mint an episode key (`ep_<ULID>`). Give every independent task its own key, even when two tasks
start with identical text: without a key the gateway groups steps by their opening text, so two
concurrent tasks that open the same way would be merged into one episode and share one verdict.

```ts signature
function mintEpisodeKey(): string
```

### mintRequestId

function · `src/correlation.ts`

Mint a client-side request id (`req_c_<ULID>`, 32 characters). Send it with
`{ requestId }` on a chat or embeddings call to know the id before the call returns. The `req_c_`
prefix keeps a client-minted id apart from the ids the gateway mints itself.

```ts signature
function mintRequestId(): string
```

### normalizeOutcomeTarget

function · `src/outcomes.ts`

Normalize the `record` target: a bare string is an artifact id.

```ts signature
function normalizeOutcomeTarget(target: string | OutcomeTarget): OutcomeTarget
```

### outcomeIdempotencyKey

function · `src/flywheel-queue.ts`

The Idempotency-Key a queued outcome is ALWAYS sent with: derived from the persisted queue-entry id,
so every replay — including one after a process restart with a [`FileOutcomeStore`](#fileoutcomestore) — carries
the same key as the first attempt.

```ts signature
function outcomeIdempotencyKey(entry: Pick<QueuedOutcome, 'id'>): string
```

### parseGrantHeader

function · `src/preflight.ts`

Parse the uncached `X-UR-Grant` header into a [`PreflightGrant`](#preflightgrant), or null when absent/blank/
unparseable (fail-closed — a garbled header is treated as "no grant", never a throw).

```ts signature
function parseGrantHeader(value: string | null): PreflightGrant | null
```

### parseLearningRefusal

function · `src/learning-controls.ts`

The named refusal a gateway message starts with: a `snake_case` token (at least one underscore),
optionally followed by a parenthesized sub-reason, then `:` or the end. `null` for anything else.

```ts signature
function parseLearningRefusal(message: string): {
    refusal: string;
    detail: string | null;
} | null
```

### parseMaxAgeSeconds

function · `src/preflight.ts`

Parse the `max-age` seconds out of a `Cache-Control` header value, or null when absent.

```ts signature
function parseMaxAgeSeconds(cacheControl: string | null): number | null
```

### parseOutcomeReceipt

function · `src/outcome-receipts.ts`

Check a receipt response body; a body that is not a receipt is a typed `invalid_response`.

```ts signature
function parseOutcomeReceipt(body: unknown): OutcomeReceiptRecord
```

### parseOutcomeReceiptList

function · `src/outcome-receipts.ts`

Check a receipt-list response body (`{ object: "list", data: [...] }`).

```ts signature
function parseOutcomeReceiptList(body: unknown): OutcomeReceiptList
```

### pendingQueryString

function · `src/outcomes.ts`

Build the `/v1/outcomes/pending` query string (empty string when no filters).

```ts signature
function pendingQueryString(query: PendingOutcomesQuery = {}): string
```

### planOutcomeReport

function · `src/outcome-report.ts`

Validate a report and build the event it sends. Pure: no IO.

```ts signature
function planOutcomeReport(requestId: string, params: OutcomeReportParams): OutcomeReportPlan
```

### preflightCacheKey

function · `src/preflight.ts`

A stable cache key for a preflight request: call type, cluster key, budget and a digest of `messages`.

```ts signature
function preflightCacheKey(params: PreflightParams): string
```

### preflightHasClusterKey

function · `src/preflight.ts`

Does a preflight request carry a cluster key (so a grant is minted)?

```ts signature
function preflightHasClusterKey(params: PreflightParams): boolean
```

### readRequestId

function · `src/correlation.ts`

Read the gateway request id from whatever you hold: an SDK result (`.requestId`), a response body
with the `ur` block (`ur.request_id`, which is also what the official `openai` client returns), a
`Response`, a `Headers` object, or anything with a `headers` property (for example the `response`
of the `openai` client's `.withResponse()`). Returns `null` when none is present.

```ts signature
function readRequestId(source: unknown): string | null
```

### renderHostedPromptResult

function · `src/prompt-render.ts`

Render a hosted prompt template (pure), returning a result object instead of throwing. It
substitutes every `{{name}}` slot with the
supplied value (coerced to a string); FAIL-CLOSED with `{ ok:false, missing }` (sorted, de-duped) when
any DECLARED-REQUIRED variable is absent/null/undefined. A missing OPTIONAL variable (declared not
required, or an undeclared `{{slot}}`) renders as the empty string.

```ts signature
function renderHostedPromptResult(input: {
    readonly template: string;
    readonly variables: readonly HostedPromptVariable[];
    readonly vars?: Readonly<Record<string, unknown>>;
}): RenderPromptResult
```

### renderPrompt

function · `src/prompt-render.ts`

Render a hosted prompt (the ergonomic API) — returns the substituted instruction string, or THROWS
[`PromptVariablesMissingError`](#promptvariablesmissingerror) listing the names when a DECLARED-REQUIRED variable is missing
(fail-closed, the SAME rule the gateway applies — never a silent blank). `prompt` is the shape
[`UltraRouter.getPrompt`](#ultrarouter) / preflight `prompt` returns.

```ts signature
function renderPrompt(prompt: RenderablePrompt, vars?: Readonly<Record<string, unknown>>): string
```

### reportSourceEventId

function · `src/outcome-report.ts`

The `source_event_id` a report carries: `rpt_` followed by the lowercase hex SHA-256 of the UTF-8
string `"ur-outcome-report/v1\n" + requestId + "\n" + verdict + "\n" + source + "\n" +
(idempotencyKey ?? "")`. Deterministic, so the same report is always the same event.

```ts signature
function reportSourceEventId(requestId: string, verdict: 'pass' | 'fail', source: OutcomeSource, idempotencyKey?: string): string
```

### reviewerSignatureHeaders

function · `src/reviewer.ts`

Build the two signature headers for an already-serialized body.

```ts signature
async function reviewerSignatureHeaders(secret: string, rawBody: string, nowMs: number = Date.now()): Promise<Record<string, string>>
```

### reviewerSignedPayload

function · `src/reviewer.ts`

The exact bytes an adapter signs: `"<unix-seconds>.<raw request body>"`. Pure.

```ts signature
function reviewerSignedPayload(timestamp: string, rawBody: string): string
```

### reviewerVerdictAction

function · `src/reviewer.ts`

What a per-event reviewer verdict allows the queue to do. Only a verdict that validates moves an
event, and it must be an object with a string `event_id`:

- `remove`: `status` is `accepted` or `duplicate` (the gateway recorded the event);
- `dead_letter`: `status` is `rejected` / `unsupported`, with a string `reason` and
  `repairable: true` (kept for `repair()`);
- `drop`: `status` is `rejected` / `unsupported`, with a string `reason` and `repairable: false` (a
  terminal refusal of this event);
- `keep`: anything else — no verdict, an unknown status, a refusal without a reason or without a
  boolean `repairable`. The event stays queued.

```ts signature
function reviewerVerdictAction(verdict: unknown): 'remove' | 'dead_letter' | 'drop' | 'keep'
```

### sha256Hex

function · `src/diff-stats.ts`

SHA-256 hex digest of a string's UTF-8 bytes. Pure; no WebCrypto, no `node:crypto`.

```ts signature
function sha256Hex(input: string): string
```

### signReviewerPayload

function · `src/reviewer.ts`

Compute the `sha256=<hex>` reviewer signature with WebCrypto. The key is your ultrarouter API key
— the same credential that identifies the workspace and the producer, so a signature can never
disagree with the events it authorizes. Exported so a non-TypeScript reviewer system can be
checked against a known-good implementation.

```ts signature
async function signReviewerPayload(secret: string, timestamp: string, rawBody: string): Promise<string>
```

### toLearningError

function · `src/learning-controls.ts`

Turn a gateway refusal of a learning control into a [`LearningError`](#learningerror): the named refusal at
the start of the message decides first, then the error code. Anything else (a transport failure,
an unrecognised refusal) is returned unchanged.

```ts signature
function toLearningError(err: unknown): unknown
```

### ulid

function · `src/flywheel-queue.ts`

A lexicographically-sortable ULID (48-bit timestamp + 80-bit randomness, Crockford base32).
Uses the global `crypto.getRandomValues` (edge-portable). This is the default
`source_event_id` / queue-entry generator; it is INJECTABLE so tests stay deterministic.

```ts signature
function ulid(now: number = Date.now()): string
```

### withHeaderGrant

function · `src/preflight.ts`

Compose the returned response's grant from the FRESH `X-UR-Grant` header — NEVER from the cache
(read fresh on every response, including a 304). When the header is absent the grant is null
and `grant_reason` is preserved from the body (e.g. `no_cluster_key`); when present, the grant is
the header's and `grant_reason` is null.

```ts signature
function withHeaderGrant(body: PreflightResponse, headerGrant: PreflightGrant | null): PreflightResponse
```

## Constants

### DEFAULT_MAX_RETRIES

const · `src/client.ts`

The default number of retries for a retryable failure.

```ts signature
const DEFAULT_MAX_RETRIES = 2
```

### DEFAULT_PREFLIGHT_CACHE_MAX_ENTRIES

const · `src/preflight.ts`

The default bound on preflight cache entries (see [`PreflightCacheOptions.maxEntries`](#preflightcacheoptions)).

```ts signature
const DEFAULT_PREFLIGHT_CACHE_MAX_ENTRIES = 1000
```

### DEFAULT_TIMEOUT_MS

const · `src/client.ts`

The default total request timeout (ms).

```ts signature
const DEFAULT_TIMEOUT_MS = 600_000
```

### EPISODE_HEADER

const · `src/correlation.ts`

The header that carries the episode handle (equivalent to the body field `ur.artifact`).

```ts signature
const EPISODE_HEADER = 'x-ur-artifact'
```

### EPISODE_KEY_MAX_LENGTH

const · `src/correlation.ts`

The longest episode key the SDK sends in a header.

```ts signature
const EPISODE_KEY_MAX_LENGTH = 256
```

### EVENT_REJECTION_CODES

const · `src/flywheel-queue.ts`

The gateway error codes that refuse an outcome EVENT itself — its payload (`invalid_request`), its
target (`not_found`) or a different payload under its identity (`conflict`) — so that replaying the
identical bytes can never succeed. Every other code (the credentials, the workspace's spend, the
transport, a code this SDK does not know) leaves the event queued.

```ts signature
const EVENT_REJECTION_CODES: readonly GatewayErrorCode[]
```

### EXPERIMENT_EXECUTION_HEADER

const · `src/resources.ts`

The request header every call of an enrolled execution carries (its `execution_id`).

```ts signature
const EXPERIMENT_EXECUTION_HEADER = 'x-ur-experiment-execution'
```

### GATEWAY_ERROR_CODES

const · `src/errors.ts`

Every stable gateway error code, in taxonomy order. Switch on `UltraRouterError.code` against
these values; a transport failure uses `connection` / `timeout` instead.

```ts signature
const GATEWAY_ERROR_CODES = Object.keys(
  GATEWAY_ERROR_TAXONOMY,
) as readonly GatewayErrorCode[]
```

### GATEWAY_ERROR_TAXONOMY

const · `src/errors.ts`

The gateway error taxonomy: every stable error code with its canonical HTTP status and whether a
client may retry it as-is. The SDK uses this table to decide retries — a code marked
`retryable: false` is never retried, whatever its status.

```ts signature
const GATEWAY_ERROR_TAXONOMY = {
  /** Malformed or invalid request body, parameters, or an unsupported option. */
  invalid_request: { status: 400, retryable: false },
  /** A declared `ur.manifest` is structurally invalid (for ex …
```

### LEARNED_MESSAGE_ROLE

const · `src/learned-placement.ts`

The role the learned block is injected under — a DATA `user` message, exactly as the seam splices.

```ts signature
const LEARNED_MESSAGE_ROLE = 'user'
```

### LEARNING_ERROR_ACTIONS

const · `src/learning-controls.ts`

What to do about each [`LearningErrorReason`](#learningerrorreason).

```ts signature
const LEARNING_ERROR_ACTIONS: Readonly<Record<LearningErrorReason, string>>
```

### LEARNING_ERROR_CODES

const · `src/learning-controls.ts`

The refusals each [`LearningErrorReason`](#learningerrorreason) is recognised from: a named refusal (the first
token of the gateway's message, e.g. `corrections_consent_required: …` or
`reflection_model_not_workspace_owned (no_workspace_key): …`), else the error code.

```ts signature
const LEARNING_ERROR_CODES: Readonly<Record<LearningErrorReason, readonly string[]>>
```

### ORACLE_SIGNATURE_HEADER

const · `src/resources.ts`

The request header carrying the oracle pull-transport signature (`sha256=<hex>`).

```ts signature
const ORACLE_SIGNATURE_HEADER = 'x-ur-oracle-signature'
```

### ORACLE_TIMESTAMP_HEADER

const · `src/resources.ts`

The request header carrying the oracle signature timestamp (unix seconds).

```ts signature
const ORACLE_TIMESTAMP_HEADER = 'x-ur-oracle-timestamp'
```

### OUTCOME_SOURCES

const · `src/outcome-report.ts`

Every [`OutcomeSource`](#outcomesource), in table order.

```ts signature
const OUTCOME_SOURCES = Object.keys(OUTCOME_VERDICTS) as readonly OutcomeSource[]
```

### OUTCOME_VERDICT_VALUES

const · `src/outcome-report.ts`

Every [`OutcomeVerdict`](#outcomeverdict).

```ts signature
const OUTCOME_VERDICT_VALUES: readonly OutcomeVerdict[]
```

### OUTCOME_VERDICTS

const · `src/outcome-report.ts`

The verdict mapping, source by source. Identical to the shared fixture's `sources`.

```ts signature
const OUTCOME_VERDICTS: Readonly<Record<OutcomeSource, OutcomeSourceMapping>>
```

### OUTCOME_VERDICTS_SCHEMA_VERSION

const · `src/outcome-report.ts`

The schema version of the verdict mapping (the shared fixture's `schema_version`).

```ts signature
const OUTCOME_VERDICTS_SCHEMA_VERSION = 1
```

### PREFLIGHT_DEFAULT_CONFIG_MAX_AGE_S

const · `src/preflight.ts`

The config-part max age (seconds) the gateway declares — `Cache-Control: private, max-age=5`.

```ts signature
const PREFLIGHT_DEFAULT_CONFIG_MAX_AGE_S = 5
```

### PREFLIGHT_DEFAULT_LIVE_MAX_AGE_S

const · `src/preflight.ts`

The live-part (health-ordered fallbacks) max age (seconds) — `routing.max_age_s`.

```ts signature
const PREFLIGHT_DEFAULT_LIVE_MAX_AGE_S = 30
```

### PREFLIGHT_GRANT_HEADER

const · `src/preflight.ts`

The lowercased response header the grant is served on — uncached, present on 200 AND 304.

```ts signature
const PREFLIGHT_GRANT_HEADER = 'x-ur-grant'
```

### PREFLIGHT_LIVE_MAX_AGE_HEADER

const · `src/preflight.ts`

The lowercased response header carrying the 30 s LIVE-part max age (`routing.max_age_s`).

```ts signature
const PREFLIGHT_LIVE_MAX_AGE_HEADER = 'x-ur-live-max-age'
```

### PROMPT_VARIABLES_MISSING_CODE

const · `src/prompt-render.ts`

The stable error code the gateway raises for a missing required hosted-prompt variable.

```ts signature
const PROMPT_VARIABLES_MISSING_CODE = 'prompt_variables_missing'
```

### RECEIPT_WAIT_DEFAULTS

const · `src/outcome-receipts.ts`

`waitForReceipt` defaults.

```ts signature
const RECEIPT_WAIT_DEFAULTS = {
  timeoutMs: 30_000,
  pollIntervalMs: 250,
  maxPollIntervalMs: 4_000,
} as const
```

### REPORT_IDENTITY_VERSION

const · `src/outcome-report.ts`

The version tag mixed into every derived `source_event_id`.

```ts signature
const REPORT_IDENTITY_VERSION = 'ur-outcome-report/v1'
```

### REQUEST_ID_HEADER

const · `src/correlation.ts`

The header the gateway echoes the request id on, and accepts a client-chosen id from.

```ts signature
const REQUEST_ID_HEADER = 'x-ur-request-id'
```

### REQUEST_ID_PATTERN

const · `src/correlation.ts`

The shape the gateway accepts for a client-sent request id: 1–64 of `A-Z a-z 0-9 _ -`.

```ts signature
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
```

### REVIEWER_SIGNATURE_HEADER

const · `src/reviewer.ts`

The header carrying the adapter signature (`sha256=<hex>`).

```ts signature
const REVIEWER_SIGNATURE_HEADER = 'x-ur-reviewer-signature'
```

### REVIEWER_TIMESTAMP_HEADER

const · `src/reviewer.ts`

The header carrying the signature's unix-second timestamp (bound INTO the MAC).

```ts signature
const REVIEWER_TIMESTAMP_HEADER = 'x-ur-reviewer-timestamp'
```

### TERMINAL_RECEIPT_STATES

const · `src/outcome-receipts.ts`

The final receipt states: [`OutcomeReceiptState`](#outcomereceiptstate) values other than `pending`.

```ts signature
const TERMINAL_RECEIPT_STATES: readonly OutcomeReceiptState[]
```

### VERSION

const · `src/version.ts`

The version of this SDK (kept equal to `package.json` by a unit test).

```ts signature
const VERSION = '0.1.0'
```

## Interfaces

### ApiRequestInit

interface · `src/resources.ts`

Options for the typed [`UltraRouter.request`](#ultrarouter) helper: the path
parameters, the query string and the JSON body, each typed from the OpenAPI operation.

```ts signature
interface ApiRequestInit<M extends HttpMethod, P extends ApiPath<M>> {
    path?: PathParamsOf<ApiOperation<M, P>>;
    query?: QueryOf<ApiOperation<M, P>>;
    body?: BodyOf<ApiOperation<M, P>>;
}
```

| Member | Description |
| --- | --- |
| `path?: PathParamsOf<ApiOperation<M, P>>` | Values for the `{placeholders}` in the path template. Each value is percent-encoded. |
| `query?: QueryOf<ApiOperation<M, P>>` | Query-string parameters. `undefined` values are skipped. |
| `body?: BodyOf<ApiOperation<M, P>>` | The JSON request body. |

### ArtifactListQuery

interface · `src/artifacts.ts`

`GET /v1/artifacts` keyset query filters (never OFFSET).

```ts signature
interface ArtifactListQuery {
    limit?: number;
    cursor?: string;
    archetype?: ArtifactArchetype;
    key?: string;
}
```

| Member | Description |
| --- | --- |
| `limit?: number` | Page size (1–200, default 50). |
| `cursor?: string` | Opaque keyset cursor from the prior page. |
| `archetype?: ArtifactArchetype` | Filter to one archetype. |
| `key?: string` | Filter to one artifact key. |

### ArtifactScope

interface · `src/client.ts`

The scope handed to `withArtifact(key, fn)`. Every chat and embeddings call carries
`ur.artifact = key`; `record` and `final` target the artifact.

```ts signature
interface ArtifactScope {
    readonly key: string;
    chat: {
        completions: {
            create: (params: ChatCompletionCreateParams, options?: RequestOptions) => Promise<(ChatCompletion & RequestCorrelation) | (ChatCompletionStream & StreamCorrelation)>;
        };
    };
    embeddings: {
        create: (params: EmbeddingCreateParams, options?: RequestOptions) => Promise<CreateEmbeddingResponse & RequestCorrelation>;
    };
    record: (outcome: OutcomeInput, options?: RequestOptions) => Promise<OutcomeReceipt>;
    final: (params: FinalParams, options?: RequestOptions) => Promise<FinalResponse>;
}
```

| Member | Description |
| --- | --- |
| `readonly key: string` | The bound artifact key. |
| `chat: { completions: { create: ( params: ChatCompletionCreateParams, options?: RequestOptions, ) => Promise< (ChatCompletion & RequestCorrelation) \| (ChatCompletionStream & StreamCorrelation) >; }; }` | Chat completions bound to the artifact. |
| `embeddings: { create: ( params: EmbeddingCreateParams, options?: RequestOptions, ) => Promise<CreateEmbeddingResponse & RequestCorrelation>; }` | Embeddings bound to the artifact. |
| `record: (outcome: OutcomeInput, options?: RequestOptions) => Promise<OutcomeReceipt>` | Durably record an outcome on the bound artifact (upserted on first use). |
| `final: (params: FinalParams, options?: RequestOptions) => Promise<FinalResponse>` | Record the human-approved final on the bound artifact. |

### ArtifactsResource

interface · `src/client.ts`

`ur.ur.artifacts`: the units of value your application produces.

```ts signature
interface ArtifactsResource {
    create: (params: CreateArtifactParams, options?: RequestOptions) => Promise<Artifact>;
    get: (id: string, options?: RequestOptions) => Promise<Artifact>;
    list: (query?: ArtifactListQuery, options?: RequestOptions) => Promise<ArtifactListResponse>;
    final: (id: string, params: FinalParams, options?: RequestOptions) => Promise<FinalResponse>;
}
```

| Member | Description |
| --- | --- |
| `create: (params: CreateArtifactParams, options?: RequestOptions) => Promise<Artifact>` | Create or upsert an artifact by `key`. |
| `get: (id: string, options?: RequestOptions) => Promise<Artifact>` | Get one artifact with its claims. |
| `list: (query?: ArtifactListQuery, options?: RequestOptions) => Promise<ArtifactListResponse>` | List artifacts (keyset pagination: pass `next_cursor` back as `cursor`). |
| `final: (id: string, params: FinalParams, options?: RequestOptions) => Promise<FinalResponse>` | Record the human-approved final output. With corrections consent send `{ final, draft? }`; without it send `{ diff_stats, final_hash }` from [`diffStats`](#diffstats) so no text leaves the process. |

### AsOpenAI

interface · `src/client.ts`

The [`UltraRouter.asOpenAI`](#ultrarouter) signature: a configuration, or a client built with the given constructor.

```ts signature
interface AsOpenAI {
    (): OpenAICompatConfig;
    <T>(ctor: OpenAIConstructor<T>): T;
}
```

### AutopilotCallType

interface · `src/types.ts`

One observed call type in the readiness rollup.

```ts signature
interface AutopilotCallType {
    call_type_id: string;
    slug: string;
    display_name: string;
    source: string;
    lifecycle_state: string;
    confidence: 'high' | 'medium' | 'low';
    requests: number;
    spend_micro_usd: number;
    models_seen: string[];
    providers_seen: string[];
    cost_provenance: AutopilotCostProvenance;
    evidence_gaps: string[];
}
```

| Member | Description |
| --- | --- |
| `call_type_id: string` | The `ct_*` id. |
| `slug: string` | The slug. |
| `display_name: string` | Display name. |
| `source: string` | How the call type was created. |
| `lifecycle_state: string` | Lifecycle state: `observing`, `evaluator_building`, `benchmarkable`, `recommendable`, `canary`, `verified` or `held`. |
| `confidence: 'high' \| 'medium' \| 'low'` | Inference confidence. |
| `requests: number` | Observed requests. |
| `spend_micro_usd: number` | Observed spend (micro-USD). |
| `models_seen: string[]` | Models seen. |
| `providers_seen: string[]` | Providers seen. |
| `cost_provenance: AutopilotCostProvenance` | Cost provenance mix. |
| `evidence_gaps: string[]` | What evidence is missing, and why. |

### AutopilotCostProvenance

interface · `src/types.ts`

How much of the observed cost is replayable (provider-reported) versus estimate-only.

```ts signature
interface AutopilotCostProvenance {
    measured_replayable: number;
    estimate_only: number;
}
```

| Member | Description |
| --- | --- |
| `measured_replayable: number` | Requests with replayable, provider-reported cost. |
| `estimate_only: number` | Requests with estimate-only cost. |

### AutopilotCoverage

interface · `src/types.ts`

What evidence the rollup could and could not use.

```ts signature
interface AutopilotCoverage {
    retention_mode: string;
    payload_consented: boolean;
    confirmed_envelopes: number;
    non_replayable_envelopes: number;
    queued_envelopes: number;
    notes: string[];
}
```

| Member | Description |
| --- | --- |
| `retention_mode: string` | The workspace retention mode. |
| `payload_consented: boolean` | Whether payload storage is consented. |
| `confirmed_envelopes: number` | Confirmed captured envelopes. |
| `non_replayable_envelopes: number` | Envelopes that cannot be replayed. |
| `queued_envelopes: number` | Envelopes still queued. |
| `notes: string[]` | Human-readable notes. |

### AutopilotStatus

interface · `src/types.ts`

`ur.autopilot.status()` (`GET /v1/audit/readiness`): the read-only readiness and lifecycle rollup.
Extra wire fields are preserved via the index signature.

```ts signature
interface AutopilotStatus {
    object: 'audit_readiness';
    state: string;
    generated: boolean;
    total_requests: number;
    total_spend_micro_usd: number;
    observing_call_types: number;
    call_types: AutopilotCallType[];
    inventory: {
        providers: string[];
        models: string[];
        key_modes: string[];
    };
    coverage: AutopilotCoverage;
    [key: string]: unknown;
}
```

| Member | Description |
| --- | --- |
| `object: 'audit_readiness'` | Always `audit_readiness`. |
| `state: string` | The workspace audit state (`observing` while passively observing). |
| `generated: boolean` | `false` until the first rollup has been computed. |
| `total_requests: number` | Observed requests. |
| `total_spend_micro_usd: number` | Observed spend (micro-USD). |
| `observing_call_types: number` | Call types still observing. |
| `call_types: AutopilotCallType[]` | Per-call-type readiness. |
| `inventory: { providers: string[]; models: string[]; key_modes: string[] }` | Providers, models and key modes seen. |
| `coverage: AutopilotCoverage` | Evidence coverage. |
| `[key: string]: unknown;` | Any further fields the gateway returns. |

### BenchResource

interface · `src/client.ts`

`ur.ur.bench`: suites, paired runs, reports and the baseline-compare gate.

```ts signature
interface BenchResource {
    status: (suite: string, options?: RequestOptions) => Promise<BenchSuiteStatus>;
    freeze: (suite: string, params?: BenchFreezeParams, options?: RequestOptions) => Promise<BenchDatasetFreeze>;
    run: (params: BenchRunParams, options?: RequestOptions) => Promise<BenchRunTrigger | BenchRun>;
    get: (runId: string, options?: RequestOptions) => Promise<BenchRun>;
    report: {
        (runId: string, params?: {
            format?: 'json';
        }, options?: RequestOptions): Promise<BenchReport>;
        (runId: string, params: {
            format: 'md' | 'bundle';
        }, options?: RequestOptions): Promise<string>;
    };
    expect: (suite: string, expectations: BenchExpectationInput[], options?: RequestOptions) => Promise<BenchExpectations>;
    record: (target: BenchOutcomeTarget, outcomes: BenchOutcomeInput[], options?: RequestOptions) => Promise<BenchOutcomes>;
    baseline: (runId: string, options?: RequestOptions) => Promise<BenchBaseline>;
    gate: (runId: string, options?: RequestOptions) => Promise<BenchCompareGate>;
}
```

| Member | Description |
| --- | --- |
| `status: (suite: string, options?: RequestOptions) => Promise<BenchSuiteStatus>` | Read a suite's readiness (`GET /v1/bench/suites/{slug}/status`). |
| `freeze: ( suite: string, params?: BenchFreezeParams, options?: RequestOptions, ) => Promise<BenchDatasetFreeze>` | Freeze a suite into immutable dataset cards. `max_items` caps items per call type. |
| `run: (params: BenchRunParams, options?: RequestOptions) => Promise<BenchRunTrigger \| BenchRun>` | Trigger a paired run. With `wait: true` the client polls until the run is `complete` or `failed` and resolves the run instead of the trigger receipt. |
| `get: (runId: string, options?: RequestOptions) => Promise<BenchRun>` | Read a run and its per-arm evidence. |
| `report: { (runId: string, params?: { format?: 'json' }, options?: RequestOptions): Promise<BenchReport>; (runId: string, params: { format: 'md' \| 'bundle' }, options?: RequestOptions): Promise<string>; }` | Read a run's evidence report. `format: 'json'` (default) resolves the typed report; `'md'` and `'bundle'` resolve the exported text. |
| `expect: ( suite: string, expectations: BenchExpectationInput[], options?: RequestOptions, ) => Promise<BenchExpectations>` | Attach assertions (expectations) to a suite. |
| `record: ( target: BenchOutcomeTarget, outcomes: BenchOutcomeInput[], options?: RequestOptions, ) => Promise<BenchOutcomes>` | Record per-trace outcomes for a suite (`{ suite }`) or a run (`{ run }`). |
| `baseline: (runId: string, options?: RequestOptions) => Promise<BenchBaseline>` | Pin a completed run as the suite baseline. |
| `gate: (runId: string, options?: RequestOptions) => Promise<BenchCompareGate>` | Read a compare run's gate verdict (`pass`, `fail` or `inconclusive`). |

### BenchRunParams

interface · `src/types.ts`

`ur.bench.run(params)` parameters. The wire fields match the trigger request; `suite` names the
suite and the `wait` / poll fields are client-side only.

```ts signature
interface BenchRunParams {
    suite: string;
    max_cost_usd: number;
    mode?: BenchRunMode;
    selection_mode?: BenchSelectionMode;
    require_power?: boolean;
    dry_run?: boolean;
    force?: boolean;
    call_types?: string[];
    candidates?: string[];
    compare?: boolean;
    baseline_run_id?: string;
    cost_ceiling_usd?: number;
    max_output_tokens?: number;
    wait?: boolean;
    pollIntervalMs?: number;
    waitTimeoutMs?: number;
}
```

| Member | Description |
| --- | --- |
| `suite: string` | The suite slug. |
| `max_cost_usd: number` | Required per-run cost cap (USD). |
| `mode?: BenchRunMode` | `request` (default) or `task`. |
| `selection_mode?: BenchSelectionMode` | `selection` (default) or `noninferiority`. |
| `require_power?: boolean` | Exclude underpowered call types before any budget is reserved (default `false`). |
| `dry_run?: boolean` | Return the estimate, dispositions and allowance without reserving or dispatching anything. |
| `force?: boolean` | Skip the recent-run deduplication and always run fresh. |
| `call_types?: string[]` | Restrict the run to these frozen call-type ids. |
| `candidates?: string[]` | Explicit challenger model ids (default: selected from the catalog). |
| `compare?: boolean` | Compare mode: run the current config as the single arm and gate it against a baseline. |
| `baseline_run_id?: string` | The baseline run (`br_*`) to compare against (default: the suite's pinned baseline). |
| `cost_ceiling_usd?: number` | An absolute per-unit cost ceiling (USD); a breach fails the gate. |
| `max_output_tokens?: number` | The per-attempt output-token ceiling (default 256), pinned into the run; changing it starts a new measurement epoch. |
| `wait?: boolean` | Poll until the run is `complete` or `failed`, then resolve the run. |
| `pollIntervalMs?: number` | Poll interval with `wait: true` (ms, default 1000). |
| `waitTimeoutMs?: number` | Maximum wait with `wait: true` (ms, default 120000) before a `timeout` error. |

### CallType

interface · `src/types.ts`

A call type: a stable name for one kind of request, with its config history and lifecycle.

```ts signature
interface CallType {
    object: 'call_type';
    id: string;
    slug: string;
    display_name: string;
    source: string;
    current_config_version: number | null;
    config: CallTypeConfigVersion | null;
    lifecycle_state: string;
    lifecycle_reason: string | null;
    lifecycle_transitioned_at: string | null;
    created_at: string;
    updated_at: string;
}
```

| Member | Description |
| --- | --- |
| `object: 'call_type'` | Always `call_type`. |
| `id: string` | The `ct_*` id. |
| `slug: string` | The stable slug. |
| `display_name: string` | Display name. |
| `source: string` | How the call type was created (declared or inferred). |
| `current_config_version: number \| null` | The active config version number, or `null`. |
| `config: CallTypeConfigVersion \| null` | The active config version, or `null`. |
| `lifecycle_state: string` | The Autopilot lifecycle state (`observing` … `verified` / `held`). Informational only. |
| `lifecycle_reason: string \| null` | The evidence reason for the last lifecycle transition, or `null`. |
| `lifecycle_transitioned_at: string \| null` | When the last lifecycle transition happened (ISO 8601), or `null`. |
| `created_at: string` | Creation time (ISO 8601). |
| `updated_at: string` | Last update time (ISO 8601). |

### CallTypeConfigBody

interface · `src/types.ts`

A call-type config body. On update, an omitted field keeps its current value.

```ts signature
interface CallTypeConfigBody {
    model_pin?: string | null;
    router_mode?: 'pinned' | 'auto' | 'candidates' | 'off' | null;
    compression_mode?: 'off' | 'semantic_safe' | 'adaptive' | 'lossless' | 'auto' | null;
    fallbacks?: string[] | null;
    provider_prefs?: Record<string, unknown> | null;
    learned_context_delivery?: LearnedContextDelivery;
    case_precedents_enabled?: boolean;
    self_improve_mode?: 'off' | 'assist' | 'autopilot';
    self_improve_guardrails?: SelfImproveGuardrails;
}
```

| Member | Description |
| --- | --- |
| `model_pin?: string \| null` | Pin a model, or `null` to clear the pin. |
| `router_mode?: 'pinned' \| 'auto' \| 'candidates' \| 'off' \| null` | Routing mode, or `null` for the default. |
| `compression_mode?: 'off' \| 'semantic_safe' \| 'adaptive' \| 'lossless' \| 'auto' \| null` | Compression mode, or `null` for the default. |
| `fallbacks?: string[] \| null` | Ordered fallback models, or `null`. |
| `provider_prefs?: Record<string, unknown> \| null` | Provider preferences, or `null`. |
| `learned_context_delivery?: LearnedContextDelivery` | How learned context is delivered: `gateway_inject_after_stable_prefix` (the gateway injects it on proxied requests) or `off` (a caller that calls its model directly injects it with `useLearned`). |
| `case_precedents_enabled?: boolean` | Serve per-request case precedents into the learned slot (default `false`). |
| `self_improve_mode?: 'off' \| 'assist' \| 'autopilot'` | Self-improvement mode: `off`, `assist` (propose to your inbox) or `autopilot` (adopt within guardrails). |
| `self_improve_guardrails?: SelfImproveGuardrails` | Self-improvement guardrails (a cost budget and the enabled surfaces). |

### CallTypeConfigVersion

interface · `src/types.ts`

One immutable config version of a call type.

```ts signature
interface CallTypeConfigVersion {
    version: number;
    model_pin: string | null;
    router_mode: string | null;
    compression_mode: string | null;
    fallbacks: string[] | null;
    provider_prefs: Record<string, unknown> | null;
    learned_context_delivery?: LearnedContextDelivery;
    case_precedents_enabled?: boolean;
    created_at: string;
}
```

| Member | Description |
| --- | --- |
| `version: number` | The config version number. |
| `model_pin: string \| null` | The pinned model, or `null`. |
| `router_mode: string \| null` | The routing mode, or `null` for the default. |
| `compression_mode: string \| null` | The compression mode, or `null` for the default. |
| `fallbacks: string[] \| null` | Ordered fallback models, or `null`. |
| `provider_prefs: Record<string, unknown> \| null` | Provider preferences, or `null`. |
| `learned_context_delivery?: LearnedContextDelivery` | How learned context is delivered on this version. |
| `case_precedents_enabled?: boolean` | Whether per-request case precedents are served into the learned slot on this version. |
| `created_at: string` | When this version was created (ISO 8601). |

### CallTypeListResponse

interface · `src/types.ts`

`GET /v1/call-types` response.

```ts signature
interface CallTypeListResponse {
    object: 'list';
    data: CallType[];
}
```

| Member | Description |
| --- | --- |
| `object: 'list'` | Always `list`. |
| `data: CallType[]` | The call types. |

### CallTypesResource

interface · `src/client.ts`

`ur.ur.callTypes`: call-type configuration, evals and hosted prompts.

```ts signature
interface CallTypesResource {
    list: (options?: RequestOptions) => Promise<CallTypeListResponse>;
    create: (params: CreateCallTypeParams, options?: RequestOptions) => Promise<CallType>;
    get: (id: string, options?: RequestOptions) => Promise<CallType>;
    update: (id: string, params: CallTypeConfigBody, options?: RequestOptions) => Promise<CallType>;
    enqueueEval: (id: string, params?: EnqueueEvalParams, options?: RequestOptions) => Promise<EnqueueEvalResponse>;
    listEvals: (id: string, options?: RequestOptions) => Promise<EvalRunList>;
    recommendations: (id: string, options?: RequestOptions) => Promise<CallTypeRecommendations>;
    prompts: HostedPromptsResource;
    verifiedMemory: VerifiedMemoryResource;
}
```

| Member | Description |
| --- | --- |
| `list: (options?: RequestOptions) => Promise<CallTypeListResponse>` | List call types (`GET /v1/call-types`). |
| `create: (params: CreateCallTypeParams, options?: RequestOptions) => Promise<CallType>` | Create a call type (`POST /v1/call-types`). Needs a key with `config:write`. |
| `get: (id: string, options?: RequestOptions) => Promise<CallType>` | Get one call type by slug or `ct_*` id. |
| `update: (id: string, params: CallTypeConfigBody, options?: RequestOptions) => Promise<CallType>` | Append a config version (`PATCH /v1/call-types/{id}`). Omitted fields keep their value. |
| `enqueueEval: ( id: string, params?: EnqueueEvalParams, options?: RequestOptions, ) => Promise<EnqueueEvalResponse>` | Trigger an eval run for the call type. Resolves to the enqueued run, or to a documented no-op (`enqueued: false` with a `reason`); a deduplicated trigger names the run it joined (`prior_run_id`). |
| `listEvals: (id: string, options?: RequestOptions) => Promise<EvalRunList>` | List the call type's eval runs and their candidates (`GET /v1/call-types/{id}/evals`). |
| `recommendations: (id: string, options?: RequestOptions) => Promise<CallTypeRecommendations>` | Read the eval-backed model recommendations for the call type. |
| `prompts: HostedPromptsResource` | Hosted prompt versions. |
| `verifiedMemory: VerifiedMemoryResource` | Verified-memory controls. |

### ChatChoice

interface · `src/types.ts`

One completion choice.

```ts signature
interface ChatChoice {
    index: number;
    message: {
        role: string;
        content?: string | null;
        tool_calls?: unknown[];
    };
    finish_reason: string | null;
    logprobs?: unknown;
}
```

| Member | Description |
| --- | --- |
| `index: number` | The choice index. |
| `message: { role: string; content?: string \| null; tool_calls?: unknown[]; }` | The generated message. |
| `finish_reason: string \| null` | Why generation stopped (`stop`, `length`, `tool_calls`, …). |
| `logprobs?: unknown` | Log probabilities, when requested. |

### ChatCompletion

interface · `src/types.ts`

`POST /v1/chat/completions` (non-streaming) response.

```ts signature
interface ChatCompletion {
    id: string;
    object: 'chat.completion';
    created: number;
    model: string;
    choices: ChatChoice[];
    usage: Usage;
    system_fingerprint?: string;
    ur: UrResponseBlock;
}
```

| Member | Description |
| --- | --- |
| `id: string` | The completion id. |
| `object: 'chat.completion'` | Always `chat.completion`. |
| `created: number` | Unix seconds. |
| `model: string` | The model that produced the completion. |
| `choices: ChatChoice[]` | The generated choices. |
| `usage: Usage` | Token usage. |
| `system_fingerprint?: string` | The provider system fingerprint, when reported. |
| `ur: UrResponseBlock` | The ultrarouter response block. |

### ChatCompletionChunk

interface · `src/types.ts`

One streamed chunk (`chat.completion.chunk`). The final chunk carries `usage` and `ur`.

```ts signature
interface ChatCompletionChunk {
    id: string;
    object: 'chat.completion.chunk';
    created: number;
    model: string;
    choices: {
        index: number;
        delta: {
            role?: string;
            content?: string | null;
            tool_calls?: unknown[];
        };
        finish_reason?: string | null;
    }[];
    usage?: Usage | null;
    ur?: UrResponseBlock;
}
```

| Member | Description |
| --- | --- |
| `id: string` | The completion id. |
| `object: 'chat.completion.chunk'` | Always `chat.completion.chunk`. |
| `created: number` | Unix seconds. |
| `model: string` | The model producing the stream. |
| `choices: { index: number; delta: { role?: string; content?: string \| null; tool_calls?: unknown[] }; finish_reason?: string \| null; }[]` | The incremental deltas. |
| `usage?: Usage \| null` | Token usage, on the final chunk. |
| `ur?: UrResponseBlock` | The ultrarouter response block, on the final chunk. |

### ChatCompletionCreateParams

interface · `src/types.ts`

`POST /v1/chat/completions` request body: the OpenAI fields plus the ultrarouter extensions.

```ts signature
interface ChatCompletionCreateParams {
    model?: string;
    messages: ChatMessage[];
    tools?: unknown[];
    tool_choice?: string | Record<string, unknown>;
    response_format?: ResponseFormat;
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
    max_completion_tokens?: number;
    stop?: string | string[];
    stream?: boolean;
    stream_options?: Record<string, unknown>;
    seed?: number;
    logprobs?: boolean;
    top_logprobs?: number;
    n?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    user?: string;
    reasoning_effort?: ReasoningEffort;
    reasoning?: ReasoningOptions;
    models?: string[];
    router?: RouterMode;
    call_type?: string;
    compression?: CompressionOption;
    provider?: ProviderPreferences;
    ur?: UrRequestOptions;
    bench?: BenchTag;
    metadata?: Record<string, unknown>;
}
```

| Member | Description |
| --- | --- |
| `model?: string` | Provider-prefixed model id, e.g. `openai/gpt-5.2-mini`. Optional when the client has a `defaultModel`. |
| `messages: ChatMessage[]` | The conversation. |
| `tools?: unknown[]` | Tool (function) definitions, OpenAI-shaped. |
| `tool_choice?: string \| Record<string, unknown>` | `none`, `auto`, `required`, or a specific tool. |
| `response_format?: ResponseFormat` | Structured output control (`json_object` / `json_schema`). |
| `temperature?: number` | Sampling temperature. |
| `top_p?: number` | Nucleus sampling. |
| `max_tokens?: number` | Maximum tokens to generate (legacy name). |
| `max_completion_tokens?: number` | Maximum tokens to generate. |
| `stop?: string \| string[]` | Stop sequences. |
| `stream?: boolean` | Stream the response as server-sent events. |
| `stream_options?: Record<string, unknown>` | Stream options, e.g. `{ include_usage: true }`. |
| `seed?: number` | Sampling seed. |
| `logprobs?: boolean` | Return log probabilities. |
| `top_logprobs?: number` | Number of top log probabilities per token. |
| `n?: number` | Number of choices. |
| `frequency_penalty?: number` | Frequency penalty. |
| `presence_penalty?: number` | Presence penalty. |
| `user?: string` | An end-user identifier. |
| `reasoning_effort?: ReasoningEffort` | The OpenAI reasoning-effort control. Forwarded to providers that support it, mapped to a thinking budget for budget-based providers, and refused with `capability_unsupported` where a provider has no reasoning control. |
| `reasoning?: ReasoningOptions` | OpenRouter-compatible structured reasoning control. |
| `models?: string[]` | Ordered fallback model ids (OpenRouter-compatible). |
| `router?: RouterMode` | Routing mode for this call. |
| `call_type?: string` | A stable call-type slug that groups requests of the same kind. |
| `compression?: CompressionOption` | Compression control. |
| `provider?: ProviderPreferences` | Provider preferences. |
| `ur?: UrRequestOptions` | Per-request ultrarouter controls. |
| `bench?: BenchTag` | A per-call Bench capture tag. Folded into the body `ur.bench`, which wins over the client's construction-time `bench` headers. |
| `metadata?: Record<string, unknown>` | Free-form metadata. |

### ChatCompletionsCreate

interface · `src/client.ts`

`chat.completions.create`: resolves a [`ChatCompletion`](#chatcompletion), or a [`ChatCompletionStream`](#chatcompletionstream) when
`stream: true`.

```ts signature
interface ChatCompletionsCreate {
    (params: ChatCompletionCreateParams & {
        stream?: false | undefined;
    }, options?: RequestOptions): Promise<ChatCompletion & RequestCorrelation>;
    (params: ChatCompletionCreateParams & {
        stream: true;
    }, options?: RequestOptions): Promise<ChatCompletionStream & StreamCorrelation>;
    (params: ChatCompletionCreateParams, options?: RequestOptions): Promise<(ChatCompletion & RequestCorrelation) | (ChatCompletionStream & StreamCorrelation)>;
}
```

### ChatContentPart

interface · `src/types.ts`

One content part of a multi-part message. `cache_control` marks a prompt-cache breakpoint (honoured
by providers that support explicit cache breakpoints; ignored elsewhere).

```ts signature
interface ChatContentPart {
    type?: string;
    text?: string;
    cache_control?: {
        type: 'ephemeral';
        ttl?: string;
    };
    [key: string]: unknown;
}
```

| Member | Description |
| --- | --- |
| `type?: string` | The part type, e.g. `text` or `image_url`. |
| `text?: string` | The text of a `text` part. |
| `cache_control?: { type: 'ephemeral'; ttl?: string }` | A prompt-cache breakpoint. |
| `[key: string]: unknown;` | Other provider-specific part fields (for example `image_url`). |

### ChatMessage

interface · `src/types.ts`

An OpenAI-shaped chat message. `content` may be a string, a multi-part array, or `null`.

```ts signature
interface ChatMessage {
    role: ChatRole;
    content?: string | ChatContentPart[] | null;
    name?: string;
    tool_calls?: unknown[];
    tool_call_id?: string;
}
```

| Member | Description |
| --- | --- |
| `role: ChatRole` | The author role. |
| `content?: string \| ChatContentPart[] \| null` | The message content. |
| `name?: string` | An optional participant name. |
| `tool_calls?: unknown[]` | Tool calls requested by an assistant message. |
| `tool_call_id?: string` | For a `tool` message: the id of the tool call it answers. |

### ChatResource

interface · `src/client.ts`

`ur.chat`: OpenAI-compatible chat completions.

```ts signature
interface ChatResource {
    completions: {
        create: ChatCompletionsCreate;
    };
}
```

| Member | Description |
| --- | --- |
| `completions: { create: ChatCompletionsCreate; }` | `POST /v1/chat/completions`. |

### CompressionOptions

interface · `src/types.ts`

Structured compression control.

```ts signature
interface CompressionOptions {
    mode?: CompressionMode;
    no_compress_fields?: string[];
    max_quality_risk?: 'low' | 'medium' | 'high';
}
```

| Member | Description |
| --- | --- |
| `mode?: CompressionMode` | The compression mode. |
| `no_compress_fields?: string[]` | Message paths that must never be rewritten, e.g. `messages.1.content` or `messages.2`. |
| `max_quality_risk?: 'low' \| 'medium' \| 'high'` | How much quality risk lossy pruning may take (maps to a prune-ratio cap). |

### CorrelationOptions

interface · `src/correlation.ts`

The ids [`correlationHeaders`](#correlationheaders) turns into request headers.

```ts signature
interface CorrelationOptions {
    requestId?: string | undefined;
    episodeKey?: string | undefined;
}
```

| Member | Description |
| --- | --- |
| `requestId?: string \| undefined` | A client-chosen request id (`[A-Za-z0-9_-]{1,64}`), sent as `x-ur-request-id`. |
| `episodeKey?: string \| undefined` | The episode handle, sent as `x-ur-artifact`: printable ASCII, at most 256 characters. |

### CreateCallTypeParams

interface · `src/types.ts`

`POST /v1/call-types` request body.

```ts signature
interface CreateCallTypeParams {
    slug: string;
    config?: CallTypeConfigBody;
}
```

| Member | Description |
| --- | --- |
| `slug: string` | The stable slug. |
| `config?: CallTypeConfigBody` | The initial config. |

### CreateEmbeddingResponse

interface · `src/types.ts`

`POST /v1/embeddings` response.

```ts signature
interface CreateEmbeddingResponse {
    object: 'list';
    data: Embedding[];
    model: string;
    usage: {
        prompt_tokens: number;
        total_tokens: number;
    };
    ur: EmbeddingUrBlock;
}
```

| Member | Description |
| --- | --- |
| `object: 'list'` | Always `list`. |
| `data: Embedding[]` | One vector per input. |
| `model: string` | The model that produced the vectors. |
| `usage: { prompt_tokens: number; total_tokens: number }` | Token usage. |
| `ur: EmbeddingUrBlock` | The ultrarouter response block (without compression, which never applies to embeddings). |

### DiffStats

interface · `src/diff-stats.ts`

The client-computed diff statistics sent on the no-consent final path.

```ts signature
interface DiffStats {
    edit_ratio: number;
    changed_spans: number;
    lengths: {
        draft: number;
        final: number;
    };
    final_hash: string;
}
```

| Member | Description |
| --- | --- |
| `edit_ratio: number` | Normalized character edit ratio ∈ [0,1]. `0` = byte-identical, `1` = no shared content. |
| `changed_spans: number` | The number of maximal contiguous changed character regions (`0` when identical). |
| `lengths: { draft: number; final: number }` | Raw character lengths of the draft and final. |
| `final_hash: string` | The SHA-256 hex digest of the FINAL content (the metadata-only path stores this verbatim). |

### DurableEntry

interface · `src/flywheel-queue.ts`

The minimum shape a durably-queued entry must have: a stable id and an attempt counter.
[`QueuedOutcome`](#queuedoutcome) satisfies it, and so does the reviewer queue's entry — which is
why the stores below are generic rather than duplicated (one durability
implementation, two queues).

```ts signature
interface DurableEntry {
    readonly id: string;
    attempts: number;
}
```

| Member | Description |
| --- | --- |
| `readonly id: string` | A stable queue-entry id. |
| `attempts: number` | Delivery attempts so far. |

### Embedding

interface · `src/types.ts`

One embedding vector.

```ts signature
interface Embedding {
    object: 'embedding';
    index: number;
    embedding: number[] | string;
}
```

| Member | Description |
| --- | --- |
| `object: 'embedding'` | Always `embedding`. |
| `index: number` | The input index this vector belongs to. |
| `embedding: number[] \| string` | The vector (`number[]`), or a base64 string with `encoding_format: 'base64'`. |

### EmbeddingCreateParams

interface · `src/types.ts`

`POST /v1/embeddings` request body.

```ts signature
interface EmbeddingCreateParams {
    model?: string;
    input: string | string[];
    dimensions?: number;
    encoding_format?: 'float' | 'base64';
    user?: string;
    call_type?: string;
    ur?: UrRequestOptions;
    bench?: BenchTag;
    metadata?: Record<string, unknown>;
}
```

| Member | Description |
| --- | --- |
| `model?: string` | Provider-prefixed embedding model id. Optional when the client has a `defaultModel`. |
| `input: string \| string[]` | One input string or a batch. |
| `dimensions?: number` | Output dimensions (models that support it). |
| `encoding_format?: 'float' \| 'base64'` | `float` (default) or `base64`. |
| `user?: string` | An end-user identifier. |
| `call_type?: string` | A stable call-type slug. |
| `ur?: UrRequestOptions` | Per-request ultrarouter controls. |
| `bench?: BenchTag` | A per-call Bench capture tag (folded into `ur.bench`). |
| `metadata?: Record<string, unknown>` | Free-form metadata. |

### EmbeddingsResource

interface · `src/client.ts`

`ur.embeddings`: OpenAI-compatible embeddings.

```ts signature
interface EmbeddingsResource {
    create: (params: EmbeddingCreateParams, options?: RequestOptions) => Promise<CreateEmbeddingResponse & RequestCorrelation>;
}
```

| Member | Description |
| --- | --- |
| `create: ( params: EmbeddingCreateParams, options?: RequestOptions, ) => Promise<CreateEmbeddingResponse & RequestCorrelation>` | Create embeddings (`POST /v1/embeddings`), with the gateway request id as `requestId`. |

### EmbeddingUrBlock

interface · `src/types.ts`

The `ur` block on an embeddings response: the chat block without `compression` (embeddings are
never compressed), with an OPEN routing mode — the embeddings contract types it as a string.

```ts signature
interface EmbeddingUrBlock extends Omit<UrResponseBlock, 'compression' | 'routing'> {
    routing: Omit<UrRoutingBlock, 'mode'> & {
        mode: RouterMode | (string & {});
    };
}
```

| Member | Description |
| --- | --- |
| `routing: Omit<UrRoutingBlock, 'mode'> & { mode: RouterMode \| (string & {}) }` | How the request was routed; `mode` is a [`RouterMode`](#routermode) value in practice, typed open. |

### ExperimentOutcomeOptions

interface · `src/client.ts`

Per-call options for [`ExperimentsResource.outcome`](#experimentsresource): the request options, plus `dryRun` to
run the same validation against the current rows and holds and return the dry-run answer
(`?dry_run=true`) with nothing written.

```ts signature
interface ExperimentOutcomeOptions extends RequestOptions {
    dryRun?: boolean;
}
```

| Member | Description |
| --- | --- |
| `dryRun?: boolean` | Validate-only: send `?dry_run=true`, return the dry-run shape, write nothing. |

### ExperimentsResource

interface · `src/client.ts`

`ur.ur.flywheel.experiments`: the bounded-experiment RUN surface, for a runner holding a key with
the `flywheel:experiment:run` scope. Enrol each execution before its first call, send the returned
`execution_id` as the `x-ur-experiment-execution` header on every call of the run, then record the
one terminal outcome (dry-run it first) and ask for the screen or test evaluation. The owner-session
operations (holds, reconcile, judgements, acknowledge, test fund / manifest / judgements) are not on
an api key and are not mapped here.

```ts signature
interface ExperimentsResource {
    enrol: (experimentId: string, params: EnrolExperimentExecutionParams, options?: RequestOptions) => Promise<ExperimentExecution>;
    outcome: {
        (experimentId: string, executionId: string, params: RecordExperimentOutcomeParams, options: ExperimentOutcomeOptions & {
            dryRun: true;
        }): Promise<ExperimentExecutionOutcomeDryRun>;
        (experimentId: string, executionId: string, params: RecordExperimentOutcomeParams, options?: ExperimentOutcomeOptions): Promise<ExperimentExecutionOutcome>;
    };
    evaluateScreen: (experimentId: string, options?: RequestOptions) => Promise<ExperimentScreenEvaluation>;
    evaluateTest: (experimentId: string, options?: RequestOptions) => Promise<ExperimentTestEvaluation>;
}
```

| Member | Description |
| --- | --- |
| `enrol: ( experimentId: string, params: EnrolExperimentExecutionParams, options?: RequestOptions, ) => Promise<ExperimentExecution>` | Enrol one execution slot of a candidate-frozen experiment (`POST …/executions`). The gateway — never the caller — decides the arm from the sealed assignment. Idempotent on the server: a repeat of the same `{ phase, pair_key, slot }` returns the same execution (`created: false`), so a resume safely re-enrols the identical tuple; the SDK never invents a new slot to work around a failure. |
| `outcome: { ( experimentId: string, executionId: string, params: RecordExperimentOutcomeParams, options: ExperimentOutcomeOptions & { dryRun: true }, ): Promise<ExperimentExecutionOutcomeDryRun>; ( experimentId: string, executionId: string, params: RecordExperimentOutcomeParams, options?: ExperimentOutcomeOptions, ): Promise<ExperimentExecutionOutcome>; }` | Record the one terminal outcome of an enrolled execution (`POST …/executions/{id}/outcome`), body-free (ids, hashes and numbers only). Idempotent on the execution. With `{ dryRun: true }` the same validation runs against the current rows and holds and returns the dry-run answer with nothing written; the two response shapes are discriminated by `object`. |
| `evaluateScreen: ( experimentId: string, options?: RequestOptions, ) => Promise<ExperimentScreenEvaluation>` | Evaluate the screen explicitly (`POST …/screen/evaluate`): counts before the verdict, the verdict after. Idempotent. |
| `evaluateTest: ( experimentId: string, options?: RequestOptions, ) => Promise<ExperimentTestEvaluation>` | Evaluate the prospective test explicitly (`POST …/test/evaluate`): counts before the decision, the decision after. Idempotent. |

### Feedback

interface · `src/types.ts`

A stored feedback row.

```ts signature
interface Feedback {
    object: 'request_feedback';
    id: string;
    request_id: string;
    rating: 1 | -1;
    tags: string[];
    comment: string | null;
    created_at: string;
}
```

| Member | Description |
| --- | --- |
| `object: 'request_feedback'` | Always `request_feedback`. |
| `id: string` | The feedback id. |
| `request_id: string` | The rated request. |
| `rating: 1 \| -1` | The rating. |
| `tags: string[]` | Tags. |
| `comment: string \| null` | Comment, or `null`. |
| `created_at: string` | Creation time (ISO 8601). |

### FeedbackEnvelope

interface · `src/types.ts`

The raw wire shape of the feedback route: the row wrapped in `{ feedback }`.
`ur.requests.feedback` unwraps it; this type is for raw-REST callers.

```ts signature
interface FeedbackEnvelope {
    feedback: Feedback;
}
```

| Member | Description |
| --- | --- |
| `feedback: Feedback` | The stored feedback row. |

### FeedbackParams

interface · `src/types.ts`

`POST /v1/requests/{id}/feedback` request body.

```ts signature
interface FeedbackParams {
    rating: 1 | -1;
    tags?: string[];
    comment?: string;
}
```

| Member | Description |
| --- | --- |
| `rating: 1 \| -1` | `1` (good) or `-1` (bad). |
| `tags?: string[]` | Optional tags. |
| `comment?: string` | An optional comment. |

### FlywheelResource

interface · `src/client.ts`

`ur.ur.flywheel`: learning status and verdict-source health.

```ts signature
interface FlywheelResource {
    status: (options?: RequestOptions) => Promise<FlywheelStatus>;
    calibration: (options?: RequestOptions) => Promise<FlywheelCalibration>;
    sources: (options?: RequestOptions) => Promise<VerdictSources>;
    sourceChecks: SourceChecksResource;
    experiments: ExperimentsResource;
}
```

| Member | Description |
| --- | --- |
| `status: (options?: RequestOptions) => Promise<FlywheelStatus>` | Read usage, integration health and the learning block (`GET /v1/flywheel/status`). |
| `calibration: (options?: RequestOptions) => Promise<FlywheelCalibration>` | The `learning` block of [`FlywheelResource.status`](#flywheelresource): calibration availability as the gateway declares it. |
| `sources: (options?: RequestOptions) => Promise<VerdictSources>` | List the workspace's verdict sources and whether each one counts toward readiness. |
| `sourceChecks: SourceChecksResource` | Planted-failure checks for verdict sources. |
| `experiments: ExperimentsResource` | The bounded-experiment run surface (enrol, outcome, screen/test evaluation). |

### GatewayErrorEnvelope

interface · `src/errors.ts`

The body of a well-formed gateway error envelope, `{ error: { code, message, request_id,
retryable, provider_code? } }` (the `GatewayError` schema): every required field present with its
declared type. [`UltraRouterError.envelope`](#ultraroutererror) carries it when, and only when, the response body
was exactly that.

```ts signature
interface GatewayErrorEnvelope {
    readonly code: string;
    readonly message: string;
    readonly request_id: string;
    readonly retryable: boolean;
    readonly provider_code?: string;
}
```

| Member | Description |
| --- | --- |
| `readonly code: string` | The stable error code the gateway sent. |
| `readonly message: string` | The human-readable, secret-free explanation. |
| `readonly request_id: string` | The gateway correlation id (`req_…`). |
| `readonly retryable: boolean` | Whether the gateway says the same request may be retried as-is (the raw flag, before any clamp). |
| `readonly provider_code?: string` | The raw upstream provider error code, when a provider produced the failure. |

### GenerationOutcome

interface · `src/types.ts`

One outcome event bound to a request, as rendered by `GET /v1/generation`.

```ts signature
interface GenerationOutcome {
    artifact_id: string;
    channel: string;
    kind: string;
    latency_class: string;
    learning_use: string[];
    observed_at: string;
    source: string;
    value: Record<string, unknown>;
}
```

| Member | Description |
| --- | --- |
| `artifact_id: string` | The artifact the outcome landed on. |
| `channel: string` | The outcome channel (for example `mechanical`). |
| `kind: string` | The outcome kind (for example `schema_valid`, `tool_error`). |
| `latency_class: string` | `instant` or `delayed` (assigned by the gateway). |
| `learning_use: string[]` | How the outcome may be used (assigned by the gateway). |
| `observed_at: string` | When the outcome took effect (ISO 8601). |
| `source: string` | Who recorded it (assigned by the gateway; `gateway` for native events). |
| `value: Record<string, unknown>` | The typed value: reasons, indices or counts only (never a body). |

### GenerationStats

interface · `src/types.ts`

`GET /v1/generation?id=…`: the stats of one served request.

```ts signature
interface GenerationStats {
    id: string;
    call_type: string | null;
    model_requested: string;
    model_served: string | null;
    provider: string | null;
    status: 'ok' | 'error' | 'cancelled';
    error_class: string | null;
    contract_digest: string | null;
    tokens: {
        input: number;
        output: number;
        cached: number;
        total: number;
    };
    cost: {
        total_micro_usd: number;
        total_usd: number;
        cost_basis: 'priced' | 'derived' | 'unpriced' | 'verified_memory' | null;
    };
    timing: {
        ttfb_ms: number | null;
        latency_ms: number | null;
    };
    routing_decision: Record<string, unknown>;
    compression: Record<string, unknown>;
    outcomes: GenerationOutcome[];
    exposure: {
        arm: string | null;
        epoch: number | null;
    };
    lever: {
        lever_id: string | null;
        module_version: string | null;
        epoch: number | null;
        pack_hash: string | null;
        injection: Record<string, unknown> | null;
    };
    byok: boolean;
    created_at: string;
}
```

| Member | Description |
| --- | --- |
| `id: string` | The request id. |
| `call_type: string \| null` | The call type, or `null`. |
| `model_requested: string` | The model the caller asked for. |
| `model_served: string \| null` | The model that served, or `null` when nothing was served. |
| `provider: string \| null` | The provider that served, or `null`. |
| `status: 'ok' \| 'error' \| 'cancelled'` | The request status. |
| `error_class: string \| null` | The error class of a failed request, or `null`. |
| `contract_digest: string \| null` | A digest of the declared contract (schema, tools, tool choice, response format), or `null`. |
| `tokens: { input: number; output: number; cached: number; total: number }` | Token counts. |
| `cost: { total_micro_usd: number; total_usd: number; cost_basis: 'priced' \| 'derived' \| 'unpriced' \| 'verified_memory' \| null; }` | Cost in integer micro-USD and USD, with the basis the gateway priced it on: `priced` (the model's catalog price), `derived` (a dated snapshot priced from its curated base), `unpriced` (no catalog price — metered at 0 and only ever served when the gateway is explicitly configured to allow unpriced models), `verified_memory` (served from a verified memory, no provider call), or `null` when nothing was served. |
| `timing: { ttfb_ms: number \| null; latency_ms: number \| null }` | Time to first byte and total latency (ms). |
| `routing_decision: Record<string, unknown>` | The routing decision trail. |
| `compression: Record<string, unknown>` | The compression record. |
| `outcomes: GenerationOutcome[]` | Outcome events bound to this request. |
| `exposure: { arm: string \| null; epoch: number \| null }` | The experiment arm and epoch stamped before dispatch (evidence only). |
| `lever: { lever_id: string \| null; module_version: string \| null; epoch: number \| null; pack_hash: string \| null; injection: Record<string, unknown> \| null; }` | The learned-context stamp: what was served (ids and numbers only) or why nothing was. |
| `byok: boolean` | Whether your own provider key served the request. |
| `created_at: string` | Creation time (ISO 8601). |

### HostedPromptsResource

interface · `src/client.ts`

`ur.ur.callTypes.prompts`: hosted prompt versions of a call type.

```ts signature
interface HostedPromptsResource {
    list: (callTypeId: string, options?: RequestOptions) => Promise<HostedPromptList>;
    create: (callTypeId: string, params: CreateHostedPromptParams, options?: RequestOptions) => Promise<HostedPromptVersion>;
    get: (callTypeId: string, version: number | string, options?: RequestOptions) => Promise<HostedPromptVersion>;
    activate: (callTypeId: string, version: number | string, params?: ActivateHostedPromptParams, options?: RequestOptions) => Promise<HostedPromptPointer>;
    deactivate: (callTypeId: string, options?: RequestOptions) => Promise<HostedPromptPointer>;
    proposal: (callTypeId: string, options?: RequestOptions) => Promise<HostedPromptProposal>;
}
```

| Member | Description |
| --- | --- |
| `list: (callTypeId: string, options?: RequestOptions) => Promise<HostedPromptList>` | List every hosted prompt version of a call type and the active pointer. |
| `create: ( callTypeId: string, params: CreateHostedPromptParams, options?: RequestOptions, ) => Promise<HostedPromptVersion>` | Create a new immutable hosted prompt version. |
| `get: ( callTypeId: string, version: number \| string, options?: RequestOptions, ) => Promise<HostedPromptVersion>` | Read one hosted prompt version. |
| `activate: ( callTypeId: string, version: number \| string, params?: ActivateHostedPromptParams, options?: RequestOptions, ) => Promise<HostedPromptPointer>` | Make a version the active prompt for the call type. |
| `deactivate: (callTypeId: string, options?: RequestOptions) => Promise<HostedPromptPointer>` | Clear the active pointer (the call type returns to its code-owned prompt). |
| `proposal: (callTypeId: string, options?: RequestOptions) => Promise<HostedPromptProposal>` | Read the host-your-prompt onboarding proposal for a call type. |

### HostedPromptVariable

interface · `src/prompt-render.ts`

One DECLARED template variable — a `{{name}}` slot and whether the caller MUST supply it.

```ts signature
interface HostedPromptVariable {
    readonly name: string;
    readonly required: boolean;
}
```

| Member | Description |
| --- | --- |
| `readonly name: string` | The variable name (the `name` in `{{name}}`). |
| `readonly required: boolean` | Whether the caller must supply it. |

### ImportListQuery

interface · `src/imports.ts`

`GET /v1/imports` keyset query filters (never OFFSET).

```ts signature
interface ImportListQuery {
    limit?: number;
    cursor?: string;
}
```

| Member | Description |
| --- | --- |
| `limit?: number` | Page size (1–200, default 50). |
| `cursor?: string` | Opaque keyset cursor from the prior page. |

### ImportsResource

interface · `src/client.ts`

`ur.ur.imports`: history imports.

```ts signature
interface ImportsResource {
    create: (params: ImportParams, options?: RequestOptions) => Promise<Import>;
    get: (id: string, options?: RequestOptions) => Promise<Import>;
    list: (query?: ImportListQuery, options?: RequestOptions) => Promise<ImportListResponse>;
    cancel: (id: string, options?: RequestOptions) => Promise<Import>;
}
```

| Member | Description |
| --- | --- |
| `create: (params: ImportParams, options?: RequestOptions) => Promise<Import>` | Create (or resume) an import. `mode: 'preview'` returns the capability report and stores nothing. |
| `get: (id: string, options?: RequestOptions) => Promise<Import>` | Get one import with its capability report. |
| `list: (query?: ImportListQuery, options?: RequestOptions) => Promise<ImportListResponse>` | List imports (keyset pagination). |
| `cancel: (id: string, options?: RequestOptions) => Promise<Import>` | Cancel a non-terminal import. |

### LearnedMessage

interface · `src/learned-placement.ts`

The learned block the placement inserts: a DATA `user` message carrying the rendered module body.

```ts signature
interface LearnedMessage {
    readonly role: typeof LEARNED_MESSAGE_ROLE;
    readonly content: string;
}
```

| Member | Description |
| --- | --- |
| `readonly role: typeof LEARNED_MESSAGE_ROLE` | Always `user`: learned context is data, never an instruction. |
| `readonly content: string` | The rendered learned-module body. |

### LearnedRecordOptions

interface · `src/client.ts`

Options for [`LearnedSession.record`](#learnedsession).

```ts signature
interface LearnedRecordOptions {
    archetype?: ArtifactArchetype;
    request?: RequestOptions;
}
```

| Member | Description |
| --- | --- |
| `archetype?: ArtifactArchetype` | The artifact archetype for the grant-quoting upsert (default `answer`). |
| `request?: RequestOptions` | Request options forwarded to the artifact upsert and the outcome record. |

### LearnedSession

interface · `src/client.ts`

The session `useLearned(params)` resolves: the preflight answer plus the two actions a caller that
calls its model directly needs — place the learned module, and record an outcome quoting the grant.

```ts signature
interface LearnedSession {
    readonly preflight: PreflightResponse;
    readonly grant: PreflightGrant | null;
    readonly knowledge: PreflightKnowledge | null;
    readonly model: string | null;
    apply: <M extends {
        readonly role?: unknown;
    }>(messages: readonly M[]) => (M | LearnedMessage)[];
    record: (outcome: OutcomeInput, options?: LearnedRecordOptions) => Promise<OutcomeReceipt>;
}
```

| Member | Description |
| --- | --- |
| `readonly preflight: PreflightResponse` | The full preflight response (routing, knowledge, grant, prompt). |
| `readonly grant: PreflightGrant \| null` | The exposure grant (present when a cluster key was given; `null` otherwise). |
| `readonly knowledge: PreflightKnowledge \| null` | The learned knowledge to inject (`null` on a holdout arm or when nothing applies). |
| `readonly model: string \| null` | The recommended model id, or `null` when none resolves. |
| `apply: <M extends { readonly role?: unknown }>(messages: readonly M[]) => (M \| LearnedMessage)[]` | Insert the learned module into `messages` right after the leading system messages (the same position the gateway uses). Always injects when `knowledge` is present; passes the messages through unchanged when it is `null`. Pure: never mutates the input. |
| `record: (outcome: OutcomeInput, options?: LearnedRecordOptions) => Promise<OutcomeReceipt>` | Record an outcome on the artifact named by the preflight `artifact_key`, quoting the grant (`grant_id` + `attestation: 'applied'`), through the durable outcome queue. |

### LearningResource

interface · `src/client.ts`

`ur.ur.learning`: learning controls for one call type (`/v1/call-types/{id}/learning*`; a `ct_…`
id or a slug). Every control resolves a [`LearningControlResult`](#learningcontrolresult): what happened (`changed`,
`version_id`, `stopped_evaluation_id`) plus the resulting status (`learning`). A refusal you can
act on (missing consent, no workspace-owned reflection provider, learning not enabled, an invalid
promotion policy, a version conflict, not found, forbidden) rejects with a `LearningError`
naming the `reason`, the gateway's `refusal`, its `detail` and the `action`.

```ts signature
interface LearningResource {
    toolDocumentation: (callTypeId: string, options?: RequestOptions) => Promise<LearningToolDocumentation>;
    putToolDocumentation: (callTypeId: string, params: PutLearningToolDocumentationParams, options?: RequestOptions) => Promise<LearningToolDocumentation>;
    status: (callTypeId: string, options?: RequestOptions) => Promise<LearningStatus>;
    enable: (callTypeId: string, params: EnableLearningParams, options?: RequestOptions) => Promise<LearningControlResult>;
    pause: (callTypeId: string, options?: RequestOptions) => Promise<LearningControlResult>;
    resume: (callTypeId: string, options?: RequestOptions) => Promise<LearningControlResult>;
    disable: (callTypeId: string, options?: RequestOptions) => Promise<LearningControlResult>;
    versions: (callTypeId: string, options?: RequestOptions) => Promise<LearningVersionList>;
    version: (callTypeId: string, versionId: string, options?: RequestOptions) => Promise<LearningVersionDetail>;
    rollback: (callTypeId: string, params?: LearningRollbackParams, options?: RequestOptions) => Promise<LearningControlResult>;
    promote: (callTypeId: string, versionId: string, options?: RequestOptions) => Promise<LearningControlResult>;
    reject: (callTypeId: string, versionId: string, options?: RequestOptions) => Promise<LearningControlResult>;
    evaluations: (callTypeId: string, options?: RequestOptions) => Promise<LearningEvaluationList>;
}
```

| Member | Description |
| --- | --- |
| `toolDocumentation: ( callTypeId: string, options?: RequestOptions, ) => Promise<LearningToolDocumentation>` | Read the customer-supplied tool summaries for a call type. |
| `putToolDocumentation: ( callTypeId: string, params: PutLearningToolDocumentationParams, options?: RequestOptions, ) => Promise<LearningToolDocumentation>` | Replace the tool schemas (at most 256, 1 MiB); tools: [] clears them. |
| `status: (callTypeId: string, options?: RequestOptions) => Promise<LearningStatus>` | Read the status: state, recipe, reflection provider, promotion policy, active version, latest candidate, running and last evaluation, evidence, budget, usage and outcome receipts. |
| `enable: ( callTypeId: string, params: EnableLearningParams, options?: RequestOptions, ) => Promise<LearningControlResult>` | Enable learning (self-serve: an owner/admin or a `config:write` key, with the workspace's corrections consent on and a workspace-owned offer for `reflection_model`). |
| `pause: (callTypeId: string, options?: RequestOptions) => Promise<LearningControlResult>` | Pause: stop reflecting and evaluating, keep serving the active version. |
| `resume: (callTypeId: string, options?: RequestOptions) => Promise<LearningControlResult>` | Resume a paused call type (and reset the bounded retries after quota / budget refusals). |
| `disable: (callTypeId: string, options?: RequestOptions) => Promise<LearningControlResult>` | Disable: stop serving learned versions (the kill switch). |
| `versions: (callTypeId: string, options?: RequestOptions) => Promise<LearningVersionList>` | List the version history with each version's state, newest first. |
| `version: ( callTypeId: string, versionId: string, options?: RequestOptions, ) => Promise<LearningVersionDetail>` | Read one version: its lessons, transitions and the body-free reflection receipt. |
| `rollback: ( callTypeId: string, params?: LearningRollbackParams, options?: RequestOptions, ) => Promise<LearningControlResult>` | Point the active version at an exact earlier version (`version_id`), or, without one, at the version that was active immediately before the current one. |
| `promote: ( callTypeId: string, versionId: string, options?: RequestOptions, ) => Promise<LearningControlResult>` | Promote a version by hand (owner/admin); a running evaluation of it stops. |
| `reject: ( callTypeId: string, versionId: string, options?: RequestOptions, ) => Promise<LearningControlResult>` | Reject a candidate by hand (owner/admin); the incumbent keeps serving. |
| `evaluations: (callTypeId: string, options?: RequestOptions) => Promise<LearningEvaluationList>` | List evaluations with their frozen rule, arms, difference and decision, newest first. |

### Model

interface · `src/types.ts`

One model in the catalog.

```ts signature
interface Model {
    id: string;
    object: 'model';
    name: string;
    provider: string;
    context_length: number | null;
    capabilities: Record<string, unknown>;
    pricing: ModelPricing;
    active: boolean;
    origin_jurisdiction: string;
    hosting_jurisdiction: string;
    hosting_region: string | null;
    weights: 'open' | 'closed' | 'unknown';
    workspace_custom?: boolean;
}
```

| Member | Description |
| --- | --- |
| `id: string` | Provider-prefixed model id. |
| `object: 'model'` | Always `model`. |
| `name: string` | Display name. |
| `provider: string` | The provider slug. |
| `context_length: number \| null` | Context window in tokens, when known. |
| `capabilities: Record<string, unknown>` | Capability flags (tools, json_schema, vision, …). |
| `pricing: ModelPricing` | Pricing. |
| `active: boolean` | Whether the model is currently served. |
| `origin_jurisdiction: string` | The developing lab's jurisdiction (ISO 3166-1 alpha-2), or `unknown`. |
| `hosting_jurisdiction: string` | Where this offer runs (ISO 3166-1 alpha-2), or `unknown`. |
| `hosting_region: string \| null` | The provider-published serving region (for example `us-east-1`), or `null`. |
| `weights: 'open' \| 'closed' \| 'unknown'` | Whether the model weights are downloadable. |
| `workspace_custom?: boolean` | `true` on a model served by one of your workspace's custom providers. |

### ModelListQuery

interface · `src/client.ts`

`GET /v1/models` filters.

```ts signature
interface ModelListQuery {
    provider?: string;
    capability?: string;
}
```

| Member | Description |
| --- | --- |
| `provider?: string` | Only models served by this provider slug. |
| `capability?: string` | Only models with this capability (for example `tools` or `json_schema`). |

### ModelPricing

interface · `src/types.ts`

Model pricing, in integer micro-USD and in USD, per one million tokens.

```ts signature
interface ModelPricing {
    input_micro_usd_per_1m: number;
    output_micro_usd_per_1m: number;
    cached_input_micro_usd_per_1m: number | null;
    input_usd_per_1m: number;
    output_usd_per_1m: number;
}
```

| Member | Description |
| --- | --- |
| `input_micro_usd_per_1m: number` | Input price per 1M tokens (micro-USD). |
| `output_micro_usd_per_1m: number` | Output price per 1M tokens (micro-USD). |
| `cached_input_micro_usd_per_1m: number \| null` | Cached-input price per 1M tokens (micro-USD), when the provider discounts cached input. |
| `input_usd_per_1m: number` | Input price per 1M tokens (USD). |
| `output_usd_per_1m: number` | Output price per 1M tokens (USD). |

### ModelsListResponse

interface · `src/types.ts`

`GET /v1/models` response.

```ts signature
interface ModelsListResponse {
    object: 'list';
    data: Model[];
}
```

| Member | Description |
| --- | --- |
| `object: 'list'` | Always `list`. |
| `data: Model[]` | The models visible to your key. |

### ModelsResource

interface · `src/client.ts`

`ur.models`: the model catalog visible to your key.

```ts signature
interface ModelsResource {
    list: (query?: ModelListQuery, options?: RequestOptions) => Promise<ModelsListResponse>;
    retrieve: (id: string, options?: RequestOptions) => Promise<ModelDetail>;
}
```

| Member | Description |
| --- | --- |
| `list: (query?: ModelListQuery, options?: RequestOptions) => Promise<ModelsListResponse>` | List models (`GET /v1/models`), optionally filtered by provider or capability. |
| `retrieve: (id: string, options?: RequestOptions) => Promise<ModelDetail>` | Retrieve one model with every provider offer that serves it (`GET /v1/models/{id}`). The id is provider-prefixed, e.g. `openai/gpt-5.2-mini`. |

### OpenAICompatConfig

interface · `src/openai-adapter.ts`

The preset an OpenAI-compatible client needs: `{ baseURL, apiKey }`.

```ts signature
interface OpenAICompatConfig {
    baseURL: string;
    apiKey: string;
    defaultHeaders?: Record<string, string>;
}
```

| Member | Description |
| --- | --- |
| `baseURL: string` | Already includes the `/v1` suffix the OpenAI client expects. |
| `apiKey: string` | The API key. |
| `defaultHeaders?: Record<string, string>` | Headers to send on every request (for example Bench capture headers). |

### OracleSigningOptions

interface · `src/resources.ts`

Signing options for the oracle pull transport: the oracle's HMAC secret.

```ts signature
interface OracleSigningOptions {
    secret: string;
    timestamp?: number;
}
```

| Member | Description |
| --- | --- |
| `secret: string` | The oracle signing secret returned when the oracle was registered or its secret rotated. |
| `timestamp?: number` | Override the signing time (unix seconds). Defaults to now; a testing seam. |

### OraclesResource

interface · `src/client.ts`

`ur.ur.oracles`: checks that can tell a right answer from a wrong one.

```ts signature
interface OraclesResource {
    register: (params: RegisterOracleParams, options?: RequestOptions) => Promise<OracleRegistration>;
    get: (oracleId: string, options?: RequestOptions) => Promise<Oracle>;
    qualify: (oracleId: string, params: QualifyOracleParams, options?: RequestOptions) => Promise<OracleQualification>;
    test: (oracleId: string, params?: TestOracleParams, options?: RequestOptions) => Promise<OracleTestResult>;
    revoke: (oracleId: string, options?: RequestOptions) => Promise<OracleRevocation>;
    claimJobs: (oracleId: string, params: ClaimOracleJobsParams, signing: OracleSigningOptions, options?: RequestOptions) => Promise<OracleJobClaim>;
    submitVerdicts: (oracleId: string, params: SubmitOracleVerdictsParams, signing: OracleSigningOptions, options?: RequestOptions) => Promise<OracleVerdictsResult>;
}
```

| Member | Description |
| --- | --- |
| `register: (params: RegisterOracleParams, options?: RequestOptions) => Promise<OracleRegistration>` | Register a check, or append a new version of an existing one (`oracle_id`). |
| `get: (oracleId: string, options?: RequestOptions) => Promise<Oracle>` | Read an oracle, its versions, the role its current version earned and its transport state. |
| `qualify: ( oracleId: string, params: QualifyOracleParams, options?: RequestOptions, ) => Promise<OracleQualification>` | Qualify the current version against planted failures built from your known-good examples. |
| `test: ( oracleId: string, params?: TestOracleParams, options?: RequestOptions, ) => Promise<OracleTestResult>` | Send a test probe end to end. Nothing is graded. |
| `revoke: (oracleId: string, options?: RequestOptions) => Promise<OracleRevocation>` | Revoke an oracle (terminal). |
| `claimJobs: ( oracleId: string, params: ClaimOracleJobsParams, signing: OracleSigningOptions, options?: RequestOptions, ) => Promise<OracleJobClaim>` | Pull transport: lease due jobs. The request is signed with the oracle secret (`sha256=` HMAC of `"<timestamp>.<raw body>"`). Each job payload is returned exactly once. |
| `submitVerdicts: ( oracleId: string, params: SubmitOracleVerdictsParams, signing: OracleSigningOptions, options?: RequestOptions, ) => Promise<OracleVerdictsResult>` | Pull transport: post signed verdicts for claimed jobs (idempotent per job). |

### OutcomeFlushReport

interface · `src/flywheel-queue.ts`

The summary `ur.outcomes.flush` resolves to.

```ts signature
interface OutcomeFlushReport {
    delivered: number;
    rejected: number;
    pending: number;
    results: OutcomeResult[];
}
```

| Member | Description |
| --- | --- |
| `delivered: number` | Events delivered (a server result was returned) this flush. |
| `rejected: number` | Events dropped this flush because the server definitively refused them ([`isDefinitiveRejection`](#isdefinitiverejection)). |
| `pending: number` | Events still queued after this flush (an unknown outcome or a refused credential — flush again later). |
| `results: OutcomeResult[]` | The delivered server results, in flush order. |

### OutcomeNotReported

interface · `src/outcome-report.ts`

The result of reporting `unknown`: nothing was sent.

```ts signature
interface OutcomeNotReported<S extends OutcomeSource = OutcomeSource> {
    readonly status: 'not_reported';
    readonly requestId: string;
    readonly verdict: 'unknown';
    readonly source: S;
    readonly teaches: false;
    readonly reason: 'verdict_unknown';
}
```

| Member | Description |
| --- | --- |
| `readonly status: 'not_reported'` | Always `not_reported`. |
| `readonly requestId: string` | The request the verdict was about. |
| `readonly verdict: 'unknown'` | Always `unknown`. |
| `readonly source: S` | The source passed in. |
| `readonly teaches: false` | Always `false`: an unknown verdict carries no signal. |
| `readonly reason: 'verdict_unknown'` | Always `verdict_unknown`. |

### OutcomeQueueDeps

interface · `src/flywheel-queue.ts`

Construction dependencies for [`OutcomeQueue`](#outcomequeue) (all injectable for tests).

```ts signature
interface OutcomeQueueDeps {
    store: OutcomeStore;
    send: OutcomeSender;
    now?: () => number;
    genId?: () => string;
}
```

| Member | Description |
| --- | --- |
| `store: OutcomeStore` | Where entries are persisted before sending. |
| `send: OutcomeSender` | Sends one finalized event. |
| `now?: () => number` | Clock for `observed_at` + `enqueued_at` (injectable; defaults to `Date.now`). |
| `genId?: () => string` | Queue-entry / `source_event_id` generator (injectable; defaults to a ULID). |

### OutcomeReported

interface · `src/outcome-report.ts`

The result of reporting `pass` or `fail`. `status` is the delivery state of the durable queue:
`delivered` (the gateway answered; see `result` and `receipt`), `queued` (the outcome of the send
is unknown or the gateway was unavailable; the identical event stays queued for
`ur.ur.outcomes.flush()`), or `rejected` (the gateway definitively refused the event; see `error`).

```ts signature
interface OutcomeReported<S extends OutcomeSource = OutcomeSource> {
    readonly status: 'delivered' | 'queued' | 'rejected';
    readonly requestId: string;
    readonly verdict: 'pass' | 'fail';
    readonly source: S;
    readonly channel: OutcomeChannel;
    readonly kind: string;
    readonly teaches: OutcomeTeaches<S>;
    readonly sourceEventId: string;
    readonly entryId: string;
    readonly result: RequestOutcomeResult | null;
    readonly receipt: OutcomeReceiptRecord | null;
    readonly error: UltraRouterError | null;
}
```

| Member | Description |
| --- | --- |
| `readonly status: 'delivered' \| 'queued' \| 'rejected'` | The delivery state. |
| `readonly requestId: string` | The request the verdict is about. |
| `readonly verdict: 'pass' \| 'fail'` | The verdict sent. |
| `readonly source: S` | The source passed in. |
| `readonly channel: OutcomeChannel` | The outcome channel the verdict mapped to. |
| `readonly kind: string` | The channel kind the verdict mapped to. |
| `readonly teaches: OutcomeTeaches<S>` | Whether this source can teach: `false` for `self_rating` (a proxy ranks but never teaches), `true` otherwise. The gateway's own assignment is in `result.learning_use`. |
| `readonly sourceEventId: string` | The `source_event_id` sent (derived unless you supplied the parts). Use it as `supersedes`. |
| `readonly entryId: string` | The durable queue entry id (stable for the same identity). |
| `readonly result: RequestOutcomeResult \| null` | The gateway's answer when delivered, else `null`. Its `status` may be `pending`. |
| `readonly receipt: OutcomeReceiptRecord \| null` | The durable receipt when the gateway returned one, else `null`. |
| `readonly error: UltraRouterError \| null` | Why the event is still queued or was refused, else `null`. |

### OutcomeReportParams

interface · `src/outcome-report.ts`

The arguments of `ur.ur.outcomes.report`.

```ts signature
interface OutcomeReportParams<S extends OutcomeSource = OutcomeSource, V extends OutcomeVerdict = OutcomeVerdict> {
    verdict: V;
    source: S;
    idempotencyKey?: string | undefined;
    observedAt?: string | Date | undefined;
    evidenceHash?: string | undefined;
    supersedes?: string | undefined;
}
```

| Member | Description |
| --- | --- |
| `verdict: V` | The task verdict. `unknown` sends nothing (missing feedback stays unknown). |
| `source: S` | Where the verdict came from. `self_rating` is a proxy that never teaches. |
| `idempotencyKey?: string \| undefined` | Your own key for this verdict (for example the verifier name or a webhook event id). It is part of the derived identity: the same `(requestId, verdict, source, idempotencyKey)` is always the same event, so retrying never double-reports. Two independent verdicts of the same source on the same request need two keys. |
| `observedAt?: string \| Date \| undefined` | When the verdict was observed (ISO-8601 or a `Date`; default: the first time it is reported). Pass it explicitly when a report may be retried from another process, so the replay is byte-identical. |
| `evidenceHash?: string \| undefined` | A content hash of the evidence behind the verdict (never the evidence itself). |
| `supersedes?: string \| undefined` | The `source_event_id` of an earlier report this one revises. |

### OutcomeSourceMapping

interface · `src/outcome-report.ts`

How one [`OutcomeSource`](#outcomesource) maps onto outcome channels.

```ts signature
interface OutcomeSourceMapping {
    readonly label: string;
    readonly teaches: boolean;
    readonly pass: OutcomeVerdictMapping;
    readonly fail: OutcomeVerdictMapping;
}
```

| Member | Description |
| --- | --- |
| `readonly label: string` | A short human label. |
| `readonly teaches: boolean` | Whether this source can teach (`false` only for the self-rating proxy). |
| `readonly pass: OutcomeVerdictMapping` | The event a `pass` verdict sends. |
| `readonly fail: OutcomeVerdictMapping` | The event a `fail` verdict sends. |

### OutcomesResource

interface · `src/client.ts`

`ur.ur.outcomes`: outcome events, delivered through a durable local queue.

```ts signature
interface OutcomesResource {
    record: (target: string | OutcomeTarget, outcome: OutcomeInput, options?: RequestOptions) => Promise<OutcomeReceipt>;
    batch: (outcomes: BatchOutcomeInput[], options?: RequestOptions) => Promise<BatchOutcomesResponse>;
    pending: (query?: PendingOutcomesQuery, options?: RequestOptions) => Promise<PendingClaimsResponse>;
    flush: (options?: RequestOptions) => Promise<OutcomeFlushReport>;
    report: <S extends OutcomeSource, V extends OutcomeVerdict>(requestId: string, params: OutcomeReportParams<S, V>, options?: RequestOptions) => Promise<OutcomeReportResult<S, V>>;
    receipt: (id: string, options?: RequestOptions) => Promise<OutcomeReceiptRecord>;
    receiptsForRequest: (requestId: string, options?: RequestOptions) => Promise<OutcomeReceiptList>;
    waitForReceipt: (id: string, options?: WaitForReceiptOptions) => Promise<OutcomeReceiptRecord>;
}
```

| Member | Description |
| --- | --- |
| `record: ( target: string \| OutcomeTarget, outcome: OutcomeInput, options?: RequestOptions, ) => Promise<OutcomeReceipt>` | Durably record one outcome on an artifact (a bare string is an artifact id) or a request. The event is persisted before the first send and replayed verbatim (same identity, same Idempotency-Key) on every retry. A delivery failure never throws: only a definitive refusal of the event drops it (`rejected`); a timeout, cancellation, connection failure, 408/429/5xx or 401/403 leaves it queued for [`OutcomesResource.flush`](#outcomesresource). Only an `OutcomeStoreError` (a store that cannot persist) is thrown. |
| `batch: ( outcomes: BatchOutcomeInput[], options?: RequestOptions, ) => Promise<BatchOutcomesResponse>` | Record up to 1,000 outcomes keyed by request, artifact id or artifact key in one call. |
| `pending: ( query?: PendingOutcomesQuery, options?: RequestOptions, ) => Promise<PendingClaimsResponse>` | List claims still awaiting resolution (keyset pagination). |
| `flush: (options?: RequestOptions) => Promise<OutcomeFlushReport>` | Drain the durable queue. Call it before your process exits. |
| `report: <S extends OutcomeSource, V extends OutcomeVerdict>( requestId: string, params: OutcomeReportParams<S, V>, options?: RequestOptions, ) => Promise<OutcomeReportResult<S, V>>` | Report a task verdict on a request: `pass` / `fail` / `unknown` plus its `source`, mapped onto the outcome channels by the SDK's verdict table. `unknown` sends nothing and resolves `not_reported`; `self_rating` is a proxy that never teaches (`teaches: false`). The event is sent through the durable queue under an identity derived from `(requestId, verdict, source, idempotencyKey)`, so a retry, a lost acknowledgement or a repeated call never double-reports. Report as soon as you have the verdict: the gateway accepts it before the request is fully written (`result.status === 'pending'`, with a receipt). Never throws for a delivery failure. |
| `receipt: (id: string, options?: RequestOptions) => Promise<OutcomeReceiptRecord>` | Read one outcome receipt (`GET /v1/outcome-receipts/{id}`). |
| `receiptsForRequest: (requestId: string, options?: RequestOptions) => Promise<OutcomeReceiptList>` | Read every outcome receipt of a request (`GET /v1/requests/{id}/outcome-receipts`). |
| `waitForReceipt: (id: string, options?: WaitForReceiptOptions) => Promise<OutcomeReceiptRecord>` | Poll a receipt with bounded exponential backoff (250 ms doubling to 4 s by default) until it reaches a final state (`applied`, `rejected`, `failed`, `expired`), and resolve it. Rejects with [`ReceiptWaitTimeoutError`](#receiptwaittimeouterror) after `timeoutMs` (default 30 s) and with an `aborted` error when `signal` fires. It reads the public receipt route only. |

### OutcomeStore

interface · `src/flywheel-queue.ts`

The durability port. Every method may be sync or async. Implementations MUST persist the
whole entry (a real store writes it to disk before returning) so a crash after `append` but
before delivery never loses the event. Generic over the entry type, defaulting to
[`QueuedOutcome`](#queuedoutcome) so every existing `OutcomeStore` usage is unchanged.

```ts signature
interface OutcomeStore<T extends DurableEntry = QueuedOutcome> {
    append(entry: T): void | Promise<void>;
    update(entry: T): void | Promise<void>;
    remove(id: string): void | Promise<void>;
    list(): T[] | Promise<T[]>;
}
```

| Member | Description |
| --- | --- |
| `append(entry: T): void \| Promise<void>` | Persist a new entry (must be durable before resolving). |
| `update(entry: T): void \| Promise<void>` | Persist an updated entry. |
| `remove(id: string): void \| Promise<void>` | Remove an entry by id. |
| `list(): T[] \| Promise<T[]>` | Every queued entry, in insertion order. |

### OutcomeVerdictMapping

interface · `src/outcome-report.ts`

One side (pass or fail) of a source's mapping: the outcome channel, kind and optional value.

```ts signature
interface OutcomeVerdictMapping {
    readonly channel: OutcomeChannel;
    readonly kind: string;
    readonly value?: {
        readonly value: number;
    };
}
```

| Member | Description |
| --- | --- |
| `readonly channel: OutcomeChannel` | The outcome channel. |
| `readonly kind: string` | The channel kind. |
| `readonly value?: { readonly value: number }` | The typed value sent with the event (only `self_rating` has one). |

### PendingOutcomesQuery

interface · `src/outcomes.ts`

`GET /v1/outcomes/pending` query filters (keyset — never OFFSET).

```ts signature
interface PendingOutcomesQuery {
    limit?: number;
    cursor?: string;
    since?: string;
    archetype?: string;
    state?: 'pending' | 'overdue';
}
```

| Member | Description |
| --- | --- |
| `limit?: number` | Page size (1–200, default 50). |
| `cursor?: string` | Opaque keyset cursor from the prior page. |
| `since?: string` | Only claims created at/after this ISO-8601 instant. |
| `archetype?: string` | Filter to one archetype. |
| `state?: 'pending' \| 'overdue'` | Filter to `pending` or `overdue` (default: both). |

### PreflightCacheEntry

interface · `src/preflight.ts`

A cached preflight decision. `body` has its grant STRIPPED to null — the grant is NEVER cached.

```ts signature
interface PreflightCacheEntry {
    readonly etag: string;
    readonly body: PreflightResponse;
    readonly storedAtMs: number;
    readonly configMaxAgeS: number;
    readonly liveMaxAgeS: number;
}
```

| Member | Description |
| --- | --- |
| `readonly etag: string` | The strong `ETag` of the config-versioned part. |
| `readonly body: PreflightResponse` | The cached response body with `grant` nulled (the grant is never part of the cache). |
| `readonly storedAtMs: number` | When this entry was stored/last revalidated (ms). |
| `readonly configMaxAgeS: number` | The config-versioned part max age (seconds) — from `Cache-Control: max-age`. |
| `readonly liveMaxAgeS: number` | The LIVE (fallbacks) part max age (seconds) — from `X-UR-Live-Max-Age` / `routing.max_age_s`. |

### PreflightCacheOptions

interface · `src/preflight.ts`

Options for the client-side preflight cache (`new UltraRouter({ preflightCache })`).

```ts signature
interface PreflightCacheOptions {
    maxEntries?: number | undefined;
}
```

| Member | Description |
| --- | --- |
| `maxEntries?: number \| undefined` | The most request identities kept (default [`DEFAULT_PREFLIGHT_CACHE_MAX_ENTRIES`](#default_preflight_cache_max_entries)). Past it the least recently used entry is evicted. `0` disables the cache (every call goes to the network). |

### PreflightRequestOptions

interface · `src/preflight.ts`

Per-call preflight options. Extends [`RequestOptions`](#requestoptions) with the cache knobs.

```ts signature
interface PreflightRequestOptions extends RequestOptions {
    maxAgeS?: number;
    noCache?: boolean;
    now?: () => number;
}
```

| Member | Description |
| --- | --- |
| `maxAgeS?: number` | Override the client-side LIVE-part freshness window (seconds). Within it a repeat call revalidates (`If-None-Match` ⇒ 304, reusing the cached body); past it a full unconditional refetch re-pulls the health-ordered fallbacks. Defaults to the response's `X-UR-Live-Max-Age`. |
| `noCache?: boolean` | Bypass the client cache entirely — always an unconditional fetch; never serve/revalidate/store. |
| `now?: () => number` | Injectable clock (ms). Advanced/testing seam so cache freshness can be exercised deterministically; defaults to `Date.now`. |

### ProviderPreferences

interface · `src/types.ts`

OpenRouter-compatible provider preferences.

```ts signature
interface ProviderPreferences {
    order?: string[];
    allow_fallbacks?: boolean;
    ignore?: string[];
    require_parameters?: boolean;
    data_collection?: 'allow' | 'deny';
    quantizations?: string[];
    sort?: 'price' | 'throughput' | 'latency';
}
```

| Member | Description |
| --- | --- |
| `order?: string[]` | Provider slugs to try in this order. |
| `allow_fallbacks?: boolean` | Whether the gateway may fall back to providers outside `order`. |
| `ignore?: string[]` | Provider slugs to never use. |
| `require_parameters?: boolean` | Only use providers that support every request parameter. |
| `data_collection?: 'allow' \| 'deny'` | Whether providers that retain prompts may be used. |
| `quantizations?: string[]` | Allowed quantization levels. |
| `sort?: 'price' \| 'throughput' \| 'latency'` | Sort offers by price, throughput or latency. |

### QueuedOutcome

interface · `src/flywheel-queue.ts`

One durably-queued outcome (persisted before its first send; replayed verbatim).

```ts signature
interface QueuedOutcome {
    readonly id: string;
    readonly target: OutcomeTarget;
    readonly event: FinalizedOutcomeEvent;
    readonly enqueued_at: string;
    attempts: number;
}
```

| Member | Description |
| --- | --- |
| `readonly id: string` | Stable queue-entry id (distinct from the event's `source_event_id`). |
| `readonly target: OutcomeTarget` | Where the outcome lands (an artifact or a request). |
| `readonly event: FinalizedOutcomeEvent` | The finalized wire event — NEVER mutated between attempts (the retry guarantee). |
| `readonly enqueued_at: string` | ISO-8601 enqueue time (for observability / ordering; not the event's `observed_at`). |
| `attempts: number` | Delivery attempts so far (bumped on each retryable failure). |

### QueuedReviewerEvent

interface · `src/reviewer.ts`

One durably-queued reviewer event (persisted before its first send; replayed verbatim).

```ts signature
interface QueuedReviewerEvent extends DurableEntry {
    readonly id: string;
    readonly event: ReviewerEvent;
    readonly backfill?: ReviewerBackfill;
    readonly reviewerSystem?: string;
    readonly enqueued_at: string;
    attempts: number;
    dead_letter?: {
        reason: string;
        at: string;
    };
}
```

| Member | Description |
| --- | --- |
| `readonly id: string` | Stable queue-entry id (distinct from the reviewer's own `event_id`). |
| `readonly event: ReviewerEvent` | The wire event — NEVER mutated between attempts (the retry guarantee). |
| `readonly backfill?: ReviewerBackfill` | The backfill this entry belongs to, when it was enqueued inside one. |
| `readonly reviewerSystem?: string` | The reviewer-system label to send with it. |
| `readonly enqueued_at: string` | ISO-8601 enqueue time (observability/ordering only). |
| `attempts: number` | Delivery attempts so far. |
| `dead_letter?: { reason: string; at: string }` | Set when the server refused the event with a REPAIRABLE reason. The entry stays in the store as a DEAD LETTER (we never silently drop evidence a human produced) until `repair()` clears it. |

### ReasoningOptions

interface · `src/types.ts`

OpenRouter-compatible structured reasoning control. Takes precedence over `reasoning_effort`.

```ts signature
interface ReasoningOptions {
    effort?: ReasoningEffort;
    max_tokens?: number;
    exclude?: boolean;
}
```

| Member | Description |
| --- | --- |
| `effort?: ReasoningEffort` | The reasoning effort. |
| `max_tokens?: number` | A direct thinking-token budget (budget-based providers; minimum 1024). |
| `exclude?: boolean` | Drop reasoning tokens from the response. Not supported: `true` is refused with a named error. |

### RenderablePrompt

interface · `src/prompt-render.ts`

A hosted prompt as [`renderPrompt`](#renderprompt) needs it — the shape `getPrompt()` / preflight `prompt` returns.

```ts signature
interface RenderablePrompt {
    readonly template: string;
    readonly variables: readonly HostedPromptVariable[];
}
```

| Member | Description |
| --- | --- |
| `readonly template: string` | The template text with `{{name}}` slots. |
| `readonly variables: readonly HostedPromptVariable[]` | The declared variables. |

### RequestCorrelation

interface · `src/correlation.ts`

The correlation the SDK attaches to every chat completion and embeddings result.

```ts signature
interface RequestCorrelation {
    readonly requestId: string;
}
```

| Member | Description |
| --- | --- |
| `readonly requestId: string` | The gateway request id: the `x-ur-request-id` response header, else the body's `ur.request_id`. Pass it to `ur.ur.outcomes.report`. Not enumerable, so it never appears in `JSON.stringify` of the result. |

### RequestOptions

interface · `src/types.ts`

Per-call request options, accepted as the last argument of every method.

```ts signature
interface RequestOptions {
    signal?: AbortSignal | undefined;
    timeout?: number | undefined;
    maxRetries?: number | undefined;
    headers?: Record<string, string> | undefined;
    idempotencyKey?: string | undefined;
    requestId?: string | undefined;
    episodeKey?: string | undefined;
}
```

| Member | Description |
| --- | --- |
| `signal?: AbortSignal \| undefined` | Abort the request (and any pending retry). |
| `timeout?: number \| undefined` | Total timeout for this call in ms, including retries. |
| `maxRetries?: number \| undefined` | Maximum retries for this call. |
| `headers?: Record<string, string> \| undefined` | Extra headers for this call (they win over the client defaults). |
| `idempotencyKey?: string \| undefined` | An explicit idempotency key (otherwise one is generated for each non-streaming POST). |
| `requestId?: string \| undefined` | Your own request id for this call (`[A-Za-z0-9_-]{1,64}`), sent as `x-ur-request-id` so you know the id before the call returns. Mint one with `mintRequestId()`. Meaningful on chat completions and embeddings; the gateway echoes it on the response. |
| `episodeKey?: string \| undefined` | The episode handle, sent as `x-ur-artifact` (the same key as `ur.artifact`): every step of one multi-step task carries the same key, and concurrent tasks carry different keys even when they open with identical text. Printable ASCII, at most 256 characters. |

### ReviewerDeliveryOptions

interface · `src/client.ts`

Options for a reviewer delivery: a declared backfill and/or the reviewer system name.

```ts signature
interface ReviewerDeliveryOptions {
    backfill?: ReviewerBackfill;
    reviewerSystem?: string;
}
```

| Member | Description |
| --- | --- |
| `backfill?: ReviewerBackfill` | Declare the batch as a backfill of historical decisions. |
| `reviewerSystem?: string` | A label for the reviewer system the decisions come from. |

### ReviewerFlushReport

interface · `src/reviewer.ts`

The summary `ur.reviewer.flush()` resolves to.

```ts signature
interface ReviewerFlushReport {
    accepted: number;
    duplicate: number;
    deadLettered: number;
    dropped: number;
    pending: number;
    results: ReviewerEventResult[];
}
```

| Member | Description |
| --- | --- |
| `accepted: number` | Events the server durably recorded this flush. |
| `duplicate: number` | Replays the server absorbed as visible no-ops. |
| `deadLettered: number` | Events the server refused with a REPAIRABLE reason — kept as dead letters. |
| `dropped: number` | Events dropped after a terminal, non-repairable refusal. |
| `pending: number` | Events still queued (a retryable transport failure — try again later). |
| `results: ReviewerEventResult[]` | The per-event verdicts, in flush order. |

### ReviewerQueueDeps

interface · `src/reviewer.ts`

Construction dependencies for [`ReviewerQueue`](#reviewerqueue) (all injectable for tests).

```ts signature
interface ReviewerQueueDeps {
    store: OutcomeStore<QueuedReviewerEvent>;
    send: ReviewerSender;
    now?: () => number;
    genId?: () => string;
    batchSize?: number;
}
```

| Member | Description |
| --- | --- |
| `store: OutcomeStore<QueuedReviewerEvent>` | Where events are persisted before sending. |
| `send: ReviewerSender` | Sends one grouped batch. |
| `now?: () => number` | Clock for `enqueued_at` (injectable; defaults to `Date.now`). |
| `genId?: () => string` | Queue-entry id generator (injectable; defaults to a ULID). |
| `batchSize?: number` | Max events per delivery (the server accepts at most 500). |

### ReviewerResource

interface · `src/client.ts`

`ur.ur.reviewer`: the signed adapter for human approve / reject / edit decisions.

```ts signature
interface ReviewerResource {
    setup: (options?: RequestOptions) => Promise<ReviewerSetup>;
    test: (scenario?: ReviewerTestScenario, options?: RequestOptions) => Promise<ReviewerTestResult>;
    record: (event: ReviewerEvent, opts?: ReviewerDeliveryOptions) => Promise<string>;
    send: (events: ReviewerEvent[], opts?: ReviewerDeliveryOptions, options?: RequestOptions) => Promise<ReviewerEventsResponse>;
    flush: (options?: RequestOptions) => Promise<ReviewerFlushReport>;
    deadLetters: () => Promise<QueuedReviewerEvent[]>;
    repair: (entry: QueuedReviewerEvent, opts?: {
        repinToCurrentVersion?: boolean;
    }, options?: RequestOptions) => Promise<ReviewerRepairResult>;
    health: (options?: RequestOptions) => Promise<ReviewerHealth>;
}
```

| Member | Description |
| --- | --- |
| `setup: (options?: RequestOptions) => Promise<ReviewerSetup>` | Read the mapping preview and the signature recipe. |
| `test: (scenario?: ReviewerTestScenario, options?: RequestOptions) => Promise<ReviewerTestResult>` | Run a guided test scenario end to end (`happy`, `replay` or `version_mismatch`). |
| `record: (event: ReviewerEvent, opts?: ReviewerDeliveryOptions) => Promise<string>` | Durably queue one decision; nothing is sent until [`ReviewerResource.flush`](#reviewerresource). Resolves the queue entry id. |
| `send: ( events: ReviewerEvent[], opts?: ReviewerDeliveryOptions, options?: RequestOptions, ) => Promise<ReviewerEventsResponse>` | Send a signed batch immediately (bypasses the local queue). |
| `flush: (options?: RequestOptions) => Promise<ReviewerFlushReport>` | Drain the local reviewer queue. |
| `deadLetters: () => Promise<QueuedReviewerEvent[]>` | Events the gateway refused with a repairable reason, still held locally. |
| `repair: ( entry: QueuedReviewerEvent, opts?: { repinToCurrentVersion?: boolean }, options?: RequestOptions, ) => Promise<ReviewerRepairResult>` | Re-drive one dead-lettered event. |
| `health: (options?: RequestOptions) => Promise<ReviewerHealth>` | Read the integration health states and the next repair action. |

### SegmentHint

interface · `src/types.ts`

A segment label for one message, refining how compression segments the request.

```ts signature
interface SegmentHint {
    index: number;
    kind: SegmentHintKind;
}
```

| Member | Description |
| --- | --- |
| `index: number` | Index into the `messages` array. |
| `kind: SegmentHintKind` | The segment kind of that message. |

### SourceChecksResource

interface · `src/client.ts`

`ur.ur.flywheel.sourceChecks`: planted-failure checks for a verdict source.

```ts signature
interface SourceChecksResource {
    issue: (params: IssueSourceCheckParams, options?: RequestOptions) => Promise<SourceCheck>;
    answer: (checkId: string, params: AnswerSourceCheckParams, options?: RequestOptions) => Promise<SourceCheckGrade>;
}
```

| Member | Description |
| --- | --- |
| `issue: (params: IssueSourceCheckParams, options?: RequestOptions) => Promise<SourceCheck>` | Issue a planted-failure check to the calling verdict source. Its probes are returned once. |
| `answer: ( checkId: string, params: AnswerSourceCheckParams, options?: RequestOptions, ) => Promise<SourceCheckGrade>` | Answer a check: exactly one verdict per probe. It is graded once. |

### StreamCorrelation

interface · `src/correlation.ts`

The correlation the SDK attaches to a chat stream as soon as it opens.

```ts signature
interface StreamCorrelation {
    readonly requestId: string | null;
}
```

| Member | Description |
| --- | --- |
| `readonly requestId: string \| null` | The gateway request id from the `x-ur-request-id` header (or the id you sent), available before the first chunk; `null` only when the gateway sent no header and you sent no id. The final chunk's `ur.request_id` carries it too. |

### UltraRouterDefaults

interface · `src/types.ts`

Construction-time defaults; each one is overridable per call.

```ts signature
interface UltraRouterDefaults {
    router?: RouterMode | undefined;
    compression?: CompressionOption | undefined;
    callType?: string | undefined;
    provider?: ProviderPreferences | undefined;
    maxCostUsd?: number | undefined;
}
```

| Member | Description |
| --- | --- |
| `router?: RouterMode \| undefined` | Default routing mode. |
| `compression?: CompressionOption \| undefined` | Default compression control. |
| `callType?: string \| undefined` | Default call-type slug. |
| `provider?: ProviderPreferences \| undefined` | Default provider preferences. |
| `maxCostUsd?: number \| undefined` | Default per-call cost cap (USD), sent as `ur.max_cost_usd`. |

### UltraRouterOptions

interface · `src/types.ts`

Options for `new UltraRouter(options)`. Every field is optional.

```ts signature
interface UltraRouterOptions {
    apiKey?: string | undefined;
    baseURL?: string | undefined;
    defaultModel?: string | undefined;
    autopilot?: AutopilotMode | undefined;
    bench?: BenchInitTag | undefined;
    defaults?: UltraRouterDefaults | undefined;
    timeout?: number | undefined;
    maxRetries?: number | undefined;
    fetch?: FetchLike | undefined;
    defaultHeaders?: Record<string, string> | undefined;
    requestIds?: 'gateway' | 'client' | undefined;
    outcomeStore?: OutcomeStore | undefined;
    reviewerStore?: OutcomeStore<QueuedReviewerEvent> | undefined;
    preflightCache?: PreflightCacheOptions | undefined;
}
```

| Member | Description |
| --- | --- |
| `apiKey?: string \| undefined` | The API key (`ur_sk_live_…` / `ur_sk_test_…`). Falls back to `ULTRAROUTER_API_KEY`, then `UR_API_KEY`. |
| `baseURL?: string \| undefined` | The gateway base URL, without `/v1`. Falls back to `ULTRAROUTER_BASE_URL`, then `UR_BASE_URL`. There is no hosted default, so one of these is required (for example `http://localhost:8080` for a local gateway); construction throws `configuration` when none is set. Point it at your own deployment to self-host. |
| `defaultModel?: string \| undefined` | The model used when a call omits `model`. |
| `autopilot?: AutopilotMode \| undefined` | The one-line Autopilot intent: `audit` sends `router: 'off'`, `recommend` sends `router: 'candidates'`, `auto` sends `router: 'auto'`. A per-call `router` may only lower autonomy below this ceiling (a higher value is clamped). Omit it for a plain pass-through client. |
| `bench?: BenchInitTag \| undefined` | A Bench capture tag stamped as `X-UR-Bench-*` headers on every request (and carried by `asOpenAI()`). A per-call `bench` overrides it. Falls back to `UR_BENCH` (with optional `UR_BENCH_RUN` / `UR_BENCH_TRACE`). Bench capture needs a test key (`ur_sk_test_…`). |
| `defaults?: UltraRouterDefaults \| undefined` | Construction-time defaults, each overridable per call. |
| `timeout?: number \| undefined` | Total request timeout in ms (default 600000), including retries. |
| `maxRetries?: number \| undefined` | Maximum retries for a retryable failure (default 2). |
| `fetch?: FetchLike \| undefined` | A custom `fetch` (default `globalThis.fetch`). |
| `defaultHeaders?: Record<string, string> \| undefined` | Extra headers sent on every request. |
| `requestIds?: 'gateway' \| 'client' \| undefined` | Who chooses request ids: `gateway` (default; the gateway mints one and echoes it) or `client` (the SDK mints one with `mintRequestId()` for every chat completion and embeddings call that does not pass `requestId`, so the id is known even when the response is lost). |
| `outcomeStore?: OutcomeStore \| undefined` | Where outcome events are persisted before they are sent. Defaults to an in-process `MemoryOutcomeStore`; pass a `FileOutcomeStore(path)` to survive restarts, or your own [`OutcomeStore`](#outcomestore). |
| `reviewerStore?: OutcomeStore<QueuedReviewerEvent> \| undefined` | Where reviewer events are persisted before they are sent (same options as `outcomeStore`). |
| `preflightCache?: PreflightCacheOptions \| undefined` | The bound on the client-side `preflight()` cache: `{ maxEntries }` request identities (default 1000), least recently used evicted first; `{ maxEntries: 0 }` disables it. |

### UrCompressionBlock

interface · `src/types.ts`

The compression summary in the `ur` response block.

```ts signature
interface UrCompressionBlock {
    applied: 'off' | 'semantic_safe' | 'adaptive';
    deprecated_alias?: 'lossless' | 'auto';
    savings_basis?: 'provider_reported' | 'estimated_diagnostic';
    source?: 'off' | 'qualified' | 'unqualified-legacy';
    tokens_saved?: number;
    est_saved_usd?: number;
    cache_saved_usd?: number;
    verify?: string;
}
```

| Member | Description |
| --- | --- |
| `applied: 'off' \| 'semantic_safe' \| 'adaptive'` | The compression tier actually applied. |
| `deprecated_alias?: 'lossless' \| 'auto'` | Set when the request used a deprecated legacy alias. |
| `savings_basis?: 'provider_reported' \| 'estimated_diagnostic'` | Whether a figure is provider-reported or only an estimated diagnostic. |
| `source?: 'off' \| 'qualified' \| 'unqualified-legacy'` | Where the applied tier came from (`unqualified-legacy` = no qualifying evidence yet). |
| `tokens_saved?: number` | Tokens removed by compression, when any. |
| `est_saved_usd?: number` | Estimated USD difference attributed to compression (an estimate; see `savings_basis`). |
| `cache_saved_usd?: number` | USD difference attributed to provider prompt caching, when reported. |
| `verify?: string` | The verification outcome of a lossy rewrite, when one ran. |

### UrNamespace

interface · `src/client.ts`

The `ur` namespace: every ultrarouter resource beyond the OpenAI-compatible surface.

```ts signature
interface UrNamespace {
    callTypes: CallTypesResource;
    requests: {
        feedback: (requestId: string, params: FeedbackParams, options?: RequestOptions) => Promise<Feedback>;
    };
    generation: {
        get: (requestId: string, options?: RequestOptions) => Promise<GenerationStats>;
    };
    key: {
        get: (options?: RequestOptions) => Promise<KeyInfo>;
    };
    autopilot: {
        readonly mode: AutopilotMode | undefined;
        status: (options?: RequestOptions) => Promise<AutopilotStatus>;
    };
    bench: BenchResource;
    artifactTypes: {
        upsert: (params: ArtifactTypeUpsertParams, options?: RequestOptions) => Promise<ArtifactType>;
    };
    artifacts: ArtifactsResource;
    outcomes: OutcomesResource;
    learning: LearningResource;
    reviewer: ReviewerResource;
    flywheel: FlywheelResource;
    imports: ImportsResource;
    improvementReads: {
        list: (options?: RequestOptions) => Promise<ImprovementReads>;
    };
    oracles: OraclesResource;
    asOpenAI: AsOpenAI;
}
```

| Member | Description |
| --- | --- |
| `callTypes: CallTypesResource` | Call-type configuration, evals, recommendations, hosted prompts and verified memory. |
| `requests: { feedback: ( requestId: string, params: FeedbackParams, options?: RequestOptions, ) => Promise<Feedback>; }` | Per-request feedback. |
| `generation: { get: (requestId: string, options?: RequestOptions) => Promise<GenerationStats>; }` | Per-request generation stats. |
| `key: { get: (options?: RequestOptions) => Promise<KeyInfo>; }` | The API key the client was constructed with. |
| `autopilot: { readonly mode: AutopilotMode \| undefined; status: (options?: RequestOptions) => Promise<AutopilotStatus>; }` | The one-line Autopilot intent and the read-only readiness rollup. |
| `bench: BenchResource` | Bench suites, runs, reports and the compare gate. |
| `artifactTypes: { upsert: (params: ArtifactTypeUpsertParams, options?: RequestOptions) => Promise<ArtifactType>; }` | Artifact types: the objective that defines success for a kind of artifact. |
| `artifacts: ArtifactsResource` | Artifacts: the units of value your application produces. |
| `outcomes: OutcomesResource` | Outcome events with a durable local queue, verdict reports and receipts. |
| `learning: LearningResource` | Learning controls per call type. |
| `reviewer: ReviewerResource` | The signed reviewer-decision adapter. |
| `flywheel: FlywheelResource` | Learning status and verdict-source health. |
| `imports: ImportsResource` | History imports. |
| `improvementReads: { list: (options?: RequestOptions) => Promise<ImprovementReads>; }` | Improvement reads: a cost read and a quality read for every call type. |
| `oracles: OraclesResource` | Oracles: registered checks and their pull transport. |
| `asOpenAI: AsOpenAI` | Alias of [`UltraRouter.asOpenAI`](#ultrarouter). |

### UrRequestOptions

interface · `src/types.ts`

Per-request ultrarouter controls (the `ur` request extension).

```ts signature
interface UrRequestOptions {
    trace_id?: string;
    tags?: Record<string, string>;
    max_cost_usd?: number;
    timeout_ms?: number;
    segments?: SegmentHint[];
    bench?: BenchTag;
    artifact?: string;
    situation?: Record<string, unknown>;
    manifest?: UrManifest | DeepReadonly<UrManifest>;
    context_modules?: UrContextModule[];
    prompt_vars?: Record<string, string | number | boolean>;
}
```

| Member | Description |
| --- | --- |
| `trace_id?: string` | Your trace id; groups related requests. |
| `tags?: Record<string, string>` | Free-form string tags recorded with the request. |
| `max_cost_usd?: number` | Refuse the call before dispatch when its estimated cost exceeds this many USD. |
| `timeout_ms?: number` | A per-request upstream timeout (ms). |
| `segments?: SegmentHint[]` | Segment labels that refine compression segmentation. |
| `bench?: BenchTag` | Bench capture activation. Wins over the `X-UR-Bench-*` headers set at construction. |
| `artifact?: string` | The artifact key this request contributes to (equivalent to the `X-UR-Artifact` header; the body wins on conflict). The response `ur.artifact_id` echoes the bound artifact. `withArtifact` sets it on every bound call. |
| `situation?: Record<string, unknown>` | Declared situation facets (labels and values only), hashed into the artifact's situation key. |
| `manifest?: UrManifest \| DeepReadonly<UrManifest>` | A declared context manifest: pass `toWire(manifest)` from `@ultrarouter/sdk/context`. See [`UrManifest`](#urmanifest). |
| `context_modules?: UrContextModule[]` | Learned-context modules this call opts into, each pinned to an exact version (at most 8). The gateway refuses on any mismatch instead of serving a different version. |
| `prompt_vars?: Record<string, string \| number \| boolean>` | Values for the active hosted prompt's `{{name}}` variables when the gateway applies a hosted prompt for this call type. A missing required variable is a `prompt_variables_missing` error. |

### UrResponseBlock

interface · `src/types.ts`

The ultrarouter `ur` block attached to every chat and embeddings response.

```ts signature
interface UrResponseBlock {
    request_id: string;
    call_type: string | null;
    model_served: string;
    provider: string;
    routing: UrRoutingBlock;
    compression: UrCompressionBlock;
    cost_usd: number;
    byok: boolean;
    bench?: UrBenchEcho;
    artifact_id?: string;
    verified_memory?: UrVerifiedMemoryBlock;
}
```

| Member | Description |
| --- | --- |
| `request_id: string` | The gateway request id (`req_…`). Use it with `ur.generation.get` and `ur.requests.feedback`. |
| `call_type: string \| null` | The call type the request was attributed to, or `null`. |
| `model_served: string` | The model that actually served the request. |
| `provider: string` | The provider that served the request. |
| `routing: UrRoutingBlock` | How the request was routed. |
| `compression: UrCompressionBlock` | What compression did. |
| `cost_usd: number` | The request cost in USD. |
| `byok: boolean` | Whether your own provider key (BYOK) served the request. |
| `bench?: UrBenchEcho` | The Bench capture echo, present only on a bench-tagged call. |
| `artifact_id?: string` | The artifact the request was bound to, present only when the request declared one. |
| `verified_memory?: UrVerifiedMemoryBlock` | Present only when the answer came from verified memory. |

### UrRoutingBlock

interface · `src/types.ts`

The routing summary in the `ur` response block.

```ts signature
interface UrRoutingBlock {
    mode: RouterMode;
    fallback_used: boolean;
    engine?: string;
}
```

| Member | Description |
| --- | --- |
| `mode: RouterMode` | The routing mode that applied. |
| `fallback_used: boolean` | Whether a fallback model served the request. |
| `engine?: string` | The engine that decided (for example `verified_memory` for an answer from verified memory). |

### Usage

interface · `src/types.ts`

Token usage of a completion.

```ts signature
interface Usage {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details?: {
        cached_tokens?: number;
    };
}
```

| Member | Description |
| --- | --- |
| `prompt_tokens: number` | Input tokens. |
| `completion_tokens: number` | Output tokens. |
| `total_tokens: number` | Input plus output tokens. |
| `prompt_tokens_details?: { cached_tokens?: number }` | Input token details (`cached_tokens` = tokens served from the provider prompt cache). |

### VerifiedMemoryResource

interface · `src/client.ts`

`ur.ur.callTypes.verifiedMemory`: answer-from-verified-memory controls for a call type.

```ts signature
interface VerifiedMemoryResource {
    get: (callTypeId: string, options?: RequestOptions) => Promise<VerifiedMemoryStatus>;
    enable: (callTypeId: string, params?: EnableVerifiedMemoryParams, options?: RequestOptions) => Promise<VerifiedMemoryEnableResult>;
    disable: (callTypeId: string, options?: RequestOptions) => Promise<VerifiedMemoryDisableResult>;
}
```

| Member | Description |
| --- | --- |
| `get: (callTypeId: string, options?: RequestOptions) => Promise<VerifiedMemoryStatus>` | Read the verified-memory setting of the active config version and whether it can serve. |
| `enable: ( callTypeId: string, params?: EnableVerifiedMemoryParams, options?: RequestOptions, ) => Promise<VerifiedMemoryEnableResult>` | Enable verified memory. The gateway calibrates against the declared `target_precision` and only enables it when an operating point clears it. Requires workspace authorisation. |
| `disable: (callTypeId: string, options?: RequestOptions) => Promise<VerifiedMemoryDisableResult>` | Disable verified memory (the kill switch). Idempotent. |

### WaitForReceiptOptions

interface · `src/outcome-receipts.ts`

Options for `ur.ur.outcomes.waitForReceipt`.

```ts signature
interface WaitForReceiptOptions {
    timeoutMs?: number | undefined;
    signal?: AbortSignal | undefined;
    pollIntervalMs?: number | undefined;
    maxPollIntervalMs?: number | undefined;
}
```

| Member | Description |
| --- | --- |
| `timeoutMs?: number \| undefined` | The longest time to wait, in ms (default 30000). |
| `signal?: AbortSignal \| undefined` | Stop waiting: the call rejects with an `aborted` error. |
| `pollIntervalMs?: number \| undefined` | The first delay between reads, in ms (default 250); it doubles after every read. |
| `maxPollIntervalMs?: number \| undefined` | The longest delay between reads, in ms (default 4000). |

## Types

### ActivateHostedPromptParams

type · `src/resources.ts`

The body of `ur.callTypes.prompts.activate(id, version, params)`.

```ts signature
type ActivateHostedPromptParams = OperationRequestBody<'activateHostedPrompt'>;
```

### AnswerSourceCheckParams

type · `src/resources.ts`

The body of `ur.flywheel.sourceChecks.answer(id, params)`.

```ts signature
type AnswerSourceCheckParams = OperationRequestBody<'gradeVerdictSourceCheck'>;
```

### ApiOperation

type · `src/resources.ts`

The operation object for a path template + method.

```ts signature
type ApiOperation<M extends HttpMethod, P extends ApiPath<M>> = paths[P][M];
```

### ApiPath

type · `src/resources.ts`

Every path template that defines the given method, e.g. `ApiPath<'get'>` includes `/v1/models/{id}`.

```ts signature
type ApiPath<M extends HttpMethod> = {
    [P in keyof paths]: paths[P][M] extends {
        responses: unknown;
    } ? P : never;
}[keyof paths];
```

### ApiResponse

type · `src/resources.ts`

The success response body for a path template + method.

```ts signature
type ApiResponse<M extends HttpMethod, P extends ApiPath<M>> = ApiOperation<M, P> extends {
    responses: infer R;
} ? SuccessBody<R> : unknown;
```

### Artifact

type · `src/artifacts.ts`

An artifact as rendered by the API (metadata only — NEVER a body).

```ts signature
type Artifact = Schemas['ArtifactSummary'];
```

### ArtifactArchetype

type · `src/artifacts.ts`

The closed artifact-archetype vocabulary.

```ts signature
type ArtifactArchetype = Schemas['ArtifactSummary']['archetype'];
```

### ArtifactClaim

type · `src/artifacts.ts`

A claim on an artifact + its cached reducer state (metadata only).

```ts signature
type ArtifactClaim = Schemas['ArtifactClaim'];
```

### ArtifactEnvelope

type · `src/artifacts.ts`

The `{ artifact: … }` envelope returned by create/upsert + get.

```ts signature
type ArtifactEnvelope = Schemas['ArtifactEnvelope'];
```

### ArtifactListResponse

type · `src/artifacts.ts`

`GET /v1/artifacts` response — a keyset page of artifacts.

```ts signature
type ArtifactListResponse = Schemas['ArtifactListResponse'];
```

### ArtifactObjective

type · `src/artifacts.ts`

An artifact-type objective. The objective is the one thing the product never
infers: you declare once what "it worked" means and it is pinned onto every
artifact of that type. Append-only: an upsert that CHANGES it appends a new version; an
unchanged upsert is an idempotent no-op returning the existing one.

```ts signature
type ArtifactObjective = Schemas['ArtifactObjective'];
```

### ArtifactObjectiveMetric

type · `src/artifacts.ts`

The closed objective-metric vocabulary.

```ts signature
type ArtifactObjectiveMetric = ArtifactObjective['metric'];
```

### ArtifactObjectivePredicate

type · `src/artifacts.ts`

The closed resolution-predicate vocabulary.

```ts signature
type ArtifactObjectivePredicate = NonNullable<ArtifactObjective['predicate_id']>;
```

### ArtifactType

type · `src/artifacts.ts`

A persisted artifact-type objective version as rendered by the API.

```ts signature
type ArtifactType = Schemas['ArtifactType'];
```

### ArtifactTypeEnvelope

type · `src/artifacts.ts`

The `{ artifact_type: … }` envelope returned by `upsert`.

```ts signature
type ArtifactTypeEnvelope = Schemas['ArtifactTypeEnvelope'];
```

### ArtifactTypeUpsertParams

type · `src/artifacts.ts`

`ur.artifactTypes.upsert(params)` — register/append an objective version.

```ts signature
type ArtifactTypeUpsertParams = Schemas['UpsertArtifactTypeRequest'];
```

### AutopilotMode

type · `src/types.ts`

The one-line Autopilot intent (see [`UltraRouterOptions.autopilot`](#ultrarouteroptions)): `audit` (observe only),
`recommend` (rank approved candidates) or `auto` (let the router act once evidence qualifies).

```ts signature
type AutopilotMode = 'audit' | 'recommend' | 'auto';
```

### BatchOutcomeInput

type · `src/outcomes.ts`

One batch outcome keyed by `request_id | artifact_id | artifact_key` (optional `claim_key`).

```ts signature
type BatchOutcomeInput = Schemas['BatchOutcomeInput'];
```

### BatchOutcomeResult

type · `src/outcomes.ts`

One batch row's result (echoes the input target key + the per-row verdict).

```ts signature
type BatchOutcomeResult = Schemas['BatchOutcomeResult'];
```

### BatchOutcomesResponse

type · `src/outcomes.ts`

`POST /v1/outcomes/batch` response — per-row results + a verdict rollup.

```ts signature
type BatchOutcomesResponse = Schemas['BatchOutcomesResponse'];
```

### BenchBaseline

type · `src/types.ts`

`ur.bench.baseline(runId)`: the pinned suite baseline.

```ts signature
type BenchBaseline = Schemas['BenchBaselineResponse'];
```

### BenchCompareGate

type · `src/types.ts`

`ur.bench.gate(runId)`: the baseline-compare gate (`pass` / `fail` / `inconclusive`).

```ts signature
type BenchCompareGate = Schemas['BenchCompareGateResponse'];
```

### BenchDatasetFreeze

type · `src/types.ts`

`ur.bench.freeze(suite)`: the immutable dataset cards.

```ts signature
type BenchDatasetFreeze = Schemas['BenchDatasetFreezeResponse'];
```

### BenchExpectationInput

type · `src/types.ts`

One assertion to attach with `ur.bench.expect`.

```ts signature
type BenchExpectationInput = Schemas['BenchExpectationsRequest']['expectations'][number];
```

### BenchExpectations

type · `src/types.ts`

`ur.bench.expect(suite, …)` result.

```ts signature
type BenchExpectations = Schemas['BenchExpectationsResponse'];
```

### BenchFreezeParams

type · `src/types.ts`

`ur.bench.freeze(suite, params)` body: the optional per-call-type `max_items` cap (1–5000, default 500).

```ts signature
type BenchFreezeParams = Schemas['BenchFreezeRequest'];
```

### BenchInitTag

type · `src/types.ts`

The construction-time Bench tag: like [`BenchTag`](#benchtag), but `trace` may be a per-request factory.

```ts signature
type BenchInitTag = string | {
    suite: string;
    run?: string;
    trace?: string | (() => string);
};
```

### BenchOutcomeInput

type · `src/types.ts`

One per-trace outcome to record with `ur.bench.record`.

```ts signature
type BenchOutcomeInput = Schemas['BenchOutcomesRequest']['outcomes'][number];
```

### BenchOutcomes

type · `src/types.ts`

`ur.bench.record(…)` result.

```ts signature
type BenchOutcomes = Schemas['BenchOutcomesResponse'];
```

### BenchOutcomeTarget

type · `src/types.ts`

`ur.bench.record` target: a suite slug or a run id.

```ts signature
type BenchOutcomeTarget = {
    suite: string;
} | {
    run: string;
};
```

### BenchReport

type · `src/types.ts`

`ur.bench.report(runId)`: the immutable evidence report.

```ts signature
type BenchReport = Schemas['BenchReportResponse'];
```

### BenchReportFormat

type · `src/types.ts`

The report export format. `json` is typed; `md` and `bundle` are returned as text.

```ts signature
type BenchReportFormat = 'json' | 'md' | 'bundle';
```

### BenchRun

type · `src/types.ts`

`ur.bench.get(runId)`: a run and its per-arm evidence.

```ts signature
type BenchRun = Schemas['BenchRunResponse'];
```

### BenchRunMode

type · `src/types.ts`

The paired-run mode: `request` (per request) or `task` (whole trace).

```ts signature
type BenchRunMode = 'request' | 'task';
```

### BenchRunTrigger

type · `src/types.ts`

`ur.bench.run(params)`: the trigger receipt (estimate, allowance and per-call-type dispositions).

```ts signature
type BenchRunTrigger = Schemas['BenchRunTriggerResponse'];
```

### BenchSelectionMode

type · `src/types.ts`

The selection mode: `selection` ranks evidence (never a recommendation); `noninferiority` can support a migration.

```ts signature
type BenchSelectionMode = 'selection' | 'noninferiority';
```

### BenchSuiteStatus

type · `src/types.ts`

`ur.bench.status(suite)`: suite readiness.

```ts signature
type BenchSuiteStatus = Schemas['BenchSuiteStatusResponse'];
```

### BenchTag

type · `src/types.ts`

A Bench capture tag. A bare string is the suite slug; the object form adds the capture-window
`run` label and the multi-call task-grouping `trace`.

```ts signature
type BenchTag = string | {
    suite: string;
    run?: string;
    trace?: string;
};
```

### CallTypeImprovementReads

type · `src/resources.ts`

One call type's pair of improvement reads.

```ts signature
type CallTypeImprovementReads = Schemas['CallTypeImprovementReads'];
```

### CallTypeRecommendations

type · `src/resources.ts`

`ur.callTypes.recommendations(id)`: the eval-backed model recommendations for a call type. The
OpenAPI document does not publish this response schema yet, so it is typed as an open object.

```ts signature
type CallTypeRecommendations = Record<string, unknown>;
```

### ChatCompletionStream

type · `src/types.ts`

An async iterable of chunks; the last chunk carries `usage` and `ur`.

```ts signature
type ChatCompletionStream = AsyncIterable<ChatCompletionChunk>;
```

### ChatRole

type · `src/types.ts`

A chat message role.

```ts signature
type ChatRole = 'system' | 'developer' | 'user' | 'assistant' | 'tool';
```

### ClaimInput

type · `src/artifacts.ts`

A customer-declared claim on an artifact create.

```ts signature
type ClaimInput = NonNullable<CreateArtifactParams['claims']>[number];
```

### ClaimOracleJobsParams

type · `src/resources.ts`

The body of `ur.oracles.claimJobs(id, params)` (pull transport).

```ts signature
type ClaimOracleJobsParams = OperationRequestBody<'claimOracleJobs'>;
```

### CompressionMode

type · `src/types.ts`

Compression mode: `off` (the default — no model-visible rewrite), `semantic_safe` (deterministic,
evidence-qualified rewrites) or `adaptive` (guarded pruning). `lossless` and `auto` are deprecated
legacy aliases that still parse and map to the conservative policy; `lossless` is not a guarantee
that the model sees identical text.

```ts signature
type CompressionMode = 'off' | 'semantic_safe' | 'adaptive' | 'lossless' | 'auto';
```

### CompressionOption

type · `src/types.ts`

The `compression` field: a bare mode or the structured object.

```ts signature
type CompressionOption = CompressionMode | CompressionOptions;
```

### CreateArtifactParams

type · `src/artifacts.ts`

`POST /v1/artifacts` request — create/upsert an artifact by `key`.

```ts signature
type CreateArtifactParams = Schemas['CreateArtifactRequest'];
```

### CreateHostedPromptParams

type · `src/resources.ts`

The body of `ur.callTypes.prompts.create(id, params)`.

```ts signature
type CreateHostedPromptParams = OperationRequestBody<'createHostedPrompt'>;
```

### DeepReadonly

type · `src/types.ts`

A deeply read-only view of a type. `ur.manifest` accepts it, so the read-only value `toWire()`
returns can be passed as-is.

```ts signature
type DeepReadonly<T> = T extends (infer E)[] ? readonly DeepReadonly<E>[] : T extends object ? {
    readonly [K in keyof T]: DeepReadonly<T[K]>;
} : T;
```

### EnableLearningParams

type · `src/learning-controls.ts`

`ur.ur.learning.enable(callTypeId, params)`: `reflection_model` (required; it must resolve to a
workspace-owned offer), and optionally `lessons_mode`, `lessons_k`, `promotion` (an object of
policy changes merged over the current policy) and `recipe`.

```ts signature
type EnableLearningParams = Schemas['EnableLearningRequest'];
```

### EnableVerifiedMemoryParams

type · `src/resources.ts`

The body of `ur.callTypes.verifiedMemory.enable(id, params)`.

```ts signature
type EnableVerifiedMemoryParams = OperationRequestBody<'enableVerifiedMemory'>;
```

### EnqueueEvalParams

type · `src/types.ts`

`ur.callTypes.enqueueEval` request body.

```ts signature
type EnqueueEvalParams = Schemas['EnqueueEvalRequest'];
```

### EnqueueEvalResponse

type · `src/types.ts`

`ur.callTypes.enqueueEval` response: the enqueued run (`run_id`, `candidate_count`) or a documented
no-op (`enqueued: false` with a `reason`; a deduplicated trigger names `prior_run_id`).

```ts signature
type EnqueueEvalResponse = Schemas['EnqueueEvalResponse'];
```

### EnrolExperimentExecutionParams

type · `src/resources.ts`

The body of `ur.flywheel.experiments.enrol(id, params)` (`{ phase, pair_key, slot }`).

```ts signature
type EnrolExperimentExecutionParams = OperationRequestBody<'enrolFlywheelExperimentExecution'>;
```

### EvalRunList

type · `src/resources.ts`

`ur.callTypes.listEvals(id)`: a call type's eval runs, their candidates and run specs.

```ts signature
type EvalRunList = Schemas['EvalRunListResponse'];
```

### ExperimentExecution

type · `src/resources.ts`

One enrolled experiment execution. `arm` is decided by the sealed assignment, never by the
caller; send `execution_id` as the `x-ur-experiment-execution` header on every call of the run.

```ts signature
type ExperimentExecution = OperationResponse<'enrolFlywheelExperimentExecution'>;
```

### ExperimentExecutionOutcome

type · `src/resources.ts`

A recorded live-execution outcome (`object: 'flywheel_experiment_execution_outcome'`).

```ts signature
type ExperimentExecutionOutcome = Extract<ExperimentOutcomeResult, {
    object: 'flywheel_experiment_execution_outcome';
}>;
```

### ExperimentExecutionOutcomeDryRun

type · `src/resources.ts`

An outcome dry-run answer (`object: 'flywheel_experiment_execution_outcome_dry_run'`): the answer
the record would give now — `status`, the named `refusal`, `missing_request_ids`,
`unlisted_request_ids` and `open_holds` — with nothing written.

```ts signature
type ExperimentExecutionOutcomeDryRun = Extract<ExperimentOutcomeResult, {
    object: 'flywheel_experiment_execution_outcome_dry_run';
}>;
```

### ExperimentScreenEvaluation

type · `src/resources.ts`

The explicit screen re-evaluation (`POST …/screen/evaluate`): counts before the verdict, the verdict after.

```ts signature
type ExperimentScreenEvaluation = OperationResponse<'evaluateFlywheelExperimentScreen'>;
```

### ExperimentTestEvaluation

type · `src/resources.ts`

The explicit prospective-test re-evaluation (`POST …/test/evaluate`): counts before the decision, the decision after.

```ts signature
type ExperimentTestEvaluation = OperationResponse<'evaluateFlywheelExperimentTest'>;
```

### FetchLike

type · `src/types.ts`

The `fetch` signature the SDK depends on. Inject your own for tests, proxies or instrumentation.

```ts signature
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
```

### FinalizedOutcomeEvent

type · `src/flywheel-queue.ts`

A finalized outcome event: the caller's [`OutcomeInput`](#outcomeinput) with `observed_at` and
`source_event_id` guaranteed present (fixed at enqueue). This is the EXACT wire payload
replayed on every attempt — never re-derived.

```ts signature
type FinalizedOutcomeEvent = OutcomeInput & {
    observed_at: string;
    source_event_id: string;
};
```

### FinalParams

type · `src/artifacts.ts`

`POST /v1/artifacts/:id/final` request — the human-approved output (channel 2).

```ts signature
type FinalParams = Schemas['FinalRequest'];
```

### FinalResponse

type · `src/artifacts.ts`

`POST /v1/artifacts/:id/final` response — the appended final artifact version.

```ts signature
type FinalResponse = Schemas['FinalResponse'];
```

### FlywheelCalibration

type · `src/flywheel-status.ts`

`ur.flywheel.calibration()` → the `learning` block of GET /v1/flywheel/status: the flywheel
class + calibration AVAILABILITY (never a fabricated track record). Explicitly
unavailable while the workspace is still collecting evidence.

```ts signature
type FlywheelCalibration = FlywheelStatus['learning'];
```

### FlywheelStatus

type · `src/flywheel-status.ts`

`ur.flywheel.status()` → GET /v1/flywheel/status.

```ts signature
type FlywheelStatus = Schemas['FlywheelStatusResponse'];
```

### FlywheelUsage

type · `src/flywheel-status.ts`

The four SEPARATED Flywheel usage quantities + caps + storage + COGS.

```ts signature
type FlywheelUsage = Schemas['FlywheelUsageBlock'];
```

### GatewayErrorCode

type · `src/errors.ts`

A stable gateway error code (the closed set the gateway returns).

```ts signature
type GatewayErrorCode = keyof typeof GATEWAY_ERROR_TAXONOMY;
```

### HostedPromptList

type · `src/resources.ts`

`ur.callTypes.prompts.list(id)`: every hosted prompt version of a call type + the active pointer.

```ts signature
type HostedPromptList = OperationResponse<'listHostedPrompts'>;
```

### HostedPromptPointer

type · `src/resources.ts`

The active hosted-prompt pointer after `activate` / `deactivate`.

```ts signature
type HostedPromptPointer = OperationResponse<'activateHostedPrompt'>;
```

### HostedPromptProposal

type · `src/resources.ts`

`ur.callTypes.prompts.proposal(id)`: the host-your-prompt onboarding proposal for a call type.

```ts signature
type HostedPromptProposal = OperationResponse<'getHostedPromptProposal'>;
```

### HostedPromptVersion

type · `src/resources.ts`

One immutable hosted prompt version (`create` / `get`).

```ts signature
type HostedPromptVersion = OperationResponse<'getHostedPrompt'>;
```

### HttpMethod

type · `src/resources.ts`

An HTTP method the typed [`UltraRouter.request`](#ultrarouter) helper accepts.

```ts signature
type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';
```

### Import

type · `src/imports.ts`

An import job as rendered by the API (metadata + capability report; NEVER a body).

```ts signature
type Import = Schemas['ImportSummary'];
```

### ImportCapabilityReport

type · `src/imports.ts`

The pre-analysis capability report (accepted/duplicate/rejected/unsupported; NEVER a body).

```ts signature
type ImportCapabilityReport = Schemas['ImportCapabilityReport'];
```

### ImportEnvelope

type · `src/imports.ts`

The `{ import: … }` envelope returned by create / get / cancel.

```ts signature
type ImportEnvelope = Schemas['ImportEnvelope'];
```

### ImportListResponse

type · `src/imports.ts`

`GET /v1/imports` response — a keyset page of imports (metadata only).

```ts signature
type ImportListResponse = Schemas['ImportListResponse'];
```

### ImportParams

type · `src/imports.ts`

`POST /v1/imports` request — create/resume a history import (consent-gated).

```ts signature
type ImportParams = Schemas['ImportRequest'];
```

### ImprovementReads

type · `src/resources.ts`

`ur.improvementReads.list()`: for every call type, a cost read and a quality read.

```ts signature
type ImprovementReads = Schemas['ImprovementReadsResponse'];
```

### IssueSourceCheckParams

type · `src/resources.ts`

The body of `ur.flywheel.sourceChecks.issue(params)`.

```ts signature
type IssueSourceCheckParams = OperationRequestBody<'issueVerdictSourceCheck'>;
```

### KeyInfo

type · `src/resources.ts`

`ur.key.get()`: the presented API key describing itself (scopes, caps, usage this period).

```ts signature
type KeyInfo = Schemas['KeyIntrospection'];
```

### LearnedContextDelivery

type · `src/types.ts`

How learned context is delivered on a call type.

```ts signature
type LearnedContextDelivery = 'gateway_inject_after_stable_prefix' | 'off';
```

### LearningArmEvidence

type · `src/learning-controls.ts`

One arm's evidence in an evaluation.

```ts signature
type LearningArmEvidence = LearningEvaluation['arms']['candidate'];
```

### LearningControlAction

type · `src/learning-controls.ts`

The control a [`LearningControlResult`](#learningcontrolresult) reports.

```ts signature
type LearningControlAction = LearningControlResult['action'];
```

### LearningControlResult

type · `src/learning-controls.ts`

The result of every learning control: what happened plus the resulting status.

```ts signature
type LearningControlResult = Schemas['LearningControlResponse'];
```

### LearningErrorReason

type · `src/learning-controls.ts`

Why a learning control was refused, in terms you can act on.

```ts signature
type LearningErrorReason = 'missing_consent' | 'provider_unavailable' | 'not_enabled' | 'invalid_promotion' | 'version_conflict' | 'quota_exhausted' | 'budget_exhausted' | 'not_found' | 'forbidden';
```

### LearningEvaluation

type · `src/learning-controls.ts`

One prospective randomized evaluation (`object: "learning_evaluation"`, id `lev_…`).

```ts signature
type LearningEvaluation = Schemas['LearningEvaluation'];
```

### LearningEvaluationDecision

type · `src/learning-controls.ts`

An evaluation's decision; every decision except `promoted` keeps the incumbent.

```ts signature
type LearningEvaluationDecision = LearningEvaluation['decision'];
```

### LearningEvaluationList

type · `src/learning-controls.ts`

`GET /v1/call-types/{id}/learning/evaluations`: evaluations, newest first.

```ts signature
type LearningEvaluationList = OperationResponse<'listLearningEvaluations'>;
```

### LearningEvidence

type · `src/learning-controls.ts`

Evidence counts: recorded, verified, consumed, incorporated by the active version, backlog.

```ts signature
type LearningEvidence = LearningStatus['evidence'];
```

### LearningLesson

type · `src/learning-controls.ts`

One lesson of a learned version.

```ts signature
type LearningLesson = LearningVersionDetail['lessons'][number];
```

### LearningObjective

type · `src/learning-controls.ts`

What an evaluation must show: `success` (a higher whole-task success rate) or `cost_noninferior`
(a lower mean cost with success not worse than the declared margin).

```ts signature
type LearningObjective = LearningPromotionPolicy['objective'];
```

### LearningPromotionMode

type · `src/learning-controls.ts`

How a candidate becomes active: `evaluate` (a randomized evaluation against the incumbent under a
rule frozen when it starts), `manual` (an owner or admin promotes or rejects it) or `immediate`
(publication is activation).

```ts signature
type LearningPromotionMode = LearningPromotionPolicy['mode'];
```

### LearningPromotionPolicy

type · `src/learning-controls.ts`

The full promotion policy (as the status reports it).

```ts signature
type LearningPromotionPolicy = Schemas['LearningPromotionPolicy'];
```

### LearningReceiptCounts

type · `src/learning-controls.ts`

Outcome receipts attributed to the call type, by state.

```ts signature
type LearningReceiptCounts = LearningStatus['outcome_receipts'];
```

### LearningRollbackParams

type · `src/learning-controls.ts`

`ur.ur.learning.rollback(callTypeId, params)`: the earlier `version_id` (default: the previous one).

```ts signature
type LearningRollbackParams = OperationRequestBody<'rollbackLearning'>;
```

### LearningState

type · `src/learning-controls.ts`

The learning state: `off`, `collecting` (enabled, waiting for evidence), `learning` (a reflection
is due or an evaluation runs), `paused`, `disabled` (the kill switch), `unavailable` (consent,
provider or repeated failures), `quota_exhausted` / `budget_exhausted` (refused for resources and
retried with backoff — never silent).

```ts signature
type LearningState = LearningStatus['state'];
```

### LearningStatus

type · `src/learning-controls.ts`

`GET /v1/call-types/{id}/learning`: a call type's learning status (`object: "learning"`).

```ts signature
type LearningStatus = Schemas['LearningStatus'];
```

### LearningToolDocumentation

type · `src/learning-controls.ts`

Stored tool summaries and their content digest; original descriptions are not retained.

```ts signature
type LearningToolDocumentation = OperationResponse<'getLearningToolDocumentation'>;
```

### LearningVersion

type · `src/learning-controls.ts`

A learned version as the history reports it (`object: "learning_version"`, id `epb_…`).

```ts signature
type LearningVersion = Schemas['LearningVersion'];
```

### LearningVersionDetail

type · `src/learning-controls.ts`

`GET /v1/call-types/{id}/learning/versions/{version_id}`: one version, its lessons and provenance.

```ts signature
type LearningVersionDetail = Schemas['LearningVersionDetail'];
```

### LearningVersionList

type · `src/learning-controls.ts`

`GET /v1/call-types/{id}/learning/versions`: the version history, newest first.

```ts signature
type LearningVersionList = OperationResponse<'listLearningVersions'>;
```

### LearningVersionRef

type · `src/learning-controls.ts`

A short reference to a version inside a status (`active_version`, `latest_candidate`).

```ts signature
type LearningVersionRef = NonNullable<LearningStatus['active_version']>;
```

### LearningVersionState

type · `src/learning-controls.ts`

A version's state. Versions are immutable; only their state moves.

```ts signature
type LearningVersionState = LearningVersion['state'];
```

### ModelDetail

type · `src/resources.ts`

`models.retrieve(id)`: one logical model with every provider offer that serves it.

```ts signature
type ModelDetail = Schemas['ModelDetailResponse'];
```

### OpenAIConstructor

type · `src/openai-adapter.ts`

A minimal OpenAI-client constructor shape (the official `openai` package matches).

```ts signature
type OpenAIConstructor<T> = new (opts: {
    baseURL: string;
    apiKey: string;
    defaultHeaders?: Record<string, string>;
}) => T;
```

### OperationId

type · `src/resources.ts`

Every `operationId` in the published OpenAPI document.

```ts signature
type OperationId = keyof operations;
```

### OperationQuery

type · `src/resources.ts`

The query parameters of an operation, by `operationId` (`never` when it takes none).

```ts signature
type OperationQuery<Op extends OperationId> = operations[Op]['parameters'] extends {
    query?: infer Q;
} ? Q : never;
```

### OperationRequestBody

type · `src/resources.ts`

The JSON request body of an operation, by `operationId` (`never` when it takes none).

```ts signature
type OperationRequestBody<Op extends OperationId> = operations[Op] extends {
    requestBody: {
        content: {
            'application/json': infer B;
        };
    };
} ? B : operations[Op] extends {
    requestBody?: {
        content: {
            'application/json': infer B;
        };
    };
} ? B : never;
```

### OperationResponse

type · `src/resources.ts`

The success response body of an operation, by `operationId`.

```ts signature
type OperationResponse<Op extends OperationId> = SuccessBody<operations[Op]['responses']>;
```

### Oracle

type · `src/resources.ts`

`ur.oracles.get(id)`: an oracle, the role its current version earned, and its transport state.

```ts signature
type Oracle = OperationResponse<'getOracle'>;
```

### OracleJobClaim

type · `src/resources.ts`

Claimed pull jobs; each payload is returned exactly once.

```ts signature
type OracleJobClaim = OperationResponse<'claimOracleJobs'>;
```

### OracleQualification

type · `src/resources.ts`

An oracle qualification.

```ts signature
type OracleQualification = OperationResponse<'qualifyOracle'>;
```

### OracleRegistration

type · `src/resources.ts`

A registered oracle version.

```ts signature
type OracleRegistration = OperationResponse<'registerOracle'>;
```

### OracleRevocation

type · `src/resources.ts`

The result of `ur.oracles.revoke(id)`.

```ts signature
type OracleRevocation = OperationResponse<'revokeOracle'>;
```

### OracleTestResult

type · `src/resources.ts`

A send-test result (never graded).

```ts signature
type OracleTestResult = OperationResponse<'testOracle'>;
```

### OracleVerdictsResult

type · `src/resources.ts`

The recorded verdicts.

```ts signature
type OracleVerdictsResult = OperationResponse<'submitOracleVerdicts'>;
```

### OutcomeChannel

type · `src/outcomes.ts`

The closed outcome-channel vocabulary.

```ts signature
type OutcomeChannel = Schemas['OutcomeInput']['channel'];
```

### OutcomeEpisodeAssociation

type · `src/outcome-receipts.ts`

How an outcome relates to the request's episode: `associated` (the episode carries a verdict),
`pending` (a teaching outcome waiting for its episode to be recorded), `not_recorded` (no episode
held the request in time) or `not_applicable` (the outcome does not teach, or was not applied).

```ts signature
type OutcomeEpisodeAssociation = OutcomeReceiptEpisode['status'];
```

### OutcomeEpisodeVerdict

type · `src/outcome-receipts.ts`

What an outcome did to its episode: `recorded` (it is the verdict), `kept_earlier` (the first
verdict wins), `revised` (a `supersedes` revision before the episode was learned from) or
`revised_after_incorporation` (recorded and counted, never silently unlearned); `null` until
associated.

```ts signature
type OutcomeEpisodeVerdict = OutcomeReceiptEpisode['verdict'];
```

### OutcomeInput

type · `src/outcomes.ts`

One outcome event as SENT by the caller (server assigns provenance + learning_use).

```ts signature
type OutcomeInput = Schemas['OutcomeInput'];
```

### OutcomeReceipt

type · `src/flywheel-queue.ts`

The receipt `ur.outcomes.record` resolves to. A delivery failure never throws: `queued` means the
outcome is unknown or the event was not refused (a timeout, a cancellation, a connection failure, any
401/403/408/429/5xx answer, an answer without a well-formed gateway envelope such as an HTML error
page, or a malformed success) and the identical event stays in the store for
[`OutcomeQueue.flush`](#outcomequeue); `rejected` means the server definitively refused the EVENT
([`isDefinitiveRejection`](#isdefinitiverejection)) and it was dropped. Only a store that cannot persist
([`OutcomeStoreError`](#outcomestoreerror)) throws.

```ts signature
type OutcomeReceipt = {
    status: 'delivered';
    entryId: string;
    result: OutcomeResult;
} | {
    status: 'rejected';
    entryId: string;
    error: UltraRouterError;
} | {
    status: 'queued';
    entryId: string;
    error: UltraRouterError;
};
```

### OutcomeReceiptEpisode

type · `src/outcome-receipts.ts`

The episode association of an applied teaching outcome: `{ status, trace_id, verdict }`.

```ts signature
type OutcomeReceiptEpisode = OutcomeReceiptRecord['episode'];
```

### OutcomeReceiptList

type · `src/outcome-receipts.ts`

`GET /v1/requests/{id}/outcome-receipts`: every receipt for one request, oldest first.

```ts signature
type OutcomeReceiptList = OperationResponse<'listRequestOutcomeReceipts'>;
```

### OutcomeReceiptRecord

type · `src/outcome-receipts.ts`

One outcome receipt (`object: "outcome_receipt"`, id `ocr_…`).

```ts signature
type OutcomeReceiptRecord = OperationResponse<'getOutcomeReceipt'>;
```

### OutcomeReceiptState

type · `src/outcome-receipts.ts`

A receipt's lifecycle: `pending` until its request is recorded, then exactly one final state —
`applied` (recorded), `rejected` (refused, see `reason`), `failed` (recording kept hitting an
internal error) or `expired` (no request with this id appeared in your workspace within 15
minutes; `reason: "request_not_found"`, indistinguishable from an unknown id).

```ts signature
type OutcomeReceiptState = OutcomeReceiptRecord['status'];
```

### OutcomeReportPlan

type · `src/outcome-report.ts`

A validated report: either nothing to send, or the event and its stable identity.

```ts signature
type OutcomeReportPlan = {
    readonly send: false;
    readonly result: OutcomeNotReported;
} | {
    readonly send: true;
    readonly mapping: OutcomeVerdictMapping;
    readonly teaches: boolean;
    readonly verdict: 'pass' | 'fail';
    readonly event: OutcomeInput & {
        source_event_id: string;
    };
};
```

### OutcomeReportResult

type · `src/outcome-report.ts`

What `report` resolves to for a given source and verdict.

```ts signature
type OutcomeReportResult<S extends OutcomeSource = OutcomeSource, V extends OutcomeVerdict = OutcomeVerdict> = V extends 'unknown' ? OutcomeNotReported<S> : OutcomeReported<S>;
```

### OutcomeResult

type · `src/outcomes.ts`

One recorded outcome event's server-assigned result.

```ts signature
type OutcomeResult = Schemas['OutcomeResult'];
```

### OutcomeSender

type · `src/flywheel-queue.ts`

The transport seam: send ONE finalized event and resolve its server result, or throw.

```ts signature
type OutcomeSender = (entry: QueuedOutcome, options?: RequestOptions) => Promise<OutcomeResult>;
```

### OutcomeSource

type · `src/outcome-report.ts`

Where a verdict came from. Only `self_rating` never teaches.

```ts signature
type OutcomeSource = 'verifier' | 'business_rule' | 'webhook' | 'human_review' | 'self_rating';
```

### OutcomeTarget

type · `src/outcomes.ts`

Where a recorded outcome lands: an artifact (by id) or a request (the request
shortcut). `ur.outcomes.record` also accepts a bare artifact-id string, normalized to
`{ artifact }` (the `record(art.id, …)` signature).

```ts signature
type OutcomeTarget = {
    readonly artifact: string;
} | {
    readonly request: string;
};
```

### OutcomeTeaches

type · `src/outcome-report.ts`

`true` for every source except `self_rating`, which is a proxy that never teaches.

```ts signature
type OutcomeTeaches<S extends OutcomeSource> = S extends 'self_rating' ? false : true;
```

### OutcomeVerdict

type · `src/outcome-report.ts`

A task verdict: `pass`, `fail`, or `unknown` (nothing is sent).

```ts signature
type OutcomeVerdict = 'pass' | 'fail' | 'unknown';
```

### PendingClaim

type · `src/outcomes.ts`

A claim awaiting resolution, as listed by `GET /v1/outcomes/pending`.

```ts signature
type PendingClaim = Schemas['PendingClaim'];
```

### PendingClaimsResponse

type · `src/outcomes.ts`

`GET /v1/outcomes/pending` response — keyset-paginated pending/overdue claims.

```ts signature
type PendingClaimsResponse = Schemas['PendingClaimsResponse'];
```

### PreflightCacheDecision

type · `src/preflight.ts`

The cache decision for a preflight call. Pure — [`decidePreflightCache`](#decidepreflightcache) derives it.

```ts signature
type PreflightCacheDecision = {
    readonly kind: 'fresh';
} | {
    readonly kind: 'revalidate';
    readonly ifNoneMatch: string;
} | {
    readonly kind: 'fetch';
};
```

### PreflightGrant

type · `src/preflight.ts`

The exposure grant embedded in a preflight response (present when a cluster key is given).

```ts signature
type PreflightGrant = NonNullable<PreflightResponse['grant']>;
```

### PreflightKnowledge

type · `src/preflight.ts`

The learned knowledge preflight would inject, and where (`after_stable_prefix`).

```ts signature
type PreflightKnowledge = NonNullable<PreflightResponse['knowledge']>;
```

### PreflightParams

type · `src/preflight.ts`

`preflight(params)` request: a call type, an optional cluster key (`artifact_key` or `trace_id`),
optional budget hints, and the optional `messages` a per-request case module is rendered for.
`messages` takes the same [`ChatMessage`](#chatmessage) objects as `chat.completions.create` (a content part
may carry provider-specific fields such as `image_url`, which the gateway accepts as sent).

```ts signature
type PreflightParams = Omit<Schemas['PreflightRequest'], 'messages'> & {
    messages?: ChatMessage[];
};
```

### PreflightPrompt

type · `src/preflight.ts`

The ACTIVE hosted prompt version a preflight returns (`{ version, template, variables, sha256 }`).

```ts signature
type PreflightPrompt = NonNullable<PreflightResponse['prompt']>;
```

### PreflightResponse

type · `src/preflight.ts`

The preflight response — routing + learned knowledge + placement + the grant.

```ts signature
type PreflightResponse = Schemas['PreflightResponse'];
```

### PreflightRouting

type · `src/preflight.ts`

The routing block (mode + recommended model + health-ordered fallbacks + why).

```ts signature
type PreflightRouting = PreflightResponse['routing'];
```

### PutLearningToolDocumentationParams

type · `src/learning-controls.ts`

Replace customer-supplied tool schemas; an empty tools array clears the stored set.

```ts signature
type PutLearningToolDocumentationParams = OperationRequestBody<'putLearningToolDocumentation'>;
```

### QualifyOracleParams

type · `src/resources.ts`

The body of `ur.oracles.qualify(id, params)`.

```ts signature
type QualifyOracleParams = OperationRequestBody<'qualifyOracle'>;
```

### ReasoningEffort

type · `src/types.ts`

A reasoning effort level.

```ts signature
type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high';
```

### RecordExperimentOutcomeParams

type · `src/resources.ts`

The body of `ur.flywheel.experiments.outcome(...)` — ids, hashes and numbers only, never a body.

```ts signature
type RecordExperimentOutcomeParams = OperationRequestBody<'recordFlywheelExperimentExecutionOutcome'>;
```

### RecordOutcomesResponse

type · `src/outcomes.ts`

`POST /v1/artifacts/:id/outcomes` response — the per-event results (202 after durable insert).

```ts signature
type RecordOutcomesResponse = Schemas['RecordOutcomesResponse'];
```

### RegisterOracleParams

type · `src/resources.ts`

The body of `ur.oracles.register(params)`.

```ts signature
type RegisterOracleParams = OperationRequestBody<'registerOracle'>;
```

### RenderPromptResult

type · `src/prompt-render.ts`

The result of [`renderHostedPromptResult`](#renderhostedpromptresult): a rendered instruction, or a NAMED missing-variable refusal.

```ts signature
type RenderPromptResult = {
    readonly ok: true;
    readonly text: string;
} | {
    readonly ok: false;
    readonly missing: readonly string[];
};
```

### RequestOutcomeResult

type · `src/outcome-receipts.ts`

The answer of `POST /v1/requests/{id}/outcomes`: the outcome result (`accepted`, `duplicate`, or
`pending` while the request has not been recorded yet) plus its durable `receipt`.

```ts signature
type RequestOutcomeResult = OperationResponse<'recordRequestOutcome'>;
```

### ResponseFormat

type · `src/types.ts`

The `response_format` request field.

```ts signature
type ResponseFormat = {
    type: 'text';
} | {
    type: 'json_object';
} | {
    type: 'json_schema';
    json_schema: Record<string, unknown>;
};
```

### ReviewerBackfill

type · `src/reviewer.ts`

A declared backfill window (progress is reported per id; completion is declared, never inferred).

```ts signature
type ReviewerBackfill = NonNullable<Schemas['ReviewerEventsRequest']['backfill']>;
```

### ReviewerDecision

type · `src/reviewer.ts`

The closed reviewer-decision vocabulary.

```ts signature
type ReviewerDecision = Schemas['ReviewerEventInput']['decision'];
```

### ReviewerEvent

type · `src/reviewer.ts`

One reviewer decision as SENT. Aliased from the generated schema: there is no `learning_use`,
`source` or `producer` field on it, which is what makes "the adapter cannot supply them" a
type-level fact rather than a promise.

```ts signature
type ReviewerEvent = Schemas['ReviewerEventInput'];
```

### ReviewerEventResult

type · `src/reviewer.ts`

The per-event verdict the server returns.

```ts signature
type ReviewerEventResult = Schemas['ReviewerEventResult'];
```

### ReviewerEventsResponse

type · `src/reviewer.ts`

`POST /v1/flywheel/reviewer/events` response — per-event verdicts + a rollup.

```ts signature
type ReviewerEventsResponse = Schemas['ReviewerEventsResponse'];
```

### ReviewerFinal

type · `src/reviewer.ts`

The optional, consented final a reviewer approved. `text` is stored only under consent.

```ts signature
type ReviewerFinal = NonNullable<ReviewerEvent['final']>;
```

### ReviewerHealth

type · `src/reviewer.ts`

`GET /v1/flywheel/reviewer/health` — the six named states + the next repair action.

```ts signature
type ReviewerHealth = Schemas['ReviewerHealthResponse'];
```

### ReviewerRepairResult

type · `src/reviewer.ts`

`POST /v1/flywheel/reviewer/repair` — the refusal before, and the verdict after re-driving.

```ts signature
type ReviewerRepairResult = Schemas['ReviewerRepairResponse'];
```

### ReviewerSender

type · `src/reviewer.ts`

The transport seam: send a signed batch and resolve the per-event verdicts.

```ts signature
type ReviewerSender = (entries: readonly QueuedReviewerEvent[], backfill: ReviewerBackfill | undefined, reviewerSystem: string | undefined, options?: RequestOptions) => Promise<ReviewerEventsResponse>;
```

### ReviewerSetup

type · `src/reviewer.ts`

`GET /v1/flywheel/reviewer/setup` — the mapping preview + the signature recipe.

```ts signature
type ReviewerSetup = Schemas['ReviewerSetupResponse'];
```

### ReviewerTestResult

type · `src/reviewer.ts`

`POST /v1/flywheel/reviewer/test` — the joined artifact + event pair from guided setup.

```ts signature
type ReviewerTestResult = Schemas['ReviewerTestResponse'];
```

### ReviewerTestScenario

type · `src/reviewer.ts`

The guided-setup scenarios.

```ts signature
type ReviewerTestScenario = NonNullable<Schemas['ReviewerTestRequest']['scenario']>;
```

### RouterMode

type · `src/types.ts`

Routing mode. `off` serves the requested model; `auto` / `candidates` engage the router.

```ts signature
type RouterMode = 'off' | 'auto' | 'candidates';
```

### SegmentHintKind

type · `src/types.ts`

The message-origin segment kinds you may label via `ur.segments`. Only `reference_context` and
`history` are eligible for lossy compression; the other labels protect a message.

```ts signature
type SegmentHintKind = 'system_instructions' | 'user_question' | 'reference_context' | 'few_shot_examples' | 'tool_results' | 'history';
```

### SelfImproveGuardrails

type · `src/types.ts`

The self-improvement guardrails of a call type.

```ts signature
type SelfImproveGuardrails = NonNullable<Schemas['CallTypeConfigBody']['self_improve_guardrails']>;
```

### SourceCheck

type · `src/resources.ts`

An issued planted-failure check (its probes are returned once).

```ts signature
type SourceCheck = OperationResponse<'issueVerdictSourceCheck'>;
```

### SourceCheckGrade

type · `src/resources.ts`

A graded planted-failure check.

```ts signature
type SourceCheckGrade = OperationResponse<'gradeVerdictSourceCheck'>;
```

### SubmitOracleVerdictsParams

type · `src/resources.ts`

The body of `ur.oracles.submitVerdicts(id, params)` (pull transport).

```ts signature
type SubmitOracleVerdictsParams = OperationRequestBody<'submitOracleVerdicts'>;
```

### SuccessBody

type · `src/resources.ts`

The JSON body of an operation's success response (`200`, `201` or `202`), or `unknown`.

```ts signature
type SuccessBody<Responses> = Responses extends {
    200: {
        content: {
            'application/json': infer B;
        };
    };
} ? B : Responses extends {
    201: {
        content: {
            'application/json': infer B;
        };
    };
} ? B : Responses extends {
    202: {
        content: {
            'application/json': infer B;
        };
    };
} ? B : unknown;
```

### TestOracleParams

type · `src/resources.ts`

The body of `ur.oracles.test(id, params)`.

```ts signature
type TestOracleParams = OperationRequestBody<'testOracle'>;
```

### UrBenchEcho

type · `src/types.ts`

The Bench capture echo on a bench-tagged response.

```ts signature
type UrBenchEcho = NonNullable<Schemas['UrResponseBlock']['bench']>;
```

### UrContextModule

type · `src/types.ts`

A pinned learned-context module reference for `ur.context_modules`.

```ts signature
type UrContextModule = NonNullable<NonNullable<Schemas['ChatCompletionsRequest']['ur']>['context_modules']>[number];
```

### UrManifest

type · `src/types.ts`

A declared context manifest on the wire: the value of `ur.manifest`, exactly the
`toWire(manifest)` shape `@ultrarouter/sdk/context` produces. It carries hashes, ranges and labels
only (never bodies); the gateway verifies every entry hash against the bytes it receives before
any transform.

```ts signature
type UrManifest = NonNullable<NonNullable<Schemas['ChatCompletionsRequest']['ur']>['manifest']>;
```

### UrManifestEntry

type · `src/types.ts`

One declared context-manifest entry: a labelled, hashed slice of the request.

```ts signature
type UrManifestEntry = UrManifest['entries'][number];
```

### UrManifestRange

type · `src/types.ts`

A declared range in the `ur.segments` coordinate system (UTF-16 code units).

```ts signature
type UrManifestRange = NonNullable<UrManifestEntry['range']>;
```

### UrVerifiedMemoryBlock

type · `src/types.ts`

Present only when the request was answered from the workspace's verified memory (no provider call).

```ts signature
type UrVerifiedMemoryBlock = NonNullable<Schemas['UrResponseBlock']['verified_memory']>;
```

### VerdictSources

type · `src/resources.ts`

`ur.flywheel.sources()`: every verdict source of the workspace and whether it counts.

```ts signature
type VerdictSources = OperationResponse<'listVerdictSources'>;
```

### VerifiedMemoryDisableResult

type · `src/resources.ts`

The result of `ur.callTypes.verifiedMemory.disable(id)` (the kill switch).

```ts signature
type VerifiedMemoryDisableResult = OperationResponse<'disableVerifiedMemory'>;
```

### VerifiedMemoryEnableResult

type · `src/resources.ts`

The result of `ur.callTypes.verifiedMemory.enable(id)`.

```ts signature
type VerifiedMemoryEnableResult = OperationResponse<'enableVerifiedMemory'>;
```

### VerifiedMemoryStatus

type · `src/resources.ts`

`ur.callTypes.verifiedMemory.get(id)`: the verified-memory setting and its live servability.

```ts signature
type VerifiedMemoryStatus = OperationResponse<'getVerifiedMemory'>;
```
