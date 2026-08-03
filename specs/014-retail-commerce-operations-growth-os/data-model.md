# Data Model and State Contracts

## 1. Authority model

The platform stores one active commerce backend binding per Workspace.

### `commerce_backend_bindings`

| Column | Purpose |
|---|---|
| `binding_id` | Stable UUID |
| `tenant_id`, `workspace_id`, `workspace_key` | Scope |
| `brand_key` | Optional narrower binding |
| `backend_mode` | `platform_native` or `erpnext` |
| `adapter_key` | Certified adapter |
| `connection_id` | Governed provider connection reference |
| `authority_domains_json` | Inventory/order/payment/procurement/HR domains owned |
| `status` | planned, active, read_only, disabled, retired |
| `revision` | Monotonic version |
| `effective_from`, `effective_until` | Lifecycle |
| `created_by`, `approved_by` | Governance refs |

Constraints:

- at most one active writable binding for each workspace/domain;
- no credential material;
- activation requires adapter certification and context readback.

## 2. Platform-native catalog and inventory

These tables are authoritative only when backend mode is `platform_native` for their domain.

### `commerce_products`

- product ID, tenant/workspace/brand;
- product type/category/taxonomy;
- lifecycle and publication readiness;
- default language and translation refs;
- version and timestamps.

### `commerce_product_variants`

- variant ID and product ID;
- SKU/barcode;
- option values such as size/color;
- fungibility mode: `fungible` or `unique_units`;
- unit of measure;
- version.

Unique keys are tenant/workspace scoped. Provider/channel identifiers are stored in mapping tables, not used as primary identity.

### `commerce_stock_units`

For exact physical items:

- `stock_unit_id`;
- tenant/workspace/brand;
- product and variant;
- supplier lot;
- barcode/serial;
- location and bin;
- state;
- condition grade;
- cost reference;
- current active reservation;
- version;
- timestamps.

State machine:

```text
pending_intake -> pending_qc -> available
available -> reserved -> sold
reserved -> available
sold -> returned_pending_inspection
returned_pending_inspection -> available | quarantine | damaged | supplier_return
available -> quarantine | transferred
quarantine -> available | damaged | supplier_return
```

### `commerce_inventory_balances`

For fungible variants:

- variant/location;
- on_hand;
- reserved;
- available derived or constrained;
- allocated_offline;
- quarantine;
- version.

Balance mutation uses a ledger or guarded delta operation. No unbounded arbitrary overwrite without override evidence.

### `commerce_inventory_movements`

Append-only movement ledger:

- source/target state/location;
- quantity or Stock Unit;
- reason and source operation;
- order/return/receipt/transfer links;
- actor and context refs;
- created timestamp.

## 3. Reservations and offline allocations

### `commerce_reservations`

- reservation ID;
- exact Stock Unit or variant quantity;
- tenant/workspace/brand/location/channel;
- customer/session/order refs;
- status;
- expiry;
- idempotency scope;
- price snapshot ref;
- context revision/hash;
- version;
- created/released/committed timestamps.

States:

```text
active -> committed
active -> released
active -> expired
active -> cancelled
```

Unique constraint for unique units prevents more than one active reservation.

### `commerce_offline_allocation_leases`

- lease ID;
- terminal/device and branch;
- Stock Unit or variant quota;
- signed lease fingerprint;
- issued/expiry/reconciled timestamps;
- issued context revision;
- status: active, consumed, released, expired, conflicted, revoked;
- version.

A unique Stock Unit has at most one active lease or online reservation.

## 4. Pricing and carts

### `commerce_price_lists`

Scope, currency, channel/location applicability, status, policy version.

### `commerce_prices`

Variant/product, list price, sale price, cost visibility class, tax class reference, effective window, version.

### `commerce_price_snapshots`

Immutable checkout/POS snapshot containing safe item prices, discounts, tax/shipping components, policy revision, currency, and hash.

### `commerce_carts` and `commerce_cart_lines`

Optional durable carts. Cart state is not stock authority. A cart line references a reservation when stock is held.

## 5. Orders, POS, payments, and fulfillment

### `commerce_orders`

- order ID/number;
- tenant/workspace/brand;
- channel/location;
- customer ref;
- status;
- currency and totals;
- price snapshot;
- reservation refs;
- attribution snapshot;
- fulfillment mode;
- context revision;
- idempotency key hash;
- version.

