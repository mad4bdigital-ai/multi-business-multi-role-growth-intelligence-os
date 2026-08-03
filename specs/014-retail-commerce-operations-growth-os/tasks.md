# Dependency-Ordered Tasks

No task is complete in this specification PR. `[P]` marks work that can be parallel only after its prerequisites are complete.

## Phase 0 — Specification and baseline

- [ ] T001 Validate all Spec 014 JSON/YAML/Markdown artifacts in CI.
- [ ] T002 Add a contract-baseline test proving Spec 014 contracts remain specification-only.
- [ ] T003 Re-scan current `main` before implementation and update Brownfield inventory.
- [ ] T004 Record authoritative production schema and migration baseline separately from repository presence.
- [ ] T005 Resolve open product decisions: backend pilot mode, object storage, payment provider, shipping provider, and ERPNext version.
- [ ] T006 Approve architecture/security/API/database/operations review checklist.

## Phase 1 — Domain contracts and policies

- [ ] T010 Create `src/domain/commerce/errors.js` with stable error catalog. [FR-API-004]
- [ ] T011 Create commerce value objects and identifier validation. [FR-CAT-001, FR-CTX-001]
- [ ] T012 Implement inventory and Stock Unit state machines. [FR-INV-003]
- [ ] T013 Implement reservation policy and expiry rules. [FR-INV-001..006]
- [ ] T014 Implement order state machine. [FR-ORD-001..008]
- [ ] T015 Implement payment state machine and unknown-outcome policy. [FR-ORD-004..006]
- [ ] T016 Implement return/refund state machines. [FR-RET-001..004]
- [ ] T017 Implement media/content/publication state machines. [FR-MEDIA-001..007, FR-CONT-001..004]
- [ ] T018 Implement measurement consent, PII, and dedupe policy. [FR-MEAS-001..004]
- [ ] T019 Implement offline allocation policy. [FR-INV-007..008]
- [ ] T020 Define Commerce Authority Adapter interface and manifest validator. [FR-CTX-004, FR-ERP-001..004]
- [ ] T021 Add unit tests for all domain transitions and invalid states.

## Phase 2 — Context, resource, and capability foundation

- [ ] T030 Define commerce resource types: backend, product, variant, Stock Unit, location, terminal, reservation, order, publication.
- [ ] T031 Define commerce resource operations and capability taxonomy. [FR-AUTH-001]
- [ ] T032 Define role templates without treating role names as authority. [FR-AUTH-002]
- [ ] T033 Add Commerce Context repository ports to Context Kernel.
- [ ] T034 Implement commerce backend binding resolution.
- [ ] T035 Implement location, channel, terminal, and target-resource resolution.
- [ ] T036 Include commerce revisions in context hash/version vector.
- [ ] T037 Add exact connection selection for ERP/payment/shipping/catalog/measurement operations.
- [ ] T038 Add ambiguity, stale revision, caller override, wrong-brand, wrong-location, and cross-tenant tests. [FR-CTX-001..004, FR-AUTH-003]
- [ ] T039 Add read-only Commerce Context diagnostic projection with no credentials.

## Phase 3 — Database and platform-native catalog

- [ ] T040 Finalize platform-native schema names and identifier/collation contracts.
- [ ] T041 Add additive migration for backend bindings and commerce operations/idempotency.
- [ ] T042 Add product, variant, Stock Unit, balance, movement, location, and price schema.
- [ ] T043 Add indexes and unique constraints for tenant scope and unique reservations.
- [ ] T044 Register every table in database lifecycle registry.
- [ ] T045 Add migration dry-run, schema parity, and rollback/disable evidence.
- [ ] T046 Implement commerce repositories only in infrastructure layer.
- [ ] T047 Implement read-only catalog query service and safe projections. [FR-CAT-001..005]
- [ ] T048 Add Resource API read descriptors only where generic browsing is appropriate.
- [ ] T049 Add SQL repository tenant/workspace predicate tests.

## Phase 4 — Atomic inventory and reservations

