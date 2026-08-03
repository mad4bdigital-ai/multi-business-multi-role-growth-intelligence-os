# Retail Commerce Business Activity Brownfield Rescan — 2026-08-03

## 1. Scan identity

- Task: `T003` — re-scan current `main` before implementation and update Brownfield inventory.
- Repository: `mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os`.
- Exact scanned `main`: `f56e8713e7e3041b0db9e34daf96de903fcb8ee6`.
- Scan date: `2026-08-03`.
- Scan mode: repository read-only.
- Database query: not performed.
- Migration dry-run or Apply: not performed.
- Runtime/provider/credential/WordPress/WooCommerce/Google Drive/Production action: not performed.
- Secrets included: `false`.

This file is a dated rescan of the implementation landscape. It supplements `business-activity-brownfield-review.md`; it does not rewrite that historical architectural review.

## 2. Method

The rescan inspected current-main source and searched for concrete runtime implementations of:

- Business Activity type registries;
- Business Operating Profile records and revisions;
- Effective Business Profile snapshots and lineage;
- Activity Capability Pack resolvers;
- Business Profile inheritance and conflict resolution;
- profile-aware Commerce capability and Blueprint execution.

The scan also re-read the current Tenant commercial profile, `/connect` onboarding, Dynamic Container Authority foundation, Context Kernel inventory, migration governance references, and the Retail Commerce specification baseline.

Repository search is evidence of repository presence or absence only. It is not evidence that a migration is applied in an environment or that a runtime surface is deployed. That authoritative environment baseline remains T004.

## 3. Exact-main inventory

| Area | Current source | Current state on scanned main | Reuse decision | Remaining gap |
|---|---|---|---|---|
| Tenant commercial account profile | `http-generic-api/migrations/029_sprint32_tenant_commercials.sql` | `commercial_profiles` exists with one unique row per `tenant_id`, free-text `industry`, JSON markets/verticals, contract, billing, revenue, health, churn, and notes. | Retain as Tenant Commercial Account Profile. | It has no Brand scope, immutable revisions, typed activity taxonomy, inheritance lineage, conflict policy, profile compilation, capability binding, or authority epoch. |
| Commercial profile routes | `http-generic-api/routes/tenantCommercialRoutes.js` | The router is guarded by `requireBackendApiKey`. GET and partial-upsert PUT read/write one Tenant row; PUT uses `COALESCE(VALUES(...), ...)`. | Preserve for compatibility and administrative commercial metadata. | It is not a user/Brand-scoped Business Operating Profile API and must not become Commerce execution authority. |
| `/connect` segment preferences | `http-generic-api/public/connect/steps-4.jsx` | Segment-specific goals and extras remain static arrays for Freelancer, Affiliater, Member, Corporate, and Agency. The UI states that these answers do not block activation. | Reuse as discovery and clarification evidence. | Static presentation options are not a governed taxonomy, capability registry, or authority decision. |
| `/connect` business profile | `http-generic-api/public/connect/steps-4.jsx` | Business type remains a fixed choice among Product, Service, SaaS, Marketplace, and Hybrid; Industry remains free text. Brand voice, products/services, locations, CMS, analytics, and requested CMS scope are collected. | Preserve the payload and normalize it into candidate facts. | Owner confirmation, schema-versioned revisions, Brand-scoped publication, lineage, conflict handling, and effective-profile compilation are absent. |
| Dynamic Container Authority | `http-generic-api/migrations/319_sprint69_dynamic_container_authority_foundation.sql`, `docs/dynamic-container-authority-foundation.md`, `http-generic-api/dynamicContainerAuthority.js` | Registry-driven container, relationship, classification, role, resource-binding, closure, merge, and authority-epoch foundations exist. `Activity` is an available container type. The documentation explicitly classifies this as schema/domain foundation only and says it is not wired into execution. | Reuse for ancestry, classifications, fences, deterministic merge strategies, and epochs. | `Activity` container identity does not itself provide Business Activity taxonomy, operating-profile semantics, capability packs, or runtime authorization. |
| Dynamic Container validation | `http-generic-api/test-dynamic-container-authority-foundation.mjs`, `http-generic-api/test-dynamic-container-migration-preflight.mjs`, `http-generic-api/test-dynamic-container-rollout-safety.mjs` | Foundation and rollout-safety tests exist. | Reuse the tested fail-closed limits, cycle, isolation, and no-secret patterns. | Tests do not prove an Effective Business Profile resolver or environment migration application. |
| Context Kernel inventory | `docs/context-kernel/current-resolver-inventory.md`, `http-generic-api/openapi/context-kernel.yaml`, `specs/012-unified-admin-tenant-context-kernel/**` | Context Kernel contracts and inventories exist. The current resolver inventory is explicitly report-only and records first-row selection, all-zero sentinel, query-failure fallback, ambiguity, and permissive-default findings. | Reuse effective-subject, Tenant/Workspace/Brand, connection ownership, ambiguity, revision, and fail-closed patterns. | Business Profile resolution is not currently inserted as a governed stage between Brand resolution and provider/capability execution. Existing resolver findings must not be copied into the new profile resolver. |
| Effective Authority and workflow foundations | Spec 011/012 assets, Work Maps, capability/workflow/provider governance | Versioned policy, capability, workflow, evidence, readiness, connection, and execution concepts exist. | Compose existing authorities and executors. | A Business Profile may constrain or propose capabilities; it must never become a parallel executor or bypass. |
| Retail Commerce specification governance | `specs/014-retail-commerce-operations-growth-os/**`, `.github/workflows/retail-commerce-specification-baseline.yml`, `http-generic-api/test-retail-commerce-specification-baseline.mjs` | The bounded specification package, Work Map decisions, E2E handoff contract, and specification-only CI baseline are present on main. | Use as the implementation contract and fail-closed no-runtime ratchet. | Specification presence is not implementation maturity or Production proof. |
| Proposed Business Activity/Profile entities | Names proposed in `business-activity-brownfield-review.md` and `business-activity-profile-and-inheritance.md` | Searches for `business_activity_type_registry`, `business_operating_profiles`, `effective_business_profile_snapshots`, `EffectiveBusinessProfile`, `businessProfileResolver`, and `activityCapabilityPackResolver` returned no concrete runtime implementation outside specification/design references. | Implement additively after Phase 0 decisions and authority review. | All bounded profile registries, revisions, assignments, policies, snapshots, lineage, conflicts, invalidations, and resolver services remain unimplemented. |
| WordPress/WooCommerce capability estate | Existing WordPress phases, connector/provider governance, Retail Commerce contracts | Reusable CMS, content, media, security, release, backup, QA, and WooCommerce contract concepts exist. | Select capability packs from the effective profile and certified topology. | Plugin/CMS presence and `/connect` CMS selection still cannot establish compatibility, domain authority, or safe inventory semantics. |
| Migration lifecycle | Migration files and governed migration runner/test surfaces | Repository migration artifacts and governance tooling exist. | Use the governed runner, preflight, ledger, readback, and rollback evidence for future additive schema. | This rescan does not assert that migration 029 or 319 is applied in any environment. Authoritative schema/migration parity is T004. |

