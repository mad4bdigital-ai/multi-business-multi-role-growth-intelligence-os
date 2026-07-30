# Architecture Decisions and Trade-offs

## 1. Purpose

This document records the major architectural choices behind the composed runtime, the evidence/rationale, alternatives considered, consequences, and conditions that would justify revisiting a decision.

It prevents future implementation slices from reopening settled design questions without new evidence.

## ADR-001 — Extend Specs 011/012/013; do not create a fourth execution Feature Spec

### Decision

- Spec 011 owns durable execution, orchestration, governance, receipts, reconciliation, and provider lifecycle.
- Spec 012 owns execution context, exact target/connection, capsule, revisions, and invalidation.
- Spec 013 owns catalog, descriptor/intent public surface, compatibility, and result transport.
- This package owns integration order, parity, benchmark, rollout, and rollback only.

### Rationale

Existing Specs already contain the required functional authorities. A new unified execution Feature Spec would duplicate definitions, create conflicting task/completion states, and make ownership of context, plan, and public surface ambiguous.

### Rejected alternative

Create a new `014-unified-governed-execution-fabric` that owns everything.

### Consequences

- cross-spec traceability is mandatory;
- implementation PRs update owner Specs and integration gates;
- integration package cannot introduce independent domain state.

## ADR-002 — One application dispatcher, multiple transport adapters

### Decision

Use one internal `DispatchGovernedOperation` boundary. Custom GPT, Tenant, Admin, Agent, worker, and scheduler are adapters.

### Rationale

Route-specific dispatch duplicates context/policy resolution and audit semantics. One application boundary enables reuse of compiled evidence and consistent receipts/readbacks.

### Rejected alternatives

- keep independent route/tool/agent executors and optimize each;
- call generic HTTP routes internally to reuse behavior.

### Consequences

- routes become thin;
- shared behavior moves from middleware/routes into application services;
- transport authentication remains at edge, while execution audit/authority is inside dispatcher.

## ADR-003 — Direct in-process dispatch for in-process handlers

### Decision

Do not use localhost HTTP when caller and handler share process/deployment. Use HTTP only for a true separately deployed service boundary.

### Rationale

Loopback adds middleware, auth, parsing, serialization, timeout, and context-loss overhead without isolation benefit.

### Risks

Bypassing route middleware could lose checks/audit.

### Mitigation

Move required checks/audit into shared application boundary and prove legacy/composed safety-event parity.

## ADR-004 — Execution Capsule is immutable context evidence, not authority

### Decision

Spec 012 emits a no-secret immutable capsule with exact target and revision dependencies. It does not grant execution by itself.

### Rationale

The runtime needs a reusable exact context without caching mutable approval/envelope/provider state.

### Rejected alternatives

- re-resolve full context at every step;
- cache a broad session context containing mutable authority;
- let each executor select its own target.

### Consequences

- static resolution can be reused safely;
- dynamic mutation checks remain mandatory;
- target substitution is explicit and generally requires re-resolution/new approval.

## ADR-005 — Revision-bound reuse, not TTL-only caching

### Decision

Reuse descriptor, policy, context, authority-path projection, and capability binding only under exact revision vector. TTL may bound freshness but is not authority.

### Rationale

TTL alone can accept revoked authority or changed connection/target. Revision vectors provide precise invalidation and avoid invalidating unrelated tenants/resources.

### Rejected alternatives

- cache everything in Redis for a fixed time;
- never cache anything;
- global cache flush on any registry change.

### Consequences

- loaders/resolvers must expose revision/domain dependencies;
- invalidation event quality becomes important;
- dynamic checks remain uncached or short-lived with exact evidence.

## ADR-006 — Compile once, validate dynamically at mutation frontier

### Decision

Compile immutable descriptor/context/governance/plan artifacts once per revision set. Refresh approval, envelope, authority grant, resource/provider version, connection status, SHA, idempotency, and locks immediately before mutation as declared.

### Rationale

This removes repeated static work while preserving mutable safety facts.

### Rejected alternatives

- recompute all policy/context for every step;
- trust compiled decision for entire long session without refresh.

## ADR-007 — Parent DAG for ordinary workflow steps

### Decision

