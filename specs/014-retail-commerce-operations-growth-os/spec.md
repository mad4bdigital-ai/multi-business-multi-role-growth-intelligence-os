# Product Specification

## 1. Problem statement

The platform can govern multi-tenant execution, resources, workflows, providers, approvals, evidence, and frontend surfaces, but it does not yet expose a complete retail commerce domain capable of operating a physical store, online store, POS, supplier flow, product photography, catalog publication, and marketing measurement as one consistent system.

The product must support cases where a single physical item is visible in more than one sales channel and must prevent conflicting sales automatically. It must also support fungible variants, multiple branches, supplier lots, returns, media automation, Arabic interfaces, and provider integrations without creating a second ungoverned runtime or duplicating business authority.

## 2. Goals

### G-001 — Unified retail operation

Provide one governed experience for online commerce, POS, inventory, supplier operations, employee-facing work, product media, customer service, catalogs, analytics, and growth workflows.

### G-002 — Exact business authority

Resolve one authoritative commerce backend per tenant Workspace. Every inventory, reservation, order, payment, return, and publication mutation must be delegated to that selected backend through a certified adapter.

### G-003 — Atomic unique-item protection

Guarantee that a unique stock unit cannot be sold, reserved, returned, quarantined, or published as available by conflicting channels at the same time.

### G-004 — Reusable platform foundation

Extend the existing Context Kernel, capability system, Resource API layering, execution plans, approval holds, Outbox, Workers, frontend surface catalog, audit, and provider connection model.

### G-005 — Implementation parity

Make the production implementation testable against the interaction and contract behavior demonstrated by RetailOS v6, while explicitly rejecting UI-only equivalence as completion evidence.

## 3. Non-goals

- Replacing platform governance with ERPNext governance.
- Sharing one commerce table set across tenants without tenant predicates.
- Building a generic browser-held privileged proxy.
- Treating Google Sheets as commerce authority.
- Storing provider secrets in product, order, analytics, or publication rows.
- Permitting blind retries after unknown payment or provider outcomes.
- Allowing AI-generated product facts to bypass evidence and review policy.
- Implementing tax, e-invoicing, payroll, or statutory accounting without separate localization specifications.

## 4. Actors

| Actor | Responsibilities |
|---|---|
| Shopper | Browse, filter, reserve, checkout, track, request return |
| Cashier | POS sale, payment intake, receipt, bounded return initiation |
| Store Manager | Discount approval, shift close, exceptional stock release |
| Inventory Operator | Receive, count, transfer, quarantine, reconcile |
| Photographer | Product intake, shot capture, media evidence |
| Content Reviewer | Verify attributes, defects, measurements, descriptions, publish readiness |
| Supplier Manager | Suppliers, purchase receipts, lot quality, supplier performance |
| Customer Service | Customer timeline, complaints, return support, escalation |
| Marketer | Campaigns, catalogs, measurement health, performance analysis |
| Finance Operator | Payment reconciliation, refunds, settlement review |
| HR Manager | Employee and shift projections through ERP/HR adapter |
| Tenant Admin | Workspace policy, roles, providers, locations, backend selection |
| Platform Admin | Adapter certification, platform policy, incident and release governance |
| Background Worker | Expiry, outbox delivery, image processing, provider synchronization, reconciliation |
| Provider Webhook | Signed payment, shipping, catalog, or channel outcome callback |

Actor labels are product roles only. Runtime authority derives from authenticated principal, membership, exact resource authority, capability, context, and policy evidence.

## 5. Context requirements

### FR-CTX-001

Every authenticated operation MUST resolve `tenant_ref`, `workspace_ref`, optional `brand_ref`, `location_ref`, `channel_ref`, target resource, provider connection, and commerce backend through Context Kernel-compatible evidence.

### FR-CTX-002

Caller-supplied tenant, workspace, brand, location, or connection identifiers MUST be constraints only and MUST NOT override authenticated authority.

