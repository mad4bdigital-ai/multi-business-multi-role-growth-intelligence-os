# Deep Design Index

This directory extends the top-level specification with executable architectural constraints. These documents define correctness, security, consistency, and rollout expectations before implementation begins.

## Documents

- `formal-decision-model.md` — canonical authorization input, output, revision vector, and evaluation order.
- `invariants-and-state-machines.md` — non-negotiable invariants and valid state transitions.
- `threat-model.md` — trust boundaries, abuse cases, mitigations, and residual risks.
- `consistency-and-reconciliation.md` — freshness, invalidation, outbox, controller, and readback rules.
- `adapter-contract-and-certification.md` — adapter lifecycle, certification, rollout, and deterministic selection.
- `testing-and-parity-strategy.md` — unit, property, concurrency, integration, isolation, and shadow-parity tests.
- `rollout-pr-sequence.md` — small-PR implementation sequence, gates, rollback, and evidence.
- `operational-model.md` — SLOs, audit evidence, metrics, alerts, and support states.
- `api-error-catalog.md` — stable error taxonomy and status-code mapping.

## Design authority

The documents are normative for implementation planning but do not supersede platform runtime policy, authenticated scope, SQL registry authority, or the canonical repository instructions.

## Core proposition

The platform is not merely a capability registry. It is an evidence-producing authority system:

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

No later stage may silently repair, widen, or reinterpret an earlier authority decision.

## Completion rule

Implementation may not move from shadow to enforcement until:

1. every pilot has a canonical identity and typed contract;
2. legacy and adaptive decisions are compared;
3. all adaptive-allow/legacy-deny mismatches are resolved;
4. stale and replayed envelopes fail closed;
5. every mutating pilot has idempotency and readback;
6. tenant isolation tests pass;
7. adapter selection is deterministic;
8. rollback and reconciliation evidence are available.
