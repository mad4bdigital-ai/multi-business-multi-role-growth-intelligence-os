# Tasks

## Branch safety

- [x] Review latest branches and open PRs.
- [x] Record file-overlap constraints.
- [x] Create a dedicated work branch from pinned `main`.
- [x] Reconcile branch drift without force.

## Implementation

- [x] Add tenant-effective dashboard action resolution.
- [x] Add fail-closed readiness classification.
- [x] Add installation-aware connector counts.
- [x] Preserve unavailable counts as null.
- [x] Derive blocked operational surfaces.
- [x] Derive authorization visibility from completeness evidence.

## Tests

- [x] Add action readiness regression coverage.
- [x] Add unknown-versus-known-zero dashboard coverage.
- [x] Add blocked completeness and awareness coverage.
- [x] Pass Syntax Check.
- [x] Pass Unit & Integration Tests.
- [x] Pass Execution Resolver Gate.
- [x] Pass Architecture Drift Detection.

## Release

- [x] Open pull request #1891.
- [x] Verify final changed-file scope.
- [x] Complete requirements and security checklists.
- [x] Confirm required checks pass on the reviewed head.
- [x] Prepare governed merge with fresh SHA validation and ancestry readback.

Post-merge evidence is recorded in PR #1891 and the governed execution log rather than by mutating the merged branch.
