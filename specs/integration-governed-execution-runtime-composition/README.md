# Governed Execution Runtime Composition Integration Kit

## Classification

This package is a cross-spec integration, certification, performance, rollout, and closeout kit. It is not a fourth functional Spec and does not own runtime behavior.

The functional owners remain:

- **Spec 011 — Durable Governed Execution and Agent Delegation**: canonical execution contract, governed plan, DAG scheduling, lanes, approvals, delegation, idempotency, locks, provider dispatch and readback, receipts, reconciliation, ledger, outbox, repository delivery, and canonical next action.
- **Spec 012 — Unified Admin and Tenant Context Kernel**: authenticated principal, effective subject, Tenant, Workspace, Brand, Resource, Connection, authority path, capability readiness, context hash and revisions, pins, Execution Capsule, validation, and invalidation.
- **Spec 013 — System Tool Catalog V2**: principal-scoped catalog, descriptor identity and discovery, exact lookup, bounded intent interpretation, public execution-shell specification, compatibility adapters, consequential projection, and compact/full result transport.

The integration kit owns only:

- cross-spec ownership and interface compatibility;
- dependency and implementation order;
- shadow comparison and safety-equivalence evidence;
- certification and benchmark gates;
- rollout, migration, compatibility, and rollback coordination;
- cross-spec traceability and closeout evidence.

Its manifest declares:

```json
{
  "package_type": "cross_spec_integration_kit",
  "runtime_authority": false,
  "functional_authority": false
}
```

## Current baseline

System Tool Catalog V2 is no longer a pending stacked dependency:

- baseline PR: `#3260`;
- reviewed head: `cc0d3f385427a3ad9396e8293587aa3cdfdfdc43`;
- merge SHA on `main`: `0de0cdd6727040a2670821025c32615991cb3251`;
- baseline runtime state: catalog list, direct descriptor lookup, read-only capability-intent discovery, and catalog observability are merged;
- future execution state: `executeIntent`, `executeOperation`, status, result, cancel, and resume remain specification-only and have `runtime_authority=false`.

The specification branch is synchronized with this baseline and is reviewed directly against `main`.

## Problem

The repository already contains most of the required execution primitives, but they were delivered through independent routes, planners, workers, policy loaders, agent loops, and projection paths. Without a composition contract, implementation can accidentally create:

- a second context resolver inside an executor;
- a second workflow state machine inside a Custom GPT adapter;
- a second tool registry inside a planner;
- repeated authority, policy, descriptor, and connection resolution at every step;
- ordinary child-plan recursion and model-per-step coordination;
- incompatible operation, plan, approval, receipt, and result identities;
- in-process localhost HTTP loopback;
- lane selection based only on connector name;
- synchronous non-authoritative Drive or JSONL projection on the critical path;
- optimizations that weaken authorization, readback, audit, recovery, or tenant isolation;
- generic public routes that conceal the consequence of the selected mutation;
- a runtime cutover before its context, governance, persistence, or rollback dependencies are authoritative.

## Composition contract

```text
Spec 013 Intent or Exact Operation Surface
  -> Spec 012 Execution Capsule
  -> Spec 011 Governance Decision and Governed Plan
  -> Spec 011 Fast Lane or Durable Graph Lane
  -> Provider Dispatch and Same-Cycle Readback
  -> Receipt, Reconciliation, Execution Ledger, and Outbox
  -> Verified Projections
  -> Spec 013 Compact or Full Result Projection
```

Every entry point—Custom GPT, Tenant API, Admin API, Agent runtime, worker, or scheduler—is an adapter to this composition. None may reconstruct execution authority independently after a governed decision has been compiled.

## Ownership matrix

| Concern | Authoritative owner | Consumer obligations |
|---|---|---|
| principal and effective subject | Spec 012 | 011 and 013 pass authenticated evidence; no reconstruction |
| Tenant, Workspace, Brand, Resource, Connection | Spec 012 | 011 validates capsule; 013 never chooses authority targets |
| context hash, revisions, pins, invalidation | Spec 012 | 011 binds plan and approval; 013 carries safe references |
| descriptor discovery and version | Spec 013 | 011 consumes the exact visible descriptor and version |
| intent candidates | Spec 013 | 012 applies context constraints; 011 cannot infer a different intent |
| canonical execution contract | Spec 011 | 013 submits intent or exact operation; 012 supplies context |
| plan, DAG, scheduler, lane, resource locks | Spec 011 | 012 supplies capsule; 013 projects state |
| approval and delegation | Spec 011 | 012 invalidation can revoke descendants; 013 exposes the frontier |
| provider dispatch and readback | Spec 011 | 013 cannot bypass; 012 keeps the selected target exact |
| receipt, idempotency, reconciliation | Spec 011 | 013 exposes bounded references; 012 validates context identity |
| execution ledger and transactional outbox | Spec 011 | 013 transports results; 012 scopes visibility |
| compact/full result transport | Spec 013 | 011 stores authoritative result; 012 enforces projection scope |
| integration, benchmark, rollout, rollback | this kit | all owners emit evidence; no domain authority is created here |