### FR-CTX-003

A commerce execution context MUST include a revision vector and context hash. Mutations MUST reject stale context, backend-selection drift, location drift, or connection drift.

### FR-CTX-004

The selected `commerce_backend_mode` MUST be exactly one of `platform_native` or `erpnext` for v1. A workspace with zero or more than one active authoritative backend MUST be blocked.

## 6. Product and catalog requirements

### FR-CAT-001

The model MUST distinguish:

- Product Model;
- Product Variant;
- Stock Unit;
- Supplier Lot;
- Measurement Profile;
- Condition Grade;
- Defect Record;
- Media Asset;
- Channel Publication.

### FR-CAT-002

A variant MAY be fungible with quantity greater than one. A unique Stock Unit MUST have its own stable identifier, barcode, lifecycle state, location, cost lineage, condition, and media evidence.

### FR-CAT-003

Product data MUST support Arabic and additional languages without duplicating inventory identity.

### FR-CAT-004

Search and filter projections MUST support category, price, size, material, fit, condition, branch, availability, pickup readiness, unique-item status, discount, defect disclosure, and media verification.

### FR-CAT-005

Public product projections MUST not reveal supplier cost, internal notes, provider IDs prohibited by policy, or tenant-private evidence.

## 7. Inventory and reservation requirements

### FR-INV-001

The authoritative adapter MUST implement an atomic reservation operation with:

- stable idempotency key;
- expected entity version;
- requested quantity or exact Stock Unit reference;
- channel and location;
- bounded expiry;
- transactionally persisted reservation and outbox events;
- authoritative readback.

### FR-INV-002

For a unique Stock Unit, concurrent reservations MUST produce one success and deterministic conflicts for all losing requests.

### FR-INV-003

Available, Reserved, Sold, Quarantine, Damaged, Transferred, and Returned states MUST follow an explicit state machine. Invalid transitions return `409 STATE_VERSION_CONFLICT` or a more specific stable code.

### FR-INV-004

Reservation expiry MUST run automatically. It MUST release stock at most once, emit a committed event, and refresh every dependent channel without human initiation.

### FR-INV-005

Inventory delta propagation MUST occur only after the authoritative transaction commits.

### FR-INV-006

Manual stock override MUST require explicit capability, reason, expected version, audit evidence, and same-cycle readback.

### FR-INV-007 — Offline POS

A disconnected device MUST NOT complete a sale for a unique item unless it owns a valid, signed, bounded offline allocation lease created while online. Without a lease, the POS MAY park the basket but MUST not issue a final sale receipt.

### FR-INV-008

Fungible inventory MAY use branch/device allocation quotas if enabled by policy. Reconnection MUST reconcile used, released, expired, and conflicting allocations before new offline allocations are issued.

## 8. Checkout, order, POS, and payment requirements

### FR-ORD-001

Checkout MUST validate price snapshot, stock reservation, shipping/pickup choice, customer consent, currency, discount authority, and payment readiness before order creation.

### FR-ORD-002

Order creation MUST be idempotent and bind the order to reservation, price snapshot, customer, channel, location, campaign attribution, and context revision.

### FR-ORD-003

POS sale MUST use the same inventory authority and idempotency semantics as online checkout.

### FR-ORD-004

A successful payment callback or readback MUST commit the reservation exactly once and transition the order according to the payment state machine.

### FR-ORD-005

A failed payment MUST release the reservation automatically when policy permits. An unknown payment outcome MUST preserve a bounded hold and enter reconciliation without blind replay.

### FR-ORD-006

Provider redirects, browser success pages, client-side callbacks, and transport success MUST NOT be treated as authoritative payment success.

### FR-ORD-007

Discounts above the actor threshold MUST create an approval hold. Inventory conflict prevention, reservation expiry, payment readback, and catalog sync MUST NOT create approval holds merely because they are automatic mutations.

### FR-ORD-008

