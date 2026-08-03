# Commerce Enablement Fabric and Solution Blueprints

## 1. Normative status

This document is a normative extension of Spec 014.

It defines how a Tenant and an authorized Brand operator discover, select, configure, launch, and operate a digital commerce solution by reusing the platform's existing capabilities instead of assembling disconnected tools manually.

It does not authorize provider writes, production deployment, payment execution, catalog publication, DNS mutation, WordPress mutation, or database migration.

## 2. Product decision

The platform MUST expose a **Commerce Enablement Fabric** rather than a fixed one-size-fits-all storefront installer.

The Fabric resolves:

```text
Tenant
→ Workspace
→ Brand
→ Business Goal
→ Existing Assets and Connections
→ Required Capability Graph
→ Candidate Solution Blueprints
→ Readiness / Gaps / Risks / Cost
→ Governed Implementation Plan
→ Launch Gates
→ Operations Cockpit
```

The user MUST be able to understand:

- what capabilities already exist;
- what the connected site and providers can support;
- what is missing;
- which implementation patterns are compatible;
- what the platform can automate;
- what needs human approval;
- what requires an external provider, plugin, custom bridge, or localization;
- what is operationally healthy after launch.

## 3. Existing repository capabilities to reuse

The reviewed repository already contains reusable foundations for:

- Brand-aware Context Kernel and effective authority;
- connected systems, credential bindings, capability envelopes, and execution preflight;
- execution plans, steps, approval holds, retries, evidence, and readback;
- provider adapters and connector execution;
- WordPress content publishing with credential intake recovery;
- CMS site access grants and workspace resource grants;
- WordPress migration/lifecycle phases A through P;
- hosting-account and site-runtime inventory;
- upload, media, Google Drive, assets, and output routing;
- analytics bindings, tracking inventory, consent signals, and ads readiness;
- platform Outbox, workers, operational alerts, audit, and observability;
- frontend surface governance and fail-closed dispatch;
- tenant commercial profiles whose verticals already include WordPress, WooCommerce, Shopify, and SaaS.

These capabilities MUST be composed into visible product capabilities. They MUST NOT remain hidden as isolated technical endpoints known only to platform engineers.

## 4. Commerce Enablement Catalog

The platform MUST maintain a versioned catalog of user-facing capabilities.

Each catalog item includes:

```text
capability_key
name_ar
name_en
capability_family
business_outcomes
supported_brand_types
supported_solution_modes
required_domain_authorities
required_connections
required_scopes
required_resource_grants
required_platform_capabilities
required_human_roles
risk_class
activation_mode
readiness_probe
implementation_template
operation_runbook
acceptance_suite
cost_model
status
version
```

### 4.1 Capability families

The initial catalog MUST include:

1. commerce foundation;
2. site and storefront;
3. product and catalog;
4. inventory and reservations;
5. checkout and orders;
6. payments and refunds;
7. fulfillment and shipping;
8. POS and branch operations;
9. supplier and procurement;
10. product intake and media;
11. content and SEO;
12. forms, leads, CRM, and customer service;
13. analytics, consent, and attribution;
14. catalog feeds and social commerce;
15. advertising operations;
16. performance and availability;
17. security and access;
18. backup and recovery;
19. deployment, release, and rollback;
20. observability and reconciliation;
21. Workspace File Fabric and Brand Drive operations;
22. AI-assisted content and operational agents.

### 4.2 Capability maturity

A capability MUST expose one of:

```text
available
available_with_configuration
available_with_external_provider
available_with_certified_adapter
available_with_custom_bridge
planned
unsupported
blocked
```

Implementation maturity is separate:

```text
inventory_only
dry_run_ready
apply_supported
sandbox_certified
production_certified
degraded
retired
```

A capability that has inventory code but no certified apply path MUST NOT be presented as fully executable.

## 5. Commerce Discovery and Diagnostic Session

A Brand administrator starts with a governed discovery session.

### 5.1 Inputs

