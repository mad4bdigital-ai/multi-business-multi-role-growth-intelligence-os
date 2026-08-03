# Brownfield Research and Repository Reuse Assessment

## 1. Evidence boundary

This research is a repository review against `main` at observed SHA:

```text
06ed62c6d72fd9015294628efbff47c38545c6ad
```

The review establishes code and contract presence. It does not prove that every table is migrated in production, every provider is connected, every worker is enabled, or every described feature is behaviorally certified.

## 2. Repository identity

The repository is a governed multi-tenant execution and Growth Intelligence operating system. It is not currently a complete ERP, ecommerce engine, or retail POS product. Its strongest reusable assets are control-plane and execution capabilities rather than commerce ledgers.

Authoritative architecture order remains the canonical documents and SQL registries. Runtime business state is SQL-primary; Google Sheets is legacy, mirror, or recovery only.

## 3. Context and isolation foundation

### Verified code

- `http-generic-api/contextKernel/`
- `http-generic-api/contextKernel/application/contextResolutionService.js`
- `http-generic-api/contextKernel/application/executionPlanService.js`
- `http-generic-api/contextKernel/application/unknownOutcomeReconciliationService.js`
- `specs/012-unified-admin-tenant-context-kernel/architecture.md`

### Reusable capability

The Context Kernel already models authenticated principal, authorized scope, tenant, workspace, optional brand, target resource, exact connection, capability readiness, context revision, and context hash.

### Commerce use

Commerce must extend the candidate and resource graph with:

- commerce backend;
- branch/location;
- sales channel;
- product/variant/Stock Unit;
- POS terminal/device;
- supplier;
- publication/catalog connection.

The API layer must not choose a backend or connection directly. It passes authenticated evidence to an application use case that resolves exact commerce context.

### Required gap

There is no verified Commerce Context resolver or backend selection contract. Spec 014 introduces one selected authoritative backend per Workspace and rejects ambiguous or stale selection.

## 4. SQL and data authority

### Verified code

- `http-generic-api/stateManager.js`
- `http-generic-api/sqlAdapter.js`
- `http-generic-api/db.js`
- `docs/work-maps/data-model-domain-map.md`
- governed migration scripts and lifecycle registry.

### Existing useful data

Brand Registry mappings already include measurement identifiers such as GA and GTM bindings. The repository contains tenancy, users, memberships, connected systems, credential bindings, assets, workflows, approvals, execution logs, audit, resource graph, and provider governance tables.

### Critical gap

Repository search and the generated data-model map did not establish an authoritative commerce domain containing complete product, variant, Stock Unit, reservation, cart/order, payment, return, supplier lot, publication, and attribution ledgers.

Terms such as inventory in current code often mean route/schema inventory or migration inventory, not retail stock.

### Decision

New commerce tables and/or an ERP adapter are required. Existing generic resources are not sufficient to enforce stock invariants.

## 5. Resource API layering

### Verified code

- `http-generic-api/routes/resourceApiRoutes.js`
- `http-generic-api/src/api/resourceApi/resourceApiController.js`
- `http-generic-api/src/application/resourceApi/resourceApiService.js`
- `http-generic-api/src/domain/resourceApi/resourceCatalog.js`
- `http-generic-api/src/infrastructure/resourceApi/resourceRepository.js`
- `docs/adr-2026-06-22-resource-api-layer-boundaries.md`

### Reusable capability

The repository has a tested layering rule:

```text
Route -> Controller -> Application -> Domain -> Infrastructure
```

SQL is prohibited above infrastructure. Express and JWT are prohibited in domain/application modules.

### Current limitation

Current Resource API descriptors are primarily sessions, executions, assets, and approvals. Commerce cannot be added as a large switch statement inside the route or current static descriptor object.

### Decision

Create a dedicated commerce bounded context following the same layering discipline. Add safe read projections to Resource API only where generic resource browsing is useful; keep transactional operations in commerce application services.

## 6. Workflow, orchestration, and approvals

### Verified code

