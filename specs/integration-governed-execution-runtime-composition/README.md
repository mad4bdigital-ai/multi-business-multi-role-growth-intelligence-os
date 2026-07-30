# Governed Execution Runtime Composition Integration Kit

## Classification

This package is a cross-spec integration, certification, performance, and rollout kit. It is not a new functional authority and does not duplicate the requirements owned by:

- Spec 011 — durable execution, plan orchestration, delegation, approvals, receipts, reconciliation, provider readback, repository delivery, and execution lifecycle;
- Spec 012 — principal/effective subject, context resolution, exact resource and connection binding, Execution Capsule, revisions, pins, and invalidation;
- Spec 013 — principal-scoped catalog, descriptor and intent discovery, exact-operation/intent public shell, compatibility, and compact/full result transport.

The kit owns only:

- dependency and implementation order;
- cross-spec interface compatibility;
- ownership and traceability;
- shadow and safety-vector comparison;
- benchmark protocol and target gates;
- rollout, migration, compatibility, and rollback coordination;
- cross-spec closeout evidence.

It has `runtime_authority=false` and `functional_authority=false`.

## Problem

The platform already contains most required primitives, but they were delivered in independent phases and entry points. Without an explicit composition package, implementation can accidentally create:

- a second context resolver inside an executor;
- a second workflow state machine inside the Custom GPT adapter;
- a second tool registry inside a planner;
- duplicated authorization and policy queries at each layer;
- ordinary child-plan recursion and model-per-step coordination;
- incompatible operation, plan, approval, receipt, and result identities;
- in-process localhost HTTP loopback;
- connector-name-based lane selection;
- synchronous non-authoritative Drive/JSONL projection on the critical path;
- performance improvements that weaken readback, audit, or recovery;
- public generic routes that hide the true consequence of selected mutations;
- PRs that cut over one surface before its dependencies are authoritative.

## Composition contract

```text
Spec 013 Intent / Exact Operation Surface
  -> Spec 012 Execution Capsule
  -> Spec 011 Canonical Governance and Governed Plan
  -> Spec 011 Fast or Durable Graph Execution
  -> Spec 011 Provider Dispatch, Readback, Receipt, Reconciliation, Ledger
  -> Transactional Outbox and Verified Projections
  -> Spec 013 Compact or Full Result Projection
```

## Ownership matrix

| Concern | Authoritative owner | Consumer obligations |
|---|---|---|
| principal and effective subject | Spec 012 | 011/013 pass authenticated evidence; no reconstruction |
| tenant/workspace/brand/resource/connection | Spec 012 | 011 validates capsule; 013 never selects authority targets |
| context hash, revision, pins, invalidation | Spec 012 | 011 binds plan/approval; 013 carries safe references |
| operation descriptor discovery/version | Spec 013 | 011 consumes exact descriptor/version |
| intent interpretation candidates | Spec 013 | 012 applies context constraints; 011 does not infer a different intent |
| canonical execution contract | Spec 011 | 013 submits intent/operation; 012 supplies context |
| plan, DAG, scheduler, lane, locks | Spec 011 | 012 supplies capsule; 013 projects state |
| approval and delegation | Spec 011 | 012 invalidation can revoke dependent approval; 013 exposes frontier |
| provider dispatch and readback | Spec 011 | 013 cannot bypass; 012 target remains exact |
| receipt, idempotency, reconciliation | Spec 011 | 013 exposes bounded references; 012 supports context validation |
| execution ledger and outbox | Spec 011 | 013 transports results; 012 scopes projections |
| compact/full result transport | Spec 013 | 011 stores authoritative result; 012 enforces visibility |
| integration, benchmark, rollout | this kit | all owners provide metrics/evidence; no domain authority here |

## Artifact index

### Owner-Spec extensions

1. `../011-durable-governed-execution-and-agent-delegation/runtime-composition-performance-addendum.md`
   - one dispatcher;
   - compiled plans;
   - ready-set DAG scheduling;
   - resource locks;
   - fast/durable lanes;
   - approval frontier;
   - ledger/outbox and compact result;
   - performance requirements and delivery slices.

