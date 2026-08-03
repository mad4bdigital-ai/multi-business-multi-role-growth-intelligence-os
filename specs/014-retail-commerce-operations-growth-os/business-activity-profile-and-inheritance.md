# Dynamic Business Activity, Business Profile, and Inheritance Fabric

## 1. Normative status

This document is a normative extension of Spec 014.

It defines how the platform derives capabilities, solution blueprints, connections, policies, workflows, interfaces, and operating guidance from the actual commercial activity of a Tenant and Brand.

It supersedes any interpretation that treats `industry`, `verticals_json`, `business type`, or onboarding answers as direct runtime authority.

No provider write, database migration, production deployment, permission widening, or external mutation is authorized by this document.

## 2. Brownfield finding

The repository already contains several useful but currently separated foundations:

- `commercial_profiles` stores Tenant-level market and account metadata such as industry, company size, markets, verticals, contract, MRR, LTV, and health;
- `/connect` collects Business Type, Industry, locations, products/services, CMS, social channels, analytics, goals, and segment-specific preferences;
- Dynamic Container Authority provides typed containers, relationships, closure, classifications, role templates, resource dimensions, inheritance modes, merge strategies, and authority epochs;
- Spec 011 provides versioned effective authority, graph edges, inheritance-policy references, resource grants, version vectors, projections, drift findings, and invalidation;
- Spec 012 provides Tenant, Workspace, Brand, owner-scope, connection ownership, and fail-closed context resolution;
- Activity/Reference Packs, workflow templates, capability catalogs, provider adapters, WordPress phases A-P, and WooCommerce packs already represent reusable implementation knowledge.

The missing layer is a governed semantic bridge that turns these inputs into one versioned **Effective Business Operating Profile**.

## 3. Separation of concerns

The existing `commercial_profiles` table MUST remain the commercial relationship profile of the platform customer. It answers questions such as:

- contract type;
- billing currency;
- MRR, ARR, and LTV;
- acquisition source;
- customer health and churn risk;
- plan and usage limits.

It MUST NOT become the authority for operational commerce behavior.

A new logical concept is required:

```text
Business Operating Profile
```

It answers:

- what the business does;
- what it sells;
- how it earns revenue;
- which channels it operates;
- how fulfillment, booking, subscription, inventory, and customer service work;
- which regulations, geographies, currencies, languages, and tax rules apply;
- which capabilities and solution blueprints are relevant;
- which policies and constraints must be inherited by Brands, sites, channels, and locations.

The two profiles may reference each other but MUST have separate lifecycle, schemas, revision vectors, permissions, and audit evidence.

## 4. Scope model

The platform MUST support Business Operating Profiles at these scopes:

```text
platform
→ tenant
→ workspace
→ brand
→ channel
→ location
→ resource
```

Commerce execution always requires an exact Brand. The upper layers provide defaults and constraints; they never replace Brand authority.

### 4.1 Platform scope

Provides platform-wide safe defaults, supported activity taxonomy, certified packs, regulatory baselines, and hard safety policies.

### 4.2 Tenant scope

Represents organization-wide characteristics shared across Workspaces and Brands, such as legal markets, company scale, operating countries, shared service providers, and global risk policies.

### 4.3 Workspace scope

Represents collaborative operating defaults for a team or business unit. Workspace inheritance is optional and cannot authorize Commerce by itself.

### 4.4 Brand scope

Represents the mandatory commercial identity under which products, services, orders, content, tracking, files, providers, and customer communications operate.

### 4.5 Channel and location scope

Provides bounded overlays for web, POS, marketplace, WhatsApp, live commerce, branch, warehouse, pickup point, or service location.

### 4.6 Resource scope

Provides a narrow override or restriction for one product family, store, terminal, campaign, folder root, supplier, or other governed resource.

## 5. Business Activity Type Registry

Business activities MUST be data-driven registry records, not hard-coded `if industry === ...` branches.

Each activity type contains:

```text
activity_type_key
version
name_ar
name_en
parent_activity_type_keys
activity_family
value_chain_role
supported_business_models
product_service_modes
operating_characteristics_schema
required_profile_dimensions
default_capability_pack_refs
optional_capability_pack_refs
incompatible_pack_refs
regulatory_pack_refs
recommended_blueprint_refs
applicability_predicate_schema_ref
status
```

