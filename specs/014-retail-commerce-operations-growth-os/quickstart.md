# Implementation Quickstart

## 1. Current status

This branch contains specification artifacts only. Do not run migrations, seed runtime registries, connect providers, or deploy from this branch.

## 2. Read order

1. `.specify/memory/constitution.md`
2. `docs/spec-kit-governance.md`
3. this specification `README.md`
4. `business-activity-brownfield-review.md`
5. `business-activity-profile-and-inheritance.md`
6. `brand-scoped-commerce-authority.md`
7. `commerce-enablement-and-solution-blueprints.md`
8. `wordpress-woocommerce-authority-and-operations.md`
9. `research.md`
10. `spec.md`
11. `concerns.md`
12. `operation-paths.md`
13. `plan.md`
14. `data-model.md`
15. contracts and checklists
16. task files

## 3. Prepare an implementation slice

For each implementation PR:

1. synchronize a new branch from current `main`;
2. identify the exact task IDs and requirements;
3. run interruption readiness;
4. inspect current files again because this is a fast-moving brownfield repository;
5. create a scoped implementation manifest or evidence file under this spec;
6. implement the smallest additive slice;
7. update canonical sources, not generated outputs directly;
8. run targeted and required CI;
9. record head/base SHA, migrations, feature flags, rollout, rollback, and unresolved gaps.

Suggested readiness command:

```bash
cd http-generic-api
npm run readiness:interruptions
```

## 4. Contract validation

The draft contracts are specification inputs. Before exposing routes:

```bash
cd http-generic-api
npm run schemas:guard
npm run frontend:dispatch:check
```

Add a Spec 014 contract-baseline test that parses:

- `contracts/business-activity-profile-inheritance.schema.json`;
- `contracts/commerce-capability-catalog.schema.json`;
- `contracts/retail-commerce-operations.openapi.yaml`;
- `contracts/commerce-events.schema.json`;
- `contracts/commerce-provider-adapter.schema.json`;
- `contracts/wordpress-woocommerce-adapter.schema.json`.

The test must assert OpenAPI 3.1, JSON Schema 2020-12, stable operation IDs, no secret-like examples, and draft-only/non-runtime classification until the route PR.

## 5. First recommended code slice — profile contracts and pure resolver

Do not begin with inventory tables, WooCommerce writes, or provider connections.

Start with pure domain contracts and deterministic resolution:

```text
src/domain/businessProfile/activityType.js
src/domain/businessProfile/profileDefinition.js
src/domain/businessProfile/inheritancePolicy.js
src/domain/businessProfile/applicabilityPredicate.js
src/domain/businessProfile/effectiveProfileResolver.js
src/domain/businessProfile/errors.js
```

Required unit tests:

- primary, secondary, and cross-cutting activity composition;
- deny_wins, union, intersection, minimum, maximum, nearest_replace, priority_replace, and block_on_conflict;
- restrictive-only child override rejection;
- multi-parent equal-priority conflict;
- bounded predicate validation and deterministic digest;
- stable lineage and version vector;
- no Brand, blocked Commerce result;
- stale source revision, stale result;
- no credential or private payload fields in output.

This first slice must not add SQL, public routes, provider calls, or runtime feature activation.

## 6. Brownfield repository ports

After pure domain tests, add read-only repository ports over existing foundations:

```text
BusinessActivityTypeRepository
BusinessProfileDefinitionRepository
BusinessOperatingProfileRepository
ContainerProfileGraphRepository
ActivityCapabilityPackRepository
EffectiveBusinessProfileProjectionRepository
```

Adapters should read:

- Dynamic Container Authority classifications, relationships, closure, and authority epochs;
- existing Tenant/Workspace/Brand identities;
- current commercial and onboarding candidate sources;
- configuration and effective-authority revisions;
- capability, workflow, adapter, and Blueprint registries.

Do not duplicate the generic container graph or authority engine.

## 7. Database slice rules

Before any migration:

- finalize whether each logical entity maps to an existing generic registry or needs a bounded new table;
- review the latest migration numbering and lifecycle registry;
- dry-run with the governed migration runner;
- ensure Tenant-leading keys and Brand-leading keys where Commerce applies;
- define collation and identifier contracts;
- register lifecycle, owner, backup, retention, and rollback;
- keep migration additive and feature disabled;
- preserve existing `commercial_profiles` and `/connect` compatibility;
- create candidates rather than automatically activating legacy `industry` or `verticals_json` values.

Do not edit production or apply migrations merely because this specification exists.

## 8. Effective Business Profile pilot

The first integrated pilot should use two Brands in one Workspace with different activities.

Example:

```text
Brand A → retail.apparel + outlet_stock + unique_items + POS
Brand B → services.professional + appointments + quotations
```

Required evidence:

- isolated effective profiles and caches;
- different capability maps and Blueprint scores;
- Tenant and Workspace defaults inherited with lineage;
- restrictive parent policies cannot be broadened;
- Brand-local overrides do not leak;
- profile revision invalidates discovery, plans, and agent context;
- stale revision fails closed;
- rollback creates a new immutable revision;
- no default Brand inference.

## 9. Context Kernel integration

Add Effective Business Profile resolution after exact Brand resolution and before capability, Blueprint, provider, or workflow dispatch.

Verify:

- one exact Brand;
- active profile and profile definition;
- activity and pack revisions;
- Tenant/Workspace/Brand/channel/location/resource ancestry;
- domain authority and connection bindings;
- context revision/hash;
- no caller override;
- no tenant- or industry-specific code branches.

Mutation implementation begins only after context parity tests pass.

## 10. Capability and Blueprint integration

Extend the Capability Catalog and Solution Blueprint resolver so each record declares:

- activity applicability predicate;
- required profile dimensions;
- required or forbidden Activity Packs;
- inheritance contract;
- unknown-profile behavior.

Discovery results must pin:

- Effective Business Profile reference;
- context hash;
- version vector;
- activity and pack references;
- inherited constraints and local overrides;
- conflict references.

## 11. Commerce domain policy slice

Only after profile resolution is stable, add pure Commerce domain policy:

```text
src/domain/commerce/errors.js
src/domain/commerce/inventoryStateMachine.js
src/domain/commerce/reservationPolicy.js
src/domain/commerce/paymentStateMachine.js
src/domain/commerce/offlineAllocationPolicy.js
src/infrastructure/commerce/adapters/commerceAuthorityAdapter.js
```

Capability activation and selected authority mode must come from the pinned Effective Business Profile and Brand context.

## 12. Reservation pilot

The first behaviorally meaningful Commerce pilot is unique-item reservation in `platform_native` sandbox mode for an activity profile that requires unique-item semantics.

Required evidence:

- two concurrent attempts, one success;
- same idempotency key, same result;
- changed payload, conflict;
- stale expected version, conflict;
- expired reservation, one release;
- transaction rollback leaves no reservation or Outbox row;
- commit writes domain state and Outbox;
- cross-Tenant, cross-Brand, wrong-location, and wrong-profile rejection;
- safe operation readback.

## 13. WordPress and WooCommerce pilot

Start read-only.

1. compile the Brand Effective Business Profile;
2. inventory the WordPress site and WooCommerce status;
3. evaluate A-P and WC-01 to WC-10 pack predicates;
4. score Standard, Governed Bridge, ERPNext hybrid, and content-only Blueprints;
5. prove active plugins are not treated as certification;
6. prove unique-item plus POS requirements reject WooCommerce Standard;
7. verify Governed Bridge only becomes compatible after adapter certification;
8. keep all WordPress/WooCommerce writes disabled until separate enablement.

## 14. ERPNext adapter pilot

Do not begin with production credentials.

1. compile the activity and Business Profile requirements;
2. create provider profile and adapter manifest in fixture/sandbox state;
3. implement readiness and read-only product/inventory methods;
4. implement custom Frappe atomic reservation if required by the effective profile;
5. run adapter contract suite;
6. verify normalized conflict and unknown-outcome behavior;
7. mark behaviorally certified only from sandbox evidence;
8. keep provider execution disabled until separate enablement.

## 15. Frontend development

The HTML demos are reference artifacts, not files to copy into production unchanged.

Build RetailOS and Enablement modules under the governed `/platform` surface. Use:

- shared design tokens;
- same-origin API;
- fail-closed surface policy;
- no service keys in browser;
- Arabic RTL and English locale dictionaries;
- schema-driven Business Profile forms;
- inherited/local/restricted lineage indicators;
- profile impact preview;
- dynamic relevant/not-relevant capability map;
- exact API state labels;
- mobile/tablet/desktop viewport tests;
- production-disabled QA Sandbox.

## 16. Provider and worker development

Every worker must have:

- SQL/Outbox source of truth;
- pinned Tenant/Workspace/Brand and Effective Business Profile context;
- deterministic claim identity;
- bounded concurrency;
- retry classification;
- dead letter;
- health/lag metrics;
- no-secret logs;
- replay-safe provider identity;
- readback when outcome can be unknown;
- stale-profile and revoked-policy rejection before replay.

## 17. Completion evidence

A slice is not complete at transport success. Record:

- profile validation and activation state;
- inheritance lineage and conflict state;
- capability and Blueprint applicability state;
- execution state;
- delivery state;
- provider acknowledgement/readback;
- compensation/rollback state;
- production deployment parity when deployed.

Update `completion.json` only from authoritative evidence. Never create no-op commits to trigger CI.
