# Implementation Plan

## Delivery principle

The preferred repository path is to repair and reconcile the current feature branch. Before creating a replacement branch, the governed workflow must:

1. inspect current and default branch SHAs;
2. classify drift and file overlap;
3. repair the current branch through fast-forward, reviewed merge commit, or explicitly approved stale-branch patch;
4. verify ancestry, tree scope, CI, and PR continuity.

A new branch is a last resort only when the current branch cannot be safely reconciled without losing history or violating policy.

## Architecture boundaries

Implementation follows the repository layer model:

```text
src/api/sharedAssetFabric
src/application/sharedAssetFabric
src/domain/sharedAssetFabric
src/infrastructure/sharedAssetFabric

src/api/contextComposition
src/application/contextComposition
src/domain/contextComposition
src/infrastructure/contextComposition

src/api/adaptiveGrowth
src/application/adaptiveGrowth
src/domain/adaptiveGrowth
src/infrastructure/adaptiveGrowth
```

- API validates and maps transport contracts.
- Application services orchestrate use cases and transactions.
- Domain modules implement typed algebra, invariants, and decisions.
- Infrastructure adapters read current registries, Dynamic Container Authority, variants, connections, and telemetry.
- Existing Resource API coverage architecture is reused for list/get/search/permissions/changes/revisions/readback patterns.

No controller may directly implement policy algebra or call providers.

## Phase -1 — Extended Design Freeze

Before runtime implementation, approve the boundaries and canonical owners for the additional platform planes:

1. principal/group/service identity and delegation;
2. tenant federation, lifecycle, ownership transfer, offboarding, export, legal hold, and erasure;
3. data classification, purpose, consent, retention, residency, and jurisdiction;
4. commercial entitlement, estimate, reservation, settlement, refund, and cost attribution;
5. contextual model routing, fallback, evaluation, deprecation, and quality drift;
6. universal operation identity, outbox/inbox, delivery semantics, cancellation, compensation, concurrency, and backpressure;
7. artifact/knowledge provenance, verification, correction, retraction, and disposition;
8. temporal `as_of`, scheduled publication, environment, region, and jurisdiction semantics;
9. plugin/package publisher trust, signing, dependency inventory, vulnerability, license, update, and revocation;
10. compatibility, portability, resilience, human service levels, capability ontology, localization, fairness, and cross-tenant learning.

Deliverables:

- ADRs for each P0 boundary;
- source-of-truth and ownership matrix;
- compatibility and migration strategy;
- updated Effective Runtime Manifest schema proposal;
- threat model and data-flow review;
- quality/evaluation and cutover thresholds;
- decision on which authorities are required in the first read-only pilot versus deferred.

Exit: no unresolved P0 authority duplication or undefined fail-open behavior.

## Phase 0 — Design and canonical alignment

- Approve the shared-by-default and optional-variant terminology.
- Approve typed policy operators and user preference boundaries.
- Reconcile this Spec Kit with the Dynamic Container Authority canonical and the Resource API coverage architecture now on `main`.
- Add ADRs for shared asset identity, typed composition algebra, personalization boundaries, and adaptive promotion.
- Update `AI_Agent_Knowledge_Guide.md`, `system_bootstrap.md`, `memory_schema.json`, `direct_instructions_registry_patch.md`, `module_loader.md`, and `prompt_router.md`.
- Update canonicals and run `node build-canonicals.mjs`.

Exit: design freeze with no unresolved authority duplication.

## Phase 1 — Shared catalog projection

- Add `platform_asset_catalog_registry` and catalog projection adapters.
- Register canonical source mappings for agents, skills, workflows, actions, apps, plugins, policies, rules, tools, logic, engines, knowledge, and profiles.
- Define tenant visibility, entitlement, risk, customization policy, required capabilities, and connection profile.
- Expose read-only Admin and Tenant Resource API coverage.

Exit: tenants can discover shared assets without copies, with explicit readiness states.

## Phase 2 — Populate Dynamic Container subjects

- Project existing tenants, workspaces, brands, business activities, and workflows into `containers` using deterministic canonical subject references.
- Create valid containment/reference edges without changing canonical ownership.
- Populate closure, classifications, and authority epochs.
- Build consistency views for missing, duplicate, stale, and cross-tenant projections.
- Keep enforcement disabled.

Exit: every pilot context resolves a bounded graph path with zero provider calls.

## Phase 3 — Bridge current roles, grants, and policies

- Build read-only bridge views/adapters for `role_assignments`, skill grants, workflow bindings, app action grants, workspace resource grants, execution policies, and target policy rules.
- Normalize bridge evidence into resource bindings and policy atoms without changing current authorities.
- Record comparable legacy and contextual decisions in shadow.

Exit: parity dashboard explains every match/mismatch by source row and field.

## Phase 4 — Typed policy semantics

- Add `policy_field_semantics_registry` and registered schemas.
- Implement pure domain operators: union, intersection, deny-wins, min/max, replacement, topological merge, ordered append, bounded weighted merge.
- Add deterministic property tests, conflict tests, and fuzzing for bounded inputs.
- Integrate field-level explanation.

Exit: identical input/version state yields identical values, evidence, and checksum.

## Phase 5 — Composition profiles

- Add composition profile, rule, and principal-selection authorities.
- Seed platform templates: explore, focused, brand-strict, role-strict, automation-safe, regulated.
- Add impact preview and versioned publish/reset flows.
- Enforce dimension-allowed operators and required layers.

Exit: users can choose eligible modes per dimension and preview impact without changing authority.

## Phase 6 — User runtime preferences

- Add the allowlisted user preference schema and service.
- Bridge existing dashboard and agent-surface preferences where compatible.
- Separate ranking/hiding/presentation from authorization.
- Add transparency, reset, change history, revisions, consent, and opt-out controls.