## 4. Runtime implementation search result

No current-main runtime implementation was found for the proposed Business Activity and Effective Business Profile layer.

The following remain specification-only concepts at this scan point:

- versioned Business Activity taxonomy;
- Business Operating Profile definitions and revisions;
- scoped assignments across Tenant, Workspace, Brand, channel, location, and resource;
- Activity Capability Pack registry and version compatibility;
- dimension-specific Business Profile inheritance policies;
- Effective Business Profile snapshots and lineage items;
- profile conflict findings and invalidation events;
- a server-side Effective Business Profile Resolver;
- profile-aware Commerce Capability Applicability Resolver;
- profile-aware Solution Blueprint scoring bound to live authority and readiness.

This absence is intentional evidence for sequencing. It prevents the implementation plan from assuming that a partial or differently named runtime already supplies these guarantees.

## 5. Updated risk inventory

### R1 — Commercial metadata confused with operating authority

`commercial_profiles` mixes market and commercial-account metadata at Tenant scope. Treating `industry` or `verticals_json` as direct runtime authority would collapse Brand differences and import untyped free text into consequential decisions.

**Control:** preserve the current meaning; migrate values only as candidate evidence with explicit source lineage and owner confirmation.

### R2 — `/connect` choices treated as taxonomy

The current UI uses fixed arrays and free text. It is useful for discovery but cannot express versioned semantics, compatibility, or restrictive policy.

**Control:** map onboarding values to proposals; never auto-activate activity, provider, capability, or Blueprint authority.

### R3 — Generic Activity container mistaken for Business Activity semantics

Dynamic Container Authority can represent an `Activity` node, but the generic node does not define business-model semantics or capability requirements.

**Control:** use the container as identity/ancestry infrastructure and add a bounded versioned Business Activity registry rather than overloading generic metadata.

### R4 — Context resolver weaknesses copied forward

The current Context Kernel inventory documents ambiguous/first-row/fallback/sentinel risks.

**Control:** the future profile resolver must require exact scope, preserve dependency failures, return ambiguity, pin revisions, and fail closed on limits or conflicts.

### R5 — Repository migration presence mistaken for applied schema

Migration files in Git do not prove environment state.

**Control:** T004 must collect authoritative schema and migration-ledger evidence separately before any implementation migration is designed or applied.

### R6 — Recommendation becomes execution authority

Profiles, capability applicability, and Blueprints can explain or propose, but existing effective authority, readiness, connection, approval, and operation governance must still authorize execution.

**Control:** keep recommendation, readiness, authority, and execution as separate recorded decisions.

## 6. Updated reuse boundary

The implementation should remain a bounded semantic composition layer:

```text
Context Kernel exact scope
→ Business Activity and Profile registries
→ versioned profile assignments and inheritance
→ Effective Business Profile compilation with lineage/conflicts
→ Commerce capability applicability
→ Solution Blueprint proposal
→ existing Effective Authority and readiness
→ existing durable plan, workflow, operation, provider, and evidence layers
```

It must not add:

- a second generic container graph;
- a second effective-authority engine;
- a second workflow or operation executor;
- silent default Brand/activity/provider/connection selection;
- credentials inside profile snapshots or evidence;
- Production or provider effects from discovery data.

## 7. T003 completion decision

T003 is complete for exact `main` `f56e8713e7e3041b0db9e34daf96de903fcb8ee6` because:

1. the historical Brownfield review was rechecked against current source;
2. concrete current-main files and behaviors were inventoried;
3. proposed runtime entity and resolver names were searched and found absent outside specification/design references;
4. current foundations and their non-authority boundaries were recorded;
5. unresolved environment and product decisions were explicitly left to T004–T006;
6. no runtime, database, provider, deployment, or Production mutation occurred.

## 8. Next gates

- **T004:** collect authoritative environment schema and migration-ledger baseline; do not infer application from Git.
- **T005:** resolve pilot backend, object storage, payment, shipping, and ERPNext version decisions.
- **T006:** approve architecture, security, API, database, and operations review checklist.

Phase 1 runtime implementation must not start by treating this repository rescan as environment authorization.