Examples include:

```text
retail.apparel
retail.outlet_stock
retail.unique_items
restaurant.quick_service
restaurant.full_service
travel.ota
travel.dmc
travel.tmc
services.professional
services.appointment_based
saas.subscription
marketplace.multi_vendor
education.course_commerce
real_estate.lead_and_booking
healthcare.clinic
media.publisher
```

These examples seed the registry only. New activity types MUST be addable without changing runtime code.

## 6. Multi-activity businesses

A Brand may have:

- exactly one primary activity type;
- zero or more secondary activity types;
- zero or more cross-cutting operating packs.

Example:

```text
primary: retail.apparel
secondary: retail.outlet_stock
cross-cutting: unique_items, multi_branch, b2c, social_commerce
```

Another example:

```text
primary: travel.dmc
secondary: services.appointment_based
cross-cutting: b2b, quotation, supplier_inventory, multilingual
```

Multiple activities do not create an implicit method-resolution order. The resolver uses explicit priorities and dimension-specific merge strategies.

## 7. Business Profile Definition Registry

Profile fields MUST be defined by versioned schemas.

A profile definition includes:

```text
profile_definition_key
profile_version
eligible_scope_types
field_schema_json
field_classifications_json
validation_rules_json
inheritance_rules_json
sensitivity_rules_json
required_evidence_rules_json
status
```

Initial profile dimensions include:

- identity and legal operating name;
- business activities and business models;
- products, services, subscriptions, bookings, bundles, and marketplaces;
- customer types: B2C, B2B, corporate, member, vendor, partner;
- revenue models;
- order and fulfillment patterns;
- inventory semantics: none, quantity, lot, serial, unique item, capacity, time slot;
- channels and locations;
- markets, currencies, languages, taxes, and e-invoicing;
- pricing, discounts, approvals, and returns;
- payment and shipping expectations;
- content, SEO, media, and photography needs;
- CRM, support, WhatsApp, and lifecycle messaging;
- analytics, consent, attribution, and advertising;
- compliance, retention, security, and recovery;
- WordPress, WooCommerce, ERP, CMS, POS, marketplace, and file-system topology;
- expected volumes and service-level objectives;
- operating maturity and desired platform-control level.

## 8. Profile lifecycle

Business Operating Profiles use:

```text
draft
→ validating
→ needs_clarification
→ ready
→ active
→ degraded
→ suspended
→ retired
```

A draft onboarding answer MUST NOT activate capabilities.

Activation requires:

1. schema validation;
2. activity-type resolution;
3. conflict analysis;
4. permission and owner-scope validation;
5. required evidence and confirmation;
6. effective-profile compilation;
7. revision publication;
8. invalidation of stale derived projections.

## 9. Inheritance graph

The resolver MUST reuse Dynamic Container Authority rather than create another generic hierarchy engine.

Recommended canonical mappings:

```text
Tenant      → tenant container
Workspace   → workspace container
Brand       → brand container
Channel     → channel container
Location    → location container
Resource    → resource container
```

Business activity and operating attributes are represented by governed classifications and profile assignments attached to these containers.

Relevant existing primitives include:

- `container_type_registry`;
- `containers`;
- `container_relationship_type_registry`;
- `container_relationships`;
- `container_closure`;
- `container_classification_type_registry`;
- `container_classifications`;
- `container_resource_dimension_registry`;
- `container_resource_bindings`;
- `container_authority_epochs`.

The Commerce implementation adds business-specific definitions and projections, not a competing graph.

## 10. Effective profile resolution order

The effective Brand profile is compiled from:

```text
1. platform hard policies and supported taxonomy
2. tenant profile constraints and defaults
3. workspace operating defaults when explicitly inheritable
4. primary activity type packs
5. secondary activity type packs
6. cross-cutting operating packs
7. Brand Business Operating Profile
8. Brand Commerce Profile
9. channel and location overlays
10. resource-specific restrictions or overrides
11. execution-time policy and live readiness
```

The list is an evaluation order, not a universal replacement precedence. Each field dimension has its own merge contract.

## 11. Dimension-specific merge strategies

The platform MUST NOT use one generic deep merge for all profile data.

