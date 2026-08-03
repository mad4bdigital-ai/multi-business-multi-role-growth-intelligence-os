# WordPress and WooCommerce Authority and Operations

## 1. Purpose

This document records the Brownfield assessment of the existing WordPress implementation and defines the required WooCommerce integration and operating modes.

It is normative for Spec 014.

## 2. Brownfield findings

### 2.1 Existing WordPress lifecycle engine

The repository contains a substantial WordPress lifecycle implementation under `http-generic-api/wordpress/`.

The barrel exports shared logic and phases A through P. The phases already implement a consistent pattern:

```text
resolve plan
→ validate plan
→ build prerequisite gate
→ inventory
→ normalize
→ classify readiness and risk
→ select safe candidates
→ compose proposed payload
→ simulate dry run
→ apply execution guard
→ produce operator handoff
```

This is a strong reusable platform asset.

### 2.2 Existing capability coverage

- Phase A: content and taxonomy migration, draft-first write, deferred parent/taxonomy/media references, selective retry, rollback verification, and writeback evidence.
- Phase B: Elementor, templates, template parts, navigation, dependency flags, cross references, mapping, and sequencing.
- Phase C: permalink, timezone, language, active theme, reading, and writing settings reconciliation.
- Phase D: Contact Form 7, WPForms, Fluent Forms, Gravity Forms, Elementor forms, email routing, webhooks, CAPTCHA, SMTP, CRM, payment, file upload, and conditional-logic signals.
- Phase E: media, featured images, inline references, attachment linkage, orphan and MIME inventory.
- Phase F: users, roles, and authentication surfaces.
- Phase G: redirects, metadata, taxonomy SEO, and post-type SEO.
- Phase H: GA, GTM, Meta Pixel, TikTok Pixel, custom tracking, consent surfaces, and plugin signals including Site Kit, tracking plugins, Facebook for WooCommerce, and cookie plugins.
- Phase I: cache, asset optimization, image optimization, CDN, and lazy loading.
- Phase J: headers, WAF, hardening, exposed surfaces, and TLS.
- Phase K: logging, alerting, monitoring, error tracking, and uptime.
- Phase L: database, files, media, plugins, themes, recovery points, and retention.
- Phase M: theme/plugin activation, settings push, cache flush, release tags, maintenance windows, rollback checkpoints, and rollback-on-failure.
- Phase N: post/media/taxonomy/user/meta/settings reconciliation, drift tolerance, and optional repair planning.
- Phase O: smoke, content, form, redirect, performance, SEO, analytics, threshold, and block-on-failure acceptance.
- Phase P: DNS, SSL, CDN flush, monitoring handoff, notification, cutover and rollback windows.

### 2.3 Existing governed publishing path

The WordPress blog-publish orchestrator already provides important foundations:

- Brand/site resolution;
- draft and publish distinction;
- credential intake recovery;
- CMS site access grants;
- workspace resource grants;
- capability resolution envelopes;
- governed effective credential resolution;
- Application Password transport;
- bounded error normalization;
- audit/evidence integration.

This path SHOULD be generalized rather than bypassed.

### 2.4 Existing connector execution

`connectorExecutor.js` already dispatches WordPress plans and records workflow runs, step runs, telemetry, and audit evidence.

However, the reviewed path also reveals gaps that MUST be repaired before commerce operations:

- legacy `brands` fields remain involved in site and credential context;
- some connection lookup uses broad target matching or `LIKE` behavior;
- WordPress context construction is site-centric, not full Brand Commerce Context;
- the generic migration dispatcher only passes a small content-oriented payload;
- lifecycle phases are not registered as user-visible capabilities;
- several later phases still reference Google Sheets inventories, while current platform authority is SQL-primary;
- inventory and dry-run logic are more complete than certified provider-apply paths;
- there is no verified WooCommerce REST adapter for products, stock, orders, refunds, customers, coupons, webhooks, or system status;
- no `wc/v3` integration was established in the reviewed baseline.

## 3. WordPress and WooCommerce are different bounded systems

The platform MUST distinguish:

### WordPress CMS authority

Owns selected site domains such as:

```text
site.content
site.taxonomies
site.builder_assets
site.configuration
site.forms
site.media
site.users_roles
site.seo
site.performance
site.security
site.observability
site.backup
site.release
```

### WooCommerce authority

May own selected Brand commerce domains such as:

```text
commerce.catalog
commerce.inventory
commerce.checkout
commerce.orders
commerce.customers
commerce.coupons
commerce.payments
commerce.fulfillment
commerce.returns
```

WordPress connection readiness does not imply WooCommerce readiness. WooCommerce connection readiness does not imply that all WordPress administrative mutations are allowed.

## 4. Brand Site Profile

Every connected WordPress site MUST resolve a versioned Brand Site Profile.

```text
brand_site_profile_ref
brand_ref
site_ref
canonical_hostname
site_role
wordpress_mode
woocommerce_mode
wordpress_connection_binding_ref
woocommerce_connection_binding_ref
hosting_connection_binding_ref
cdn_connection_binding_ref
security_connection_binding_ref
analytics_binding_refs
file_profile_ref
profile_revision
status
```

