# Runtime Composition Tasks and Gates

## Phase X0 — Evidence baseline

- [ ] **X001** Instrument legacy GPT/system tool dispatch with stage durations and correlation IDs.
- [ ] **X002** Record SQL query count, provider-call count, internal HTTP hops, model/tool round trips, continuation calls, and response size.
- [ ] **X003** Select representative fixtures: single read, single mutation, 3-6 step workflow, repository PR workflow, and long-running external wait.
- [ ] **X004** Capture authority, approval, provider, readback, receipt, result-hash, projection, and recovery outcomes for every fixture.
- [ ] **X005** Publish a no-secret baseline artifact. No speed target may be claimed without this baseline.

### Gate X0

- same fixture inputs and expected functional outcomes are reproducible;
- telemetry excludes secrets, raw JWTs, credentials, and unbounded payloads;
- stage totals reconcile to total duration within declared instrumentation overhead;
- no runtime behavior change.

## Phase X1 — Contract composition shadow

- [ ] **X010** Implement the Spec 012 Execution Capsule schema and validation port in shadow mode.
- [ ] **X011** Compile Spec 013 descriptor metadata into the Spec 011 governed execution input without dispatch.
- [ ] **X012** Compare legacy context, descriptor, policy, consequence, approval, and readback decisions with the composed shadow decision.
- [ ] **X013** Emit typed mismatch classes and bounded evidence.
- [ ] **X014** Add a cross-spec contract test preventing duplicate ownership fields and incompatible identifiers.

### Gate X1

- zero unexplained authority or target mismatch;
- zero cross-tenant or connection-substitution mismatch;
- no provider call from the shadow path;
- every mismatch has an owner Spec and canonical repair target.

## Phase X2 — Unified in-process read path

- [ ] **X020** Add `DispatchGovernedOperation` application boundary for a selected read-only operation.
- [ ] **X021** Route one Admin, one Tenant, and one Custom GPT adapter through the same dispatcher under feature flags.
- [ ] **X022** Remove localhost loopback for the selected in-process handler.
- [ ] **X023** Reuse revision-bound static descriptor/policy/context evidence while retaining principal and resource checks.
- [ ] **X024** Prove legacy and composed result hashes and projections are equivalent.

### Gate X2

- zero internal HTTP hops for selected in-process operations;
- at least 20 percent lower median internal dispatch duration;
- no p95 regression above 10 percent after warm-up;
- identical authorization, tenant scope, and result hash.

## Phase X3 — DAG read and preparation pilot

- [ ] **X030** Add ready-set scheduling to one plan with independent read/preparation branches.
- [ ] **X031** Add bounded concurrency and deterministic result aggregation.
- [ ] **X032** Add resource lock keys and prove conflicting steps do not overlap.
- [ ] **X033** Stop creating a child execution plan for ordinary workflow steps in the pilot.
- [ ] **X034** Add replay, cancellation, lease-expiry, and lost-claim tests.

### Gate X3

- independent ready steps overlap in execution evidence;
- conflicting resource locks never overlap;
- final output and result hash match sequential reference execution;
- no duplicate step or provider execution after resume.

## Phase X4 — Approval frontier

- [ ] **X040** Complete non-mutating preparation and validation before requesting approval.
- [ ] **X041** Compile one approval bundle bound to plan hash, context hash, exact resources, operation set, expected versions or SHAs, limits, expiry, and readback.
- [ ] **X042** Continue approved compatible steps without returning to the model between each step.
- [ ] **X043** Add drift cases for plan, context, resource, provider, risk, cost, SHA, and readback changes.

### Gate X4

- one approval authorizes only the exact compatible frontier;
- out-of-scope or drifted step pauses before mutation;
- no approval reuse after invalidation;
- approval count decreases without reducing mutation evidence granularity.

## Phase X5 — Ledger and projection split

- [ ] **X050** Define the atomic execution-ledger commit protocol for receipt, readback, result hash, step events, idempotency, and projection event.
- [ ] **X051** Reuse the transactional outbox for Drive, JSONL, search, analytics, and notification projections.
- [ ] **X052** Dual-write shadow projections while the current synchronous projection remains authoritative for comparison.
- [ ] **X053** Add segmented JSONL projection and per-session ordered worker serialization.
- [ ] **X054** Add projection retries, dead letter, reconciliation, and strong-projection opt-in mode.