Ordinary steps execute in one parent governed plan. Child operation is used only for explicit isolation, independent lifecycle, or compensation boundaries.

### Rationale

Child-plan-per-step repeats plan/workflow/policy/connector lifecycle and fragments operation identity.

### Rejected alternatives

- recursively call existing plan dispatcher for each step;
- keep model as coordinator between steps.

### Consequences

- parent plan needs robust step claims/state;
- child operation lineage remains supported for justified isolation.

## ADR-008 — Ready-set bounded concurrency with resource locks

### Decision

Claim all safe dependency-ready steps within global/tenant/provider/resource limits. Serialize conflicting mutation lock keys.

### Rationale

One-step-per-tick underutilizes independent work. Uncontrolled parallelism risks provider conflict, duplicated mutation, and quota exhaustion.

### Rejected alternatives

- fully sequential execution;
- run all ready steps without locks/limits;
- lock by connector only.

### Consequences

- plan descriptors declare conflict domains;
- scheduler requires fencing tokens and deterministic aggregation;
- concurrency gains depend on critical path, not total step count alone.

## ADR-009 — Fast and durable lanes selected from plan

### Decision

Lane selection uses plan graph, expected latency/provider calls, external waits, approval, risk/policy, and readback obligations.

### Rationale

Connector family is not a reliable duration/durability predictor. Same connector may support a quick read and a long CI/deploy wait.

### Rejected alternatives

- all operations synchronous;
- all operations queued/durable;
- hardcode async connector list.

### Consequences

- fast path remains low overhead;
- durable path handles restart/wait/cancel/resume;
- promotion before mutation preserves operation identity.

## ADR-010 — Approval frontier after safe preparation

### Decision

Complete authorized non-mutating preparation before requesting exact plan-bound approval. One approval may cover compatible steps only.

### Rationale

Approving vague intent early causes repeated approval or overly broad authority. Approving after exact diff/plan provides better user control and fewer interruptions.

### Rejected alternatives

- approval before every internal step;
- broad session approval;
- Agent self-approval for all low-risk actions.

### Consequences

- preparation must be bounded and non-secret;
- approval invalidation matrix is comprehensive;
- mutation begins only after dynamic refresh.

## ADR-011 — SQL ledger and provider readback are authoritative; projections are outbox-driven

### Decision

Provider result, readback, receipt, result hash, and outbox event are durably recorded before normal success response. Drive/JSONL/search/analytics/notifications are verified projections.

### Rationale

Waiting on all reporting projections extends critical path and couples provider success to unrelated storage availability.

### Rejected alternatives

- remove Drive/JSONL features;
- keep synchronous projection as universal requirement;
- best-effort fire-and-forget background writes without outbox;
- create a second queue unrelated to existing outbox.

### Consequences

- projection status is user-visible;
- strong projection mode remains possible;
- outage/reconciliation runbooks required;
- provider mutation never replayed for projection repair.

## ADR-012 — Pending receipt before unsafe dispatch

### Decision

Reserve idempotency/receipt/lock before provider mutation and finalize after readback.

### Rationale

This is required to survive transport/process/database uncertainty without duplicate mutation.

### Rejected alternatives

- write receipt only after provider success;
- rely only on provider idempotency;
- retry all transient HTTP failures.

## ADR-013 — Same-cycle readback remains mandatory where declared

### Decision

Optimization does not remove readback. Completed mutation requires declared provider/repository state verification.

### Rationale

Provider acceptance is not always final state, and transport success can hide partial/stale behavior.

### Rejected alternatives

- infer success from 2xx;
- move readback entirely to asynchronous projection;
- skip readback for speed.

### Consequences

Performance gains must come from orchestration/resolution/projection improvements, not evidence removal.

## ADR-014 — Compact result by default, full result preserved

### Decision

Return summary, state, receipt/readback, changed resources, projection status, next action, and hash-bound full-result reference.

### Rationale

Large responses force extra model/client continuation calls merely to discover outcome. Full detail remains available and authorized.

### Rejected alternatives

- always return full payload;
- discard detailed result/evidence;
- expose raw storage URLs.

## ADR-015 — Exact operation before intent when known

### Decision

Clients use `executeOperation` for known canonical operations and `executeIntent` only for genuine goal interpretation.

### Rationale

