# Business Activity and Profile Inheritance — Brownfield Code Review

## 1. Review purpose

This review identifies the exact repository foundations that should be reused to implement dynamic Business Activity, Business Operating Profiles, and inheritance. It also records current semantics that are insufficient or unsafe as direct runtime authority.

## 2. Current Tenant commercial profile

Current migration `029_sprint32_tenant_commercials.sql` creates `commercial_profiles` with:

- `tenant_id` as the only scope key;
- `industry`;
- `company_size`;
- `markets_json`;
- `verticals_json`;
- contract and billing fields;
- MRR, ARR, and LTV;
- acquisition source;
- health score and churn risk;
- notes.

Current `tenantCommercialRoutes.js` reads and updates one record per Tenant.

The update path uses `COALESCE(VALUES(field), field)`, so it behaves as a partial account-profile update. It does not provide:

- Brand scope;
- immutable revisions;
- profile definitions or schema versions;
- activity taxonomy references;
- inheritance lineage;
- conflict detection;
- field-level override policies;
- effective profile compilation;
- invalidation or authority epochs;
- connection, capability, or Blueprint linkage.

### Decision

Keep this table and route as **Tenant Commercial Account Profile** during compatibility migration. Do not rename its meaning silently and do not make MRR, LTV, churn, contract, free-text industry, or untyped verticals runtime Commerce authority.

## 3. Current `/connect` business onboarding

The current Connect UI collects useful discovery evidence:

- Tenant type and segment;
- goals and preferences;
- Business Type options: Product, Service, SaaS, Marketplace, Hybrid;
- free-text Industry;
- Brand voice, story, tagline, and audience;
- locations;
- products and services;
- CMS and CMS URL;
- social channels;
- analytics choices;
- requested CMS scope.

Segment-specific options are currently embedded in frontend arrays for Freelancer, Affiliater, Member, Corporate, and Agency.

### Reuse

These fields are useful as candidate profile inputs and dynamic clarification evidence.

### Gap

They are currently presentation choices, not a governed activity taxonomy. Their values are not enough to decide inventory semantics, legal requirements, domain authority, provider compatibility, WordPress/WooCommerce tier, or inheritance.

### Decision

Preserve the existing payload for compatibility. Normalize it into candidate profile fields and classification proposals. Require schema validation and owner confirmation before activation.

## 4. Dynamic Container Authority reuse

Migration `319_sprint69_dynamic_container_authority_foundation.sql` already provides the correct generic graph primitives:

### Containers

- typed container registry;
- allowed parent and child types;
- default inheritance and classification profiles;
- canonical subject bindings;
- status and version.

### Relationships and closure

- relationship classes: containment, sharing, delegation, reference, management;
- explicit ancestry and inheritance contribution flags;
- priorities, conditions, validity, and versions;
- closure with depth, path count, path hash, and authority epoch.

### Classifications

- classification definition registry;
- eligible container types;
- cardinality;
- inheritance modes;
- merge strategies;
- conflict policies;
- versioned assignments.

### Roles and resources

- role templates and inherited assignments;
- resource dimension registry;
- resource bindings with allow, deny, restrict, require, share, and delegate;
- local, inherited, explicit-share, and block-inheritance modes.

### Decision

Business activity and operating profile inheritance must use these primitives for ancestry, classifications, fences, and epochs. Do not create a second generic hierarchy or graph closure system.

## 5. Spec 011 Effective Authority reuse

Spec 011 defines:

- resource nodes and graph edges;
- `inheritance_policy_key` on relationships;
- scope grants and restrictions;
- versioned policy and capability sources;
- effective decision records;
- version vectors;
- projections, drift findings, and invalidation events;
- no-secret evidence.

### Decision

Effective Business Profile resolution should follow the same evidence discipline:

```text
inputs
→ versioned resolution
→ reason and conflict codes
→ lineage
→ context hash
→ expiry and invalidation
```

A Business Profile snapshot is an execution input, not an independent authorization bypass.

## 6. Spec 012 Context Kernel reuse

Spec 012 already establishes:

- Tenant and Workspace resolution;
- Brand and owner-scope resolution;
- connection ownership and delegation;
- fail-closed ambiguity;
- revision-aware context;
- prohibition of client-supplied IDs as authority.

