# Governed Execution Runtime Composition Integration Kit

## Classification

This package coordinates Specs 011, 012, and 013. It is not a fourth functional Spec and has no independent runtime authority.

```json
{
  "package_type": "cross_spec_integration_kit",
  "runtime_authority": false,
  "functional_authority": false,
  "status": "in_progress"
}
```

Its responsibilities are limited to:

- cross-spec ownership and interface compatibility;
- dependency and implementation order;
- shadow comparison and safety-equivalence evidence;
- certification and performance gates;
- rollout, migration, compatibility, rollback, and closeout coordination.

## Current baseline

System Tool Catalog V2 is merged and is no longer a stacked dependency:

- PR: `#3260`;
- reviewed head: `cc0d3f385427a3ad9396e8293587aa3cdfdfdc43`;
- merge SHA on `main`: `0de0cdd6727040a2670821025c32615991cb3251`.

The baseline exposes principal-scoped catalog list, direct descriptor lookup, read-only capability-intent discovery, and observability. The future `executeIntent`, `executeOperation`, status, result, cancel, and resume operations remain specification-only.

## Functional owners

| Owner | Authority |
|---|---|
| Spec 011 — Durable Governed Execution and Agent Delegation | execution contract, governed plan, DAG scheduler, lanes, approvals, delegation, idempotency, locks, provider dispatch/readback, receipts, reconciliation, ledger, outbox, repository delivery, next action |
| Spec 012 — Unified Admin and Tenant Context Kernel | principal, effective subject, Tenant, Workspace, Brand, Resource, Connection, authority path, capability readiness, context hashes/revisions, pins, Execution Capsule, validation, invalidation |
| Spec 013 — System Tool Catalog V2 | principal-scoped descriptors, catalog and exact lookup, bounded intent interpretation, public execution-shell specification, compatibility, consequence projection, compact/full result transport |
| This integration kit | composition, certification, benchmark, rollout, rollback, and closeout only |

## Composition contract

```text
Intent or exact operation
  -> Spec 013 descriptor and public shell
  -> Spec 012 Execution Capsule
  -> Spec 011 governance decision and governed plan
  -> fast lane or durable graph lane
  -> provider dispatch and same-cycle readback
  -> receipt, reconciliation, execution ledger, and outbox
  -> verified projections
  -> compact or full result projection
```

Every entry point—Custom GPT, Tenant API, Admin API, Agent runtime, worker, or scheduler—is an adapter to this composition. None may reconstruct execution authority independently after a governed decision has been compiled.

## Owner extension registration

| Owner | Primary addendum | Extension manifest | Requirement namespace |
|---|---|---|---|
| Spec 011 | `../011-durable-governed-execution-and-agent-delegation/runtime-composition-performance-addendum.md` | `../011-durable-governed-execution-and-agent-delegation/runtime-composition-extension.manifest.json` | `FR-RC-001`–`FR-RC-035` |
| Spec 012 | `../012-unified-admin-tenant-context-kernel/execution-capsule-runtime-addendum.md` | `../012-unified-admin-tenant-context-kernel/execution-capsule-runtime-extension.manifest.json` | `FR-EC-001`–`FR-EC-026` |
| Spec 013 | `../013-system-tool-catalog-v2/intent-execution-surface-addendum.md` | `../013-system-tool-catalog-v2/intent-execution-surface-extension.manifest.json` | `FR-IE-001`–`FR-IE-028` |

Owner manifests:

- `../011-durable-governed-execution-and-agent-delegation/manifest.json`;
- `../012-unified-admin-tenant-context-kernel/manifest.json`;
- `../013-system-tool-catalog-v2/manifest.json`.

Spec 012 registers its extension in its existing owner manifest. Spec 013 explicitly separates the merged Catalog V2 baseline from the specification-only execution surface. Spec 011 preserves its long-running phase ledger and registers this proposal through a co-located extension manifest.

## Completion-governance entrypoints

The package adopts the repository Spec Kit governance contract:

- `spec.md` — concise feature and ownership contract;
- `plan.md` — dependency-constrained implementation and rollout plan;
- `tasks.md` — X0–X9 completion-gate task index;
- `completion.json` — `in_progress` multi-PR completion state and future evidence obligations;
- `checklists/specification-readiness.md` — specification, registration, safety, and scope checklist.

`completion.json` intentionally declares future migration, production verification, and post-merge audit obligations while keeping migration apply, deployment, provider write, database write, and protected-branch authority disabled in this PR.

## Detailed package artifacts

### Architecture and ownership

- `architecture-and-runtime-topology.md` — control/data planes, components, end-to-end flows, lane algorithm, scheduler, locks, concurrency, boundaries, and flags.
- `architecture-decisions-and-tradeoffs.md` — 22 ADRs, rejected alternatives, consequences, revisit triggers, and anti-patterns.
- `domain-model-and-state-machines.md` — canonical entities, identifiers, hashes, operation/step/approval/idempotency/lock/receipt/readback/projection states, cancellation, compensation, and events.
- `owner-extension-registration.md` — owner registration, requirement namespaces, baseline/extension separation, validation, and closure rules.

### Contracts, persistence, and recovery

- `contracts-and-schema-blueprint.md` — descriptor, capsule, decision, plan, step, approval, governed input, frontier, receipt, readback, status, result, cancel, resume, error, hashing, and version contracts.
- `persistence-transaction-and-outbox-model.md` — aggregates, pre-dispatch reservation, post-readback finalization, locks, idempotency, results, outbox, JSONL/Drive projections, migration, backfill, and retention.
- `failure-retry-reconciliation-and-compensation.md` — stage-aware failures, retry matrix, unknown-outcome reconciliation, restart/disconnect recovery, cancellation, compensation, projection repair, and fault injection.

### Security, measurement, and certification

- `security-and-threat-model.md` — protected assets, actors, trust boundaries, security invariants, 24 threats, mitigations, tests, privacy, and rollout gates.
- `observability-slos-and-benchmark-protocol.md` — identifiers, timings, counts, safety metrics, SLOs, matched fixtures, controls, statistics, dashboards, and safety equality.
- `acceptance-and-certification-matrix.md` — C0–C7 contract, context, governance, scheduler, lane, idempotency, provider, cancellation, projection, API, compatibility, security, performance, migration, and human-review scenarios.

### Delivery and public surfaces

- `tasks-and-gates.md` — detailed X0–X9 tasks and gates.
- `implementation-map-and-pr-slicing.md` — repository reuse map and PR A–S scope, dependencies, no-go boundaries, CI, and review ownership.
- `rollout-migration-compatibility-and-rollback.md` — R0–R10 cohorts, expand/migrate/contract, retirement, rollback levels, and split-brain prevention.
- `openapi-and-public-execution-contract-plan.md` — execution operations, auth, completion/result modes, idempotency, consequences, errors, Custom GPT behavior, and OpenAPI rollout.
- `repository-workflow-optimization-profile.md` — inspection/preparation DAG, semantic and generator authority, approval, atomic Git mutation, PR/CI, bounded repair, merge, Production, and deployment boundaries.

### Evidence and machine-readable state

- `traceability-and-functional-results.md` — runtime evidence-to-owner mapping, functional results, acceleration targets, safety vector, and closeout requirements.
- `manifest.json` — schema v3 package index, owner and extension manifests, merged baseline, artifacts, domains, results, phases, certification, rollout, and constraints.

## Interface artifacts

### Resolved Operation Descriptor

Produced by Spec 013. It carries exact operation/version, schemas, consequence, risk, lanes, synchronous budget, durable support, idempotency, approval, readback, result projection, runtime handler, and compatibility adapter. Visibility and ranking never grant execution authority.

### Execution Capsule

Produced by Spec 012 and consumed by Spec 011. It carries the exact principal/subject/Tenant/Workspace/Brand/Resource/Connection context, hashes, revisions, expiry, and invalidation dependencies. It contains no credentials or raw provider evidence and never grants execution by itself.