- `http-generic-api/sequentialPlanOrchestrator.js`
- `http-generic-api/routes/workflowOrchestrationRoutes.js`
- `docs/sequential-plan-orchestration-architecture.md`
- tables such as `execution_plans`, `execution_plan_steps`, `execution_plan_events`, `workflow_runs`, `step_runs`, and `approval_holds`.

### Reusable capability

The orchestrator supports transactions, dependency-aware steps, stable idempotency, bounded attempts, append-only events, approval holds, resume, and asynchronous execution.

### Correct commerce use

Use plans for long-running or multi-party flows:

- supplier receipt and quality sampling;
- product intake, photography, AI draft, review, and publication;
- return inspection and routing;
- complaint pattern to Audit Finding;
- campaign creation and approval;
- periodic reconciliation.

### Incorrect commerce use

Do not use workflow approvals for atomic invariants:

- preventing a second reservation;
- releasing an expired reservation;
- applying a confirmed payment callback;
- updating availability after commit;
- deduplicating measurement events.

Those are domain rules and automatic workers.

## 7. Transactional Outbox

### Verified code

- `http-generic-api/platformOutbox.js`
- `http-generic-api/scripts/platform-outbox-worker.mjs`
- `docs/runbooks/transactional-outbox-shadow-sync.md`
- migration foundation for `platform_outbox_events` and deliveries.

### Reusable capability

The Outbox supports caller-owned SQL transactions, aggregate identity, payload hashing, bounded payloads, sensitive-field rejection, claims, retries, dead-letter, consumer health, delivery allowlists, and lag metrics.

### Commerce use

A commerce transaction writes business state and an event in the same SQL transaction. Consumers then handle:

- storefront cache invalidation;
- catalog feed delta;
- analytics event routing;
- customer notifications;
- growth metrics;
- search projection;
- ERP or external mirror updates when not authoritative.

### Required extensions

- register commerce event types;
- implement consumer-specific idempotency;
- define payload schemas and retention;
- add commerce health and reconciliation views;
- add partitioning/archival strategy at scale.

## 8. Queue and background work

### Verified code

- `http-generic-api/queue.js`
- `http-generic-api/executionAsync.js`
- BullMQ, Redis, worker concurrency, Redis idempotency, job status, generic async submission.

### Operational limitation

Redis is optional. When `REDIS_URL` is absent, queue features are disabled. Redis job and idempotency records have finite TTLs.

### Decision

SQL commerce state, Outbox, pipeline run, and provider delivery ledgers are authoritative. BullMQ is a transport/claim mechanism. A lost Redis queue must be reconstructable from SQL pending state.

## 9. Provider and credential governance

### Verified code and registries

- `connected_systems`
- `app_integrations`
- `installations`
- `credential_bindings`
- `provider_authorization_states`
- `user_app_connections`
- external delivery adapter registries;
- ads provider capability, preflight, and readiness registries;
- `http-generic-api/adsProviderGovernanceSnapshotProposal.js`.

### Reusable capability

The platform can separate provider profile, credential metadata, execution enablement, capability, preflight, budget authority, and readback.

### Commerce use

Define provider families/adapters for:

- ERPNext/Frappe;
- payment gateways;
- shipping providers;
- Google Merchant;
- Meta Catalog;
- TikTok Catalog;
- WhatsApp messaging;
- GA4 Measurement Protocol or server-side collection;
- image processing and AI model providers.

### Safety rule

Provider credentials are referenced by connection identity and resolved at dispatch. They never appear in commerce rows, Outbox payloads, frontend responses, or evidence.

## 10. Ads governance

### Verified capability

The repository has Google Ads governance profile, credential readiness, budget preflight, execution enablement, and proposal-only snapshots.

### Gap

There is no verified complete ad-performance fact ledger, cross-channel cost ingestion, order-level contribution reconciliation, or production ad mutation adapter in the reviewed baseline.

### Decision

Spec 014 adds read/reconciliation first. Spend mutations remain a separately enabled high-risk provider capability.

