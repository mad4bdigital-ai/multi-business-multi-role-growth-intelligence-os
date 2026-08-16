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
- [x] Add MariaDB read-only Brand identity/reconciliation adapter after repository port review.
- [x] Add shadow reconciliation diagnostics for legacy `target_key` rows, alias collisions, identifier collisions, and link drift.
- [x] Add Asset identity adapter with content/scoped identity separated from rights and grants.
- [x] Add Provider Account identity adapter with provider-native identity separated from credential binding.
- [x] Add Brand-list dual-read for canonical `brand_id` plus legacy `target_key`/name compatibility.

## Operation and lifecycle

- [x] Register Spec 020 descriptors in the existing Canonical Business Operation Registry from Issue #7287.
- [x] Make `platformOperationGovernanceContract.js` consume the Canonical Business Operation Registry instead of redefining `brand.create`.
- [x] Register `brand.identity.resolve`, `brand.identity.reconcile`, and `brand.claim.*` as bounded shadow operations.
- [ ] Add revision-bound Brand update/archive/restore/rebrand/supersede lifecycle executors.
- [ ] Add claim and verification evidence repository port abstraction beyond the current bounded SQL library implementation.
- [ ] Add alias-cycle reconciliation in addition to collision diagnostics.
- [ ] Add REST/GPT/MCP projections for the new identity/claim operations after separate operation-surface activation approval.

## Readiness and rollout

- [x] Add OpenAPI projection readiness mapping and fail-closed coverage test without route activation.
- [x] Add dynamic OpenAPI detail-gap classification artifact and fail-closed read-only test without claiming canonical coverage.
- [x] Add comprehensive bounded gap-closure plan covering all mounted families and separating safe traceability closure from separately authorized activation.
- [ ] Regenerate canonical operation parity on the final source head and pass exact-head CI.
- [ ] Add staging parity evidence for the new shadow operations and Brand-list dual-read.
- [ ] Add migration dry-run and rollback evidence.
- [ ] Obtain separate authorization before migration Apply.
- [ ] Obtain separate Production approval and exact runtime readback.
- [ ] Complete post-merge audit and update portfolio completion evidence.

## Explicit boundaries

- No migration Apply in this PR cycle without a new authorization.
- No provider write, credential read, grant mutation, deployment, or Production mutation.
- Identity and verified relationship state never imply effective authority.
- `target_key` remains compatibility-only while `brand_id` becomes the canonical read identity.
