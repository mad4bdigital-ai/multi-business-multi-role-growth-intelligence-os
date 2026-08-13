# Tasks — Spec 018

## A. Baseline and Contract Inventory
- [ ] A01 Map all runtime/deployment contracts that currently hard-code `main` for Hostinger production deployment.
- [ ] A02 Identify all direct/local Hostinger application-code write paths.
- [ ] A03 Identify existing break-glass and approval primitives that can be reused.
- [ ] A04 Map activation canonical-file assumptions and current exact paths.
- [ ] A05 Capture current branch, production SHA, runtime SHA, checkout cleanliness, activation status, and deployment readback.
- [ ] A06 Document rollback and compatibility risks.

## B. Environment Authority
- [x] B01 Define registry/config fields for staging branch and production branch authority.
- [x] B02 Seed `main` as staging/integration authority.
- [x] B03 Seed `Production` as production source authority.
- [x] B04 Update production deploy contract to resolve branch from policy instead of caller-controlled/hard-coded `main` enum.
- [x] B05 Require exact expected `Production` SHA.
- [x] B06 Reject arbitrary work-branch production deployment.
- [x] B07 Add same-cycle deployment SHA readback.
- [x] B08 Update API/OpenAPI contracts and structured errors where behavior changes.
- [x] B09 Add tests for branch mismatch, stale SHA, and unauthorized branch deployment.

## C. Runtime Immutability
- [x] C01 Inventory routine SSH/local filesystem write capabilities against Hostinger application paths.
- [x] C02 Deny local application-code mutation by default.
- [x] C03 Preserve read-only diagnostics and deployment readback.
- [x] C04 Add runtime-integrity state separate from health/readiness.
- [x] C05 Detect and report unapproved dirty runtime state.
- [x] C06 Add tests proving healthy service can still report degraded runtime integrity.

## D. Break-Glass Lifecycle
- [x] D01 Define break-glass persistence model and additive migration.
- [x] D02 Define lifecycle states and allowed transitions.
- [x] D03 Bind authorization to incident, principal, paths, reason, expiry, pre-change evidence, rollback, and audit identifiers.
- [x] D04 Reject unrestricted local shell/filesystem mutation as break-glass substitute.
- [x] D05 Record post-change hashes/readback for applied local patch.
- [x] D06 Require runtime verification before reconciliation state.
- [ ] D07 Require governed Git representation of the fix.
- [ ] D08 Require merge/commit reachability on `main` and staging verification.
- [ ] D09 Require promotion to `Production` through normal governed promotion.
- [ ] D10 Require clean redeploy from exact `Production` SHA.
- [ ] D11 Block `CLOSED` until clean runtime readback and no unreconciled local differences remain.
- [ ] D12 Support governed rollback state and evidence.
- [ ] D13 Add expiry, replay, stale evidence, and incomplete-reconciliation tests.

## E. Canonical Resource Registry
- [x] E01 Design additive `canonical_resource_registry` schema or approved equivalent.
- [x] E02 Include resource key, governed pointer/path, type, load strategy, validation strategy, activation requirement, searchability, environment scope, enabled state, and revision evidence.
- [x] E03 Seed current activation-critical canonical resources without changing behavior.
- [x] E04 Add `runtime_critical` classification.
- [x] E05 Add `routing_index` classification.
- [x] E06 Add `on_demand_searchable` classification.
- [x] E07 Change activation resolver from fixed file list to registry resolution.
- [x] E08 Separate content loading from integrity verification.
- [x] E09 Implement bounded on-demand lookup/retrieval for searchable resources.
- [x] E10 Ensure optional searchable resource absence degrades only its surface unless policy marks it critical.
- [x] E11 Add registry add/disable tests that require no activation-code change.

## F. Generated Deployment Attestation
- [x] F01 Define attestation schema/version.
- [x] F02 Generate from exact `Production` SHA and build/release identity.
- [x] F03 Include canonical registry revision.
- [x] F04 Hash only resources requiring deployment integrity validation.
- [x] F05 Explicitly exclude secrets.
- [x] F06 Persist or expose immutable attestation through governed readback.
- [x] F07 Add shadow comparison against Hostinger runtime.
- [x] F08 Add exact reason codes for missing/stale attestation and commit/hash mismatch.
- [ ] F09 Promote attestation enforcement only after parity evidence.

## G. Activation and Observability
- [x] G01 Report provider/bootstrap readiness separately.
- [x] G02 Report canonical-resource integrity separately.
- [x] G03 Report runtime deployment integrity separately.
- [x] G04 Report optional/on-demand knowledge degradation separately.
- [x] G05 Expose staging authority SHA, production authority SHA, and deployed runtime SHA.
- [x] G06 Expose active break-glass incidents and unreconciled changes.
- [x] G07 Expose canonical registry revision and attestation identity.
- [x] G08 Add explicit degraded reason codes from the specification.
- [x] G09 Update activation documentation and dashboard mappings.

## H. Validation and Release
- [x] H01 Add unit tests for state transitions and policy resolution.
- [x] H02 Add integration tests for Git branch authority and SQL canonical registry resolution.
- [x] H03 Add production-deploy dry-run tests proving `Production` authority.
- [x] H04 Add negative tests for direct Hostinger mutation outside break glass.
- [x] H05 Add readback/rollback tests.
- [ ] H06 Review authentication, authorization, object-level scope, replay, injection, path traversal, and secret exposure risks.
- [x] H07 Update OpenAPI 3.1 artifacts for changed public/admin contracts.
- [x] H08 Update affected canonicals and `AI_Agent_Knowledge_Guide.md`.
- [x] H09 Run canonical generation after canonical edits.
- [ ] H10 Run CI and staging verification on `main`.
- [ ] H11 Run release-readiness checks before any `Production` promotion.
- [ ] H12 Promote only through governed `main` -> `Production` flow after explicit approval.

## Sequencing
Recommended implementation order: A -> B -> C/D -> E -> F/G -> H.

Implementation should be split into bounded PRs rather than one monolithic code change.
