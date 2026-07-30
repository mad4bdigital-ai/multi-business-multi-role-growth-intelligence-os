# Implementation Map and Governed PR Slicing

## 1. Purpose

This document maps the specification to existing repository surfaces and defines a conservative multi-PR implementation order. It is a planning artifact only and does not authorize code, migration, provider, deployment, merge, or protected-branch mutation.

The guiding rule is reuse first: compose existing Context Kernel, Catalog V2, governed preflight, execution plans, Agent loop, connector execution, receipts, repository automation, outbox, response chunking, and CI surfaces rather than creating a parallel platform.

## 2. Existing runtime surfaces to reuse

### 2.1 Generic GPT and System Tool entry points

Observed responsibilities:

- principal-scoped tool listing and descriptor resolution;
- generic tool dispatch;
- governed preflight;
- response chunking and session/archive recording;
- platform endpoint tools.

Primary files to inventory before implementation:

```text
http-generic-api/routes/gptToolsRoutes.js
http-generic-api/routes/systemLayerRoutes.js
http-generic-api/systemToolCatalogV2.js
http-generic-api/openapi.yaml
http-generic-api/openapi/openapi.custom-gpt.auth-dispatcher.yaml
```

Required change direction:

- adapters call shared application services;
- no independent context/policy orchestration inside route code;
- add exact-operation/intent surfaces additively;
- preserve list/call and chunk behavior until certified migration;
- consequence metadata comes from resolved operation contract.

### 2.2 Governed preflight and policy

Primary surfaces:

```text
http-generic-api/governedExecutionPreflight.js
http-generic-api/runtimePolicyResolver.js
http-generic-api/runtimePolicyLoader.js
http-generic-api/toolCapabilityFamilyAuthorization.js
```

Required change direction:

- compile one bounded `GovernanceDecision` artifact;
- include exact policy/capability/authority revisions and decision hash;
- separate static revision-bound decisions from dynamic frontier checks;
- pass decision artifact to dispatcher rather than recomputing it in downstream layers;
- retain fail-closed behavior and exact reason codes.

### 2.3 Context Kernel

Primary surfaces:

```text
http-generic-api/contextKernel/domain/
http-generic-api/contextKernel/application/
http-generic-api/contextKernel/application/executionPlanService.js
http-generic-api/contextKernel/application/README.md
http-generic-api/contextKernel/infrastructure/
http-generic-api/contextKernel/interfaces/
```

Existing delivered capabilities to preserve:

- deterministic context resolution;
- exact candidate/resource/connection selection;
- context pin lifecycle;
- context hash/revision validation;
- execution-plan compile/validate primitives;
- unknown-outcome reconciliation ports;
- safe Tenant/Admin projections;
- shadow integration/security gates.

Required change direction:

- add `ExecutionCapsule` domain/application contract;
- implement resolve/validate ports;
- expose revision/dependency vector;
- add shadow adapter beside legacy runtime;
- connect selected reads before mutation paths;
- do not make Spec 012 own scheduler/provider execution.

### 2.4 Execution plans and workflow orchestration

Primary surfaces:

```text
http-generic-api/routes/plannerRoutes.js
http-generic-api/routes/workflowOrchestrationRoutes.js
http-generic-api/sequentialPlanOrchestrator.js
http-generic-api/test-sequential-plan-orchestrator.mjs
```

Required change direction:

- preserve current plan/step identities where compatible;
- compile immutable dependency graph and contracts;
- add ready-set scheduler beside sequential path;
- stop ordinary child-plan creation in pilot;
- add step claims, fencing, resource locks, deterministic merge;
- feature-flag by exact plan/operation;
- retain sequential fallback until parity and rollback pass.

### 2.5 Connector and provider execution

Primary surfaces:

```text
http-generic-api/connectorExecutor.js
http-generic-api/routes/workflowOrchestrationRoutes.js
provider/connection resolver modules
repository automation modules
```

Required change direction:

- split operation compilation from provider adapter dispatch;
- consume exact descriptor/capsule/governance/plan step;
- choose fast/durable lane from plan metadata, not only connector family;
- add structured dispatch classifications;
- never silently choose another connection;
- retain existing provider policy, envelope, grant, audit, and readback gates.

### 2.6 Agent loop and governance runtime