Shift close and settlement MUST preserve cashier, terminal, branch, payment-method totals, variance, and manager decision evidence.

## 9. Supplier and stock intake requirements

### FR-SUP-001

Purchase receipt MUST bind supplier, purchase order when present, lot, quantities, costs, receiving location, receiver, and evidence.

### FR-SUP-002

Receipt confirmation MUST automatically create stock units or variant quantities and required quality tasks inside one durable workflow.

### FR-SUP-003

Quality sampling rules MUST be policy-driven by supplier, category, value, defect history, and condition class.

### FR-SUP-004

Human judgment MAY classify sampled units as accepted, quarantine, or damaged. The system MUST perform subsequent stock, supplier-score, task, and outbox transitions automatically.

## 10. Returns and refunds

### FR-RET-001

Return eligibility MUST consider order, item, channel, date, policy version, condition, and prior refund state.

### FR-RET-002

The operator records physical inspection outcome; the system routes the item automatically to Available, Quarantine, Damaged, or Supplier Return.

### FR-RET-003

Refund execution MUST be idempotent, provider-readback-aware, and separate from return intake when provider outcome is unknown.

### FR-RET-004

Restocking MUST update inventory and channel availability through the committed Outbox, not direct best-effort fan-out inside the request transaction.

## 11. Product intake, photography, and media

### FR-MEDIA-001

Product Intake MUST create or resolve product, variant, Stock Unit, supplier lot, and required Shot List according to category and channel policy.

### FR-MEDIA-002

Media upload MUST use authenticated, scoped upload sessions with MIME allowlists, size limits, checksum, tenant/workspace ownership, malware/safety scan hooks, and no public write credentials.

### FR-MEDIA-003

The media pipeline MUST support validation, duplicate detection, orientation, crop, derivative sizes, compression, WebP/AVIF generation, thumbnail, background handling, and retry/dead-letter evidence.

### FR-MEDIA-004

Completion of the minimum Shot List SHOULD enqueue processing automatically. Operator controls are retry/recovery controls, not the normal execution path.

### FR-MEDIA-005

AI extraction MUST produce a draft with value, confidence, evidence references, model/version, prompt/profile version, and safety status for each field.

### FR-MEDIA-006

Sensitive facts such as material, defect, condition, measurements, authenticity, and regulated claims MUST require evidence and policy-driven human review.

### FR-MEDIA-007

The Quality Gate MUST block publication when images, measurements, condition, defect disclosure, price, stock authority, or required approvals are incomplete.

## 12. Content and publication

### FR-CONT-001

The system MUST generate channel-specific drafts rather than copy one description to every channel.

Supported projections include storefront, Google Merchant, Meta, TikTok, WhatsApp, social caption, SEO metadata, live-commerce script, and accessibility alt text.

### FR-CONT-002

Publication MUST be versioned. A publication references the exact product revision, price revision, media set, content revision, and policy revision.

### FR-CONT-003

Publishing to external providers MUST use certified provider adapters, governed credentials, Outbox delivery, retry policy, readback, and stable provider errors.

### FR-CONT-004

A publication may be disabled automatically after stock reaches zero, a unique item is reserved, product enters quarantine, a critical defect is added, or policy invalidates the content revision.

## 13. Tracking, analytics, catalogs, and advertising

### FR-MEAS-001

The platform MUST define a versioned measurement event dictionary including commerce events such as `view_item_list`, `select_item`, `view_item`, `search`, `add_to_cart`, `begin_checkout`, `add_shipping_info`, `add_payment_info`, `purchase`, `refund`, and `offline_purchase`.

### FR-MEAS-002

Accepted measurement events MUST pass schema validation, consent routing, PII rejection, tenant/brand binding, item identity validation, and deduplication.

### FR-MEAS-003

Browser and server events for the same business event MUST share an event identity. Purchase deduplication MUST additionally use transaction identity.

### FR-MEAS-004