## Owner extension registration

Each extension is attached to its functional owner through a primary addendum and a co-located extension manifest.

| Owner | Primary addendum | Extension manifest | Requirement namespace |
|---|---|---|---|
| Spec 011 | `../011-durable-governed-execution-and-agent-delegation/runtime-composition-performance-addendum.md` | `../011-durable-governed-execution-and-agent-delegation/runtime-composition-extension.manifest.json` | `FR-RC-001`–`FR-RC-035` |
| Spec 012 | `../012-unified-admin-tenant-context-kernel/execution-capsule-runtime-addendum.md` | `../012-unified-admin-tenant-context-kernel/execution-capsule-runtime-extension.manifest.json` | `FR-EC-001`–`FR-EC-026` |
| Spec 013 | `../013-system-tool-catalog-v2/intent-execution-surface-addendum.md` | `../013-system-tool-catalog-v2/intent-execution-surface-extension.manifest.json` | `FR-IE-001`–`FR-IE-028` |

Owner manifests are discoverable at:

- `../011-durable-governed-execution-and-agent-delegation/manifest.json`;
- `../012-unified-admin-tenant-context-kernel/manifest.json`;
- `../013-system-tool-catalog-v2/manifest.json`.

Spec 012 lists its extension in the existing owner manifest. Spec 013 has an owner manifest that explicitly separates the merged Catalog V2 baseline from the specification-only execution surface. Spec 011 retains its long-running implementation ledger unchanged and registers this proposal through a co-located extension manifest to avoid rewriting historical phase evidence.

See `owner-extension-registration.md` for registration and closure rules.

## Package contents

### Owner-Spec extensions

1. `runtime-composition-performance-addendum.md` under Spec 011
   - one governed dispatcher;
   - immutable compiled plans;
   - ready-set DAG scheduling;
   - bounded concurrency and resource locks;
   - fast and durable lanes;
   - exact approval frontier;
   - receipt/readback/result ledger and outbox;
   - compact result integrity;
   - performance and safety-equivalence requirements.

2. `execution-capsule-runtime-addendum.md` under Spec 012
   - immutable no-secret Execution Capsule;
   - exact selected execution context;
   - revision-bound reuse;
   - dynamic mutation-frontier validation;
   - transitive invalidation;
   - context resolve, validate, pin, and switch ports;
   - separate safe Admin and Tenant projections.

3. `intent-execution-surface-addendum.md` under Spec 013
   - `executeIntent` and `executeOperation`;
   - execution status, result, cancel, and resume contracts;
   - descriptor execution metadata;
   - completion and response modes;
   - dynamic consequential projection;
   - certified compatibility adapters;
   - public-surface rollout gates.

### Extension and owner manifests

4. `runtime-composition-extension.manifest.json` under Spec 011.
5. `execution-capsule-runtime-extension.manifest.json` under Spec 012.
6. updated Spec 012 `manifest.json` with typed extension registration.
7. `intent-execution-surface-extension.manifest.json` under Spec 013.
8. new Spec 013 `manifest.json` with merged baseline and specification-only extension separation.

### Integration architecture and decisions

9. `architecture-and-runtime-topology.md`
   - control and data planes;
   - component responsibilities;
   - end-to-end flows;
   - lane-selection and scheduler algorithms;
   - locks, concurrency, service-boundary rules, and feature flags.

10. `architecture-decisions-and-tradeoffs.md`
    - 22 ADRs;
    - considered and rejected alternatives;
    - consequences, revisit triggers, and prohibited anti-patterns.

11. `domain-model-and-state-machines.md`
    - canonical entities, identifiers, and hashes;
    - operation, step, approval, idempotency, lock, receipt, readback, projection, cancellation, and compensation states;
    - optimistic concurrency, events, and invariants.

