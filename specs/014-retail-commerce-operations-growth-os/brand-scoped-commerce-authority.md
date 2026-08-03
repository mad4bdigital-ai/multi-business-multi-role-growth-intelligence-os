# Brand-Scoped Commerce Authority

## 1. Normative status

This document is a normative amendment to Spec 014.

It supersedes every earlier phrase that treats Brand as optional for commerce execution or assigns one commerce authority only at Workspace level, including the original wording of `G-002`, `FR-CTX-001`, and `FR-CTX-004` in `spec.md`.

The governing rule is:

> A Workspace is an administrative and collaboration container. Every commerce operation MUST resolve one exact active Brand, and every commerce domain MUST have one authoritative writer for that Brand scope.

The only exceptions are platform-shared domains that are explicitly defined as non-commerce, such as a personal file area or a company-wide shared document area. A product, Stock Unit, reservation, order, POS invoice, payment, fulfillment, return, publication, measurement event, catalog delivery, campaign fact, or customer communication MUST NOT exist without an exact `brand_ref`.

## 2. Why Brand is mandatory

A Workspace may contain several independent brands with different:

- products and Stock Units;
- storefront domains and mobile surfaces;
- physical branches, warehouses, and POS terminals;
- ERP or commerce backend connections;
- payment and shipping providers;
- Google Merchant, Meta, and TikTok catalogs;
- GA4 properties, GTM containers, pixels, consent policies, and attribution rules;
- WhatsApp numbers, templates, sender identities, and customer-service policies;
- currencies, languages, taxes, pricing, and return policies;
- Google Drive roots, Shared Drives, product-media folders, and campaign archives;
- employees, agencies, suppliers, and delegated operators.

Workspace membership alone therefore cannot authorize commerce execution or provider access.

## 3. Core invariants

### BCI-001 — Mandatory Brand context

Every commerce Command, Query, Event, Aggregate, Job, Approval, Outbox delivery, Webhook Inbox transition, API trace, and Evidence record MUST carry a non-null exact `brand_ref`.

### BCI-002 — One writer per Brand domain

Authority uniqueness is evaluated using at least:

```text
tenant_ref
workspace_ref
brand_ref
domain_key
optional location/channel partition when the domain contract permits it
```

For one effective revision and scope, zero writers means `DOMAIN_AUTHORITY_NOT_CONFIGURED`; more than one writer means `DOMAIN_AUTHORITY_AMBIGUOUS`.

### BCI-003 — No silent fallback

A consequential commerce operation MUST NOT fall back:

- from Brand connection to Workspace connection;
- from one Brand connection to another Brand connection;
- from company-owned connection to personal connection;
- from a requested channel or location to another channel or location;
- from an inactive Brand profile to a default Brand.

Fallback is allowed only when an explicit, versioned delegation binding names the Brand, domain, capabilities, connection, expiry, and policy revision.

### BCI-004 — Brand identity does not grant authority

A client-supplied `brand_ref`, hostname, folder ID, catalog ID, provider account ID, ERP company ID, or pixel ID is only a constraint. Authority derives from authenticated membership, Brand access, resource authority, capability, connection ownership/delegation, active revisions, and policy evidence.

### BCI-005 — Cross-Brand isolation

All storage predicates, uniqueness constraints, caches, search projections, idempotency keys, Outbox aggregates, Webhook Inbox records, and analytics facts MUST preserve `brand_ref`.

An identifier valid in Brand A MUST not be accepted in Brand B, even when both Brands belong to the same Workspace.

### BCI-006 — Automatic Brand resolution for public commerce

A public storefront request SHOULD derive the Brand from a governed hostname or application-surface binding. The browser does not select a provider connection.

### BCI-007 — Explicit Brand selection for internal surfaces

Tenant users working in Admin, POS, Photography, Inventory, Marketing, or Customer Service MUST select or inherit a Brand from an authorized surface, terminal, task, or resource. The selected Brand remains visible and pinned for the operation.

### BCI-008 — Brand revision evidence

Commerce context MUST include:

- `brand_profile_revision`;
- domain-authority revisions;
- connection-binding revisions;
- location/channel revisions;
- policy revision;
- a deterministic context hash.

Stale or changed revisions block mutation before credential resolution.

## 4. Brand Commerce Profile

The platform MUST introduce a canonical `Brand Commerce Profile` projection backed by governed SQL registries.

Minimum fields:

```text
brand_ref
tenant_ref
workspace_ref
status
legal_or_operating_name
default_currency
default_locale
default_timezone
pricing_policy_ref
return_policy_ref
consent_policy_ref
tax_profile_ref
brand_profile_revision
activated_at
suspended_at
```

A Brand profile state is one of:

```text
draft
configuration_incomplete
ready
active
degraded
suspended
retired
```

Commerce writes require `active`, except explicitly authorized setup, migration, reconciliation, or recovery operations.

## 5. Brand-bound registries

### 5.1 Domain authority bindings

`brand_domain_authority_bindings` map one Brand and domain to one authoritative adapter and connection.

Examples:

```text
Brand A + commerce.catalog       -> ERPNext Connection A
Brand A + commerce.inventory     -> ERPNext Connection A
Brand A + commerce.orders        -> ERPNext Connection A
Brand A + commerce.payments      -> Payment Connection A
Brand A + commerce.fulfillment   -> Shipping Connection A
Brand A + measurement.events     -> Measurement Profile A
Brand A + ads.performance        -> Ads Read Connections A
Brand A + customer.communication -> WhatsApp Connection A
```

### 5.2 Connection bindings

`brand_connection_bindings` MUST record:

```text
binding_ref
brand_ref
domain_key
capability_key
connection_ref
connection_owner_scope_type
connection_owner_scope_ref
binding_mode
explicit_delegation_ref
status
binding_revision
effective_from
effective_until
```

`binding_mode` is one of:

```text
brand_owned
workspace_delegated
platform_managed
```

`workspace_delegated` requires explicit Brand-targeted delegation. Workspace ownership alone is insufficient.

### 5.3 Storefront and channel bindings

`brand_channel_bindings` associate the Brand with:

- public hostname and route namespace;
- storefront or mobile application;
- POS terminal/device group;
- Live Commerce session profile;
- marketplace or social catalog;
- channel-specific price list and content policy;
- channel measurement profile.

A hostname, terminal, or Live session MUST resolve to exactly one active Brand.

### 5.4 Location bindings

Every branch, warehouse, pickup location, POS terminal, and stock allocation belongs to or is explicitly delegated to one or more Brands through versioned bindings.

Shared physical locations MAY host several Brands, but inventory, terminal session, employee capability, receipt identity, and settlement remain Brand-bound.

### 5.5 Measurement and advertising bindings

Each Brand MUST resolve its own:

- GA4 property or data stream;
- GTM container or server-side container;
- Google Ads customer/conversion actions;
- Meta pixel/dataset and catalog;
- TikTok pixel/events/catalog;
- consent profile;
- first-party domain and server-event configuration;
- attribution and retention policy.

Events from different Brands MUST not share a measurement destination unless an explicit multi-Brand reporting profile permits it. Even then, each event retains `brand_ref` and destination mapping evidence.

### 5.6 Provider catalog bindings

Merchant Center, Meta, TikTok, marketplace, and WhatsApp catalog identifiers MUST be resolved through Brand bindings. Provider IDs supplied by the caller never select the destination.

## 6. Brand context resolution algorithm

For every commerce request, the application service performs the following fail-closed sequence:

1. authenticate the principal or validate the public surface/session;
2. resolve Tenant and Workspace;
3. derive Brand constraints from hostname, terminal, task, route, or explicit authorized selection;
4. require exactly one active Brand candidate;
5. validate Brand membership/resource authority for authenticated users;
6. resolve the Brand Commerce Profile and revision;
7. resolve channel and location under the Brand;
8. resolve the bounded domain authority for the Brand;
9. resolve the exact Brand connection binding and required capability;
10. validate adapter certification, provider readiness, credential readiness, and execution enablement;
11. build a revision vector and context hash;
12. only then resolve credentials and dispatch.

No route, UI, workflow step, or agent tool may skip this sequence.

## 7. Commerce data model rules

The following entities require non-null `brand_ref`:

- Product Model and Product Variant;
- Stock Unit, inventory balance, movement, reservation, and allocation lease;
- price list, discount rule, tax projection, and promotion;
- cart, checkout, order, invoice, POS shift, and settlement;
- payment intent, payment fact, refund, and reconciliation;
- shipment, pickup, fulfillment, and return;
- supplier relationship, supplier lot, receipt, and quality task;
- Product Intake, Shoot Session, Media Asset binding, AI Draft, and approval;
- publication, catalog delivery, provider issue, and readback;
- customer-brand relationship, consent, communication, complaint, and service case;
- measurement event, attribution fact, campaign fact, and contribution fact.

Primary and unique keys MUST include `brand_ref` wherever the identifier is not globally unique by construction.

## 8. Brand-bound Google Drive and file management

Workspace File Fabric continues to support Personal, Company Workspace, and Brand file areas. Commerce-related files MUST use Brand scope.

### 8.1 Brand File Profile

Each active commerce Brand MUST define a `Brand File Profile` containing:

```text
brand_ref
file_authority_binding_ref
root_file_ref or shared_drive_ref
product_media_root_ref
campaign_root_ref
supplier_root_ref
customer_service_root_ref
evidence_root_ref
archive_root_ref
file_policy_revision
```

### 8.2 Connection selection

A Brand file operation uses:

1. a Brand-owned Google Drive connection; or
2. an explicitly delegated Company Workspace connection naming the Brand and allowed roots/capabilities.

It MUST NOT use a user's personal Drive connection for shared commerce assets unless the operation is explicitly personal and does not create Brand authority or shared operational dependency.

### 8.3 Root containment

Product images, campaign files, supplier documents, reports, and operational evidence MUST remain within authorized Brand roots or approved Shared Drives. Move/copy/share operations that cross Brand roots require explicit cross-Brand transfer capability and evidence.