- [ ] T050 Implement platform-native atomic reservation with caller-owned transaction. [OP-001]
- [ ] T051 Write commerce Outbox event inside the reservation transaction. [FR-INV-005]
- [ ] T052 Implement reservation readback and operation projection.
- [ ] T053 Implement release/cancel path with expected version. [OP-002]
- [ ] T054 Implement automatic expiry worker with durable claim.
- [ ] T055 Implement fungible quantity reservation and balance constraints.
- [ ] T056 Implement manual override as a separately authorized operation. [FR-INV-006]
- [ ] T057 Add concurrent race, deadlock, rollback, idempotency, and expiry tests. [AC-002, AC-003, AC-033]
- [ ] T058 Add Outbox consumer idempotency and availability projection consumer.
- [ ] T059 Add reservation conflict and expiry operational metrics/alerts.

## Phase 5 — Orders, checkout, POS, and payments

- [ ] T060 Add price snapshot, order, line, fulfillment, POS shift/sale, and payment schemas.
- [ ] T061 Implement checkout validation and idempotent order creation. [OP-003]
- [ ] T062 Implement POS sale using the same inventory authority. [OP-004]
- [ ] T063 Implement discount threshold policy and approval hold integration.
- [ ] T064 Implement payment adapter interface, intent, callback verification, and safe references.
- [ ] T065 Implement payment captured/failed/unknown reconciliation paths.
- [ ] T066 Implement reservation commit and failure release exactly once.
- [ ] T067 Implement shift open/close and settlement variance projection.
- [ ] T068 Implement offline allocation lease schema and issuance/reconciliation.
- [ ] T069 Add unique-item offline denial and lease tests. [AC-008]
- [ ] T070 Add payment duplicate webhook, timeout, conflicting readback, and refund tests.

## Phase 6 — Suppliers, QC, returns, and customer service

- [ ] T080 Add supplier, receipt, lot, QC task, and inspection schemas.
- [ ] T081 Implement receipt transaction and automatic QC plan generation. [OP-005]
- [ ] T082 Implement sampling policy and inspection decision continuation.
- [ ] T083 Add return, return-line, and refund operation schemas.
- [ ] T084 Implement return eligibility and inspection workflow. [OP-009]
- [ ] T085 Implement automatic restock/quarantine/damaged routing.
- [ ] T086 Implement customer timeline safe projections.
- [ ] T087 Implement complaint normalization, dedupe, cluster threshold, and Audit Finding creation. [OP-010]
- [ ] T088 Add supplier/return/complaint integration and negative tests.

## Phase 7 — Product intake, photography, AI, and content

- [ ] T090 Add intake, Shot List, shoot session, upload session, media asset, derivative, and pipeline schema.
- [ ] T091 Implement scoped media upload session and storage adapter.
- [ ] T092 Add MIME, size, checksum, image decoder, duplicate, and safety validation.
- [ ] T093 Implement category/channel Shot List resolution.
- [ ] T094 Implement durable media pipeline stages and SQL reconstruction.
- [ ] T095 Add image-processing worker with bounded resources and dead letter.
- [ ] T096 Add AI attribute draft/value schemas with evidence and confidence.
- [ ] T097 Implement AI provider adapter and field-level policy.
- [ ] T098 Implement content revision generation per channel/language.
- [ ] T099 Implement human review for sensitive fields and quality gate. [OP-006]
- [ ] T100 Add pipeline restart, stage idempotency, low-confidence, and false-claim tests.

## Phase 8 — Publications and channel catalogs

- [ ] T110 Add publication, catalog mapping, sync run, and issue schemas.
- [ ] T111 Implement publication version and readiness service.
- [ ] T112 Define catalog provider adapter contract and connection profiles.
- [ ] T113 [P] Implement Google Merchant sandbox adapter.
- [ ] T114 [P] Implement Meta Catalog sandbox adapter.
- [ ] T115 [P] Implement TikTok Catalog sandbox adapter.
- [ ] T116 Implement high-priority availability delta consumer. [OP-007]
- [ ] T117 Implement content/price/media delta consumers.
- [ ] T118 Implement provider issue readback and full reconciliation.
- [ ] T119 Add retry/dead-letter/provider partial rejection tests.
- [ ] T120 Add catalog drift and latency alerts.

