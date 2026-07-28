# Tasks

## Core implementation

- [x] Implement principal-scoped descriptor normalization and stable ordering.
- [x] Implement catalog versions and snapshot-bound cursor pagination.
- [x] Implement direct descriptor lookup without page scanning.
- [x] Implement read-only intent-to-capability resolution.
- [x] Implement descriptor/runtime parity and no-secret observability.
- [x] Wire read-only System Layer list, lookup, resolution, and observability routes.
- [x] Preserve bounded legacy list aliases and transitional numeric cursors.
- [x] Add 250-tool unit coverage and HTTP integration coverage.
- [x] Add OpenAPI 3.1, ADR, compatibility, and rollout documentation.

## Verification and closeout

- [ ] Pass Syntax Check.
- [ ] Pass Architecture Drift Detection.
- [ ] Pass Execution Resolver Gate.
- [ ] Pass Unit & Integration Tests.
- [ ] Reconcile the work branch with the latest `main` without force.
- [ ] Re-run CI on the reconciled head.
- [ ] Record final CI and release-readiness evidence in `completion.json`.