Supported strategies include:

### 11.1 `deny_wins`

Used for prohibited operations, regulatory blocks, cross-Brand access, public sharing, unsupported payment methods, unsafe plugins, and forbidden data handling.

### 11.2 `union`

Used for cumulative requirements, required checks, mandatory capabilities, audit evidence, supported channels, and applicable regulatory obligations.

### 11.3 `intersection`

Used for allowed operations, provider scopes, permitted markets, safe plugin capabilities, and delegated resource boundaries.

### 11.4 `nearest_replace`

Used for local defaults such as display language, default currency, theme preference, notification cadence, content tone, and default warehouse when replacement is explicitly allowed.

### 11.5 `priority_replace`

Used when several activity packs provide candidate defaults and an explicit registry priority resolves them.

### 11.6 `minimum`

Used for maximum tolerated risk, shortest retention where policy requires minimization, lowest transaction ceiling, or most restrictive timeout.

### 11.7 `maximum`

Used for minimum required evidence, minimum approval level, minimum backup frequency, or strongest service requirement.

### 11.8 `block_on_conflict`

Used for domain authority, legal entity, tax identity, payment merchant, inventory writer, order writer, and Brand file root.

## 12. Inheritance controls

Every profile field or pack contribution may declare:

```text
inheritance_mode:
  local_only
  inherit_down
  inherit_until_blocked
  explicit_share
  block_inheritance

override_policy:
  forbidden
  restrictive_only
  allowed
  approval_required
```

A child cannot broaden a `restrictive_only` value.

Examples:

- Tenant blocks public file sharing; Brand cannot enable it.
- Workspace suggests WordPress; Brand may choose another CMS because the field is an overridable default.
- Activity pack requires inventory reservations for unique items; Brand cannot remove the requirement while unique-item mode remains active.
- Brand sets Arabic as default language; one channel may select English if the market and localization policy allow it.

## 13. Dynamic applicability predicates

Capability and Activity Packs MUST use a bounded declarative predicate language.

Supported operators:

```text
all
any
not
eq
neq
in
contains
exists
gte
lte
```

Inputs are limited to versioned profile fields, classifications, certified adapter capabilities, connected-system readiness, and current authority facts.

Arbitrary JavaScript, SQL fragments, provider calls, or user-supplied code are forbidden in predicates.

Example:

```json
{
  "all": [
    { "in": ["unique_item", { "path": "inventory.modes" }] },
    { "any": [
      { "in": ["pos", { "path": "channels" }] },
      { "in": ["live_commerce", { "path": "channels" }] }
    ] }
  ]
}
```

This predicate activates the cross-channel unique-item reservation pack without hard-coding a specific industry.

## 14. Activity Capability Packs

An Activity Capability Pack is a versioned composition of:

- capability requirements;
- optional capabilities;
- forbidden or incompatible capabilities;
- solution Blueprint preferences;
- profile field defaults;
- domain-authority constraints;
- required provider families;
- workflow templates;
- surface modules;
- readiness probes;
- acceptance tests;
- operating metrics;
- risk and approval rules.

Packs are composable and do not directly execute providers.

The effective pack set is compiled from the activity graph and profile predicates.

## 15. Business-profile-driven Blueprint selection

Blueprint scoring MUST be reproducible and evidence-backed.

Inputs include:

- effective Business Operating Profile revision;
- activity and pack revisions;
- Brand Commerce Profile revision;
- detected sites, plugins, providers, and connections;
- domain-authority assignments;
- adapter certification;
- operating volume and SLO requirements;
- implementation budget and control preference;
- legal and market constraints.

A Blueprint score MUST expose:

```text
score
matched_outcomes
matched_capabilities
missing_capabilities
inherited_requirements
local_overrides
conflicts
custom_bridge_requirements
operational_risks
lineage
```

The recommendation is not authority. A Brand owner or governed policy approves consequential activation.

## 16. WordPress and WooCommerce applicability

WordPress and WooCommerce are capabilities and solution components, not universal defaults.

### 16.1 WordPress is favored when

- the activity is content-led;
- SEO, publishing, forms, landing pages, or editorial workflows are central;
- the Brand already operates a WordPress estate;
- the selected Commerce authority can safely project products or transactions to WordPress;
- the required plugin families are compatible and certified.