Exit: every user can personalize authorized behavior with no cross-user or authority mutation.

## Phase 7 — Optional variants

- Extend existing package variant concepts into generic shared-asset variants for non-package assets.
- Add modifiable-path profiles, patch validation, versioning, conflict detection, upgrade preview/apply, reset, and certification gates.
- Do not create variants during ordinary catalog use or grants.

Exit: explicit user/role/workspace/brand/activity/tenant customization is versioned, isolated, and reversible.

## Phase 8 — Effective runtime manifest

- Combine container resolution, shared candidates, profile choices, policy algebra, variants, preferences, and readiness into an immutable manifest.
- Add epoch and version revalidation, caching, invalidation, explanation, and outcome attribution.
- Link execution plans/logs to the manifest checksum.

Exit: every dispatch or block is reconstructable without secrets.

## Phase 9 — Connections and operational cleanup

- Integrate tenant/user connection selection and opaque credential references.
- Clean pending connector classifications: genuine setup gaps, platform validation gaps, internal transports, duplicates, stale records, and dev-only connectors.
- Backfill installation evidence only after same-cycle validation.
- Separate approval-sensitive grants from open requests in awareness.

Exit: catalog readiness matches operational evidence and no synthetic installation exists.

## Phase 10 — Adaptive growth foundation

- Add adaptive proposals, simulations, experiments, outcome measurements, and promotion candidates.
- Connect existing recommendation, intent, execution, readiness, and business-result evidence.
- Implement proposal classes A–E and approval routing.
- Add privacy, consent, retention, and cross-tenant aggregation controls.

Exit: signals can produce explainable proposals, but no proposal silently mutates authority.

## Phase 11 — Simulation and canary

- Build bounded historical/synthetic replay with no provider writes.
- Define success metrics, guardrails, sample thresholds, expiry, and automatic rollback.
- Canary personal preferences first, then read-only composition profiles, then low-risk variants.
- Exclude provider writes and Class E from autonomous canaries.

Exit: measured improvements can be promoted or rolled back using immutable evidence.

## Phase 12 — Family-by-family cutover

Suggested order:

1. shared catalog visibility;
2. user presentation preferences;
3. read-only workflow ranking;
4. knowledge/tools guarded union;
5. agent/workflow contextual composition;
6. read actions and connections;
7. approval-sensitive actions in shadow;
8. write actions only after exact certification.

Each family requires parity, latency, audit, isolation, rollback, and release-readiness evidence.

## Cross-plane implementation sequence

The additional planes are introduced behind read-only adapters and feature-family flags. They do not require one monolithic migration.

### Sequence A — identity and lifecycle foundations

- principal/group/service identity;
- tenant relationships and lifecycle states;
- environment/region/jurisdiction registry;
- data classification and purpose registry;
- contract/schema registry.

### Sequence B — manifest inputs

- commercial entitlement and cost estimate/reservation preview;
- model capability/policy/evaluation read models;
- artifact provenance and verification;
- human availability/escalation evidence;
- resilience and backup readiness.

### Sequence C — operation consistency

- universal operation identity;
- outbox/inbox and deduplication;
- deadlines/cancellation;
- concurrency and reservations;
- saga/compensation and dead-letter recovery.

### Sequence D — tenant portability and ecosystem

- tenant export/import and offboarding;
- plugin/package supply-chain trust;
- capability ontology/substitution;
- client compatibility/deprecation;
- localization and jurisdiction behavior.

### Sequence E — evaluation and adaptive expansion

- golden datasets and regression suites;
- recommendation exposure/fairness evidence;
- online drift/calibration;
- privacy-safe cross-tenant aggregate learning;
- commercial and platform-default experiments.

Each sequence begins in diagnostics/shadow and can be independently disabled. Contextual writes remain blocked until all applicable P0 planes return current, non-ambiguous evidence.

## Testing strategy

### Unit

- every algebra operator;
- precedence and ambiguity;
- patch validation;
- preference authority boundaries;
- proposal risk classification;
- deterministic checksums.

### Integration

- container graph plus legacy bridges;
- profile selection plus typed atoms;
- variants plus shared base upgrades;
- connection/readiness resolution;
- manifest persistence and epoch drift;
- adaptive simulation and rollback.

### Security

- cross-tenant object access;
- secret-like payload rejection;
- role/grant escalation;
- mandatory policy weakening;
- wildcard delegation;
- stale cache/manifest use;
- provider call before authorization.

### Performance

- multi-parent path bounds;
- candidate limits;
- catalog pagination;
- p50/p95/p99 manifest resolution;
- cache invalidation;
- high-cardinality telemetry queries.

## Migration strategy

- additive migrations only;
- bridge views before authority cutover;
- no one-row-per-tenant asset seeding;
- reversible by disabling consumers and feature flags;
- backfills are idempotent, bounded, and read back;
- destructive cleanup occurs only after certified cutover and retention review.

## Release gates

- OpenAPI 3.1 and Resource API coverage pass;
- architecture boundaries and test manifest pass;
- migrations preflight and rollback plan pass;
- zero critical shadow mismatches;
- required sample and audit coverage pass;
- secrets-included flags remain false;
- development verification and release readiness pass;
- explicit approval precedes production enforcement;
- production parity and behavioral readback pass.

## No-go conditions

- shared assets are copied automatically per tenant;
- user preference is used as a grant;
- arbitrary JSON merge remains possible;
- current Dynamic Container graph remains empty for target pilot scopes;
- unresolved legacy/contextual parity gaps;
- credentials appear in variants or manifests;
- enforcement is enabled without rollback and same-cycle readback;
- adaptive changes can self-approve authority or provider writes.