### 4.1 Site roles

- primary storefront;
- content site;
- landing site;
- campaign microsite;
- B2B portal;
- support portal;
- staging;
- development;
- archive.

### 4.2 Site status

```text
discovered
connection_required
inventory_ready
configuration_incomplete
ready
active
degraded
maintenance
suspended
retired
```

No commerce write is allowed through a content-only, staging, suspended, or ambiguous site unless the operation policy explicitly permits it.

## 5. Authentication and connection model

### 5.1 WordPress connection

The preferred WordPress write connection uses:

- exact Brand/site connection binding;
- HTTPS;
- WordPress Application Password or certified alternative;
- least-privilege WordPress user;
- CMS site grant;
- workspace/Brand resource grant;
- capability envelope;
- connection and Brand revisions.

### 5.2 WooCommerce connection

The initial WooCommerce API connection supports:

- WooCommerce REST consumer key and secret stored through governed credential references;
- exact Store URL and Store ID;
- permission profile: read, write, or read/write;
- optional signed bridge identity;
- webhook secret references separated from REST credentials;
- provider API version;
- store and Brand binding revisions.

Credentials MUST NOT be stored in Brand profile, product, order, plugin inventory, Outbox payload, or evidence.

### 5.3 Credential separation

At minimum, separate capabilities and credentials for:

- WordPress content draft;
- WordPress publish;
- WordPress site configuration;
- WordPress plugin/theme operations;
- WooCommerce read inventory;
- WooCommerce product write;
- WooCommerce order read;
- WooCommerce refund;
- WooCommerce webhook management;
- hosting operations;
- DNS/CDN operations.

## 6. WooCommerce adapter tiers

### Tier 0 — Discovery only

Capabilities:

- version and system profile;
- plugin/theme inventory;
- product/order counts;
- settings and webhook inventory;
- no mutation.

### Tier 1 — Standard REST

Uses official WooCommerce REST semantics for:

- products and variations;
- inventory fields;
- orders;
- customers;
- coupons;
- refunds where provider support exists;
- webhooks;
- system status and selected settings.

Limitations MUST be explicit:

- no claim of cross-channel atomic unique-item reservation;
- no claim of transactionally atomic platform Outbox with Woo database commit;
- plugin extensions may introduce fields and behavior not represented in core REST;
- provider timeouts may create unknown outcomes;
- scheduled actions and plugin webhooks require separate monitoring.

### Tier 2 — Governed Bridge Plugin

A versioned MAD4B/Frappe-independent WordPress plugin exposes certified endpoints and events.

Required features:

```text
GET  /mad4b/v1/readiness
GET  /mad4b/v1/capabilities
POST /mad4b/v1/reservations
POST /mad4b/v1/reservations/{id}/release
POST /mad4b/v1/reservations/{id}/commit
GET  /mad4b/v1/operations/{id}
GET  /mad4b/v1/resources/{type}/{id}
POST /mad4b/v1/webhook-deliveries/readback
```

The plugin MUST implement:

- Brand binding and site identity;
- signed request verification;
- nonce/timestamp replay protection;
- idempotency ledger;
- expected-version validation;
- exact stock/variation/unique-unit mapping;
- database transaction or documented lock boundary;
- operation ledger;
- bounded event payloads;
- webhook delivery retry and inspection;
- maintenance and degradation status;
- compatible WooCommerce/WordPress/PHP version matrix;
- no secret exposure.

### Tier 3 — Certified extension packs

Optional extension-specific adapters for:

- subscriptions;
- bookings;
- memberships;
- bundles/composites;
- multi-currency;
- multilingual stores;
- multi-vendor marketplaces;
- multi-location inventory;
- local delivery and pickup;
- payment gateway plugins;
- shipping label/tracking plugins;
- tax and e-invoicing plugins.

Each extension requires its own mapping and certification profile.

## 7. Authority modes

### 7.1 WooCommerce authoritative

WooCommerce is the single writer for assigned commerce domains.

Platform roles:

- Brand governance;
- connection and permission control;
- operational monitoring;
- measurement and attribution;
- content/media workflows;
- catalog-feed orchestration where appropriate;
- alerts, incident management, and reconciliation;
- growth workflows.

### 7.2 WooCommerce projection

WooCommerce displays a catalog whose source authority is Platform Native or ERPNext.

Rules:

- Woo inventory/product/order direct writes are restricted;
- product and stock changes arrive from committed authoritative events;
- checkout/order commands are mediated through the governed bridge;
- direct plugin changes that violate authority are detected as drift;
- reconciliation can repair projections but cannot infer authority from Woo state.

### 7.3 Split-domain hybrid

Permitted only with an explicit matrix.

Example:

```text
catalog        → ERPNext
inventory      → ERPNext
checkout       → WooCommerce experience
orders         → ERPNext through bridge
payments       → Woo payment plugin/provider
fulfillment    → shipping provider
content/SEO    → WordPress
measurement    → platform
```

The contract MUST define how checkout obtains authoritative price and reservation, how payment attaches to the external order, and how unknown outcomes are reconciled.

