# Deep Design Index

This directory extends the top-level specification with executable architectural constraints. These documents define correctness, security, consistency, implementation boundaries, and rollout expectations before implementation begins.

## Deep design documents

- `formal-decision-model.md` — canonical authorization input, output, revision vector, and deterministic evaluation order.
- `invariants-and-state-machines.md` — non-negotiable invariants and legal/illegal transitions.
- `threat-model.md` — trust boundaries, abuse cases, mitigations, residual risks, and security acceptance tests.
- `consistency-and-reconciliation.md` — freshness classes, revision vectors, invalidation, outbox, controllers, and readback rules.
- `adapter-contract-and-certification.md` — adapter interface, deterministic selection, certification, rollout modes, and provider error normalization.
- `testing-and-parity-strategy.md` — unit, policy, graph, property, concurrency, integration, provider, failure-injection, and shadow-parity tests.
- `rollout-pr-sequence.md` — fifteen small implementation PRs, gates, stop conditions, rollback, and database sequencing.
- `operational-model.md` — SLIs, proposed SLOs, audit events, alerts, runbooks, retention, and operational ownership.
- `api-error-catalog.md` — stable machine-readable authorization, approval, execution, adapter, and readback errors.
- `implementation-boundaries.md` — repository layer responsibilities, typed ports, transaction boundaries, queue contracts, and anti-patterns.
- `storage-and-migration-plan.md` — authority mapping, proposed physical resources, indexes, backfill, dual-read, cutover, and rollback.
- `end-to-end-flows.md` — read, internal write, external publish, revocation, replay, timeout, ambiguity, reconciliation, and compatibility flows.
- `deep-design-task-breakdown.md` — detailed engineering backlog and dependency ordering.

## Existing top-level documents

- `spec.md` — product and safety requirements.
- `adr-001-hybrid-authorization-architecture.md` — architectural decision.
- `research.md` — model alternatives and trade-offs.
- `data-model.md` — logical resource model.
- `plan.md` — phased implementation plan.
- `tasks.md` — top-level implementation backlog.
- `contracts/authorization-execution.openapi.yaml` — draft OpenAPI 3.1 contract.
- `checklists/requirements.md` — requirement acceptance checklist.
- `checklists/security.md` — security acceptance checklist.
- `completion.json` — machine-readable delivery state.
- `manifest.json` — specification metadata and risks.

## Design authority

The documents are normative for implementation planning but do not supersede platform runtime policy, authenticated scope, SQL registry authority, or canonical repository instructions.

## Core proposition

The platform is an evidence-producing authority system:

```text
Authority
  -> Decision
  -> Obligations
  -> Approval
  -> Enforcement
  -> Execution
  -> Verification
  -> Reconciliation
```

No later stage may silently repair, widen, substitute, or reinterpret an earlier authority decision.

## Non-negotiable design conclusions

1. Capability identity is provider-independent and versioned.
2. Relationships, grants, contextual policy, and approvals are separate authorities.
3. Active grants remain active when runtime approval is required.
4. Policy decision is side-effect-free.
5. Enforcement occurs again at the final execution boundary.
6. State-changing envelopes are request-bound, revision-bound, short-lived, and single-use by default.
7. Adapter selection is deterministic and certification-gated.
8. Provider acknowledgement is not verified success.
9. Readback and reconciliation are first-class architecture planes.
10. Display projections never become execution authority.
11. Shadow parity precedes enforcement.
12. Migration is additive, capability-by-capability, and cohort-by-cohort.

## Implementation entry point

The first implementation PR is limited to state semantics and operational projections:

- preserve active grant status;
- introduce `ready_requires_approval`;
- separate approval-gated active count from immediately executable count;
- correct projection filtering and source revisions;
- add regression tests;
- make no provider, enforcement, or schema-authority change.

## Completion rule

Implementation may not move from shadow to enforcement until:

1. every pilot has a canonical identity and typed contract;
2. relationship and grant authority mapping is approved;
3. legacy and adaptive decisions are compared;
4. all critical adaptive-allow/legacy-deny mismatches are resolved;
5. stale and replayed envelopes fail closed;
6. every mutating pilot has idempotency and readback;
7. tenant-isolation and sensitive-data tests pass;
8. adapter selection is deterministic and certified;
9. rollback and reconciliation evidence are available;
10. CI, release readiness, production verification, and post-merge audit obligations are satisfied for the applicable rollout stage.