States:

```text
draft -> awaiting_payment -> confirmed -> allocated -> fulfilled
awaiting_payment -> cancelled
confirmed -> partially_fulfilled | cancelled_by_compensation
fulfilled -> return_open | completed
```

### `commerce_order_lines`

Product/variant/Stock Unit, quantity, price/tax/discount/cost refs, fulfillment and return status.

### `commerce_pos_shifts`

Terminal, branch, cashier, open/close times, opening float, expected/declared totals, variance, manager decision, status.

### `commerce_pos_sales`

Order/invoice projection, shift, terminal/device, payment method summary, receipt ref, external ERP ref, safe status.

### `commerce_payment_operations`

- operation ID;
- order/refund;
- provider connection and safe reference;
- operation type: authorize/capture/refund/void/readback;
- amount/currency;
- status;
- provider idempotency reference hash;
- outcome classification;
- unknown-outcome deadline;
- attempts;
- version.

States:

```text
created -> dispatched -> pending | captured | failed | unknown
unknown -> captured | failed | conflict | manual_review
captured -> partially_refunded | refunded
```

No card or wallet instrument data is stored.

### `commerce_fulfillments`

Shipping/pickup, provider reference, location, status, tracking projection, attempts, proof/evidence refs.

## 6. Suppliers, receipts, and quality

### `commerce_suppliers`

Safe supplier business identity and ERP references. Credentials are never stored here.

### `commerce_purchase_receipts`

Receipt identity, PO ref, supplier, location, date, totals, status, adapter receipt, version.

### `commerce_supplier_lots`

Lot identity, receipt, supplier, category, quantity/cost, quality status, provenance.

### `commerce_quality_tasks`

Sampling policy, target units, required checks, assignee/role, status, due time, workflow/approval refs.

### `commerce_quality_inspections`

Task/unit, evidence, decision, defect codes, measurements, inspector, version.

Supplier scores are derived projections from receipts, inspections, defects, returns, and lead times.

## 7. Returns and refunds

### `commerce_returns`

Return ID, order/customer/channel/location, policy version, reason, status, requested/received/inspected timestamps, version.

### `commerce_return_lines`

Order line/Stock Unit, requested quantity, inspection status, disposition, refund linkage.

### `commerce_refund_operations`

May reuse payment operation structure with separate business identity and approval thresholds.

Return states:

```text
requested -> authorized -> received -> inspection_required
inspection_required -> accepted | rejected
accepted -> refund_pending -> refunded
accepted -> exchange_pending -> completed
```

## 8. Product intake and media

### `commerce_product_intakes`

- intake ID;
- source supplier/lot;
- product/variant/Stock Unit refs;
- category and policy version;
- status;
- workflow plan ref;
- creator and context.

### `commerce_shot_list_policies`

Category/channel policy, required shot keys, minimum count, measurement/evidence requirements, status/version.

### `commerce_shoot_sessions`

Intake, device/operator, status, required/completed counts, started/completed timestamps.

### `commerce_media_upload_sessions`

Scoped upload token hash, intake/shoot session, MIME/size rules, expiry, status, storage adapter.

### `commerce_media_assets`

- media ID;
- storage ref;
- checksum/perceptual hash;
- MIME/dimensions/size;
- shot key;
- product/variant/Stock Unit/intake links;
- quality status;
- lifecycle status;
- version.

### `commerce_media_derivatives`

Original asset, derivative type, dimensions, encoding, storage ref, pipeline stage/version.

### `commerce_media_pipeline_runs`

Pipeline run, stages, status, attempts, worker claim, error classification, source/output refs, timing.

## 9. AI attributes and content

### `commerce_ai_attribute_drafts`

One run per product/intake/model/profile revision.

### `commerce_ai_attribute_values`

- field key;
- candidate value;
- confidence;
- evidence media/measurement refs;
- model and prompt/profile versions;
- validation status;
- human decision, reviewer, timestamp.

### `commerce_content_revisions`

Language, channel profile, title, descriptions, bullets, SEO, alt text, live script, source draft, approval status, hash/version.

### `commerce_publications`

Product/variant, channel, provider connection, content/media/price/stock revision refs, status, external item ref, last readback, version.

States:

```text
draft -> validation_pending -> needs_review -> approved -> queued -> published
validation_pending -> blocked
published -> suspended | update_queued | retired
```