- Brand identity and Brand Commerce Profile;
- business model: B2C, B2B, marketplace, subscription, booking, service commerce, or hybrid;
- product type: fungible, unique item, digital, service, configurable, bundle, or subscription;
- channels: web, POS, social, live, marketplace, WhatsApp, sales-assisted;
- current site and hosting;
- current CMS and ecommerce engine;
- expected order volume;
- branches and warehouses;
- countries, currencies, languages, taxes, and e-invoicing needs;
- payment and shipping providers;
- current ERP, CRM, accounting, and marketing stack;
- desired level of platform control;
- budget, delivery speed, and operational maturity.

### 5.2 Automated discovery

When authorized connections exist, the platform SHOULD inventory:

- WordPress version and REST availability;
- active theme and builder assets;
- plugins and plugin families;
- WooCommerce presence, version, system status, and REST readiness;
- products, variations, stock-management settings, orders, coupons, customers, taxes, shipping zones, and webhooks by bounded probes;
- site settings and permalinks;
- forms and integrations;
- media and storage health;
- roles and authentication surfaces;
- SEO metadata and redirects;
- GA, GTM, Meta Pixel, TikTok Pixel, custom tracking, and consent surfaces;
- cache, CDN, image optimization, and lazy loading;
- TLS, headers, WAF, exposed surfaces, and hardening controls;
- logging, errors, uptime, and alerting;
- backup and recovery points;
- deployment and rollback capabilities;
- data drift and reconciliation readiness;
- QA and cutover readiness.

The discovery session MUST be Brand-scoped. A site or connection identifier supplied by the caller is a constraint only.

### 5.3 Output

The output includes:

```text
current_state_summary
business_goal_summary
detected_assets
detected_capabilities
missing_capabilities
risks
candidate_blueprints
recommended_blueprint
alternative_blueprints
estimated_implementation_slices
required_connections
required_approvals
required_custom_development
acceptance_plan
operation_plan
```

## 6. Solution Blueprint Registry

A Solution Blueprint is a versioned composition of capabilities, domain authorities, provider connections, workflows, interfaces, and acceptance tests.

A Blueprint MUST NOT be a marketing label only.

Each Blueprint contains:

```text
blueprint_key
blueprint_version
supported_business_models
domain_authority_matrix
required_capabilities
optional_capabilities
incompatible_capabilities
required_connections
required_brand_profile_fields
required_adapter_certifications
required_platform_surfaces
workflow_templates
migration_strategy
launch_gates
steady_state_runbooks
exit_and_migration_strategy
```

## 7. Initial supported blueprints

### 7.1 Platform Native Commerce

Use when the platform owns commerce catalog, inventory, reservations, orders, POS, and returns.

```text
catalog       → platform_native
inventory     → platform_native
orders        → platform_native
payments      → certified payment adapter
fulfillment   → certified shipping adapter
content CMS   → platform or WordPress
measurement   → platform ledger
files         → Brand File Authority
```

Best fit:

- unique-item and stock/outlet operations;
- multi-channel atomic reservation;
- tight POS and inventory control;
- brands requiring platform-native workflows.

### 7.2 ERPNext Commerce Authority

```text
catalog/inventory/orders/procurement/accounting → ERPNext/Frappe
storefront and experience                       → platform or connected storefront
payments/shipping                               → selected Brand authorities
measurement/files/growth                        → platform
```

A certified Frappe app is required when standard ERPNext cannot meet unique-item reservation, idempotency, or webhook/readback contracts.

### 7.3 WooCommerce Standard Brand Store

WooCommerce is the authoritative writer for the domains it owns.

```text
catalog/inventory/orders/coupons/checkout → WooCommerce
payments/shipping                         → WooCommerce extensions/providers
content/SEO/site presentation             → WordPress
measurement and growth facts              → platform
operations evidence and monitoring        → platform
files and campaign assets                 → Brand File Authority
```

This mode is appropriate when:

- the Brand wants the common WordPress/WooCommerce ecosystem;
- one WooCommerce store is the sole order and inventory writer;
- cross-channel unique-item atomic reservation is not required unless the governed bridge tier is installed;
- plugins provide acceptable payment, shipping, tax, subscription, or marketplace functions.

### 7.4 WooCommerce Governed Bridge

WooCommerce remains the storefront and checkout experience, but a certified Brand bridge plugin enforces platform contracts.

The bridge MUST support:

- Brand context and connection binding;
- signed platform-to-store requests;
- exact product/variation/stock-unit mapping;
- reservation with idempotency and expected version;
- webhook signature and replay protection;
- normalized order/payment/refund events;
- operation inspection and readback;
- Outbox-compatible event delivery;
- health and version reporting;
- no-secret responses;
- maintenance mode and safe degradation.

This mode is required for:

- unique items shown in WooCommerce and POS/Live simultaneously;
- ERP/platform inventory authority with WooCommerce projection;
- strict reservation before checkout;
- cross-channel inventory guarantees.

### 7.5 WooCommerce + ERPNext

Domain ownership MUST be explicit. Two common variants are allowed.

#### Variant A — WooCommerce order authority

```text
catalog/inventory/orders/checkout → WooCommerce
procurement/accounting            → ERPNext mirror/downstream
```

ERPNext MUST NOT independently mutate Woo-owned stock.

#### Variant B — ERPNext inventory/order authority

```text
catalog/inventory/orders → ERPNext
storefront projection    → WooCommerce
checkout command path    → governed bridge → platform/ERP authority
```

Direct WooCommerce order/stock writes are blocked or converted into mediated commands.

### 7.6 Headless WooCommerce

WooCommerce provides commerce APIs while the platform or another frontend provides the storefront.

The Blueprint MUST define:

- session/cart ownership;
- authentication;
- caching and invalidation;
- checkout tokenization;
- payment redirect handling;
- webhook processing;
- SEO rendering;
- rate limits and readback.

### 7.7 WordPress Content + External Commerce

WordPress owns content, pages, builders, forms, and SEO. Commerce is owned by Platform Native, ERPNext, or another certified backend.

Products embedded in WordPress are projections or links; WordPress does not become an implicit inventory or order writer.

### 7.8 Existing Store Operational Takeover

Use when a Brand already has a live WordPress/WooCommerce site.

The platform first performs inventory, risk classification, connection recovery, and read-only monitoring. Mutations are enabled incrementally after certification and Brand approval.

### 7.9 Content-led Lead Commerce

For service businesses without a product checkout:

- WordPress content and builders;
- forms and CRM routing;
- appointment/quotation workflows;
- WhatsApp and email communication;
- tracking and attribution;
- optional payment links;
- no inventory/order ledger unless needed.

## 8. Reuse of WordPress phases A–P

The existing phases MUST become reusable **Site Lifecycle Capability Packs**, not remain migration-only internals.

| Pack | Existing phase | User-facing purpose |
|---|---|---|
| Content Foundation | A | posts, pages, categories, tags, draft-first writes, reference repair |
| Builder and Theme Assets | B | Elementor/templates/navigation/dependency inventory and migration |
| Site Configuration | C | permalinks, language, timezone, theme and reading/writing settings |
| Forms and Integrations | D | Contact Form 7, WPForms, Fluent Forms, Gravity Forms, Elementor forms and integration risk |
| Media and Attachments | E | media inventory, featured/inline links and orphan detection |
| Users, Roles, and Auth | F | user, role, and authentication surface inventory |
| SEO and Redirects | G | metadata, taxonomies, redirects and post-type SEO |
| Analytics and Consent | H | GA, GTM, Meta Pixel, TikTok Pixel, custom tracking, consent and plugin signals |
| Performance | I | cache, asset/image optimization, CDN and lazy loading |
| Security | J | headers, WAF, TLS, exposed surfaces and hardening |
| Observability | K | logs, alerts, monitoring, errors and uptime |
| Backup and Recovery | L | database/files/media/plugins/themes and recovery points |
| Release and Rollback | M | theme/plugin/settings deployment, cache flush and rollback checkpoints |
| Data Integrity | N | counts, media, taxonomy, users, meta and settings reconciliation |
| QA and Acceptance | O | smoke, content, forms, redirects, performance, SEO and analytics checks |
| Production Cutover | P | DNS, TLS, CDN, monitoring handoff, rollback window and stakeholder notification |