## 8. Product and identity mapping

The platform MUST maintain external bindings for:

- WordPress post/page/media IDs;
- Woo product IDs;
- Woo variation IDs;
- Woo order IDs;
- Woo customer IDs;
- Woo coupon IDs;
- Woo webhook IDs;
- extension-specific IDs.

A caller-supplied Woo ID is never authority.

Canonical keys include Brand:

```text
brand_ref + canonical_product_ref
brand_ref + canonical_variant_ref
brand_ref + canonical_order_ref
brand_ref + external_provider + external_id
```

## 9. WooCommerce product model

The normalized model MUST support:

- simple and variable products;
- grouped/external products as constrained projections;
- attributes and variation options;
- regular and sale prices;
- tax status/class;
- stock management and backorders;
- downloadable and virtual flags;
- dimensions and weight;
- categories, tags, and Brand taxonomy;
- images and gallery;
- upsells and cross-sells;
- shipping classes;
- status, visibility, featured state;
- extension fields through versioned profiles.

The adapter MUST reject lossy writes when required source facts cannot be represented safely.

## 10. Inventory and unique-item safety

WooCommerce core quantity stock is suitable for many common stores when Woo is the sole writer.

For strict unique-item or multi-channel inventory, the platform MUST classify the store as one of:

```text
quantity_stock_standard
single_writer_unique_item_limited
governed_bridge_unique_item
external_inventory_projection
unsupported_multi_writer
```

The platform MUST not claim atomic cross-channel protection when the site only uses ordinary quantity updates.

## 11. Order and payment lifecycle

The normalized order projection includes:

- Brand and Store;
- order ID and external ID;
- status and status revision;
- customer pseudonymous reference;
- currency and totals;
- line items and canonical mappings;
- coupons, fees, tax, shipping;
- payment method and provider references;
- refunds;
- fulfillment/tracking references;
- attribution fields;
- creation/update timestamps;
- source channel;
- webhook and readback evidence.

A browser thank-you page is not payment authority.

## 12. Webhooks

WooCommerce webhooks MUST enter the Provider Webhook Inbox.

Required topics initially include:

- product created/updated/deleted;
- order created/updated/deleted/restored;
- customer created/updated/deleted;
- coupon created/updated/deleted;
- refund/order state where supported;
- bridge reservation and operation events.

The Inbox records provider event identity, Brand, Store, topic, signature result, payload hash, received time, processing state, and bounded evidence.

## 13. WordPress lifecycle as ongoing operations

The A–P phases MUST support three operation types:

```text
assessment
migration_or_change
continuous_control
```

Examples:

- Phase H inventory becomes periodic analytics coverage monitoring;
- Phase I becomes performance health and optimization planning;
- Phase J becomes security posture monitoring;
- Phase K becomes operations observability;
- Phase L becomes backup freshness and restore testing;
- Phase N becomes drift reconciliation;
- Phase O becomes scheduled smoke and acceptance suites;
- Phase P remains high-risk governed cutover.

## 14. Site Operations Cockpit

The Brand operator sees:

### Store health

- site availability;
- WordPress/Woo versions;
- checkout canary;
- REST/bridge readiness;
- PHP/runtime signals;
- database and scheduled-action health.

### Commerce health

- new/failed/on-hold orders;
- payment pending/unknown;
- stockouts and drift;
- refund failures;
- webhook failure/backlog;
- feed rejection;
- customer-service incidents.

### Site lifecycle

- content/Builder drift;
- form delivery and integration health;
- media/link issues;
- SEO and redirect issues;
- analytics and consent coverage;
- performance regressions;
- security findings;
- backup freshness;
- pending release and rollback readiness.

### Recommended actions

Every action displays:

- business impact;
- evidence;
- automation level;
- required role and capability;
- expected mutation;
- provider/connection;
- rollback/readback;
- cost and risk.

## 15. Legacy repair requirements

Before provider writes are enabled:

1. replace fuzzy WordPress connected-system selection with exact Brand Site Profile binding;
2. eliminate reliance on raw secrets from legacy Brand rows;
3. route all WordPress and Woo writes through effective connection resolution;
4. persist lifecycle inventories and operations in SQL-primary stores;
5. preserve Sheets as import, export, mirror, or recovery only;
6. register phase implementations in the Capability Catalog;
7. separate inventory/dry-run claims from apply/certified claims;
8. require Brand and site revisions in every operation;
9. add WooCommerce REST and bridge adapters;
10. add webhook Inbox and periodic provider readback;
11. certify cross-Brand denial and exact connection usage;
12. retain existing blog publish recovery and grants while moving it to exact Brand Site Profile context.

## 16. Non-goals

- claiming every WordPress plugin is supported;
- installing arbitrary plugins automatically without policy;
- using WordPress admin credentials as a general privileged proxy;
- allowing WooCommerce and ERPNext to mutate the same inventory domain;
- storing card data or raw payment payloads;
- treating a successful REST response as complete without required readback;
- promising unique-item safety without a certified reservation contract;
- performing DNS, plugin, theme, or production cutover without separate authorization.
