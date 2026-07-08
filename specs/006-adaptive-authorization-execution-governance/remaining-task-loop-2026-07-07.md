# Remaining Task Loop — Adaptive Authorization and Execution Governance

**Feature:** `006-adaptive-authorization-execution-governance`  
**Runtime authority:** SQL primary  
**Provider mutation:** none  
**Migration execution:** none  
**Enforcement cutover:** none

## Completed through T022

T010 through T015 are complete. PR #2290 merged the decision-plane resolver and shadow metadata. PR #2322 merged the dynamic shared enforcement kernel for T020. PR #2346 merged revision-bound execution envelopes for T021.

T022 adds the platform scoped approval kernel. It creates scoped approval requests and append-only decision logs while remaining non-executing and non-persistent.

## T022 scoped approval evidence

The kernel is implemented in `http-generic-api/platformScopedApprovalKernel.js` with tests in `http-generic-api/test-platform-scoped-approval-kernel.mjs`.

It binds approval requests to execution envelope id, execution envelope manifest hash, request scope hash, requested permissions, issued/expiry timestamps, and no-provider-apply boundaries.

Decision records are hash-chained with sequence numbers, previous decision hash, request manifest hash, approver identity, and decision note hash. Validation fails closed if a previous decision is tampered with or if a terminal decision is already present.

## Task loop classification

| Task | Classification | Evidence | Notes |
|---|---|---|---|
| T010-T015 Decision plane | complete | resolver and shadow ledger evidence | no provider mutation |
| T020 Shared enforcement kernel | complete | dynamic resolver-derived enforcement policy | no provider mutation and no cutover |
| T021 Revision-bound envelopes | complete | platform execution envelope kernel and tests | no persistence or adapter execution yet |
| T022 Scoped approvals | complete | scoped approval request and append-only decision kernel | no persistence or approval routes yet |
| T023 Stale-envelope invalidation and concurrency | open | persistence/idempotency integration remains separate | future work |
| T030 Adapter bindings, certification and drift reconcilers | open | no provider adapter execution | future work |
| T040-T043 Pilots and migration | open | no full three-pilot parity run or migration execution | future work |
| T050-T053 Verification and rollout | open | closeout verification remains incomplete | future work |
| T061-T062 Closeout | open | closeout cannot run while stale/idempotency controls, adapters, pilots, rollout and audit remain open | future work |

## Safety boundaries retained

- No provider mutation.
- No enforcement cutover.
- No migration execution.
- No new authority table.
- No secrets selected or returned.
- Ambiguity remains fail-closed.
- Adapter execution remains blocked until T030.