## 10. Measurement, catalog, ads, and attribution

### `commerce_measurement_event_dictionary`

Event key/version, schema ref, required items, allowed destinations, consent class, PII policy, active status.

### `commerce_measurement_events`

Accepted internal event:

- event ID and version;
- tenant/workspace/brand/site/channel;
- anonymous/session/customer pseudonymous refs;
- event time;
- transaction/order/product refs;
- normalized safe payload;
- consent snapshot;
- status;
- dedupe fingerprint.

### `commerce_measurement_deliveries`

Event/destination, delivery identity, status, attempts, response classification, readback, timestamps.

### `commerce_catalog_mappings`

Canonical product/variant to provider account/catalog/item identity, publication ref, status, version.

### `commerce_catalog_sync_runs` and `commerce_catalog_issues`

Delta/full mode, provider, item counts, accepted/warnings/rejected, provider issue code/message excerpt, resolution.

### `commerce_ad_fact_imports`

Provider/source/date window, immutable import identity, status, counts, source revision.

### `commerce_ad_facts`

Campaign/ad set/ad/creative/product/location/date metrics. Provider facts remain distinct by provider and attribution window.

### `commerce_attribution_snapshots`

Order/transaction, first touch, last touch, platform-reported, GA, ERP source, model/version, confidence and evidence.

### `commerce_contribution_facts`

Revenue, COGS, discount, payment fees, shipping subsidy, return cost, ad spend, contribution; currency and FX revision.

## 11. CRM and complaints

### `commerce_customer_refs`

Safe link from commerce to an existing customer identity/vault. Public analytics uses pseudonymous refs only.

### `commerce_complaints`

Order/product/Stock Unit links, normalized type, severity, evidence, status, owner, timestamps.

### `commerce_complaint_clusters`

Policy window, fingerprint, count, threshold, finding/action refs, lifecycle.

## 12. Operations, idempotency, and evidence

### `commerce_operations`

Canonical projection of every long or provider-bound operation:

- operation ID/type;
- tenant/workspace/resource;
- actor/capability;
- backend/adapter;
- request fingerprint;
- idempotency scope;
- context revision/hash;
- execution/delivery/readback/compensation states;
- correlation/request IDs;
- safe error;
- timestamps.

### `commerce_idempotency_records`

Scope key hash, request hash, operation/resource result, status, expiry/retention. Reusing a key with a different request hash returns conflict.

### `commerce_reconciliation_runs`

Domain/provider/window, candidates, confirmed, repaired, unresolved, evidence refs, status.

### Existing platform tables reused

- `platform_outbox_events` and deliveries;
- `execution_plans`, steps, events, runs;
- `approval_holds`;
- `execution_log`;
- `audit_log`, `audit_payload_evidence`, `platform_audit_event_bus`;
- provider, credential, connection, capability, authority, graph, and lifecycle registries.

## 13. Provider-mode projection tables

When ERPNext is authoritative, platform-native tables for stock/order authority are either absent, inactive, or projection-only. The platform stores:

- external resource mapping;
- adapter operation receipt;
- normalized safe read model;
- synchronization/version status;
- operation and readback evidence.

Each projection row declares `authority_class = external_projection` and cannot be mutated by platform-native repository methods.

## 14. Index and integrity requirements

At minimum:

- tenant/workspace leading indexes;
- unique active backend/domain binding;
- unique active reservation per unique Stock Unit;
- due reservation index on status/expiry;
- idempotency scope unique key;
- provider delivery identity unique key;
- measurement event/destination unique key;
- transaction/order identity uniqueness;
- publication channel/product/revision uniqueness;
- foreign-key or application-enforced exact tenant consistency;
- version columns for conflict-sensitive aggregates;
- bounded JSON columns validated by schemas.

## 15. Retention and lifecycle

- active commerce ledgers: retained per business/legal policy;
- idempotency: enough to cover provider and client retry windows;
- measurement event details: bounded retention then aggregate/anonymize;
- provider response excerpts: minimal and bounded;
- media originals/derivatives: policy by publication/legal need;
- AI prompts/results: safe structured fields and version metadata, no raw secrets;
- audit evidence: immutable/bounded according to governance policy.

All new tables must be registered in `database_table_lifecycle_registry` with owner, backup, retention, sensitivity, and recovery class.