## Phase 9 — Measurement, ads, and attribution

- [ ] T130 Add versioned measurement dictionary and event/delivery schemas.
- [ ] T131 Implement Measurement Gateway schema/consent/PII validation. [OP-008]
- [ ] T132 Implement event and transaction deduplication.
- [ ] T133 Implement GA4 destination adapter and delivery evidence.
- [ ] T134 Implement internal operational destination when marketing consent is denied.
- [ ] T135 Add ad fact import, attribution snapshot, and contribution schemas.
- [ ] T136 [P] Implement Google Ads read/import adapter using existing governance.
- [ ] T137 [P] Define Meta and TikTok ads read provider profiles/adapters.
- [ ] T138 Implement order/refund/cost/spend reconciliation. [OP-011]
- [ ] T139 Keep provider spend mutation outside read/reconciliation enablement.
- [ ] T140 Add GA4 payload, PII rejection, consent, dedupe, and attribution model tests.

## Phase 10 — ERPNext/Frappe adapter

- [ ] T150 Define ERPNext provider profile, version handshake, and resource mappings.
- [ ] T151 Implement read-only readiness, item, inventory, supplier, employee, and order projections.
- [ ] T152 Design/version custom Frappe app for atomic unique Stock Unit reservation if required.
- [ ] T153 Implement reservation/release/commit adapter methods.
- [ ] T154 Implement order/POS/payment/receipt/return adapter methods.
- [ ] T155 Normalize ERP errors and unknown outcomes.
- [ ] T156 Add sandbox fixture and behavioral contract suite.
- [ ] T157 Prove platform-native write repositories reject external projection authority.
- [ ] T158 Certify adapter in sandbox without production enablement.

## Phase 11 — RetailOS frontend

- [ ] T160 Register RetailOS tenant surface in governed frontend discovery/policy.
- [ ] T161 Generate dispatch artifacts from canonical sources.
- [ ] T162 Build storefront module with indexed filters and authoritative reserve revalidation.
- [ ] T163 Build POS/shift/offline status module.
- [ ] T164 Build inventory/supplier/QC/return modules.
- [ ] T165 Build mobile Product Intake and Content Studio.
- [ ] T166 Build catalog/tracking/ads/automation assurance views.
- [ ] T167 Build operation/evidence timeline with truthful lifecycle states.
- [ ] T168 Implement Arabic RTL and English dictionaries.
- [ ] T169 Add responsive visual tests at 360, 390, tablet, desktop.
- [ ] T170 Add WCAG 2.2 AA automated and manual evidence.
- [ ] T171 Ensure QA Sandbox controls are production-disabled.

## Phase 12 — Hardening, rollout, and closeout

- [ ] T180 Add commerce readiness and health endpoint/projection.
- [ ] T181 Add dashboards for conflicts, expiry lag, unknown payments, Outbox, media, catalog, measurement, and reconciliation.
- [ ] T182 Add backup/restore and retention validation.
- [ ] T183 Run load/concurrency tests for reservation, POS, and projections.
- [ ] T184 Run Redis-disabled/restart and worker recovery tests.
- [ ] T185 Run provider outage/circuit-breaker/fallback tests. [OP-013]
- [ ] T186 Run full cross-tenant/wrong-resource security suite.
- [ ] T187 Execute controlled pilot in sandbox/staging.
- [ ] T188 Execute governed migrations and production pilot only with separate authority.
- [ ] T189 Run all acceptance matrix rows against real backend. [OP-014]
- [ ] T190 Confirm main/production version and migration parity.
- [ ] T191 Confirm rollback/disable and operation readback.
- [ ] T192 Update documentation, runbooks, manifest delivery evidence, and completion JSON.
- [ ] T193 Move to closeout only after production parity and unresolved work classification.