2. `../012-unified-admin-tenant-context-kernel/execution-capsule-runtime-addendum.md`
   - immutable Execution Capsule;
   - revision-bound reuse;
   - dynamic mutation checks;
   - invalidation graph extension;
   - runtime ports and no-secret persistence/projections.

3. `../013-system-tool-catalog-v2/intent-execution-surface-addendum.md`
   - `executeIntent`, `executeOperation`, status/result/cancel/resume;
   - descriptor execution metadata;
   - completion/response modes;
   - dynamic consequential metadata;
   - compatibility and public quality gates.

### Integration architecture and decisions

4. `architecture-and-runtime-topology.md`
   - full control/data-plane topology;
   - component responsibilities;
   - lane-selection and scheduler algorithms;
   - locks, concurrency, end-to-end flows, service-boundary rules, feature flags.

5. `architecture-decisions-and-tradeoffs.md`
   - 22 explicit ADRs;
   - alternatives considered/rejected;
   - consequences and revisit triggers;
   - prohibited anti-patterns.

6. `domain-model-and-state-machines.md`
   - canonical entities/IDs/hashes;
   - operation, step, approval, idempotency, lock, receipt, readback, projection states;
   - cancellation, compensation, optimistic concurrency, events, invariants.

### Contracts and persistence

7. `contracts-and-schema-blueprint.md`
   - detailed JSON blueprints for descriptor, capsule, decision, plan, step, approval, governed input, frontier, receipt, readback, status, compact/full result, cancel/resume, errors;
   - versioning, canonical hashing, HTTP guidance, parity tests.

8. `persistence-transaction-and-outbox-model.md`
   - logical persistence aggregates and reuse rules;
   - pre-dispatch reservation and post-readback finalization transactions;
   - unknown-outcome protocol;
   - locks, idempotency, results, outbox, segmented JSONL, Drive projection;
   - migration/backfill/retention/indexing/tenant-isolation requirements.

9. `failure-retry-reconciliation-and-compensation.md`
   - failure stages and classifications;
   - retry matrix;
   - unknown-outcome reconciliation;
   - process restart, disconnect, eventual consistency;
   - cancellation, compensation, saga behavior, projection repair;
   - fault-injection suite.

### Security, observability, and certification

10. `security-and-threat-model.md`
    - assets, actors, trust boundaries, security invariants;
    - 24 concrete threats and mitigations;
    - credential, risk, privacy, security metrics, security rollout gates.

11. `observability-slos-and-benchmark-protocol.md`
    - trace/correlation model;
    - stage and count metrics;
    - safety metrics/SLOs;
    - eight benchmark fixtures;
    - experimental controls, statistics, safety equality vector, dashboards, closeout artifacts.

12. `acceptance-and-certification-matrix.md`
    - certification levels C0–C7;
    - comprehensive contract, context, governance, state, scheduler, lane, idempotency, provider, cancellation, projection, API, compatibility, security, performance, migration, and human-review scenarios.

### Delivery and API

13. `tasks-and-gates.md`
    - implementation phases X0–X9;
    - exact tasks, gates, CI suites, rollout closure.

14. `implementation-map-and-pr-slicing.md`
    - existing repository modules to reuse;
    - proposed logical modules;
    - PR A–S scope, no-go boundaries, dependency graph, CI/review ownership.

15. `rollout-migration-compatibility-and-rollback.md`
    - flags and cohorts;
    - R0–R10 rollout;
    - expand/migrate/contract persistence pattern;
    - legacy certification/retirement;
    - rollback levels and split-brain prevention.

16. `openapi-and-public-execution-contract-plan.md`
    - proposed public operations and security;
    - request/response modes and examples;
    - consequential metadata;
    - idempotency/error/result rules;
    - Custom GPT and OpenAPI rollout.

17. `repository-workflow-optimization-profile.md`
    - repository-specific governed plan;
    - parallel reads/preparation;
    - exact approval/change-set/atomic Git mutation;
    - generated artifacts/semantic patching;
    - PR/CI/bounded repair/merge/Production boundaries;
    - repository benchmark and acceptance scenarios.