### 16.2 WooCommerce Standard is favored when

- the Brand needs a common B2C storefront;
- one store can be the sole writer for catalog, inventory, checkout, and orders;
- unique-item cross-channel guarantees are not required;
- required payment, shipping, tax, subscription, or marketplace extensions are compatible;
- operational maturity, backup, security, and monitoring meet the profile.

### 16.3 WooCommerce Governed Bridge is required when

- unique items are sold across web, POS, live, or assisted channels;
- inventory or order authority sits in ERPNext or Platform Native;
- strict reservation and expected-version semantics are required;
- direct WooCommerce writes would violate the single-writer matrix;
- provider events require normalized Inbox, idempotency, and readback.

### 16.4 WooCommerce is not selected automatically when

- the activity is primarily booking, complex travel inventory, regulated clinical workflows, or enterprise procurement and the required semantics are unsupported;
- a plugin is merely active but not certified;
- the profile requires guarantees the selected WooCommerce tier cannot provide;
- the Brand already has a safer certified authority.

## 17. Example dynamic compositions

### 17.1 Apparel stock/outlet Brand

```text
activity: retail.apparel + retail.outlet_stock
characteristics: variants, unique items, condition, defects, photography
channels: web + POS + social + live
```

Derived packs:

- variant catalog;
- Stock Unit ledger;
- atomic reservation;
- product-intake and photography;
- condition/defect disclosure;
- returns inspection;
- catalog feeds;
- POS reconciliation;
- WooCommerce Governed Bridge when WooCommerce is selected.

### 17.2 Professional service Brand

```text
activity: services.professional
characteristics: no inventory, quotation, appointments, retainers
channels: content site + forms + WhatsApp + sales-assisted
```

Derived packs:

- WordPress content and SEO;
- forms and CRM;
- appointment or quotation workflow;
- payment links;
- lead attribution;
- no inventory or POS pack unless explicitly added.

### 17.3 Travel DMC

```text
activity: travel.dmc
characteristics: suppliers, itineraries, quotations, allocations, multi-currency
channels: web + agent-assisted + B2B
```

Derived packs:

- supplier and contract projections;
- itinerary and quotation workflows;
- booking or external inventory adapter;
- multi-currency and cancellation rules;
- WordPress content may be selected;
- WooCommerce is only compatible when bounded products or payment links fit the profile.

### 17.4 SaaS subscription

```text
activity: saas.subscription
characteristics: plans, entitlements, recurring billing, usage, support
```

Derived packs:

- subscription billing adapter;
- entitlement and usage ledger;
- account lifecycle;
- support and product analytics;
- WordPress marketing site optional;
- WooCommerce subscriptions only when the adapter tier satisfies entitlement and reconciliation requirements.

### 17.5 Marketplace

```text
activity: marketplace.multi_vendor
characteristics: vendors, commissions, settlements, disputes
```

Derived packs:

- vendor onboarding;
- multi-party catalog;
- commission and settlement ledger;
- marketplace compliance;
- WooCommerce marketplace plugins require explicit compatibility and settlement certification.

## 18. Effective Business Profile Snapshot

The resolver MUST persist a no-secret snapshot containing:

```text
effective_profile_ref
tenant_ref
workspace_ref
brand_ref
channel_ref
location_ref
primary_activity_type_key
secondary_activity_type_keys
activity_pack_refs
profile_definition_refs
resolved_dimensions_json
capability_set_json
blueprint_candidates_json
conflicts_json
lineage_json
version_vector_json
authority_epoch
context_hash
status
computed_at
expires_at
secrets_included = false
```

The lineage identifies each inherited, overridden, restricted, blocked, or defaulted value.

## 19. Revision and invalidation

The effective profile version vector includes:

- activity type versions;
- Activity Pack versions;
- Tenant, Workspace, Brand, channel, and location profile revisions;
- container relationship and classification revisions;
- Brand Commerce Profile revision;
- domain-authority and connection-binding revisions;
- adapter certification versions;
- capability-catalog and Blueprint versions;
- policy and consent revisions;
- authority epoch.

Any relevant change invalidates dependent snapshots, discovery results, Blueprint scores, readiness reports, plan drafts, caches, search projections, and agent contexts.

