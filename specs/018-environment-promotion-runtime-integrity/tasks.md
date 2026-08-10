# Tasks — Spec 018

## A. Baseline and Contract Inventory
- [ ] A01 Map all runtime/deployment contracts that currently hard-code `main` for Hostinger production deployment.
- [ ] A02 Identify all direct/local Hostinger application-code write paths.
- [ ] A03 Identify existing break-glass and approval primitives that can be reused.
- [ ] A04 Map activation canonical-file assumptions and current exact paths.
- [ ] A05 Capture current branch, production SHA, runtime SHA, checkout cleanliness, activation status, and deployment readback.
- [ ] A06 Document rollback and compatibility risks.

## B. Environment Authority
- [ ] B01 Define registry/config fields for staging branch and production branch authority.
- [ ] B02 Seed `main` as staging/integration authority.
- [ ] B03 Seed `Production` as production source authority.
- [ ] B04 Update production deploy contract to resolve branch from policy instead of caller-controlled/hard-coded `main` enum.
- [ ] B05 Require exact expected `Production` SHA.
- [ ] B06 Reject arbitrary work-branch production deployment.
- [ ] B07 Add same-cycle deployment SHA readback.
- [ ] B08 Update API/OpenAPI contracts and structured errors where behavior changes.
- [ ] B09 Add tests for branch mismatch, stale SHA, and unauthorized branch deployment.

## C. Runtime Immutability
- [ ] C01 Inventory routine SSH/local filesystem write capabilities against Hostinger application paths.
- [ ] C02 Deny local application-code mutation by default.
- [ ] C03 Preserve read-only diagnostics and deployment readback.
- [ ] C04 Add runtime-integrity state separate from health/readiness.
- [ ] C05 Detect and report unapproved dirty runtime state.
- [ ] C06 Add tests proving healthy service can still report degraded runtime integrity.

## D. Break-Glass Lifecycle
- [ ] D01 Define break-glass persistence model and additive migration.
- [ ] D02 Define lifecycle states and allowed transitions.
- [ ] D03 Bind authorization to incident, principal, paths, reason, expiry, pre-change evidence, rollback, and audit identifiers.
- [ ] D04 Reject unrestricted local shell/filesystem mutation as break-glass substitute.
- [ ] D05 Record post-change hashes/readback for applied local patch.
- [ ] D06 Require runtime verification before reconciliation state.
- [ ] D07 Require governed Git representation of the fix.
- [ ] D08 Require merge/commit reachability on `main` and staging verification.
- [ ] D09 Require promotion to `Production` through normal governed promotion.
- [ ] D10 Require clean redeploy from exact `Production` SHA.
- [ ] D11 Block `CLOSED` until clean runtime readback and no unreconciled local differences remain.
- [ ] D12 Support governed rollback state and evidence.
- [ ] D13 Add expiry, replay, stale evidence, and incomplete-reconciliation tests.

## E. Canonical Resource Registry
- [ ] E01 Design additive `canonical_resource_registry` schema or approved equivalent.
- [ ] E02 Include resource key, governed pointer/path, type, load strategy, validation strategy, activation requirement, searchability, environment scope, enabled state, and revision evidence.
- [ ] E03 Seed current activation-critical canonical resources without changing behavior.
- [ ] E04 Add `runtime_critical` classification.
- [ ] E05 Add `routing_index` classification.
- [ ] E06 Add `on_demand_searchable` classification.
- [ ] E07 Change activation resolver from fixed file list to registry resolution.
- [ ] E08 Separate content loading from integrity verification.
- [ ] E09 Implement bounded on-demand lookup/retrieval for searchable resources.
- [ ] E10 Ensure optional searchable resource absence degrades only its surface unless policy marks it critical.
- [ ] E11 Add registry add/disable tests that require no activation-code change.

## F. Generated Deployment Attestation
- [ ] F01 Define attestation schema/version.
- [ ] F02 Generate from exact `Production` SHA and build/release identity.
- [ ] F03 Include canonical registry revision.
- [ ] F04 Hash only resources requiring deployment integrity validation.
- [ ] F05 Explicitly exclude secrets.
- [ ] F06 Persist or expose immutable attestation through governed readback.
- [ ] F07 Add shadow comparison against Hostinger runtime.
- [ ] F08 Add exact reason codes for missing/stale attestation and commit/hash mismatch.
- [ ] F09 Promote attestation enforcement only after parity evidence.

## G. Activation and Observability
- [ ] G01 Report provider/bootstrap readiness separately.
- [ ] G02 Report canonical-resource integrity separately.
- [ ] G03 Report runtime deployment integrity separately.
- [ ] G04 Report optional/on-demand knowledge degradation separately.
- [ ] G05 Expose staging authority SHA, production authority SHA, and deployed runtime SHA.
- [ ] G06 Expose active break-glass incidents and unreconciled changes.
- [ ] G07 Expose canonical registry revision and attestation identity.
- [ ] G08 Add explicit degraded reason codes from the specification.
- [ ] G09 Update activation documentation and dashboard mappings.

## H. Validation and Release
- [ ] H01 Add unit tests for state transitions and policy resolution.
- [ ] H02 Add integration tests for Git branch authority and SQL canonical registry resolution.
- [ ] H03 Add production-deploy dry-run tests proving `Production` authority.
- [ ] H04 Add negative tests for direct Hostinger mutation outside break glass.
- [ ] H05 Add readback/rollback tests.
- [ ] H06 Review authentication, authorization, object-level scope, replay, injection, path traversal, and secret exposure risks.
- [ ] H07 Update OpenAPI 3.1 artifacts for changed public/admin contracts.
- [ ] H08 Update affected canonicals and `AI_Agent_Knowledge_Guide.md`.
- [ ] H09 Run canonical generation after canonical edits.
- [ ] H10 Run CI and staging verification on `main`.
- [ ] H11 Run release-readiness checks before any `Production` promotion.
- [ ] H12 Promote only through governed `main` -> `Production` flow after explicit approval.

## Sequencing
Recommended implementation order: A -> B -> C/D -> E -> F/G -> H.

Implementation should be split into bounded PRs rather than one monolithic code change.