### Evidence and machine-readable package

18. `traceability-and-functional-results.md`
    - runtime evidence-to-owner mapping;
    - ten functional-result definitions;
    - target acceleration bands;
    - safety equality vector;
    - cross-spec requirement and closeout evidence.

19. `manifest.json`
    - machine-readable package classification, owner Specs, artifacts, functional results, delivery mode, and constraints.

## Recommended reading order

### Architecture review

1. README
2. architecture-and-runtime-topology
3. architecture-decisions-and-tradeoffs
4. owner-Spec addenda
5. domain-model-and-state-machines
6. security-and-threat-model

### Implementation planning

1. implementation-map-and-pr-slicing
2. tasks-and-gates
3. contracts-and-schema-blueprint
4. persistence-transaction-and-outbox-model
5. failure-retry-reconciliation-and-compensation
6. rollout-migration-compatibility-and-rollback

### API/Custom GPT review

1. Spec 013 addendum
2. openapi-and-public-execution-contract-plan
3. contracts-and-schema-blueprint
4. security-and-threat-model
5. acceptance-and-certification-matrix

### Performance review

1. traceability-and-functional-results
2. observability-slos-and-benchmark-protocol
3. architecture-and-runtime-topology
4. repository-workflow-optimization-profile
5. acceptance-and-certification-matrix

## Interface artifacts

### Execution Capsule

Produced by Spec 012 and consumed by Spec 011. Includes capsule reference, context hash/revision, exact target/connection references, authority/capability revisions, expiry, and invalidation dependencies. It never grants execution by itself.

### Resolved Operation Descriptor

Produced by Spec 013. Includes exact operation/version, input/output schema, risk/consequence, lane/idempotency/approval/readback/result metadata, runtime handler, and compatibility adapter. Visibility never grants execution authority.

### Governance Decision and Governed Plan

Produced by Spec 011 from descriptor, capsule, policy/capability/authority evidence, and request constraints. Includes immutable decision/plan hashes, step graph, approval frontier, dynamic refresh obligations, lane, locks, idempotency, retries, readbacks, and result aggregation.

### Execution Receipt and Result

Produced by Spec 011 and transported by Spec 013. Includes operation/step/provider classification, mutation receipt, same-cycle readback, authoritative result hash, projection status, blockers, and canonical next action.

## Cross-spec invariants

1. Catalog visibility never grants execution authority.
2. Intent ranking never grants execution authority.
3. A capsule never grants execution authority by itself.
4. A plan cannot silently select a different context than its capsule.
5. A generic route cannot make a consequential operation non-consequential.
6. Static revision-bound reuse cannot replace dynamic mutation-frontier validation.
7. Fast execution cannot weaken required durability/readback.
8. Durable resume cannot create a second provider mutation.
9. Projection failure cannot rewrite a confirmed provider outcome.
10. Compact responses cannot delete authoritative evidence.
11. Unknown outcome blocks blind retry.
12. No legacy path is retired before measured parity, usage, and rollback proof.
13. No optimization is accepted when the safety equality vector differs.

## Required functional results

- one Custom GPT/API request initiates and follows a multi-step governed plan;
- all entry points use one context kernel and one governed dispatcher;
- repeated static resolution is removed without caching mutable authorization;
- independent steps run concurrently while conflicting writes remain serialized;
- one exact approval covers only compatible approved frontier steps;
- long operations survive transport and model-session interruption;
- provider result and same-cycle readback remain authoritative;
- Drive, JSONL, search, analytics, and notification outputs are reconciled projections;
- existing tools and clients continue throughout migration;
- compact results reduce continuation calls without feature loss;
- repository work reaches validated PR/CI handoff with fewer model/tool cycles;
- acceleration is measured only against identical safety outcomes.

## Status and boundaries

Current package status: Draft specification and integration planning.

This specification package performs no:

- provider call or write;
- external send;
- database write or migration apply;
- runtime route serving or cutover;
- deployment;
- merge;
- protected-branch mutation;
- feature removal;
- authority weakening;
- secret exposure.

Implementation proceeds only through the governed X/R phases and owner-Spec PRs.