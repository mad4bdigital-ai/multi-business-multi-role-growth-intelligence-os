# Implementation Plan

## 1. Constitution check

| Gate | Result |
|---|---|
| SQL/runtime authority identified | Pass — MySQL plus exactly one selected Commerce Authority Adapter |
| Current repository baseline identified | Pass — reviewed at observed main SHA in manifest |
| Scope/non-goals explicit | Pass |
| Complete operation paths | Pass — see `operation-paths.md` |
| Security/tenant concerns | Pass — see `concerns.md` and security checklist |
| Contract-first posture | Pass — OpenAPI 3.1 and JSON Schema 2020-12 drafts included |
| Migration/rollback posture | Planned; no migration applied by this PR |
| Provider execution authority | Not created |
| Secrets | None included |

## 2. Target architecture

```text
public/platform RetailOS surface
  -> same-origin tenant API/BFF
    -> routes/commerceRoutes.js
      -> src/api/commerce/commerceController.js
        -> src/application/commerce/*UseCase.js
          -> src/domain/commerce/*
            -> src/infrastructure/commerce/*Repository.js
            -> src/infrastructure/commerce/adapters/*
              -> platform-native MySQL OR ERPNext/Frappe
          -> Context Kernel
          -> capability/approval services
          -> platform Outbox
          -> audit/evidence
```

## 3. Source-of-truth strategy

### 3.1 Stable platform boundary

Frontend, POS clients, GPT tools, and internal workflows call stable platform commerce operations. They do not call ERPNext, payment, shipping, or catalog providers directly.

### 3.2 Commerce Authority Adapter

Interface:

```js
resolveReadiness(context)
getCatalogProjection(query, context)
getProduct(productRef, context)
getInventory(target, context)
reserve(input, context, idempotency)
release(input, context, idempotency)
commitReservation(input, context, idempotency)
createOrder(input, context, idempotency)
submitPosSale(input, context, idempotency)
reconcilePayment(input, context, idempotency)
receiveSupplierLot(input, context, idempotency)
routeReturn(input, context, idempotency)
inspectOperation(operationRef, context)
readback(resourceRef, context)
```

Every adapter declares supported operations, transaction semantics, idempotency behavior, expected-version support, offline capability, readback method, and SLO.

### 3.3 Modes

- `platform_native`: domain repositories use MySQL and caller-owned transactions.
- `erpnext`: application layer delegates commerce authority to an ERPNext Adapter. Platform SQL stores safe operation, binding, workflow, publication, media, measurement, and evidence records; it does not become a second writable stock/order ledger.

## 4. Planned code structure

```text
http-generic-api/
  routes/commerceRoutes.js
  src/api/commerce/
    commerceController.js
    commerceErrorEnvelope.js
  src/application/commerce/
    commerceContextService.js
    catalogQueryService.js
    reservationService.js
    checkoutService.js
    posSaleService.js
    paymentReconciliationService.js
    supplierReceiptService.js
    returnService.js
    productIntakeService.js
    publicationService.js
    measurementGatewayService.js
    attributionReconciliationService.js
    operationProjectionService.js
  src/domain/commerce/
    errors.js
    valueObjects.js
    catalogPolicy.js
    inventoryStateMachine.js
    reservationPolicy.js
    orderStateMachine.js
    paymentStateMachine.js
    returnStateMachine.js
    mediaStateMachine.js
    publicationPolicy.js
    measurementPolicy.js
    offlineAllocationPolicy.js
  src/infrastructure/commerce/
    commerceComposition.js
    platformNativeCommerceRepository.js
    commerceOperationRepository.js
    commerceMediaRepository.js
    commerceMeasurementRepository.js
    adapters/
      commerceAuthorityAdapter.js
      platformNativeAdapter.js
      erpnextAdapter.js
      paymentAdapter.js
      shippingAdapter.js
      catalogAdapter.js
      measurementAdapter.js
  workers/
    commerceReservationExpiryWorker.js
    commerceReconciliationWorker.js
    commerceMediaWorker.js
    commerceCatalogWorker.js
    commerceMeasurementWorker.js
  schemas/commerce/
  openapi/
  public/platform/commerce/
```

Exact placement may adapt to current repository conventions, but route/domain/infrastructure boundaries are mandatory.

