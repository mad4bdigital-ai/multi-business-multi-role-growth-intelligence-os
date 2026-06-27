# Tasks: Policy-Driven Resource Surface Governance

## Implementation

- [x] T001 Define explicit exposure and requirement states.
- [x] T002 Add pure surface-policy evaluation logic.
- [x] T003 Make the live audit policy-driven.
- [x] T004 Make changed-scope CI require descriptor or explicit policy.
- [x] T005 Add migration 1025 and current-surface backfill.
- [x] T006 Resolve `runtime_unclassified` metadata deterministically.
- [x] T007 Resolve assets and approvals revisions strategy as `readback_guarded`.
- [x] T008 Add deterministic unit and regression tests.
- [x] T009 Add ADR, canonicals, and Knowledge Guide updates.
- [x] T010 Exclude explicitly classified recovery snapshots from the scoped-table primary-key finding only.
- [x] T011 Add migration 1026 to align declared archive states with the resource manifest.
- [x] T012 Resolve prior open findings only after a persisted complete zero-finding audit.

## Delivery and verification

- [x] T020 Obtain CI green status on the implementation PR.
- [ ] T021 Obtain release readiness pass.
- [x] T022 Merge the implementation PR through governed finalization.
- [x] T023 Authorize and apply migration 1025 with ledger readback.
- [ ] T024 Verify production commit parity.
- [x] T025 Run and persist the post-merge live audit.
- [ ] T026 Confirm zero unresolved policy findings.
- [ ] T027 Open and merge the final closeout PR.
