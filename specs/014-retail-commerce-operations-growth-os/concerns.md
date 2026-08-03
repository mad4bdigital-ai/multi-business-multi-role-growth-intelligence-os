# Cross-Cutting Concerns

## C-001 — Dual source of truth

**Risk:** platform and ERP both accept stock/order writes, causing drift and overselling.

**Control:** exactly one active `commerce_backend_binding` per Workspace and domain. The inactive side is read projection or integration consumer only. A change of backend requires migration, freeze window, reconciliation, and cutover evidence.

## C-002 — Unique-item concurrency

**Risk:** Web, POS, and Live reserve the same physical unit.

**Control:** authoritative transaction, exact Stock Unit row lock or equivalent ERP atomic operation, state/version predicate, unique active reservation constraint, idempotency record, and committed Outbox event.

## C-003 — Offline POS

**Risk:** disconnected devices oversell unique or low-stock items.

**Control:** unique items require signed offline allocation leases. Fungible inventory uses bounded branch/device quotas. Lease issuance and reconciliation are audited; expired or conflicting leases fail closed.

## C-004 — Unknown payment outcomes

**Risk:** timeout causes duplicate charge, duplicate order, or premature stock release.

**Control:** payment operation identity, provider idempotency key, webhook signature, status readback, `unknown` state, reconciliation schedule, no blind retry, and manual review for unresolved conflicts.

## C-005 — Outbox and external side effects

**Risk:** provider side effect occurs but local state rolls back, or retry duplicates publication/message/conversion.

**Control:** domain state plus Outbox in one transaction. Provider consumers use delivery identities and readback. Consumer success is not inferred from HTTP alone where provider supports inspection.

## C-006 — Queue unavailability

**Risk:** Redis is absent or restarted and pending media/catalog work disappears.

**Control:** SQL ledgers own pending work. BullMQ jobs are reconstructable. Worker readiness blocks publication or marks affected services degraded, but does not corrupt domain state.

## C-007 — Cross-tenant and wrong-resource access

**Risk:** actor accesses product, order, customer, branch, or connection from another tenant/brand.

**Control:** Context Kernel exact selection, repository predicates on tenant/workspace, resource-authority binding, no caller identity override, capability evaluation, cross-tenant negative tests.

## C-008 — Hardcoded role authority

**Risk:** route checks role strings such as `cashier` without resource/capability context.

**Control:** roles are templates and UX labels. Operations evaluate canonical capability, principal, membership, location, resource, backend, policy, and risk.

## C-009 — Customer privacy

**Risk:** customer PII leaks into GA4, ads providers, catalog feeds, logs, Outbox, AI prompts, or screenshots.

**Control:** PII classification, allowlisted analytics fields, hashed first-party conversion path only when lawful and consented, separate customer vault/projection, payload sanitizer, no raw request/response logging.

## C-010 — Payment and card data

**Risk:** platform stores payment instrument data or provider secrets.

**Control:** hosted/tokenized provider flows, store only provider reference and safe status metadata, PCI boundary documented separately, credentials resolved from governed bindings.

## C-011 — AI hallucination in product content

**Risk:** AI invents material, authenticity, defect, condition, measurement, or claim.

**Control:** field-level evidence, confidence, model/prompt version, prohibited claim policy, deterministic validators, human review thresholds, immutable approval record, retract/republish on evidence drift.

## C-012 — Media safety and cost

**Risk:** oversized, malicious, unsupported, duplicate, or expensive media jobs.

**Control:** scoped upload session, size/MIME/checksum validation, malware hook, image decoder limits, bounded dimensions, quota/metering, duplicate hash, queue limits, dead-letter, lifecycle retention.

## C-013 — Catalog divergence

**Risk:** provider shows stale price or available unique item after reservation/sale.

**Control:** committed delta events, high-priority availability consumer, provider issue/readback ledger, periodic full reconciliation, automatic publication suspension on critical drift, alert threshold.

## C-014 — Measurement duplication and attribution ambiguity

**Risk:** browser/server duplicate purchase or dashboards combine incompatible attribution models.

**Control:** event and transaction dedupe, versioned dictionary, destination delivery ledger, explicit attribution model dimension, platform/GA/provider values stored separately, reconciliation timestamps.

## C-015 — Discount and refund fraud

**Risk:** unauthorized cashier discount or refund.

**Control:** per-operation threshold policy, approval hold above threshold, separation of requester/approver where required, settlement variance, customer/order linkage, immutable audit.

## C-016 — Return state fraud or stock corruption

**Risk:** returned item marked available without inspection or restocked twice.

**Control:** one return case per line/refund scope, inspection decision, expected version, idempotent routing, state transition constraints, refund and stock ledgers linked but independently reconciled.

## C-017 — Supplier quality manipulation

**Risk:** sampling is skipped or supplier score changed manually.

**Control:** policy-generated sample tasks, immutable receipt and QC links, bounded override with reason/approval, score derived from evidence rather than editable aggregate.

## C-018 — ERP adapter behavior mismatch

**Risk:** ERPNext semantics differ from platform state machine or custom app version.

**Control:** adapter certification matrix, version handshake, capability declaration, contract tests against sandbox, normalized errors, compatibility window, feature flags, rollback to read-only if certification expires.

## C-019 — API compatibility

**Risk:** frontend and providers depend on unstable payloads.

**Control:** OpenAPI 3.1, schema version, additive fields, explicit deprecation, consumer readiness, generated contract parity checks, stable errors.

## C-020 — Migration safety

**Risk:** large tables, locks, collation mismatch, partial migration, or production/main drift.

**Control:** additive migrations, dry run, schema/readiness checks, lifecycle registry, collation-neutral keys, chunked backfill, feature flags, rollback/disable, same-cycle production readback.

## C-021 — Performance and backpressure

**Risk:** inventory request waits for catalogs/analytics or mass publication overwhelms providers.

**Control:** transaction remains internal, Outbox fan-out asynchronous, bounded batches, per-consumer concurrency/rate limits, lag metrics, priority lanes, backpressure and dead-letter.

## C-022 — Search and projection freshness

**Risk:** public search displays stale availability.

**Control:** search is non-authoritative. Product detail and reserve call revalidate authority. Projection age is visible internally; stale projection does not permit mutation.

## C-023 — Arabic and accessibility drift

**Risk:** production UI loses RTL/mobile behavior demonstrated by demo.

**Control:** design tokens, locale dictionaries, RTL visual tests, viewport matrix, WCAG automated/manual checks, acceptance screenshots, no hardcoded left/right semantics.

## C-024 — Demo-to-production false equivalence

**Risk:** matching screens are accepted without backend invariants.

**Control:** parity checklist requires contract, domain, experience, and runtime evidence. Demo status is always labelled simulation until backend tests pass.

## C-025 — Data retention

**Risk:** unlimited events, media derivatives, provider payloads, or audit evidence increase cost and privacy exposure.

**Control:** per-table lifecycle classification, retention/archival, aggregation, bounded provider excerpts, deletion/anonymization policies, legal holds separated from operational retention.

## C-026 — Recovery and support

**Risk:** operator cannot understand stuck reservation, payment, Outbox, media, or catalog state.

**Control:** operation projection and timeline, safe replay/inspect controls, reconciliation runbooks, exact owner, stable error, next action, evidence reference, and support handoff.

## C-027 — Secrets

**Risk:** specifications, fixtures, event bodies, logs, screenshots, or generated content include credentials.

**Control:** secret key/value scanners, connection references only, sanitizer, no credential payload read in diagnostic flows, CI fixtures use non-secret placeholders.