## 5. Context Kernel extension

Add repository ports and projections for:

- active commerce backend binding;
- location and terminal/device;
- sales channel;
- product/variant/Stock Unit resource;
- provider connections relevant to the operation;
- policy and capability revision.

The resolved context adds:

```json
{
  "commerce_backend": {
    "mode": "platform_native",
    "binding_id": "...",
    "adapter_key": "...",
    "revision": "..."
  },
  "location": { "location_id": "...", "revision": "..." },
  "channel": { "channel_key": "web" },
  "terminal": null
}
```

Context hashing invalidates pending plans, approval holds, and offline leases when backend/location/authority revisions change.

## 6. Domain transaction design

### Platform-native reservation

```sql
BEGIN;
SELECT ... FROM commerce_stock_units
 WHERE tenant_id=? AND workspace_id=? AND stock_unit_id=?
 FOR UPDATE;
-- validate state and version
INSERT INTO commerce_idempotency_records ...;
INSERT INTO commerce_reservations ...;
UPDATE commerce_stock_units
 SET state='reserved', version=version+1
 WHERE ... AND state='available' AND version=?;
INSERT INTO platform_outbox_events ...; -- existing connection
COMMIT;
```

Use a uniqueness constraint preventing more than one active reservation per unique Stock Unit.

### ERPNext reservation

A certified Frappe endpoint performs equivalent atomic behavior inside ERPNext. The platform operation ledger records request fingerprint, adapter receipt, normalized result, and readback. The platform must not pre-write a contradictory local reservation ledger as authority.

## 7. Outbox event families

Register versioned events:

- `commerce.product.changed.v1`
- `commerce.stock_unit.available.v1`
- `commerce.reservation.created.v1`
- `commerce.reservation.released.v1`
- `commerce.reservation.expired.v1`
- `commerce.order.created.v1`
- `commerce.order.confirmed.v1`
- `commerce.pos.sale.completed.v1`
- `commerce.payment.outcome_changed.v1`
- `commerce.return.routed.v1`
- `commerce.supplier_lot.received.v1`
- `commerce.media.processing_requested.v1`
- `commerce.content.approved.v1`
- `commerce.publication.changed.v1`
- `commerce.catalog.delta_requested.v1`
- `commerce.measurement.event_accepted.v1`

Payloads contain identifiers, revisions, safe facts, and `secrets_included:false`; no customer PII or credentials.

## 8. Worker strategy

- Workers claim SQL/Outbox state and may use BullMQ for execution transport.
- SQL can reconstruct jobs after Redis loss.
- Reservation expiry has a dedicated indexed due-time query and advisory/exclusive claim.
- Catalog and measurement consumers use destination-specific idempotency.
- Media pipeline stages persist each output and do not restart successful stages.
- Reconciliation workers inspect unknown payment/provider states and never fabricate success.

## 9. Frontend strategy

### 9.1 Surface registration

Add a RetailOS tenant family to frontend surface discovery and explicit policy. Generated dispatch artifacts are updated from canonical sources, never manually.

### 9.2 Application modules

- Storefront;
- POS;
- Inventory;
- Supplier/QC;
- Product Intake/Studio;
- Content/Publication;
- CRM/Returns;
- Tracking/Catalogs/Ads;
- Automation Assurance;
- Operation/Evidence timeline.

### 9.3 UX rules

- Arabic RTL first, English available;
- mobile/tablet/desktop;
- same domain status labels as API;
- automatic controls represented as status/evidence;
- QA Sandbox isolated and disabled in production;
- no browser-held backend/provider secrets;
- mutations show pending/confirmed/unknown states truthfully.

## 10. Provider adapter strategy

### ERPNext/Frappe

- app installation and version handshake;
- OAuth/API credential through existing connection governance;
- tenant/workspace/brand mapping;
- item, warehouse, supplier, employee, POS, invoice, payment, receipt mapping;
- custom Frappe methods for unique Stock Unit reservation if standard behavior is insufficient;
- sandbox contract suite;
- normalized errors and readback.

### Catalogs

One provider-neutral publication model, provider-specific mappers, issue readback, and reconciliation.

### Payment

Provider-neutral intent/outcome/refund model; webhook HMAC/signature profiles; unknown-outcome inspection.

### Measurement