### Governance Decision and Governed Plan

Produced by Spec 011 from the exact descriptor, capsule, policy, authority, capability, and request constraints. It includes immutable identities, step graph, lane, approval frontier, locks, idempotency, retries, dynamic refresh obligations, readbacks, aggregation, and next-action behavior.

### Execution Receipt and Result

Produced by Spec 011 and transported by Spec 013. It carries provider classification, mutation receipt, same-cycle readback, authoritative result hash, projections, blockers, and canonical next action.

## Cross-spec invariants

1. Catalog visibility and intent ranking never grant execution authority.
2. An Execution Capsule never grants execution authority by itself.
3. A plan cannot silently substitute Tenant, Workspace, Resource, Connection, authority path, or capability.
4. Static revision-bound reuse cannot replace dynamic mutation-frontier validation.
5. A generic route cannot conceal the consequence of the selected operation.
6. Fast execution cannot weaken durability, idempotency, readback, or audit.
7. Durable resume cannot create a second provider mutation.
8. Unknown outcome blocks blind retry until reconciliation.
9. Projection failure cannot rewrite confirmed provider state.
10. Compact transport cannot delete authoritative evidence.
11. Each requirement namespace has exactly one owner.
12. Every extension must remain registered by its owner and this integration manifest.
13. Legacy retirement requires measured usage, parity, rollback, and a separate reviewed contract.
14. Performance is accepted only when the complete safety vector is equal or stricter.

## Required functional results

- one orchestration authority across all entry points;
- one exact revision-bound execution context;
- server-side continuation until completion or a governed frontier;
- bounded DAG concurrency and serialized conflicting mutations;
- one exact plan-bound approval frontier;
- plan-derived fast and durable lanes;
- pending receipt and idempotency reservation before unsafe dispatch;
- explicit reconciliation before retry after unknown outcome;
- authoritative provider, readback, receipt, result, and outbox state;
- reconciled Drive, JSONL, search, analytics, and notification projections;
- compact results with governed full-result access;
- restart-safe status, resume, cancel, and compensation;
- repository work through verified PR and CI handoff;
- legacy list/call compatibility during migration;
- measured acceleration without weaker guarantees.

## Delivery and certification

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

Certification progresses independently from C0 Contract through C7 Production Closeout. A later phase cannot bypass an earlier safety gate because its code exists.

## Recommended reading order

### Architecture review

1. `spec.md`;
2. this README;
3. `owner-extension-registration.md`;
4. `architecture-and-runtime-topology.md`;
5. `architecture-decisions-and-tradeoffs.md`;
6. the three owner addenda;
7. `domain-model-and-state-machines.md`;
8. `security-and-threat-model.md`.

### Implementation planning

1. `plan.md`;
2. `tasks.md`;
3. `implementation-map-and-pr-slicing.md`;
4. `tasks-and-gates.md`;
5. `contracts-and-schema-blueprint.md`;
6. `persistence-transaction-and-outbox-model.md`;
7. `failure-retry-reconciliation-and-compensation.md`;
8. `rollout-migration-compatibility-and-rollback.md`.

### API, security, and performance review

1. Spec 013 intent execution addendum;
2. `openapi-and-public-execution-contract-plan.md`;
3. `security-and-threat-model.md`;
4. `observability-slos-and-benchmark-protocol.md`;
5. `acceptance-and-certification-matrix.md`;
6. `traceability-and-functional-results.md`.

## Status and boundaries

The package is `in_progress`. This PR completes the specification and owner registration, not runtime implementation.

It performs no:

- runtime route, worker, scheduler, or cutover activation;
- provider call or external send;
- database write, migration apply, or backfill;
- deployment or Production synchronization;
- protected-branch mutation;
- feature removal or authority weakening;
- secret exposure.

Implementation begins only through governed owner-Spec PRs and the X/R/C gates defined here.