The event ledger MUST distinguish accepted, routed, partially delivered, rejected, deduplicated, and reconciled states without storing raw secrets or prohibited customer data.

### FR-MEAS-005

Catalog feeds MUST map one canonical product/variant identity to channel identifiers. Price and availability MUST always derive from the authoritative commerce backend.

### FR-MEAS-006

Catalog synchronization MUST be delta-driven by committed domain events, with periodic full reconciliation and provider issue readback.

### FR-MEAS-007

Advertising performance MUST reconcile spend, impressions, clicks, sessions, cart, checkout, purchases, refunds, revenue, cost of goods, discounts, payment fees, shipping subsidy, returns cost, and contribution after ads.

### FR-MEAS-008

Platform-reported attribution, GA attribution, last-click, first-touch, ERP order source, and blended reporting MUST remain distinct dimensions. The system MUST not present one as absolute truth.

### FR-MEAS-009

Ad spend or campaign mutations remain separately governed provider writes requiring provider profile, credential readiness, budget authority, execution enablement, approval when required, and readback.

## 14. CRM, complaints, and growth feedback

### FR-CRM-001

Customer timeline MUST project orders, payments, returns, conversations, complaints, campaigns, and consent without exposing cross-tenant data.

### FR-CRM-002

Repeated complaint patterns MAY create an Audit Finding automatically using policy thresholds and evidence links.

### FR-CRM-003

A finding may create a Growth Intelligence action or service opportunity, but it MUST NOT authorize external execution or spend.

### FR-CRM-004

Customer service actions that send external messages MUST use recipient, template, consent, provider, and delivery-policy gates.

## 15. Live commerce

### FR-LIVE-001

A Live session MUST bind products and exact Stock Units through stable identifiers.

### FR-LIVE-002

Live reservation MUST use the same atomic reservation service as Web and POS.

### FR-LIVE-003

A payment link MUST preserve reservation and attribution identity; expiry or failed payment releases the unit automatically.

## 16. Employee and ERP projections

### FR-ERP-001

When `erpnext` mode is selected, the adapter MUST map platform operations to certified ERPNext/Frappe contracts and return normalized platform responses.

### FR-ERP-002

Accounting, procurement, HR, payroll, and statutory records MAY remain ERP-owned. The platform MUST store references, synchronization state, and evidence rather than duplicate provider ledgers unnecessarily.

### FR-ERP-003

Adapter failure MUST produce stable classifications: unavailable, unauthorized, validation failure, conflict, unknown outcome, unsupported, and provider rejected.

### FR-ERP-004

ERPNext custom extensions required for unique Stock Unit reservation, media intake, or offline allocation MUST be versioned and certified as a provider application, not hidden in generic integration code.

## 17. Authorization

### FR-AUTH-001

Commerce operations MUST be registered as canonical capabilities and resource operations.

### FR-AUTH-002

Role names are not authority by themselves. Every operation MUST evaluate principal, membership, scope, resource binding, capability grant, operation classification, risk, backend, and exact target.

### FR-AUTH-003

Default is deny. Cross-tenant, wrong-brand, wrong-location, wrong-channel, wrong-connection, stale-context, and confused-deputy cases MUST be tested.

### FR-AUTH-004

High-risk actions include manual inventory override, high discount, refund above threshold, publication of sensitive claims, provider spend, credential changes, and destructive data actions.

## 18. API and error requirements

### FR-API-001

Public HTTP contracts MUST use OpenAPI 3.1. Structured payload schemas MUST use JSON Schema 2020-12.

### FR-API-002

Mutating requests MUST accept `Idempotency-Key`; conflict-sensitive requests MUST accept `If-Match` or equivalent expected version.

### FR-API-003

Responses MUST include request/correlation identity, operation identity where asynchronous, normalized business status, readback status, and `secrets_included: false`.

### FR-API-004

Stable error codes MUST include at minimum:

