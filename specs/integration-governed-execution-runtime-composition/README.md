# Governed Execution Runtime Composition Integration Kit

## Classification

This package is a cross-spec integration and rollout kit. It is not a new functional authority and does not duplicate the requirements owned by:

- Spec 011 — durable execution, plan orchestration, delegation, receipts, reconciliation, provider readback, and execution lifecycle;
- Spec 012 — context resolution, execution capsule, exact resource and connection binding, context revision, and invalidation;
- Spec 013 — catalog, descriptor discovery, intent/exact-operation public shell, compatibility, and result projection.

The kit owns dependency order, interface compatibility, cross-spec traceability, shadow comparison, performance measurement, rollout gates, rollback, and closure evidence.

## Problem

The platform already contains most required primitives, but they were delivered in independent phases and entry points. Without an explicit composition package, implementation can accidentally create:

- a second context resolver inside an executor;
- a second workflow state machine inside the Custom GPT adapter;
- a second tool registry inside the planner;
- duplicated authorization and policy queries at each layer;
- incompatible operation, plan, and result identities;
- performance improvements that weaken readback, audit, or recovery;
- PRs that cut over one surface before its dependencies are authoritative.

## Composition contract

```text
Spec 013 Intent/Operation Surface
  -> Spec 012 Execution Capsule
  -> Spec 011 Canonical Contract and Governed Plan
  -> Spec 011 Fast or Durable Execution
  -> Spec 011 Receipt, Readback, Reconciliation, Projections
  -> Spec 013 Compact or Full Result Projection
```

## Ownership matrix

| Concern | Authoritative owner | Consumer obligations |
|---|---|---|
| principal and effective subject | Spec 012 | 011/013 pass authenticated evidence; no reconstruction |
| tenant/workspace/resource/connection | Spec 012 | 011 validates capsule; 013 never selects authority targets |
| context hash, revision, invalidation | Spec 012 | 011 binds plan/approval; 013 carries safe references |
| operation descriptor discovery | Spec 013 | 011 consumes exact descriptor/version |
| intent interpretation candidates | Spec 013 | 012 applies context constraints; 011 does not infer a different intent |
| canonical execution contract | Spec 011 | 013 submits intent/operation; 012 supplies context |
| plan, DAG, scheduler, lane | Spec 011 | 012 supplies capsule; 013 projects state |
| approval and delegation | Spec 011 | 012 invalidation can revoke dependent approval; 013 exposes frontier |
| provider dispatch and readback | Spec 011 | 013 cannot bypass; 012 target identity remains exact |
| receipt and reconciliation | Spec 011 | 013 exposes bounded references; 012 supports unknown-outcome context validation |
| compact/full result transport | Spec 013 | 011 stores authoritative result; 012 enforces projection scope |
| rollout and performance parity | this kit | all owners provide metrics and evidence |

## Interface artifacts

### Execution Capsule interface

Produced by Spec 012 and consumed by Spec 011. Required identifiers include capsule reference, context hash and revision, selected target references, authority and capability revisions, expiry, and invalidation dependencies.

### Governed Execution Input interface

Produced by Spec 011 composition from the Spec 013 descriptor and Spec 012 capsule. Includes operation key, descriptor version, plan identity and hash, governance decision, lane policy, idempotency, approval, readback, result projection, and response mode.

### Execution Receipt interface

Produced by Spec 011 and projected by Spec 013. Includes operation and step identities, provider dispatch classification, mutation receipt, same-cycle readback, authoritative result hash, projection status, blockers, and canonical next action.

## Cross-spec invariants

1. Catalog visibility never grants execution authority.
2. A capsule never grants execution authority by itself.
3. A plan cannot silently select a different context than its capsule.
4. A generic route cannot make a consequential operation non-consequential.
5. Static revision-bound reuse cannot replace dynamic mutation-boundary validation.
6. Fast execution cannot weaken durability required by the operation class.
7. Durable execution cannot create a second provider mutation on resume.
8. Projection failure cannot rewrite a confirmed provider outcome.
9. Compact responses cannot delete authoritative evidence.
10. No legacy path is retired before measured parity and rollback proof.

## Required functional results

- one Custom GPT request can initiate and follow a multi-step governed plan;
- all entry points use one context kernel and one governed dispatcher;
- repeated static resolution is removed without caching mutable authorization;
- independent steps can run concurrently while conflicting writes remain serialized;
- one exact approval covers only the compatible approved frontier;
- long operations survive transport and model-session interruption;
- provider result and same-cycle readback remain authoritative;
- Drive, JSONL, search, analytics, and notification outputs become reconciled projections;
- existing tools and clients continue to function throughout migration;
- latency and round-trip improvements are measured against identical safety outcomes.

## Non-goals

- no new provider adapter;
- no alternate context kernel;
- no alternate policy authority;
- no automatic medium/high-risk authority expansion;
- no removal of audit, readback, idempotency, reconciliation, or full-result access;
- no production cutover in the specification PR;
- no database migration apply, deployment, merge, or protected-branch mutation.
