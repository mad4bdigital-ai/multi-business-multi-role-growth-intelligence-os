# Tasks — Spec 019 Governed Database Lifecycle and Pressure Relief

## A — Spec and Contract Foundation (PR-A)

- [ ] A01 Record the current lifecycle reporting/readiness baseline and explicit read-only boundary.
- [ ] A02 Finalize requirements, non-goals, invariants, and acceptance criteria.
- [ ] A03 Define lifecycle plan, operation, evidence, error, and readback contracts.
- [ ] A04 Define the domain-adapter interface and first three domain decisions.
- [ ] A05 Define exact database-table authority and typed approval bindings.
- [ ] A06 Define logical-cleanup versus physical-reclaim result separation.
- [ ] A07 Add threat model, security checklist, rollback rules, and test matrix.
- [ ] A08 Add E2E phase contract and Work Map integration manifest.
- [ ] A09 Run deterministic contract guard without production access.

## B — Read-Only Pressure Intelligence (PR-B)

- [ ] B01 Implement quota/usage/data-free observation adapters with explicit unavailable states.
- [ ] B02 Discover largest tables and growth velocity with bounded queries.
- [ ] B03 Classify resource semantics through registered domain adapters.
- [ ] B04 Resolve policy by exact resource and recipe identity.
- [ ] B05 Generate deterministic candidate estimates and immutable plan fingerprints.
- [ ] B06 Keep missing policy and unknown semantics blocked.
- [ ] B07 Add pressure inspector and planner observability.
- [ ] B08 Add unit, integration, invalid-input, and regression tests.

## C — Authority and Durable Mutation Readiness (PR-C)

- [ ] C01 Re-read target-environment status for mutation receipts and governed migration ledgers.
- [ ] C02 Add exact `database_table` resource authority binding.
- [ ] C03 Add registered recipe allowlist and operation identity.
- [ ] C04 Bind capability envelope, lease, typed approval, and expiry.
- [ ] C05 Verify idempotency and unknown-outcome reconciliation authority.
- [ ] C06 Keep mutation disabled when receipt persistence/readback is unavailable.
- [ ] C07 Add security and replay/injection/path-traversal tests.

## D — Response-Chunk TTL Pilot (PR-D)

- [ ] D01 Implement immutable cutoff eligibility.
- [ ] D02 Preserve non-expired and post-plan rows.
- [ ] D03 Execute bounded batches only through a registered operation.
- [ ] D04 Persist mutation receipts and batch evidence.
- [ ] D05 Implement same-cycle readback and reconciliation.
- [ ] D06 Prove idempotent retry and unknown-outcome behavior.
- [ ] D07 Add physical-reclaim assessment without automatic compaction.
- [ ] D08 Run non-production pilot and performance/lock review.

## E — Repository-Audit Supersession Adapter (PR-E)

- [ ] E01 Define deterministic latest-observation ordering.
- [ ] E02 Require completed parent run and newer observation for the same file.
- [ ] E03 Preserve latest observation, parent runs, distinct files, and non-terminal runs.
- [ ] E04 Execute bounded superseded cleanup only after policy approval.
- [ ] E05 Add adversarial concurrent-newer-row tests.

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

- [ ] V01 Contract guard passes with no secrets or arbitrary SQL surface.
- [ ] V02 Work Map and E2E governance pass with no unresolved dimensions.
- [ ] V03 Typecheck and focused tests pass for each implementation PR.
- [ ] V04 Inventory/evaluation artifacts remain deterministic.
- [ ] V05 Staging and canary evidence exist before Production promotion.
- [ ] V06 Main-to-Production promotion and readback are separately approved.