Primary surfaces:

```text
http-generic-api/agentLoopRunner.js
http-generic-api/agentGovernanceRuntime.js
http-generic-api/test-agent-governance-runtime.mjs
http-generic-api/test-supervisor-behavioral-certification.mjs
```

Required change direction:

- Agent loop becomes an adapter/consumer of governed operation plans;
- deterministic/rule-based steps continue without unnecessary LLM calls;
- LLM used only for declared interpretation/reasoning/content steps;
- delegated authority remains exact and auditable;
- planner/reviewer/executor separation preserved where required.

### 2.7 Durable job runner and workers

Primary surfaces:

```text
http-generic-api/jobRunner.js
worker lease/claim repositories
repository managed worker lifecycle modules
```

Required change direction:

- one durable operation identity;
- ready-set claim and fencing-token support;
- process restart recovery;
- external wait/status/resume/cancel;
- no duplicate mutation after lease expiry;
- integrate existing ephemeral checkout and credential-binding work where repository tasks require it.

### 2.8 Receipts, execution ledger, and reconciliation

Inventory current surfaces for:

- operation write receipts;
- repository automation receipts;
- delegation pending receipts;
- execution plans/runs/steps;
- unknown-outcome reconciliation;
- activation/other operation projections.

Required change direction:

- select one authoritative logical operation/receipt protocol;
- reuse existing tables/repositories/views where possible;
- pending receipt before unsafe dispatch;
- same-cycle readback and result hash;
- shared idempotency authority;
- no parallel receipt table for each new adapter unless domain isolation requires it.

### 2.9 Transactional outbox and archive projections

Inventory:

- existing outbox event/delivery repositories;
- session archive recording;
- Drive document projection;
- JSONL archive path;
- response chunk store;
- search/index projection.

Required change direction:

- SQL result/receipt/outbox atomic boundary;
- Drive/JSONL/search/analytics/notification as destinations;
- shadow payload/order/hash parity;
- segmented JSONL and per-ordering-key serialization;
- strong-projection opt-in retained;
- no provider replay for projection repair.

### 2.10 Repository automation

Existing reusable work includes:

- semantic/structured patching;
- atomic Git tree/commit/ref mutation;
- expected branch SHA binding;
- overlap detection;
- ephemeral checkout worker;
- short-lived repository credential binding;
- PR/CI/readback governance.

Required change direction:

- compile repository workflow as one parent governed plan;
- parallelize independent reads/blob preparation only;
- one approval frontier and atomic change-set mutation;
- durable CI/status wait;
- preserve protected-branch and merge/deploy gates.

## 3. New logical modules

Names are proposals; final naming follows repository conventions.

### Spec 012 modules

```text
contextKernel/domain/executionCapsule.js
contextKernel/application/executionCapsuleService.js
contextKernel/application/executionCapsuleValidation.js
contextKernel/application/executionCapsuleInvalidation.js
contextKernel/interfaces/executionCapsuleSchemas.js
```

Responsibilities:

- immutable model;
- canonical hash/revision vector;
- no-secret projection;
- resolve/validate ports;
- dependency invalidation.

### Spec 011 modules

```text
governedExecution/dispatchGovernedOperation.js
governedExecution/governanceDecisionCompiler.js
governedExecution/governedPlanCompiler.js
governedExecution/laneSelector.js
governedExecution/readySetScheduler.js
governedExecution/resourceLockManager.js
governedExecution/mutationFrontierValidator.js
governedExecution/executionLedgerService.js
governedExecution/reconciliationService.js
governedExecution/resultService.js
```

Do not create these if existing modules can be cleanly extended; the names describe responsibilities, not mandatory filesystem structure.

### Spec 013 modules

```text
executionSurface/resolveIntentOperation.js
executionSurface/executeOperationController.js
executionSurface/executionStatusController.js
executionSurface/executionResultController.js
executionSurface/executionContinuationController.js
executionSurface/legacyToolExecutionAdapter.js
```

## 4. PR slicing strategy

Every PR is small enough for review and has explicit no-go boundaries.

### PR A — X0 instrumentation baseline

Scope:

- stage/counter telemetry only;
- trace/correlation propagation;
- fixture/benchmark script;
- no routing or result change.

Likely touchpoints:

- GPT/System tool routes;
- connector executor;
- sequential orchestrator;
- context/policy resolver boundaries;
- session/archive timing;
- test manifest and docs.

Tests:

- telemetry schema;
- no-secret labels;
- stage total/correlation;
- legacy result unchanged.

No migrations unless an existing telemetry store cannot be reused; prefer metrics/artifacts first.

### PR B — Execution Capsule contract

Scope:

- pure domain/application model and tests;
- canonical hash/revision/dependency vector;
- no runtime authority;
- no provider call.

Tests:

- immutability;
- exact selection requirement;
- hash stability;
- invalidation matrix;
- no-secret projection;
- Tenant/Admin safe projections.

### PR C — Capsule shadow adapter

Scope:

- selected legacy read paths create shadow capsules;
- compare target/context/authority/capability decisions;
- telemetry only after legacy response where appropriate;
- no dispatch effect.

Tests:

- parity/mismatch taxonomy;
- cross-tenant block;
- failure isolation;
- no provider call.

### PR D — Descriptor execution metadata contract

Scope:

- additive catalog metadata/schema;
- descriptor/runtime/consequence parity guard;
- no new route dispatch.

Tests:

- version/snapshot hash;
- metadata required for callable descriptors;
- mismatch fail closed in shadow compiler;
- legacy catalog compatibility.

### PR E — Governed execution input shadow compiler

Scope:

- combine descriptor + capsule + existing preflight into decision/plan input;
- no provider dispatch;
- no route cutover.

Tests:

- exact hashes/revisions;
- static vs dynamic dependency classification;
- owner boundary guard;
- legacy/composed safety-vector parity.

### PR F — Unified in-process read dispatcher

Scope:

- one read-only operation;
- route adapters for Admin/Tenant/Custom GPT behind flags;
- direct application call instead of loopback;
- shared result contract.

Tests:

- identical authorization/result hash;
- zero internal HTTP hops;
- error parity;
- rollback flag.

### PR G — Ready-set scheduler domain/repository contract

Scope:

- plan graph validation;
- ready-set calculation;
- claims/leases/fencing/resource locks;
- in-memory/fake repository tests;
- no production activation.

Tests:

- model transitions;
- concurrency/serialization;
- lost claim;
- deterministic aggregation;
- cancellation.

### PR H — Scheduler read/preparation pilot

Scope:

- one non-mutating plan;
- durable state and worker path;
- sequential fallback;
- performance evidence.

No provider mutation.

### PR I — Approval frontier compiler

Scope:

- exact approval bundle and consumption protocol;
- drift matrix;
- preparation-only integration;
- no new mutation authority.

Tests:

- every binding field;
- renewal no widening;
- step consumption/replay;
- revocation/expiry.

### PR J — Ledger/outbox atomic contract

Scope:

- repository interfaces and transaction protocol;
- reuse inventory;
- migration draft only if needed;
- fake DB/fault tests;
- no live apply.

Tests:

- failure windows;
- atomic receipt/readback/result/outbox;
- idempotency;
- unknown outcome;
- tenant scope.

### PR K — Projection shadow workers

Scope:

- Drive/JSONL/search destination adapters via outbox;
- segmented JSONL contract;
- duplicate/order/hash handling;
- current synchronous path remains authoritative.

Tests:

- parity;
- outage/retry/dead-letter/reconcile;
- no provider replay;
- no-secret payload.

### PR L — Migration apply/readiness, if required

Separate governed PR/operation:

- final migration;
- engine-native dry-run;
- checksum-bound authorization;
- apply;
- ledger/schema readback;
- no runtime authority cutover in same unreviewed step.

### PR M — Fast-lane mutation pilot

Scope:

- one reversible low-risk operation;
- exact cohort/flag;
- dynamic frontier;
- receipt/readback/result;
- projection status;
- legacy rollback.

Tests:

- all unknown-outcome fault points;
- duplicate mutation zero;
- stale approval/context/SHA blocks;
- provider/readback parity;
- rollback drill.

### PR N — Durable-lane pilot

Scope:

- one long-running repository/CI/external-wait plan;
- status/resume/cancel;
- process restart;
- fast-to-durable promotion before mutation.

Tests:

- state model;
- disconnect/restart;
- no duplicate mutation;
- terminal result retrieval.