Exact lookup is deterministic, independent of catalog position, cheaper, and less ambiguous.

### Rejected alternatives

- always use semantic intent;
- expose hundreds of provider tools directly to model;
- require caller to know capability/endpoint/connection internals.

## ADR-016 — Intent resolution remains discovery, not authority

### Decision

Intent candidates are limited to visible descriptors; unique match still passes through context/governance. Ambiguity performs no dispatch.

### Rationale

Semantic similarity cannot safely establish resource, capability, credential, approval, or provider authority.

## ADR-017 — Compatibility adapters are explicit and certified

### Decision

Legacy tool calls translate only through declared adapters with semantic equivalence tests. Uncertified tools remain legacy-only.

### Rationale

Silent reinterpretation could change input defaults, consequence, target, retry, or result semantics.

### Rejected alternatives

- automatically map all tool names to operations;
- remove legacy calls immediately;
- maintain two unrelated execution outcomes forever.

## ADR-018 — Structured errors and explicit unknown outcome

### Decision

All boundaries return stable structured envelopes including stage, retryability, possible mutation, reconciliation requirement, and next action.

### Rationale

HTML/untyped transient errors cause unsafe retry and poor diagnosis.

### Rejected alternatives

- treat all 5xx as retryable;
- expose raw provider/stack body;
- return generic failure without mutation classification.

## ADR-019 — LLM use is selective

### Decision

Use LLM/model for ambiguous interpretation, non-deterministic reasoning/content, bounded failure interpretation, and summarization. Deterministic systems own context, schema, policy, idempotency, retries, state transitions, and provider readback.

### Rationale

Model-per-step orchestration increases latency/cost and can produce inconsistent safety decisions.

### Rejected alternatives

- LLM decides target/authority/retries;
- remove LLM from all workflows, including genuine interpretation.

## ADR-020 — Atomic repository change set

### Decision

Repository changes use one exact tree/commit/ref update with expected SHA and readback, while independent reads/blob preparation may be parallelized.

### Rationale

Atomicity reduces corrective commits and ambiguity; preparation parallelism improves speed without concurrent ref mutation.

## ADR-021 — No big-bang cutover

### Decision

Instrumentation → shadow → reads → DAG preparation → approval → projection shadow → low-risk mutation → durable → public surface → percentages → retirement.

### Rationale

Core components are currently delivered in different maturity phases; immediate full cutover would combine too many unknowns and weaken rollback.

### Rejected alternatives

- replace all generic tool dispatch in one PR;
- enable broad mutation after specification;
- mix migration apply, runtime cutover, and provider mutation.

## ADR-022 — Performance accepted only with safety equality

### Decision

Every benchmark compares a full safety vector and identical fixtures. A faster path with weaker evidence is rejected.

### Rationale

Latency can be trivially reduced by skipping authorization, readback, audit, or projections. Those are invalid improvements.

## 2. Revisit triggers

A decision may be revisited only with evidence such as:

- provider/service boundary split changes deployment topology;
- revision events cannot be made reliable and a safer alternative is proven;
- workload shows all operations require durable execution and fast lane offers no value;
- graph scheduler complexity exceeds measured benefit for a plan class;
- projection destination requires strong synchronous guarantee by contract;
- Custom GPT/API platform constraints prevent the proposed generic/exact surface;
- existing persistence surfaces cannot safely support required invariants;
- production benchmarks contradict target assumptions;
- new regulation/security requirement changes retention/approval/readback.

Revisit requires an ADR update, owner Spec change, compatibility/rollout plan, and evidence—not an implicit implementation deviation.

## 3. Explicit anti-patterns

- a new orchestrator beside existing ones without a convergence plan;
- Redis/cache as execution authority;
- broad session envelope detached from plan/context hash;
- one child plan per ordinary workflow step;
- generic internal HTTP for same-process handlers;
- uncontrolled concurrent mutations;
- retry-all transient errors;
- completed mutation without readback;
- Drive/JSONL as primary execution truth;
- raw provider payload/result URL exposure;
- hiding mutation consequence behind generic route metadata;
- retiring list/call before usage/parity/rollback proof;
- performance claim without baseline and safety vector;
- combining first migration, first mutation, and public cutover in one PR.