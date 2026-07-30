# Feature Specification: Governed Execution Runtime Composition

## Classification

This is a cross-spec integration and certification specification. It has no independent functional or runtime authority.

The functional requirements remain owned by:

- Spec 011 through `FR-RC-*` for governed execution, planning, scheduling, lanes, approvals, dispatch, readback, receipts, reconciliation, ledger, outbox, and performance closure;
- Spec 012 through `FR-EC-*` for the Execution Capsule, exact context, revision-bound reuse, mutation-frontier validation, and invalidation;
- Spec 013 through `FR-IE-*` for the intent/exact-operation public shell, descriptor execution metadata, consequence projection, result transport, and compatibility.

This specification owns only composition, dependency order, cross-spec invariants, certification, benchmark parity, rollout, rollback, and closeout evidence.

## Baseline

System Tool Catalog V2 was merged through PR #3260 at:

`0de0cdd6727040a2670821025c32615991cb3251`

Its list, direct lookup, read-only capability-intent discovery, and observability surfaces are baseline capabilities. The intent execution surface remains specification-only.

## Problem

The platform contains safe primitives, but multiple entry points and orchestration layers can repeat context, descriptor, policy, authority, plan, and provider-resolution work. Multi-step work can return to the model between steps, independent steps can remain serialized, and non-authoritative projections can extend the critical path.

Optimizing only one symptom—such as deferring Drive writes—would not remove the root causes. The platform needs a single composition contract that:

1. resolves one exact context;
2. compiles one governed plan;
3. selects fast or durable execution from work characteristics;
4. schedules safe dependency-ready steps;
5. validates mutable authority at the mutation frontier;
6. captures authoritative provider/readback/receipt state;
7. projects compact and full results without losing evidence;
8. preserves legacy compatibility until measured retirement.

## Composition

```text
Intent or exact operation
  -> Spec 013 descriptor and public shell
  -> Spec 012 Execution Capsule
  -> Spec 011 governance decision and plan
  -> fast lane or durable graph lane
  -> provider dispatch and same-cycle readback
  -> receipt, result, ledger, reconciliation, outbox
  -> verified projections
  -> compact or full result
```

## Cross-spec invariants

1. Catalog visibility and intent ranking never grant execution authority.
2. An Execution Capsule never grants execution authority by itself.
3. A plan cannot silently substitute Tenant, Workspace, Resource, Connection, authority path, or capability.
4. Static revision-bound reuse cannot replace dynamic mutation-frontier validation.
5. A generic route cannot hide the consequence of the selected operation.
6. Fast execution cannot weaken idempotency, durability, readback, or audit requirements.
7. Durable resume cannot replay a provider mutation.
8. Unknown outcome blocks blind retry until reconciliation.
9. Projection failure cannot rewrite confirmed provider state.
10. Compact transport cannot delete authoritative evidence.
11. Each requirement namespace has one owner.
12. No legacy path is retired without usage, parity, rollback, and separately reviewed contract evidence.
13. Performance claims are invalid unless the safety-equality vector matches or becomes stricter.

## Functional results

The composed system must provide:

- one orchestration authority across Custom GPT, Admin, Tenant, Agent, workers, and schedulers;
- one exact revision-bound execution context;
- server-side continuation until completion or a governed frontier;
- bounded DAG concurrency and serialized conflicting mutations;
- one exact plan-bound approval frontier;
- plan-derived fast and durable lanes;
- pending receipt and idempotency reservation before unsafe dispatch;
- explicit reconciliation before retry after unknown outcome;
- authoritative provider, readback, receipt, result, and outbox state;
- verified Drive, JSONL, search, analytics, and notification projections;
- compact result transport with governed full-result access;
- restart-safe status, resume, cancel, and compensation semantics;
- repository delivery through verified PR and CI handoff;
- legacy list/call compatibility during migration;
- measured acceleration without weaker guarantees.

## Non-functional requirements

- deterministic and tenant-isolated execution decisions;
- fail-closed ambiguity, collision, drift, and stale-authority handling;
- no raw secrets in capsules, plans, receipts, results, telemetry, or projections;
- bounded payloads, logs, retries, concurrency, locks, and result continuation;
- exact hashes and revisions for descriptor, context, decision, plan, approval, receipt, and result identities;
- observable stage timing, call counts, safety outcomes, and critical path;
- process-restart and transport-disconnect recovery;
- reversible percent rollout with no split-brain execution authority.

## Detailed authoritative artifacts

- owner addenda and extension manifests listed in `owner-extension-registration.md`;
- runtime topology in `architecture-and-runtime-topology.md`;
- decisions in `architecture-decisions-and-tradeoffs.md`;
- states in `domain-model-and-state-machines.md`;
- contracts in `contracts-and-schema-blueprint.md`;
- persistence in `persistence-transaction-and-outbox-model.md`;
- failures in `failure-retry-reconciliation-and-compensation.md`;
- threats in `security-and-threat-model.md`;
- measurement in `observability-slos-and-benchmark-protocol.md`;
- acceptance in `acceptance-and-certification-matrix.md`.

## Scope boundaries of this PR

This specification PR performs no runtime route activation, provider call, database write, migration apply, deployment, Production synchronization, protected-branch mutation, feature removal, authority expansion, or secret exposure.
