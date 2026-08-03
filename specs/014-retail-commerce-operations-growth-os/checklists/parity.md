# RetailOS Demo and Production Parity Checklist

## Contract parity

- [ ] Every production operation has an approved OpenAPI operation ID.
- [ ] Request and response schemas match approved contracts.
- [ ] Stable error codes match the specification.
- [ ] Idempotency, expected version, and unknown-outcome behavior match.
- [ ] State-machine labels in UI match backend states.
- [ ] Commerce event payloads pass the approved JSON Schema.
- [ ] Adapter manifests and certification match runtime versions.

## Domain parity

- [ ] Unique-item conflict is enforced by authoritative persistence.
- [ ] Reservation expiry occurs automatically and exactly once.
- [ ] Web/POS/Live use one inventory authority.
- [ ] Payment outcome changes stock/order only after authoritative evidence.
- [ ] Returns and refunds do not double-restock or double-refund.
- [ ] Catalog updates originate from committed domain events.
- [ ] Media/content gates are server enforced.
- [ ] Provider and analytics dedupe is durable.

## Experience parity

- [ ] Storefront supports approved search/filter/sort/compare behavior.
- [ ] Product displays condition, defects, measurements, fit, media, location, and availability truthfully.
- [ ] POS supports barcode, shifts, payments, discount approvals, and conflict states.
- [ ] Photography UX is camera-first and follows Shot Lists.
- [ ] Tracking, catalogs, ads, and automation assurance views use authoritative data.
- [ ] Automatic controls do not appear as normal manual buttons.
- [ ] QA controls are isolated from production.
- [ ] Arabic RTL and responsive behavior match approved viewport evidence.

## Runtime parity

- [ ] Real database or certified ERP adapter is connected.
- [ ] Outbox writes occur in the domain commit boundary.
- [ ] Workers survive/recover from process and Redis restart.
- [ ] Provider sandbox calls and readbacks are verified.
- [ ] Cross-device and multi-window consistency is server-backed.
- [ ] Observability and operation timelines are derived from runtime evidence.
- [ ] Backup, restore, reconciliation, and rollback are proved.
- [ ] Production deployment SHA and migration ledger are verified.

## Classification

A feature may be classified as:

- `demo_only`: visual or in-browser simulation only;
- `contract_ready`: approved contract and deterministic domain tests;
- `sandbox_certified`: real backend/provider sandbox evidence;
- `staging_verified`: deployed integrated staging evidence;
- `production_pilot`: controlled tenant/location production evidence;
- `production_certified`: complete acceptance, SLO, recovery, and closeout evidence.

No feature may skip directly from `demo_only` to `production_certified`.