### 8.4 Reference workflow

The demo-file workflow becomes a reusable Brand operation:

```text
Resolve Brand File Profile
-> resolve Brand Drive connection and root
-> create project child folder
-> create categorized subfolders
-> upload files with idempotency and checksums
-> archive historical copies
-> generate Brand-scoped manifest
-> read back names, MIME, parents, sizes, counts, and Brand bindings
-> resume failures without duplicating completed writes
```

### 8.5 Search and agent access

Search results and agent tools MUST filter by Brand authority before content retrieval. A Workspace-level search MUST not return another Brand's private files unless the actor has explicit cross-Brand read capability.

## 9. API requirements

### BCI-API-001

Every commerce API command requires a resolved Brand context. Public APIs may omit a raw `brand_ref` only when the Brand is deterministically resolved from the governed hostname/session and returned in the response context.

### BCI-API-002

Authenticated tenant APIs accept `brand_ref` as a constraint and return the resolved `brand_ref`, profile revision, authority revisions, and context hash.

### BCI-API-003

Idempotency scope MUST include `tenant_ref`, `workspace_ref`, `brand_ref`, operation key, and actor/channel dimensions defined by the command contract.

### BCI-API-004

Provider connection IDs, catalog IDs, pixel IDs, folder IDs, and ERP company IDs MUST not be accepted as direct authority selectors in public request bodies.

### BCI-API-005

Read projections MUST include Brand identity and MUST not merge same-SKU, same-customer, same-campaign, or same-file identities across Brands without an explicit aggregate reporting contract.

## 10. Stable error codes

```text
BRAND_REQUIRED
BRAND_NOT_FOUND
BRAND_NOT_AUTHORIZED
BRAND_NOT_ACTIVE
BRAND_CONTEXT_AMBIGUOUS
BRAND_CONTEXT_STALE
BRAND_CHANNEL_NOT_BOUND
BRAND_LOCATION_NOT_BOUND
BRAND_DOMAIN_AUTHORITY_NOT_CONFIGURED
BRAND_DOMAIN_AUTHORITY_AMBIGUOUS
BRAND_CONNECTION_NOT_BOUND
BRAND_CONNECTION_DELEGATION_REQUIRED
BRAND_CONNECTION_STALE
BRAND_PROVIDER_NOT_READY
BRAND_FILE_PROFILE_NOT_CONFIGURED
BRAND_FILE_ROOT_VIOLATION
CROSS_BRAND_OPERATION_DENIED
```

Errors MUST be structured, bounded, non-secret, and carry a correlation reference.

## 11. Migration and compatibility

1. Existing Workspace-only commerce settings are classified as unbound legacy configuration.
2. No legacy record becomes active Brand authority automatically.
3. Administrators map legacy products, inventory, channels, provider connections, measurement settings, and Drive roots to Brands through a governed migration plan.
4. Ambiguous records enter a repair queue.
5. Read-only compatibility MAY remain temporarily, but new commerce writes require Brand context.
6. Backfill and cutover require cross-Brand collision checks and reconciliation.
7. Default-Brand inference is prohibited for production mutation.

## 12. Minimum acceptance evidence

Implementation is not complete until tests prove:

- the same Workspace can operate two Brands with independent products, inventory, orders, catalogs, analytics, and Drive roots;
- Brand A cannot reserve, sell, publish, measure, message, or read private files of Brand B;
- a public hostname deterministically resolves one Brand;
- a POS terminal resolves one Brand and rejects a mismatched order/Stock Unit;
- a Workspace-owned provider connection is unusable by a Brand without explicit delegation;
- connection ambiguity blocks before credential resolution;
- a Brand-specific payment or catalog destination is selected without caller authority;
- GA4/Ads events route to the correct Brand bindings and preserve Brand identity;
- a Brand Drive workflow creates and verifies files only under the authorized Brand root;
- revoking Brand membership, binding, delegation, or Brand status blocks subsequent execution;
- stale Brand revisions cause deterministic conflict;
- reconciliation detects cross-Brand mapping or projection drift.

## 13. Implementation placement

The implementation SHOULD extend the existing Context Kernel and connection ownership model with a Brand Commerce candidate graph and exact Brand connection bindings. It MUST not create a parallel Brand selector inside commerce routes.

Recommended bounded modules:

```text
commerce/brand-context
commerce/brand-profile
commerce/domain-authority
commerce/brand-connections
commerce/channels
commerce/locations
workspace-files/brand-profile
measurement/brand-bindings
```

## 14. Delivery order

1. Brand Commerce Profile and Brand membership/resource authority.
2. Brand-scoped domain authority and connection bindings.
3. hostname/channel/location/terminal Brand resolution.
4. Brand requirements in commerce schemas, events, and idempotency.
5. Brand File Profile and Google Drive root containment.
6. cross-Brand denial and stale-revision tests.
7. legacy Workspace-only configuration classification and migration tooling.
8. pilot with at least two Brands in one Workspace before production activation.