Destination-neutral accepted event; GA4/server adapters; consent and PII policy before delivery.

## 11. Implementation PR slices

### PR-1 — Contract and domain policy foundation

- schemas, stable errors, state machines, adapter interfaces;
- no database writes or public routes;
- unit tests.

### PR-2 — Context and backend binding

- commerce backend/location/channel resource types;
- Context Kernel extension;
- backend ambiguity/staleness tests.

### PR-3 — Platform-native catalog and inventory schema

- additive migrations;
- lifecycle registry;
- catalog/variant/Stock Unit repositories;
- read-only projections.

### PR-4 — Atomic reservation and operation ledger

- idempotency, version, transaction, Outbox;
- concurrency and expiry tests;
- no external providers.

### PR-5 — Orders, POS, payments, and returns

- order/payment/return state machines;
- POS terminal/shift/offline lease foundations;
- provider adapter stubs and sandbox tests.

### PR-6 — Supplier receipt and QC workflows

- lots, receipts, sampling policy;
- sequential plan bindings and approval boundaries.

### PR-7 — Media and product intake

- scoped upload sessions;
- Shot Lists, media assets, pipeline ledgers;
- AI draft and human-review contracts.

### PR-8 — Publication and catalog adapters

- publication versions;
- Google/Meta/TikTok adapter contracts;
- Outbox consumers and provider issue readback.

### PR-9 — Measurement and attribution

- event dictionary/ledger;
- GA4 schema, consent, PII rejection, dedupe;
- spend/order/refund reconciliation and contribution facts.

### PR-10 — ERPNext/Frappe adapter pilot

- adapter and custom Frappe app contract;
- sandbox certification;
- no production cutover.

### PR-11 — RetailOS tenant frontend

- governed surface registration;
- responsive Arabic modules;
- API adapters, accessibility, visual tests.

### PR-12 — Production hardening and cutover

- fault injection, load/concurrency, backup/restore, alerts, runbooks;
- controlled pilot tenant;
- parity and production smoke;
- rollback and closeout.

Slices may be subdivided further; unrelated runtime repairs must not be added to Spec 014 branches.

## 12. Testing strategy

### Unit

- state transitions;
- policy and threshold decisions;
- event normalization;
- PII rejection;
- adapter error normalization;
- offline lease rules.

### Integration

- SQL transaction and Outbox atomicity;
- two-client reservation race;
- reservation expiry;
- payment unknown/reconciliation;
- return/refund linkage;
- worker retry/dead-letter;
- Context Kernel cross-tenant/wrong-resource.

### Contract

- OpenAPI validation;
- JSON Schema events;
- frontend/API parity;
- ERPNext sandbox adapter;
- payment/catalog/measurement adapter fixtures.

### Fault injection

- DB deadlock/retry;
- Redis disabled/restart;
- provider timeout and conflicting readback;
- duplicate webhook;
- stale context/version;
- Outbox consumer crash after provider call;
- image worker failure;
- catalog provider partial rejection.

### Experience

- Arabic RTL;
- mobile 360/390 widths;
- tablet POS;
- keyboard and screen reader;
- offline/reconnect states;
- no horizontal overflow;
- truthful state labels.

## 13. Rollout

1. contracts and read-only catalog projections;
2. shadow reservation decisions without writes;
3. platform-native sandbox with deterministic inventory;
4. ERPNext sandbox adapter;
5. one pilot branch and test catalog;
6. online reservations, then POS, then Live;
7. catalog deltas and measurement;
8. content/media pipeline;
9. broader tenant enablement.

All mutations are feature-flagged by tenant/workspace/backend and capability. Disabled mode keeps read-only health and reconciliation available.

## 14. Rollback

- disable commerce mutations through execution enablement/feature policy;
- keep readback and operation inspection available;
- stop workers after lease checks;
- restore previous frontend surface decision/route;
- reverse additive migration only when safe; otherwise leave tables inert and registered;
- for adapter cutover, return authority to prior backend only through governed reconciliation plan;
- never roll back by enabling dual writable backends.

## 15. Documentation and operations

Implementation must add:

- architecture ADR;
- adapter certification guide;
- reservation/payment/catalog/media runbooks;
- dashboard/alert definitions;
- migration and rollback evidence;
- frontend user guidance in Arabic and English;
- production parity closeout.
