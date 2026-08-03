# Requirements Quality Checklist

## Scope and truthfulness

- [x] The specification distinguishes demo implementation from repository implementation and production proof.
- [x] Current repository capabilities and gaps are documented.
- [x] Non-goals and excluded mutations are explicit.
- [x] The specification does not create runtime or provider authority.
- [x] One authoritative commerce backend per Workspace is explicit.

## Functional completeness

- [x] Storefront, filters, cart, reservation, checkout, orders, and pickup/shipping are covered.
- [x] POS, branches, terminals, shifts, discounts, settlement, and offline policy are covered.
- [x] Unique and fungible inventory are covered.
- [x] Suppliers, receipts, lots, QC, transfers, counts, returns, refunds, and restocking are covered.
- [x] Product intake, photography, media processing, AI drafts, review, and publication are covered.
- [x] Google/Meta/TikTok catalogs are covered by provider-neutral contracts.
- [x] GA4/GTM-style measurement, consent, dedupe, ads facts, attribution, and contribution are covered.
- [x] CRM, complaints, Audit Findings, Live Commerce, and Growth feedback are covered.
- [x] ERPNext/Frappe adapter and platform-native modes are covered.
- [x] Arabic RTL, mobile, accessibility, and usability are covered.

## Testability

- [x] Requirements use stable IDs.
- [x] State transitions and terminal states are explicit.
- [x] Stable error families are explicit.
- [x] Idempotency and expected-version behavior are explicit.
- [x] Unknown-outcome behavior is explicit.
- [x] Operation paths contain success, denial, retry, readback, and recovery.
- [x] Acceptance matrix separates contract/domain/experience/runtime evidence.

## Brownfield alignment

- [x] Context Kernel reuse is specified.
- [x] Resource API layering is preserved.
- [x] Existing Outbox and worker foundations are reused.
- [x] Sequential plans and approval holds are used only where appropriate.
- [x] Provider, credential, capability, and frontend governance are reused.
- [x] SQL remains platform authority where platform-native mode is selected.
- [x] Sheets are not introduced as commerce authority.

## Open requirements before implementation

- [ ] Choose initial pilot backend mode.
- [ ] Choose certified ERPNext/Frappe version and deployment topology.
- [ ] Choose object storage/media processing providers.
- [ ] Choose payment and shipping sandbox providers.
- [ ] Define initial country/localization, tax, and e-invoice scope.
- [ ] Define production SLOs, data volumes, and retention values.
- [ ] Approve architecture, security, API, database, UX, and operations reviews.