A stale effective profile MUST fail closed for consequential execution.

## 20. Conflict handling

Conflicts are first-class findings, not silent last-write-wins outcomes.

Examples:

- Tenant prohibits external sharing while Brand requests public campaign folders;
- primary and secondary activities require incompatible order authorities;
- Workspace delegates a WooCommerce connection to Brand A but Brand B requests it;
- activity requires unique-item reservation but selected WooCommerce tier only supports quantity stock;
- location requests a currency not supported by the payment authority;
- regulatory pack requires retention that conflicts with a local deletion override.

The resolver returns:

```text
ready
ready_with_inherited_constraints
needs_clarification
needs_approval
degraded
blocked
```

## 21. User experience

The Enablement Center MUST present:

- detected business activity;
- confirmed primary and secondary activities;
- inherited profile values and their source;
- local Brand values;
- restrictions that cannot be overridden;
- recommended capability packs;
- capabilities marked not relevant;
- Blueprint recommendations and tradeoffs;
- missing data and clarification questions;
- inherited provider and file policies;
- impact preview before changing the profile;
- affected sites, channels, workflows, and operations;
- revision history and rollback to an earlier approved profile.

The interface must not expose raw registry complexity to ordinary users, but administrators can inspect lineage and evidence.

## 22. Agent and automation behavior

Agents use the same Effective Business Profile as the UI and application services.

An agent MUST NOT infer business activity solely from free text when a governed profile exists.

When no active profile exists, the agent may:

- run read-only discovery;
- propose candidate activities;
- ask bounded clarification questions;
- generate a draft profile;
- preview capability and Blueprint impact.

It may not activate connections, providers, plugins, spending, publishing, payments, or production changes without the required authority and approval.

## 23. Migration from current profiles

Migration is additive and staged.

### Stage 1 — inventory

Read current:

- `commercial_profiles.industry`;
- `commercial_profiles.verticals_json`;
- `/connect` Business Type and Industry;
- onboarding products, services, locations, CMS, analytics, goals, and segments;
- Brand registry, sites, connections, plugins, workflows, and activity/reference packs.

### Stage 2 — candidate classification

Create draft candidate activities and profile fields with source evidence. Do not activate them automatically.

### Stage 3 — owner confirmation

A Tenant or Brand owner confirms activity, Brand scope, legal markets, domain authorities, and inherited policies.

### Stage 4 — effective-profile compilation

Compile the first active revision and publish lineage.

### Stage 5 — compatibility

Keep existing commercial routes and onboarding payloads working while mapping them to candidate fields. Deprecate direct runtime dependence on free-text `industry` and untyped `verticals_json` only after readback and adoption evidence.

## 24. Data model direction

The implementation SHOULD introduce or map these logical entities:

```text
business_activity_type_registry
business_profile_definition_registry
business_operating_profiles
business_profile_revisions
business_profile_assignments
activity_capability_pack_registry
activity_capability_pack_versions
business_profile_inheritance_policies
effective_business_profile_snapshots
business_profile_lineage_items
business_profile_conflict_findings
business_profile_invalidation_events
```

Where existing Configuration Authority or Container Authority tables provide exact semantics, the implementation MUST reuse them and store references rather than duplicate state.

## 25. Non-negotiable invariants

1. Business activity is registry-driven and versioned.
2. Free-text industry is discovery evidence, not runtime authority.
3. Commercial-account profile and Business Operating Profile are separate.
4. Brand remains mandatory for Commerce execution.
5. Inheritance is dimension-specific, not generic deep merge.
6. Denies and hard constraints cannot be broadened by children.
7. Multi-activity composition uses explicit priorities and conflict rules.
8. Every effective value has lineage and revisions.
9. No silent default Brand, provider, connection, activity, or Blueprint.
10. Capabilities are activated by predicates and governed packs, not industry conditionals in code.
11. WordPress and WooCommerce are dynamically selected components, not universal defaults.
12. Stale effective profiles fail closed for consequential writes.
13. UI and agents consume the same effective profile.
14. Profile changes preview impact and invalidate dependent plans and projections.
15. Secrets, raw provider payloads, and private content never enter profile snapshots or lineage evidence.