### Decision

The Context Kernel must resolve the exact active Effective Business Profile after Brand resolution and before capability/Blueprint/provider dispatch.

The caller may provide an activity or profile reference only as a constraint. The server verifies it against live authority and revisions.

## 7. Configuration Authority and Activity Packs

The repository already has versioned configuration, workflow, activity/reference pack, capability, and provider concepts distributed across Specs 006, 011, 012, 013, platform plugin surfaces, readiness, and execution evidence.

### Decision

Activity Capability Packs should compose existing capability keys, workflow templates, provider requirements, surfaces, and acceptance suites. They must not introduce a competing executor.

The pack resolver outputs a proposed effective capability set; the existing authority and execution layers still decide whether an operation is allowed and ready.

## 8. WordPress and WooCommerce reuse

The repository contains deep WordPress support covering phases A-P:

- content;
- builders/themes;
- settings;
- forms;
- media;
- users/auth;
- SEO;
- analytics/consent;
- performance;
- security;
- observability;
- backup;
- release/rollback;
- integrity;
- QA;
- cutover.

The Spec 014 extension maps these to reusable capability packs and adds WooCommerce packs for store profile, catalog, inventory, checkout, payments, fulfillment, webhooks, extensions, health, and release governance.

### Decision

Business profiles determine which packs are relevant and which WooCommerce tier is safe:

- content-led service activity may use WordPress without inventory;
- ordinary B2C quantity commerce may use WooCommerce Standard;
- cross-channel unique items require Governed Bridge or another authority;
- travel, subscription, marketplace, or regulated activities require their semantic packs and certification before WooCommerce is recommended.

No plugin presence or CMS selection alone grants compatibility.

## 9. Data ownership and profile scope

A Tenant may own several Workspaces and Brands with different activities.

Example:

```text
Tenant: group company
Workspace: shared digital team
Brand A: apparel outlet with unique-item inventory
Brand B: professional service with appointments and quotations
```

A Tenant-only profile cannot safely resolve both Brands.

### Decision

Use separate scoped Business Operating Profiles and compile one Effective Business Profile per Brand/channel/location/resource context.

## 10. Proposed additive logical entities

Where existing generic tables cannot express immutable business-profile versions and compiled projections directly, add bounded entities:

- `business_activity_type_registry`;
- `business_profile_definition_registry`;
- `business_operating_profiles`;
- `business_profile_revisions`;
- `business_profile_assignments`;
- `activity_capability_pack_registry`;
- `activity_capability_pack_versions`;
- `business_profile_inheritance_policies`;
- `effective_business_profile_snapshots`;
- `business_profile_lineage_items`;
- `business_profile_conflict_findings`;
- `business_profile_invalidation_events`.

Each row remains Tenant-scoped; Brand rows preserve Brand; references to container/config/authority records preserve their source revisions.

## 11. Resolution boundary

The target application boundary is:

```text
Context Kernel
→ Effective Business Profile Resolver
→ Commerce Capability Applicability Resolver
→ Solution Blueprint Scorer
→ Effective Authority / Readiness
→ Durable Plan or Domain Command
```

Routes, UI, agents, WordPress connectors, and WooCommerce adapters must not implement their own activity logic.

## 12. Migration safety

- no rewrite of existing `commercial_profiles` in the specification PR;
- no automatic activation from existing free-text values;
- no default Brand inference;
- no copying personal connections into Brand bindings;
- no change to provider credentials;
- no generated activity based solely on one CMS or plugin;
- candidate classification followed by owner confirmation;
- shadow resolution before runtime adoption;
- rollback by resolver/profile revision.

## 13. Brownfield conclusion

The repository is already strong enough to support dynamic business-profile inheritance without a new platform core. The correct implementation is an orchestration and semantic composition layer over:

- Dynamic Container Authority;
- Configuration and Effective Authority;
- Context Kernel;
- capability and workflow registries;
- adapters, readiness, Inbox/Outbox, evidence, and reconciliation.

The primary work is to separate profile meanings, formalize activity taxonomy and pack contracts, compile effective profiles with lineage, and make Commerce Enablement consume those profiles consistently.
