# Tasks — Platform Resource Identity and Brand Governance

## Contract baseline

- [x] Define identity scopes and supported resolver statuses.
- [x] Define canonical identity, identifier normalization, and no-authority invariants.
- [x] Define typed relationship validation separate from grants.
- [x] Add platform identity JSON Schema.
- [x] Add Brand identity resolution JSON Schema.

## Shadow implementation

- [x] Implement deterministic identity contract helpers.
- [x] Implement Brand candidate resolver with hard/probable matching.
- [x] Implement cross-tenant candidate filtering and identity-only disclosure.
- [x] Implement relationship validation with authority separation.
- [x] Add pure Node regression tests.
- [ ] Add MariaDB read-only adapter after repository port review.
- [ ] Add shadow reconciliation report for legacy target_key rows.

## Operation and lifecycle

- [ ] Register the contract in the canonical Operation Registry from Issue #7287.
- [ ] Add revision-bound Brand lifecycle operations.
- [ ] Add claim and verification evidence repository port.
- [ ] Add alias-cycle and collision reconciliation.
- [ ] Add REST/GPT/MCP projections after operation contract integration.

## Readiness and rollout

- [ ] Add staging parity evidence.
- [ ] Add migration dry-run and rollback evidence.
- [ ] Obtain separate authorization before migration Apply.
- [ ] Obtain separate Production approval and exact runtime readback.
- [ ] Complete post-merge audit and update portfolio completion evidence.
