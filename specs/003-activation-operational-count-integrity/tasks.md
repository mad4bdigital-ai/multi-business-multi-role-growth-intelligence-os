# Tasks

## Branch safety

- [x] Pin current `main` SHA and review open-PR overlap.
- [x] Reconcile repository drift without force or stale override.

## Implementation

- [x] Reproduce the 31 registered / 3 connected production condition.
- [x] Separate registered and operationally connected counts.
- [x] Add pending and error system counts.
- [x] Add explainable blocked-surface details.
- [x] Preserve null metrics for unavailable sources.
- [x] Add focused regression tests.

## Verification

- [x] Syntax Check passed on the reviewed head.
- [x] Architecture Drift Detection passed on the reviewed head.
- [x] Execution Resolver Gate passed on the reviewed head.
- [x] Unit & Integration Tests passed on the reviewed head.
- [x] Final changed-file scope is bounded and reviewed.
- [x] Governed merge is prepared with fresh SHA validation and ancestry readback.

Post-merge evidence is recorded in PR #1896 and the governed production verification ledger rather than by mutating the merged branch.