## 11. Analytics and tracking

### Verified capability

- `schemas/analytics.schema.json` contains brand measurement and tracking bindings.
- Brand Registry SQL mappings include GA property and GTM container identifiers.
- WordPress Phase H inventories GA, GTM, Meta Pixel, TikTok Pixel, custom tracking, and consent signals.

### Gap

The reviewed code does not establish a unified commerce event ledger with GA4 ecommerce schema validation, consent routing, browser/server deduplication, transaction reconciliation, and provider delivery evidence.

### Decision

Add a Measurement Gateway bounded by versioned event schemas. Accepted events are normalized and routed after policy checks; rejected or duplicate events remain visible as bounded evidence.

## 12. Media and uploads

### Verified capability

- `http-generic-api/uploadPipeline.js`
- `http-generic-api/routes/uploadRoutes.js`
- `uploads` table;
- Drive upload, metadata, processing status, schema/repository import pipelines;
- `workspace_assets` and Resource API asset lifecycle;
- WordPress Phase E media inventory and classification.

### Limitations

The generic upload path is designed around content/schema/repository ingestion and Drive storage. It is not a product-camera pipeline with signed upload sessions, image safety scanning, derivatives, Shot List evidence, AI attribute drafts, and publication gates.

### Decision

Reuse ownership, upload IDs, assets, and Drive/provider patterns only where appropriate. Introduce commerce media sessions and assets with object-storage/provider adapters. Raw media bytes must not be routed through JSON request bodies in production.

## 13. Unified frontend

### Verified capability

- `/platform` application shell;
- `/platform/ui-surfaces` governed catalog;
- `frontend-surface-policy.json` fail-closed decisions;
- deterministic discovery and dispatch generator;
- CSP and security headers;
- responsive public shell baseline.

### Gap

Authenticated tenant workspaces and a production RetailOS surface are not established by the static HTML demos.

### Decision

Register Retail Commerce as a governed tenant surface family. Build explicit tenant adapters and a same-origin BFF/API boundary. Do not ship the standalone demo as the production app.

## 14. Audit and observability

### Verified capability

- `execution_log`
- `audit_log`
- `audit_payload_evidence`
- `platform_audit_event_bus`
- operational alerts and readiness surfaces;
- canonical no-secret and readback rules.

### Commerce use

Record bounded business evidence and metrics, not full customer, payment, provider, or media payloads. Commerce events require stable operation, aggregate, context, state transition, and readback references.

## 15. ERPNext/Frappe assessment

ERPNext is not currently embedded as a verified repository module. The implementation should treat it as a governed connected system through an adapter application.

The adapter must provide normalized methods such as:

```text
resolveReadiness
reserveStock
releaseReservation
commitReservation
createOrder
submitPosInvoice
reconcilePayment
receiveSupplierLot
recordReturn
readInventory
readOrder
readEmployeeProjection
readSupplierProjection
```

If standard ERPNext cannot supply exact unique-item reservation or atomic cross-channel behavior, a versioned Frappe app is required. The app and platform adapter must be certified together.

## 16. Recommended bounded contexts

```text
commerce/context
commerce/catalog
commerce/inventory
commerce/reservations
commerce/orders
commerce/pos
commerce/payments
commerce/suppliers
commerce/returns
commerce/media
commerce/content
commerce/publications
commerce/measurement
commerce/attribution
commerce/customer-service
commerce/reconciliation
commerce/providers
```

## 17. Final Brownfield conclusion

The platform does not need a second orchestration framework. It needs a commerce domain that plugs into the existing governed runtime.

The strongest implementation path is:

1. preserve Context Kernel and authority resolution;
2. add a single commerce authority adapter per Workspace;
3. implement atomic domain transactions and state machines;
4. write committed events through the existing Outbox;
5. reuse workflow plans only for durable multi-step processes;
6. use existing provider, credential, approval, evidence, and frontend governance;
7. add contract and runtime parity tests before claiming the demo is implemented.
