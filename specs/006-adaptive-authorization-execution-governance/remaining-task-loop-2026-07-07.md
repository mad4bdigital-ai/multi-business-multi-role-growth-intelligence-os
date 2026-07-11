# Remaining Task Loop — Adaptive Authorization and Execution Governance

**Feature:** `006-adaptive-authorization-execution-governance`  
**Runtime authority:** SQL primary  
**Provider mutation:** none  
**Migration execution:** none  
**Enforcement cutover:** none

## Completed through T040

T010 through T015 are complete. PR #2290 merged the decision-plane resolver and shadow metadata. PR #2322 merged the dynamic shared enforcement kernel for T020. PR #2346 merged revision-bound execution envelopes for T021. PR #2365 merged scoped approval requests and append-only decisions for T022. PR #2380 merged stale-envelope invalidation, idempotency, and concurrency controls for T023.

PR #2389 merged T030 adapter binding, certification, deterministic selection, readback contract, execution evidence, and drift classification contracts. The T030 implementation remains contract-only: it does not execute provider adapters, perform external writes, persist runtime locks, execute migrations, run pilots, or cut over enforcement.

PR #2440 merged T040 shadow pilot parity for the three canonical pilots: `activation.skills.read`, `platform.output-artifact.write`, and `content.wordpress.publish`. The T040 implementation remains shadow-only: it records bounded parity evidence, mismatch classification, and safety flags without provider mutation, external writes, migration execution, credential selection, adapter dispatch, or enforcement cutover.

## T040 shadow pilot parity evidence

The shadow pilot parity kernel is implemented in `http-generic-api/platformShadowPilotParityKernel.js` with focused tests in `http-generic-api/test-platform-shadow-pilot-parity-kernel.mjs` and documentation in `docs/platform-shadow-pilot-parity-kernel.md`.

The kernel keeps `providerApplyAllowed: false`, `externalWriteAllowed: false`, `mutationAllowed: false`, `enforcementCutover: false`, and `secretsIncluded: false` across all pilot records. Evidence stores request-shape hashes, revision-vector hashes, and required idempotency/readback/provider-binding hashes for write-like pilots without raw payloads or prompts.

## Task loop classification

| Task | Classification | Evidence | Notes |
|---|---|---|---|
| T010-T015 Decision plane | complete | resolver and shadow ledger evidence | no provider mutation |
| T020 Shared enforcement kernel | complete | dynamic resolver-derived enforcement policy | no provider mutation and no cutover |
| T021 Revision-bound envelopes | complete | platform execution envelope kernel and tests | no persistence or adapter execution yet |
| T022 Scoped approvals | complete | scoped approval request and append-only decision kernel | no approval route execution yet |
| T023 Stale/idempotency/concurrency | complete | concurrency control kernel and tests | no persistence or adapter execution yet |
| T030 Adapter bindings, certification, and drift | complete | adapter contract kernel, tests, docs, and PR #2389 merge readback | contract-only; no provider adapter execution |
| T040 Three shadow pilots | complete | shadow pilot parity kernel, tests, docs, and PR #2440 merge readback | shadow-only; no provider mutation or external write |
| T041-T043 Mismatch thresholds, canary prerequisites, and compatibility wrappers | open | mismatch review and approval thresholds remain incomplete | future work |
| T050-T053 Verification and rollout | open | closeout verification remains incomplete | future work |
| T061-T062 Closeout | open | closeout cannot run while mismatch, rollout, and audit tasks remain open | future work |

## Safety boundaries retained

- No provider mutation.
- No external write.
- No enforcement cutover.
- No migration execution.
- No new authority table.
- No secrets selected or returned.
- No raw payloads or prompts in parity evidence.
- Ambiguity remains fail-closed.
- Adapter execution remains blocked until later runtime wiring, certification, and rollout PRs.

## Current next scope

Next implementation scope is T041: classify all legacy/adaptive mismatches from the shadow pilot evidence. T041 must remain evidence and classification only unless a later explicit approval threshold task authorizes canary behavior. It must not include provider apply, external writes, migration execution, production rollout, or enforcement cutover.
