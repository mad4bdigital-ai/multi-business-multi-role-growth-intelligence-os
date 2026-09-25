# Tasks

## Closure evaluator

- [x] Add exact-SHA closure evidence contract.
- [x] Require durable + server-derived + same-cycle evidence.
- [x] Require inspection run ID and inspection evidence hash.
- [x] Require verified all-role backup evidence.
- [x] Require all core recovery gates.
- [x] Force unknown outcome to reconciliation-only state.
- [x] Separate connector/401 and 429 attribution into non-DB degradation.
- [x] Emit deterministic closure SHA.
- [x] Keep evaluator read-only and secret-free.

## Recovery Kernel integration

- [x] Register `production_recovery_closure` R0/C0 capability.
- [x] Accept only `expected_sha` from caller.
- [x] Require server-injected evidence resolver.
- [x] Add capability to fixed Production read surfaces.
- [x] Add Production Recovery OpenAPI enum entry.
- [x] Add Recovery manifest authority metadata.

## Tests

- [x] Resolver missing fails closed.
- [x] Fully verified evidence produces recovered.
- [x] Missing backup evidence blocks recovered.
- [x] Unknown outcome cannot become recovered.
- [x] Connector/429 gaps produce degraded_non_db while core recovery remains complete.
- [ ] CI full manifest green.
- [ ] E2E governance green.
- [ ] Derived-state closure green.

## Follow-up live work

- [ ] Bind deployment-owned evidence resolver to exact current Production SHA.
- [ ] Capture verified backup evidence before mutation.
- [ ] Run fresh durable full inspection.
- [ ] Recover Governance baseline if zero-object.
- [ ] Recover runtime-persistence baseline if zero-object.
- [ ] Reconcile exact grants.
- [ ] Restore/read bootstrap ledger.
- [ ] Run ordinary migrations only after baseline proof.
- [ ] Run Admin/Device catalog functional readback.
- [ ] Run response-chunk durable smoke.
- [ ] Run Production activation readiness.
- [ ] Close connector credential binding.
- [ ] Attribute 429 source.
- [ ] Evaluate final closure.

## Durable convergence framework

- [x] Add exact-SHA deterministic recovery plan and durable run identity.
- [x] Persist run state, evidence events and idempotency receipts independently of target databases.
- [x] Sequence backup → inspection → conditional baselines → grants → catalog migration → functional readbacks → activation → connector/rate-limit → Local Manager → deployment parity.
- [x] Skip baseline rebuild when the role is not zero-object.
- [x] Require server-resolved step-bound approval before consequential/bounded mutation executors.
- [x] Forbid caller-supplied approval as execution truth.
- [x] Require mutation authority verification and same-cycle readback.
- [x] Block blind retry after unknown outcome.
- [x] Require unknown-outcome reconciliation to be readback-only.
- [x] Keep credential rebind conditional on credential-invalid and separate from 429 recovery.
- [x] Add full synthetic convergence regression suite and register it in the repository test manifest.
- [ ] Wire live durable store and governed step executors — blocked for separate Production-governed delivery.
- [ ] Bind live approval resolver to the existing Recovery approval authority — blocked for separate Production-governed delivery.