### Contracts, persistence, and recovery

12. `contracts-and-schema-blueprint.md`
    - logical JSON contracts for descriptor, capsule, governance decision, plan, step, approval, governed input, frontier, receipt, readback, status, result, cancel, resume, and errors;
    - canonical hashing, versioning, HTTP guidance, and parity requirements.

13. `persistence-transaction-and-outbox-model.md`
    - logical persistence aggregates;
    - pre-dispatch reservation and post-readback finalization protocols;
    - idempotency and resource locks;
    - unknown-outcome handling;
    - results, outbox, segmented JSONL, Drive projection, retention, migration, and backfill.

14. `failure-retry-reconciliation-and-compensation.md`
    - stage-aware failure taxonomy;
    - bounded retry matrix;
    - unknown-outcome reconciliation;
    - restart and disconnect recovery;
    - cancellation, compensation, saga behavior, projection repair, and fault injection.

### Security, observability, and certification

15. `security-and-threat-model.md`
    - protected assets, actors, and trust boundaries;
    - security invariants;
    - 24 threats and mitigations;
    - credential containment, privacy, security metrics, tests, and rollout gates.

16. `observability-slos-and-benchmark-protocol.md`
    - correlation identifiers;
    - stage, count, safety, and outcome metrics;
    - SLO targets;
    - eight matched benchmark fixtures;
    - experimental controls, statistics, safety-equality vector, dashboards, and closeout artifacts.

17. `acceptance-and-certification-matrix.md`
    - certification levels C0 through C7;
    - contract, context, governance, scheduler, lane, idempotency, provider, cancellation, projection, API, compatibility, security, performance, migration, and human-review scenarios.

### Delivery, API, and repository workflow

18. `tasks-and-gates.md`
    - implementation phases X0 through X9;
    - exact tasks, gates, CI suites, and closeout conditions.

19. `implementation-map-and-pr-slicing.md`
    - repository modules to reuse;
    - proposed logical modules;
    - PR A through S scope, no-go boundaries, dependencies, CI, and review ownership.

20. `rollout-migration-compatibility-and-rollback.md`
    - flags and cohorts;
    - rollout R0 through R10;
    - expand/migrate/contract persistence pattern;
    - legacy certification and retirement;
    - rollback levels and split-brain prevention.

21. `openapi-and-public-execution-contract-plan.md`
    - public operations and authentication;
    - request, completion, response, idempotency, consequence, error, and result semantics;
    - Custom GPT behavior and OpenAPI rollout.

22. `repository-workflow-optimization-profile.md`
    - repository-specific governed DAG;
    - parallel inspection and preparation;
    - semantic and generator authority;
    - exact approval and atomic Git mutation;
    - PR, CI, bounded repair, merge, Production, and deployment boundaries;
    - repository benchmarks and acceptance scenarios.

### Traceability and machine-readable package

23. `owner-extension-registration.md`
    - owner and extension registration matrix;
    - requirement namespace ownership;
    - baseline/extension separation;
    - validation and closure rules.

24. `traceability-and-functional-results.md`
    - runtime evidence-to-owner mapping;
    - functional results and target acceleration bands;
    - safety-equality vector;
    - cross-spec requirement and closeout evidence.

25. `manifest.json`
    - schema version 3;
    - owner and extension manifests;
    - merged baseline dependency;
    - artifacts, coverage domains, functional results, certification levels, implementation phases, rollout mode, and constraints.

## Interface artifacts

### Resolved Operation Descriptor

Produced by Spec 013. It includes exact operation and version, input/output schemas, consequence and risk, supported lanes, synchronous budget, durable support, idempotency, approval, readback, result projection, runtime handler, and compatibility adapter. Visibility or ranking never grants execution authority.

### Execution Capsule

Produced by Spec 012 and consumed by Spec 011. It includes capsule reference, context hash and revision, exact principal/subject/Tenant/Workspace/Brand/Resource/Connection references, authority and capability revisions, expiry, and invalidation dependencies. It contains no credentials or raw provider evidence and never grants execution by itself.

### Governance Decision and Governed Plan

Produced by Spec 011 from the exact descriptor, capsule, policy, capability, authority, and request constraints. It includes immutable hashes, step graph, lane, approval frontier, locks, idempotency, retries, dynamic refresh obligations, readbacks, aggregation, and next-action behavior.