Each pack MUST expose:

- inventory capability;
- normalized findings;
- readiness gate;
- safe candidates;
- proposed payload;
- dry-run evidence;
- apply support status;
- recovery/rollback behavior;
- operator handoff;
- Brand and connection binding.

## 9. WooCommerce Capability Packs

The following additional packs are required.

### WC-01 Store and System Profile

- WooCommerce and WordPress versions;
- REST API readiness;
- HPOS status;
- currency, taxes, checkout, account, and inventory settings;
- active payment/shipping/tax/subscription/marketplace plugins;
- scheduled actions and cron health;
- system status report normalized without secrets.

### WC-02 Product and Variation Catalog

- products, variations, categories, tags, attributes, brands, bundles, subscriptions, downloads;
- SKU/barcode mapping;
- stock-management mode;
- images and SEO linkage;
- provider extension fields through bounded mapping profiles.

### WC-03 Inventory and Reservation

- stock quantities and statuses;
- backorders and low-stock thresholds;
- location/multi-inventory plugin detection;
- reservation support level;
- unique-item support level;
- governed bridge requirement classification.

### WC-04 Checkout, Orders, and Customers

- carts and checkout mode;
- orders and line items;
- coupons and discounts;
- customer accounts and guest checkout;
- taxes, fees, shipping, and payment references;
- privacy-safe customer projection.

### WC-05 Payments, Refunds, and Disputes

- payment gateway capabilities;
- asynchronous status handling;
- refund APIs;
- webhook/readback capability;
- unknown-outcome reconciliation;
- settlement references without storing raw payment data.

### WC-06 Fulfillment and Shipping

- shipping zones and methods;
- order fulfillment state;
- labels and tracking plugins;
- pickup and local delivery;
- provider connection mapping.

### WC-07 Webhooks and Event Inbox

- webhook inventory;
- topic, status, delivery URL, secret-reference identity, and last delivery health;
- signed event validation;
- replay protection;
- provider event deduplication;
- dead-letter and replay after readback.

### WC-08 Extensions and Compatibility

Classify plugins as:

```text
certified
compatible
compatible_with_constraints
requires_mapping_profile
conflicting
unsupported
unknown
```

The system MUST NOT infer safe compatibility merely because a plugin is active.

### WC-09 Operational Health

- failed orders and payment holds;
- stock drift;
- webhook failures;
- scheduled action backlog;
- checkout errors;
- PHP/fatal error signals;
- plugin/theme update exposure;
- cache and object-cache health;
- backup freshness;
- security alerts;
- analytics coverage;
- feed/catalog rejection.

### WC-10 Release and Change Governance

- staging/prod topology;
- backups and rollback points;
- plugin/theme/config changes;
- maintenance window;
- smoke suite;
- order and checkout canaries;
- post-release readback.

## 10. User-facing Enablement Center

The Unified Platform MUST add a Brand-scoped surface with the following sections.

### 10.1 Goal and Blueprint

- business goal;
- selected Blueprint;
- alternatives and tradeoffs;
- domain authority matrix;
- required providers and plugins;
- estimated effort and risk.

### 10.2 Capability Map

For each capability:

```text
Available
Needs connection
Needs configuration
Needs approval
Needs plugin
Needs custom bridge
Blocked
Not relevant
```

### 10.3 Readiness and Gap Plan

- blockers ordered by dependency;
- automatic fixes;
- guided user actions;
- operator tasks;
- external purchases or provider onboarding;
- evidence required to close each gap.

### 10.4 Implementation Plan

Generate a durable execution plan composed of:

- connection setup;
- discovery inventories;
- configuration;
- content/media migration;
- provider setup;
- tracking setup;
- testing;
- release;
- post-release monitoring.