- `COMMERCE_BACKEND_UNRESOLVED`
- `COMMERCE_BACKEND_AMBIGUOUS`
- `CONTEXT_REVISION_CONFLICT`
- `STOCK_NOT_AVAILABLE`
- `STOCK_UNIT_RESERVED`
- `STATE_VERSION_CONFLICT`
- `IDEMPOTENCY_PAYLOAD_MISMATCH`
- `PRICE_SNAPSHOT_STALE`
- `PAYMENT_OUTCOME_UNKNOWN`
- `APPROVAL_REQUIRED`
- `MEDIA_QUALITY_GATE_BLOCKED`
- `PUBLICATION_NOT_READY`
- `PROVIDER_UNAVAILABLE`
- `PROVIDER_OUTCOME_UNKNOWN`
- `MEASUREMENT_EVENT_REJECTED`
- `PII_NOT_ALLOWED`

## 19. Reliability and performance

### NFR-REL-001

The reservation transaction SHOULD complete within 500 ms at p95 excluding external ERP latency. The adapter MUST declare its SLO and degraded policy.

### NFR-REL-002

No request transaction may wait for Google, Meta, TikTok, WhatsApp, or analytics delivery. External propagation uses Outbox workers.

### NFR-REL-003

Workers MUST use bounded concurrency, retry with jitter, claim expiry, dead-letter, health, lag metrics, and replay-safe consumers.

### NFR-REL-004

Commerce-critical SQL tables MUST have lifecycle classification, backup policy, retention, indexes, uniqueness constraints, and migration rollback posture.

### NFR-REL-005

Scheduled reconciliation MUST detect inventory, payment, order, catalog, attribution, and publication drift.

## 20. Arabic, accessibility, and responsive UX

### NFR-UX-001

All primary customer and employee surfaces MUST support Arabic RTL, Arabic terminology review, locale-aware currency/date/number formatting, and English fallback.

### NFR-UX-002

The storefront, POS, inventory, photography, and approval surfaces MUST be responsive for mobile, tablet, and desktop.

### NFR-UX-003

The production UI MUST meet WCAG 2.2 AA for keyboard, focus, contrast, labels, status announcements, error recovery, and touch targets.

### NFR-UX-004

Mobile product intake MUST minimize typing through barcode scan, controlled vocabularies, defaults, progressive disclosure, and camera-first capture.

### NFR-UX-005

Automatic controls MUST be represented as system status/evidence, not misleading manual action buttons. QA controls MUST be clearly isolated from daily operations.

## 21. Observability and evidence

### NFR-OBS-001

Every mutation MUST emit bounded audit and execution evidence containing tenant/workspace/resource references, actor, capability, operation, state transition, idempotency identity hash, context revision, result classification, readback, and timestamps.

### NFR-OBS-002

Logs MUST NOT contain credentials, authorization headers, payment instrument data, raw provider payloads, unrestricted customer profiles, or image binary content.

### NFR-OBS-003

Dashboards MUST expose reservation conflicts, oversell blocks, expiry lag, payment unknown outcomes, Outbox lag, dead letters, catalog rejection rate, media queue age, publication blockers, measurement rejection, and attribution reconciliation lag.

## 22. Success criteria

The product is not complete until all of the following are proved on a real backend:

1. Two concurrent requests for one unique item yield exactly one reservation.
2. Web, POS, and Live read the same authoritative availability.
3. Expired and failed-payment reservations release exactly once.
4. Unknown payment outcome does not duplicate charge or order.
5. Outbox retries do not duplicate provider-visible business effects.
6. Product intake reaches publication only after media and content gates.
7. GA4 purchase payload and server/browser dedupe pass contract tests.
8. Catalog provider issue readback is stored and visible.
9. Cross-tenant and wrong-location attempts fail closed.
10. Offline POS unique-item policy cannot oversell.
11. Arabic mobile workflows pass usability and accessibility review.
12. Production deployment parity, database migration evidence, worker health, rollback, and same-cycle smoke are complete.