### Execution Receipt and Result

Produced by Spec 011 and transported by Spec 013. It includes operation and step identity, provider classification, mutation receipt, same-cycle readback, authoritative result hash, projection status, blockers, and canonical next action.

## Cross-spec invariants

1. Catalog visibility never grants execution authority.
2. Intent ranking never grants execution authority.
3. An Execution Capsule never grants execution authority by itself.
4. A plan cannot silently select a context different from its capsule.
5. A generic route cannot make a consequential operation non-consequential.
6. Static revision-bound reuse cannot replace dynamic mutation-frontier validation.
7. Fast execution cannot weaken required durability, idempotency, or readback.
8. Durable resume cannot create a second provider mutation.
9. Projection failure cannot rewrite a confirmed provider outcome.
10. Compact responses cannot delete authoritative evidence.
11. Unknown outcome blocks blind retry.
12. No legacy path is retired before measured parity, usage, and rollback proof.
13. No performance improvement is accepted when the safety-equality vector differs.
14. Each requirement namespace has exactly one functional owner.
15. An extension must remain registered by its owner and by the integration manifest.

## Required functional results

- one Custom GPT or API request can initiate and follow a multi-step governed plan;
- every entry point uses one context kernel and one governed dispatcher;
- static resolution work is reused only under exact revision bindings;
- dynamic authority, approval, envelope, resource, provider, and SHA evidence remains fresh at the mutation frontier;
- independent steps execute concurrently while conflicting writes remain serialized;
- one exact approval covers only compatible approved frontier steps;
- long operations survive HTTP, process, and model-session interruption;
- provider result, receipt, and same-cycle readback remain authoritative;
- Drive, JSONL, search, analytics, and notifications become reconciled projections;
- compact responses reduce continuation calls without losing full-result access;
- repository work reaches verified PR and CI handoff with fewer model/tool cycles;
- existing list/call clients remain compatible throughout migration;
- acceleration is measured only against identical or stricter safety outcomes.

## Delivery and certification

Implementation proceeds through:

```text
X0 Evidence Baseline
X1 Contract Composition Shadow
X2 Unified In-Process Read
X3 DAG Read and Preparation
X4 Approval Frontier
X5 Ledger and Projection Split
X6 Fast-Lane Mutation
X7 Durable Lane
X8 Public Execution Surface
X9 Percent Rollout and Closeout
```

Certification progresses independently from C0 Contract through C7 Production Closeout. A later phase cannot bypass an earlier safety gate merely because its code exists.

## Recommended reading order

### Architecture review

1. this README;
2. `owner-extension-registration.md`;
3. `architecture-and-runtime-topology.md`;
4. `architecture-decisions-and-tradeoffs.md`;
5. the three owner-Spec addenda;
6. `domain-model-and-state-machines.md`;
7. `security-and-threat-model.md`.

### Implementation planning

1. `implementation-map-and-pr-slicing.md`;
2. `tasks-and-gates.md`;
3. `contracts-and-schema-blueprint.md`;
4. `persistence-transaction-and-outbox-model.md`;
5. `failure-retry-reconciliation-and-compensation.md`;
6. `rollout-migration-compatibility-and-rollback.md`.

### API and Custom GPT review

1. Spec 013 intent execution addendum;
2. `openapi-and-public-execution-contract-plan.md`;
3. `contracts-and-schema-blueprint.md`;
4. `security-and-threat-model.md`;
5. `acceptance-and-certification-matrix.md`.

### Performance review

1. `traceability-and-functional-results.md`;
2. `observability-slos-and-benchmark-protocol.md`;
3. `architecture-and-runtime-topology.md`;
4. `repository-workflow-optimization-profile.md`;
5. `acceptance-and-certification-matrix.md`.

## Status and boundaries

Current package status: draft specification and implementation planning.

This PR performs no:

- runtime route serving or cutover;
- provider call or write;
- external send;
- database write, migration apply, or backfill;
- deployment;
- Production synchronization;
- protected-branch mutation;
- feature removal;
- authority weakening;
- secret exposure.

It records the already merged Catalog V2 baseline but does not claim that the intent execution surface, Execution Capsule runtime integration, graph scheduler, lanes, approval frontier, ledger split, projection workers, or public execution routes are implemented.

Implementation may begin only through the governed owner-Spec PR slices and the X/R/C gates defined by this package.