### Gate X5

- 100 percent payload/order/hash parity during the shadow window;
- provider mutation is never replayed because a projection failed;
- projection outage leaves authoritative execution state intact and visible;
- reconciliation closes all induced projection failures in fault tests.

## Phase X6 — Fast-lane mutation pilot

- [ ] **X060** Select one reversible low-risk mutation with deterministic same-cycle readback.
- [ ] **X061** Validate dynamic envelope, approval, resource version, connection, and provider state at the mutation frontier.
- [ ] **X062** Commit receipt and readback before returning compact success.
- [ ] **X063** Compare legacy and composed mutation/result hashes.
- [ ] **X064** Add transport disconnect and unknown-outcome fault injection.

### Gate X6

- zero duplicate mutations;
- zero success without same-cycle readback or explicit reconciliation state;
- at least 20 percent lower median post-provider completion duration where projection work is removed from the critical path;
- rollback returns traffic to legacy path without losing receipts or evidence.

## Phase X7 — Durable-lane pilot

- [ ] **X070** Select one long-running repository, CI, deployment-observation, or external-wait workflow.
- [ ] **X071** Return execution identity after durable acceptance and begin execution without another model call.
- [ ] **X072** Implement status, resume, cancel, approval pause, and result retrieval.
- [ ] **X073** Prove process restart and HTTP disconnect recovery.
- [ ] **X074** Preserve one operation identity through fast-to-durable promotion before mutation.

### Gate X7

- operation survives process and transport interruption;
- resume never duplicates provider mutation;
- final result and readback are available by authorized reference;
- state transitions remain valid and terminal states do not re-enter execution.

## Phase X8 — Spec 013 execution surface pilot

- [ ] **X080** Publish schema-only `executeIntent`, `executeOperation`, `getExecution`, `getExecutionResult`, `cancelExecution`, and `resumeExecution` contracts.
- [ ] **X081** Run `executeOperation` for selected read pilot.
- [ ] **X082** Run an ambiguous `executeIntent` case that performs no provider call.
- [ ] **X083** Return compact receipts with optional full-result reference.
- [ ] **X084** Add consequential metadata derived from resolved operation contracts.
- [ ] **X085** Preserve `listTools` and `callTool` compatibility adapters.

### Gate X8

- exact operations do not depend on catalog page position;
- ambiguous intent fails closed;
- compact response communicates state, mutation/readback, and next action without mandatory chunk continuation;
- legacy and new surfaces produce equivalent execution semantics for certified adapters.

## Phase X9 — Percent rollout and closure

- [ ] **X090** Enable read-only composed path for an internal cohort.
- [ ] **X091** Expand to low-risk mutation cohort after X6 certification.
- [ ] **X092** Prefer intent/exact-operation execution for Custom GPT while retaining legacy fallback.
- [ ] **X093** Monitor mismatch, latency, round-trip, duplicate mutation, readback, projection, and rollback metrics.
- [ ] **X094** Remove duplicate resolver/orchestrator code only after usage reaches the declared retirement threshold.
- [ ] **X095** Generate authoritative closeout evidence across Specs 011, 012, 013, and this integration kit.

### Gate X9

- representative 3-6 step workflow uses at least 60 percent fewer caller round trips;
- representative repository workstream uses at least 80 percent fewer Agent tool calls;
- zero increase in cross-tenant access, stale approval acceptance, duplicate mutation, unknown-outcome replay, or missing readback;
- rollback drill passes before every traffic expansion;
- legacy retirement is separately reviewed and reversible.

## Required CI suites

- cross-spec schema and identifier parity;
- context-capsule invalidation model tests;
- governed plan state-machine model tests;
- ready-set concurrency and resource-lock tests;
- approval-frontier drift matrix;
- idempotency and unknown-outcome fault injection;
- ledger/outbox/projection parity and recovery;
- legacy/new execution equivalence;
- compact/full result integrity and authorization;
- consequential metadata and OpenAPI parity;
- performance benchmark with safety-outcome equality.