### PR O — Spec 013 schema-only execution surface

Scope:

- OpenAPI/JSON schemas and examples;
- not served or default disabled;
- consequence metadata design;
- Custom GPT operation/schema guard.

### PR P — Exact-operation route pilot

Scope:

- `executeOperation`, status, result for certified read operation;
- internal/Admin/Tenant cohort;
- compatibility adapter parity.

### PR Q — Intent execution pilot

Scope:

- bounded intent resolution;
- ambiguity/clarification;
- selected safe operations only;
- no hidden descriptor exposure;
- Custom GPT percent rollout.

### PR R — Projection critical-path cutover

Scope:

- enable async verified projections for certified cohort after shadow parity;
- strong mode retained;
- dashboards/runbook/rollback.

### PR S — Percent rollout and duplicate code retirement

Multiple small PRs:

- expand cohorts;
- remove one proven duplicate resolver/orchestrator at a time;
- verify legacy usage;
- preserve fallback;
- closeout evidence.

## 5. Dependency graph

```text
A instrumentation
  +--> B capsule contract --> C capsule shadow --------+
  +--> D descriptor metadata --------------------------+--> E shadow compiler
                                                        |
                                                        v
                                                     F read dispatcher
                                                        |
                     G scheduler contract --> H read DAG+
                                                        |
                     I approval frontier ----------------+
                                                        |
                     J ledger/outbox --> K shadow workers --> L migration if needed
                                                        |
                                                        v
                                                     M fast mutation
                                                        |
                                                     N durable pilot
                                                        |
                     O API schemas ----------------------+--> P exact operation --> Q intent
                                                        |
                                                     R projection cutover
                                                        |
                                                     S rollout/retirement
```

## 6. Branch and base management

- create each implementation branch from fresh `main` unless intentionally stacked;
- stacked PRs declare parent PR/head and contain only dependent diff;
- after parent merge, rebase/retarget and revalidate diff/CI;
- bind repository mutations to exact expected branch SHA;
- avoid long-lived branch divergence;
- cancel superseded CI and evaluate final synchronized head;
- generated artifacts follow generator authority.

## 7. Required tests and CI registration per PR

Every PR includes:

- focused deterministic tests;
- canonical test manifest registration;
- architecture/type/syntax validation;
- OpenAPI/schema generation/parity where relevant;
- no-secret and tenant-scope checks;
- generated artifact refresh where governed;
- PR description with scope/no-go/migration/security/rollback;
- final head/base readback.

Mutation/runtime PRs additionally require:

- fault injection;
- idempotency/unknown outcome;
- readback/receipt parity;
- kill switch/rollback;
- performance fixture and safety vector.

## 8. Code review ownership

### Spec 012 review focus

- context identity and selection;
- revision/invalidation correctness;
- no target substitution;
- effective subject and tenant isolation;
- no-secret capsule.

### Spec 011 review focus

- state machine and orchestration;
- governance/approval/idempotency;
- scheduler/locks/concurrency;
- provider/readback/receipt/reconciliation;
- ledger/outbox/result authority.

### Spec 013 review focus

- descriptor visibility/versioning;
- intent ambiguity;
- public schema/consequence metadata;
- compatibility adapters;
- compact/full result transport.

### Integration review focus

- interface compatibility;
- no duplicate authority;
- phase dependency/gates;
- benchmark safety equality;
- rollout/rollback evidence.

## 9. No-go combinations

Do not combine in one broad PR:

- Context Kernel runtime cutover plus mutation pilot;
- schema migration apply plus provider mutation activation;
- scheduler introduction plus broad mutation concurrency;
- async projection cutover plus legacy projection removal;
- `executeIntent` public exposure plus many uncertified operations;
- high-risk actions plus first durable pilot;
- legacy retirement plus new authority path;
- deployment/production cutover without same-cycle readback.

## 10. Completion mapping

Each merged implementation PR updates:

- owning Spec tasks/traceability/completion evidence;
- integration phase/task gate;
- exact head/base/merge SHA;
- CI run/check evidence;
- migration/deployment/readback where applicable;
- benchmark and safety-vector result;
- rollback drill result;
- remaining blockers and next slice.

The integration kit closes only after all owner Specs reflect the same final runtime authority and no orphaned integration-only requirement remains.