### 10.5 Operations Cockpit

After launch, show:

- storefront health;
- order and checkout health;
- inventory consistency;
- payment and shipping health;
- webhook Inbox and Outbox lag;
- Woo scheduled actions;
- WordPress errors and security posture;
- backup freshness and restore readiness;
- GA4 and pixel coverage;
- catalog/feed health;
- campaign performance and contribution;
- unresolved incidents, approvals, and reconciliation tasks.

## 11. Role-based experiences

### Brand Owner

Sees business readiness, revenue health, risks, costs, approvals, and recommended actions.

### Ecommerce Manager

Sees catalog, inventory, orders, promotions, channels, operational incidents, and releases.

### Marketing Manager

Sees content, SEO, analytics, consent, feeds, campaigns, attribution, and performance.

### Operations Manager

Sees stock, fulfillment, returns, suppliers, POS, payment reconciliation, and SLA breaches.

### Site Administrator

Sees WordPress/WooCommerce system profile, plugins, users, performance, security, backups, and releases.

### Agency or Delegated Operator

Sees only explicitly delegated Brands, domains, capabilities, and connections with bounded lifetime.

## 12. Recommendation Engine

The recommendation engine MUST be deterministic and evidence-backed before optional AI explanation.

Inputs include:

- required capabilities;
- existing stack;
- adapter certification;
- Brand authority choices;
- plugin compatibility;
- order/stock complexity;
- unique-item and POS requirements;
- scale and SLO;
- localization;
- budget and time;
- operator skill level.

Output includes scored alternatives with explicit reasons.

AI MAY summarize tradeoffs and generate implementation narratives. AI MUST NOT silently change authority, activate a connection, install a plugin, publish a site, or approve a high-risk action.

## 13. Commercial packaging

The capability catalog MAY be used to assemble plans and usage limits.

Examples:

- WordPress Site Operations;
- WooCommerce Store Operations;
- Commerce Growth;
- Multi-Brand Commerce;
- POS and Inventory;
- Managed Launch;
- Security and Recovery;
- Analytics and Attribution;
- Workspace Files and Media.

Commercial packaging MUST NOT bypass runtime capability, Brand authority, connection readiness, or provider policy.

## 14. Migration from current implementation

1. inventory the A–P functions and register them as capability implementations;
2. classify each as inventory-only, dry-run, apply-capable, or certified;
3. move runtime state and evidence from legacy Sheet-primary paths to SQL-primary registries while retaining import/readback compatibility;
4. replace fuzzy connected-system lookup and legacy Brand secrets with exact Brand connection resolution;
5. retain WordPress blog publishing through the governed credential, CMS grant, resource grant, and capability-envelope path;
6. add WooCommerce canonical ports and adapter tiers;
7. add solution Blueprint registry;
8. add Enablement Center and Operations Cockpit;
9. certify one existing WordPress site and one WooCommerce sandbox before production activation;
10. preserve legacy migration workflows behind compatibility adapters until cutover.

## 15. Non-negotiable invariants

1. Every commerce Blueprint is Brand-scoped.
2. Every Blueprint defines one writer per bounded domain.
3. The recommendation engine does not grant authority.
4. Active plugins do not prove capability safety.
5. Inventory-only code is not advertised as production apply support.
6. WooCommerce standard mode does not claim cross-channel atomic unique-item reservation.
7. The governed bridge is required when external channels share strict inventory invariants.
8. WordPress and WooCommerce credentials are resolved from exact governed connections.
9. No fuzzy target/connection selection is allowed for consequential writes.
10. Webhooks enter through the Provider Webhook Inbox.
11. Unknown outcomes require provider readback before replay.
12. Every launch Blueprint includes backup, rollback, QA, observability, and post-launch reconciliation.
13. Existing WordPress phases are reused, not duplicated in another framework.
14. The platform UI, agents, and APIs use the same application services and authority checks.
15. Production readiness requires behavioral certification, not UI or document parity.
