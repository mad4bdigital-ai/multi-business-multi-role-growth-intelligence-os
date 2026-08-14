# Tasks — Spec 019 Governed Database Lifecycle and Pressure Relief

## A — Spec and Contract Foundation (PR-A)

- [x] A01 Record the current lifecycle reporting/readiness baseline and explicit read-only boundary.
- [x] A02 Finalize requirements, non-goals, invariants, and acceptance criteria.
- [x] A03 Define lifecycle plan, operation, evidence, error, and readback contracts.
- [x] A04 Define the domain-adapter interface and first three domain decisions.
- [x] A05 Define exact database-table authority and typed approval bindings.
- [x] A06 Define logical-cleanup versus physical-reclaim result separation.
- [x] A07 Add threat model, security checklist, rollback rules, and test matrix.
- [x] A08 Add E2E phase contract and Work Map integration manifest.
- [x] A09 Run deterministic contract guard without production access.

## B — Read-Only Pressure Intelligence (PR-B)

- [x] B01 Implement quota/usage/data-free observation adapters with explicit unavailable states.
- [x] B02 Discover largest tables and growth velocity with bounded queries.
- [x] B03 Classify resource semantics through registered domain adapters.
- [x] B04 Resolve policy by exact resource and recipe identity.
- [x] B05 Generate deterministic candidate estimates and immutable plan fingerprints.
- [x] B06 Keep missing policy and unknown semantics blocked.
- [x] B07 Add pressure inspector and planner observability.
- [x] B08 Add unit, integration, invalid-input, and regression tests.

## C — Authority and Durable Mutation Readiness (Track B evidence slice)

- [x] C01 Define target-environment mutation-receipt and governed-migration-ledger evidence requirements without opening a live database connection.
- [x] C02 Consume and validate exact `database_table` resource authority evidence; Track B does not grant authority or replace the platform authority resolver.
- [x] C03 Bind readiness to the registered recipe allowlist and exact operation identity.
- [x] C04 Validate capability-envelope, execution-lease, typed-approval, plan-fingerprint, and expiry evidence.
- [x] C05 Require idempotency and readback-before-retry for unknown outcomes.
- [x] C06 Fail closed when durable receipt persistence or same-cycle authoritative readback is unavailable.
- [x] C07 Add negative coverage for production scope, wildcard/unknown resources, expiry, replay/unknown outcome, and authority/readback mismatch paths.

## D — Response-Chunk TTL Pilot (Track B non-production dry-run/rehearsal)

- [x] D01 Implement immutable cutoff eligibility.
- [x] D02 Preserve non-expired and post-plan rows.
- [x] D03 Build bounded batches only for the registered response-chunk cleanup recipe; execution remains disabled in Track B.
- [x] D04 Define plan/batch-bound mutation receipt and idempotency evidence requirements.
- [x] D05 Implement same-cycle readback and reconciliation classification without database writes.
- [x] D06 Prove blind retry is denied for unknown outcomes and retry requires authoritative readback.
- [x] D07 Add physical-reclaim assessment as observation-only evidence with automatic compaction/OPTIMIZE disabled.
- [x] D08 Run a deterministic non-production dry-run pilot and lock/performance bounding rehearsal; no live database mutation was authorized or executed.

## E — Repository-Audit Supersession Adapter (Track B readiness slice)

- [x] E01 Define deterministic latest-observation ordering.
- [x] E02 Require a completed parent run and a strictly newer observation for the same file before classifying an older finding as superseded.
- [x] E03 Preserve latest observation, parent/non-terminal run evidence, distinct files, and lineage.
- [x] E04 Implement the bounded policy/approval gate for superseded cleanup while keeping cleanup execution disabled in Track B.
- [x] E05 Add adversarial concurrent-newer-row protection that invalidates the batch and requires re-read/replan.

## F/G — JobRunner and Policy-Bound Autopilot

- [ ] F01 Reuse recipe, plan, lease, receipt, and readback contracts in JobRunner.
- [ ] F02 Add bounded scheduling, backoff, pause, and reconciliation.
- [ ] F03 Observe fallback/mismatch/lock metrics before enabling automation.
- [ ] G01 Define low-risk policy-bound autopilot eligibility.
- [ ] G02 Require explicit enablement and expiry.
- [ ] G03 Prohibit autopilot for archive, purge, compaction, rebuild, and reclaim.

## H — Engine-Run Archive/Thin (Separate Project)

- [ ] H01 Produce retention assessment and payload sizing only.
- [ ] H02 Define archive pointer, checksum, restore, and lineage contract.
- [ ] H03 Preserve run identity, status, policy hashes, summary, and audit lineage.
- [ ] H04 Obtain separate approval before any payload mutation.

## I — Physical Reclaim (Separate High-Risk Project)

- [ ] I01 Define engine-specific reclaim recipes.
- [ ] I02 Require empty/reconstructible-table and concurrent-writer checks.
- [ ] I03 Require maintenance window, free-space preflight, rollback, and post-readback.
- [ ] I04 Keep destructive apply disabled until a separate risk review passes.

## Required Validation

- [x] V01 Contract guard passes with no secrets or arbitrary SQL surface.
- [x] V02 Work Map and E2E governance pass with no unresolved dimensions.
- [x] V03 Typecheck and focused tests pass for each implementation PR.
- [x] V04 Inventory/evaluation artifacts remain integration-owned and are not regenerated by Track B.
- [ ] V05 Staging and canary evidence exist before Production promotion.
- [ ] V06 Main-to-Production promotion and readback are separately approved.
