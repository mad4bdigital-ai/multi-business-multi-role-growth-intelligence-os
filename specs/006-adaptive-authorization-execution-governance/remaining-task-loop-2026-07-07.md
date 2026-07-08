# Remaining Task Loop — Adaptive Authorization and Execution Governance

**Feature:** `006-adaptive-authorization-execution-governance`  
**Runtime authority:** SQL primary  
**Provider mutation:** none  
**Migration execution:** none  
**Enforcement cutover:** none

## Completed through T023

T010 through T015 are complete. PR #2290 merged the decision-plane resolver and shadow metadata. PR #2322 merged the dynamic shared enforcement kernel for T020. PR #2346 merged revision-bound execution envelopes for T021. PR #2365 merged scoped approval requests and append-only decisions for T022.

T023 adds stale-envelope invalidation, idempotency, and concurrency controls while remaining non-executing and non-persistent.

## T023 concurrency evidence

The kernel is implemented in `http-generic-api/platformExecutionConcurrencyKernel.js` with tests in `http-generic-api/test-platform-execution-concurrency-kernel.mjs`.

It binds execution readiness to execution envelope manifest hash, approval request manifest hash, approval decision log hash, idempotency key hash, stale guard hash, and concurrency token.

Validation fails closed when the execution envelope is stale, the approval request is stale, the decision log is tampered with, the latest decision is not approved, idempotency was already seen, a concurrency token is active, or provider apply/mutation/cutover boundaries are attempted.

## Task loop classification

| Task | Classification | Evidence | Notes |
|---|---|---|---|
| T010-T015 Decision plane | complete | resolver and shadow ledger evidence | no provider mutation |
| T020 Shared enforcement kernel | complete | dynamic resolver-derived enforcement policy | no provider mutation and no cutover |
| T021 Revision-bound envelopes | complete | platform execution envelope kernel and tests | no persistence or adapter execution yet |
| T022 Scoped approvals | complete | scoped approval request and append-only decision kernel | no persistence or approval routes yet |
| T023 Stale/idempotency/concurrency | complete | concurrency control kernel and tests | no persistence or adapter execution yet |
| T030 Adapter bindings, certification and drift reconcilers | open | no provider adapter execution | future work |
| T040-T043 Pilots and migration | open | no full three-pilot parity run or migration execution | future work |
| T050-T053 Verification and rollout | open | closeout verification remains incomplete | future work |
| T061-T062 Closeout | open | closeout cannot run while adapters, pilots, rollout and audit remain open | future work |

## Safety boundaries retained

- No provider mutation.
- No enforcement cutover.
- No migration execution.
- No new authority table.
- No secrets selected or returned.
- Ambiguity remains fail-closed.
- Adapter execution remains blocked until T030.
