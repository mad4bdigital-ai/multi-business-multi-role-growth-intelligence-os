# Gap and Reuse Matrix

| Capability | Existing repository foundation | Verified limitation | Spec 014 implementation decision |
|---|---|---|---|
| Tenant/workspace/brand resolution | Context Kernel, resource graph, connection ownership, context revision/hash | No commerce backend/location/channel selection | Extend Context Kernel repository ports and projections with commerce backend, location, channel, terminal, and target-resource binding |
| Authorization | Capabilities, grants, resource authority, execution capsules, approval policies | No commerce capability taxonomy | Register commerce resource operations and capabilities; default deny; exact target and backend binding |
| Products | Brand/business registries, workspace assets, generic Resource API | No complete product/variant/Stock Unit ledger | Add dedicated commerce catalog domain and SQL schema or ERP adapter projection |
| Unique inventory | SQL transactions and `FOR UPDATE` patterns in orchestrators | No retail reservation invariant | Implement atomic reservation repository with version, unique constraints, expiry, and Outbox |
| POS | Unified frontend and user auth foundation | No verified POS sale/shift/device domain | Add POS application service, terminal/device identity, shift and settlement model, offline allocation policy |
| Online checkout | HTTP runtime, jobs, provider connections | No cart/order/payment domain | Add checkout, price snapshot, order, payment intent/reconciliation state machines |
| Offline POS | Local Manager/device identity and connector capability governance | No offline retail allocation | Reuse device identity; add signed allocation leases and conflict reconciliation |
| Suppliers | Connected systems and generic workflow plans | No supplier lot/receipt/QC domain | Add purchase receipt projection, supplier lot, QC policy/tasks, ERP adapter mappings |
| Employees/HR | Users, memberships, actor profiles, roles | No HR/payroll ledger | Project HR from selected ERP adapter; avoid duplicating statutory HR unless separately specified |
| Returns/refunds | Approval and workflow foundations | No return inspection/refund state model | Add return case, inspection decision, restock routing, refund operation and reconciliation |
| Media upload | Upload IDs, Drive upload, workspace assets, upload processing | Generic text/schema/repo pipeline; no camera/media contract | Add signed/scoped media upload session, object storage adapter, checksums, safety hooks, derivatives |
| Photography workflow | Sequential plans and background jobs | No Shot List/AI attribute/content workflow | Add category policy, shoot session, media pipeline, AI draft, human review, content gate |
| AI content | AI model providers and agent runtime governance | No commerce field evidence/confidence contract | Add field-level confidence/evidence, model version, prohibited claims, review thresholds |
| Publication | Outbox and provider adapter governance | No product publication/version ledger | Add publication revision, channel mapper, provider delivery/readback, automatic disable events |
| Google/Meta/TikTok catalogs | Connected systems, credentials, provider policies | No catalog feed adapter or issue ledger | Add catalog provider family, adapters, delta consumer, full reconciliation, issue readback |
| GA4/GTM | Analytics schema bindings, WordPress tracking inventory | No ecommerce measurement event ledger | Add Measurement Gateway, GA4 schemas, consent, PII rejection, browser/server dedupe, delivery evidence |
| Advertising governance | Ads provider profile, credential readiness, budget preflight | Primarily proposal/readiness; no unified fact/attribution ledger | Add spend ingestion, campaign facts, order reconciliation, contribution metrics; keep mutations separately gated |
| CRM/customer timeline | Sessions, customers/contacts, support ticket and Growth Intelligence capabilities | No commerce customer/order timeline | Add safe commerce projections and complaint links; PII-separated access |
| Complaint feedback | Audit, recommendations, workflows | No commerce threshold policy | Add deduplicated complaint signal and policy-driven Audit Finding creation |
| Live Commerce | Workflow and messaging foundations | No live session/reservation domain | Add live session/product binding and reuse atomic reservation/payment link contracts |
| Outbox | Mature platform Outbox with claims/retry/dead-letter | Commerce event types absent | Register versioned commerce events and consumers; use same transaction as domain writes |
| Jobs | BullMQ/Redis optional, async job records | Redis can be disabled and entries expire | SQL is authority; workers reconstruct pending work from SQL/Outbox; Redis is transport only |
| Unknown outcomes | Context Kernel reconciliation service | No payment/catalog-specific readback ports | Implement provider-specific readback and normalized outcomes without blind retry |
| Frontend | `/platform`, governed surface discovery/policy, responsive shell | Demo is standalone and tenant shell is incomplete | Register RetailOS surface, explicit BFF/API adapters, Arabic RTL, PWA and accessibility gates |
| Audit/evidence | execution log, audit log/event bus, operational alerts | Commerce evidence vocabulary absent | Add bounded event taxonomy, metrics, alert rules, and no-secret payload projections |
| Migrations | governed migration ledger/lifecycle and CI guards | Commerce tables not present | Multi-PR migrations, lifecycle registration, dry-run/readback, additive rollout and rollback |
| ERPNext | Generic connections/providers and external endpoint auth | No certified ERPNext adapter | Add adapter contract and Frappe app certification; one authoritative backend per Workspace |

## Reuse classification

### Reuse directly

- Context Kernel concepts and services;
- capability and authority evaluation;
- execution plan/approval records;
- transactional Outbox framework;
- audit and operational evidence;
- provider/credential registry;
- SQL pool and migration governance;
- frontend surface policy and generators.

### Reuse with bounded extension

- Resource API for read projections;
- BullMQ worker transport;
- upload pipeline metadata and ownership patterns;
- Growth Intelligence recommendations;
- ads provider governance;
- analytics binding schema;
- Local Manager device identity for POS terminals.

### Build new

- Commerce Authority Adapter;
- product/variant/Stock Unit domain;
- reservations and availability service;
- order/POS/payment/return ledgers;
- supplier lot and QC model;
- commerce media and content pipelines;
- catalog and measurement gateways;
- attribution and contribution fact model;
- RetailOS tenant frontend modules;
- commerce contract and parity test suites.

## Architectural anti-patterns rejected

1. Using Google Sheets as stock authority.
2. Treating `workspace_assets` as a replacement for product and inventory records.
3. Calling three sales channels directly inside the reservation transaction.
4. Letting Redis be the only record of a reservation or media job.
5. Copying ERPNext data into an independent writable platform ledger while ERPNext remains writable.
6. Adding commerce SQL directly to route files.
7. Hardcoding tenant, brand, branch, provider, or user-specific conditions.
8. Requiring human approval for automatic consistency controls.
9. Sending raw customer or provider payloads to analytics/audit logs.
10. Promoting the static HTML demo as the production frontend without contracts and backend evidence.
