# Dynamic Business Activity and Profile Inheritance — Implementation Tasks

## Delivery rule

These tasks extend Spec 014. They do not authorize production mutation. Runtime implementation MUST use separate PRs and preserve compatibility with existing `commercial_profiles`, `/connect`, Dynamic Container Authority, Spec 011, Spec 012, and the Commerce Enablement Fabric.

## Slice BA-01 — Brownfield contract inventory

- [ ] T-BA-001 Inventory every current field written to `commercial_profiles` and classify it as account-commercial, operating-profile, duplicated, ambiguous, or deprecated.
- [ ] T-BA-002 Inventory `/connect` Business Type, Industry, products/services, locations, CMS, analytics, social, goals, segment, and preferences.
- [ ] T-BA-003 Inventory Brand Registry, Brand Core, commercial profile, vertical, Activity/Reference Pack, workflow-template, and solution-mode sources.
- [ ] T-BA-004 Map existing Dynamic Container Authority container types, relationships, classifications, resource dimensions, role assignments, closure, and authority epochs.
- [ ] T-BA-005 Map Spec 011 Configuration/Effective Authority entities and revision vectors that can be reused.
- [ ] T-BA-006 Produce a field-level migration matrix and prove no credential-bearing field enters profile storage.

## Slice BA-02 — Activity taxonomy registry

- [ ] T-BA-010 Add `business_activity_type_registry` or an exact mapping onto the governed classification registry.
- [ ] T-BA-011 Support parent activity types, primary/secondary activities, activity family, value-chain role, business models, product/service modes, and registry priority.
- [ ] T-BA-012 Add validation for cycles, invalid parents, excessive depth, duplicate keys, and deprecated ancestors.
- [ ] T-BA-013 Seed only generic activity families and a bounded initial taxonomy; do not seed customer-specific Brands.
- [ ] T-BA-014 Add lifecycle and versioning: draft, active, disabled, deprecated, retired.
- [ ] T-BA-015 Add read-only APIs and Admin surfaces for taxonomy inspection and lineage.

## Slice BA-03 — Business profile definitions

- [ ] T-BA-020 Add versioned Business Operating Profile definitions with JSON Schema validation.
- [ ] T-BA-021 Define profile dimensions for business models, products/services, revenue, inventory semantics, channels, locations, markets, languages, currencies, taxes, fulfillment, payments, media, CRM, measurement, compliance, SLO, and technology topology.
- [ ] T-BA-022 Separate platform-customer commercial fields from business-operating fields.
- [ ] T-BA-023 Define sensitivity, evidence, approval, inheritance, override, and merge rules per dimension.
- [ ] T-BA-024 Reject unknown dimensions unless an active definition explicitly allows extension fields.
- [ ] T-BA-025 Add definition compatibility and deprecation rules.

## Slice BA-04 — Scoped profiles and revisions

- [ ] T-BA-030 Add Business Operating Profiles at Tenant, Workspace, Brand, channel, location, and resource scopes.
- [ ] T-BA-031 Require Tenant, Workspace, and Brand references for Brand profiles.
- [ ] T-BA-032 Add immutable profile revisions and active-revision pointers.
- [ ] T-BA-033 Add lifecycle transitions and approval requirements.
- [ ] T-BA-034 Add candidate profiles sourced from onboarding or discovery without automatic activation.
- [ ] T-BA-035 Add owner confirmation and reason/evidence capture.
- [ ] T-BA-036 Add revision diff, impact preview, rollback, and retirement.

## Slice BA-05 — Inheritance engine integration

- [ ] T-BA-040 Reuse Dynamic Container Authority graph and closure for profile ancestry.
- [ ] T-BA-041 Add governed profile assignments/classifications to containers.
- [ ] T-BA-042 Add dimension-level strategies: deny_wins, union, intersection, minimum, maximum, nearest_replace, priority_replace, block_on_conflict.
- [ ] T-BA-043 Add inheritance modes: local_only, inherit_down, inherit_until_blocked, explicit_share, block_inheritance.
- [ ] T-BA-044 Add override policies: forbidden, restrictive_only, allowed, approval_required.
- [ ] T-BA-045 Implement explicit multi-parent ordering and reject unresolved equal-priority conflicts.
- [ ] T-BA-046 Prevent a child scope from broadening restrictive parent values.
- [ ] T-BA-047 Prove Workspace inheritance cannot create Commerce authority without an exact Brand.

## Slice BA-06 — Declarative applicability predicates

- [ ] T-BA-050 Implement a bounded predicate evaluator supporting all, any, not, eq, neq, in, contains, exists, gte, and lte.
- [ ] T-BA-051 Restrict inputs to versioned profile fields, classifications, readiness facts, adapter capabilities, and authority facts.
- [ ] T-BA-052 Reject arbitrary JavaScript, SQL, network calls, unbounded recursion, and unknown operators.
- [ ] T-BA-053 Add deterministic canonicalization and predicate digesting.
- [ ] T-BA-054 Add performance limits, depth limits, operand limits, and evaluation evidence.
- [ ] T-BA-055 Add tests proving equivalent predicates produce stable results.

## Slice BA-07 — Activity Capability Packs

- [ ] T-BA-060 Add versioned Activity Capability Packs.
- [ ] T-BA-061 Support required, optional, forbidden, and incompatible capabilities and packs.
- [ ] T-BA-062 Support profile defaults, dimension rules, domain constraints, required connection families, workflows, surfaces, readiness probes, acceptance suites, and operating metrics.
- [ ] T-BA-063 Compile packs from primary, secondary, and cross-cutting activity assignments.
- [ ] T-BA-064 Reject pack cycles and incompatible active compositions.
- [ ] T-BA-065 Preserve Activity Pack lineage in every derived capability.
- [ ] T-BA-066 Allow new packs and activities without runtime code changes.

## Slice BA-08 — Effective Business Profile resolver

- [ ] T-BA-070 Build `EffectiveBusinessProfileResolver` as an Application service, not Route logic.
- [ ] T-BA-071 Resolve platform, Tenant, Workspace, activity, Brand, Commerce, channel, location, resource, and execution policy inputs.
- [ ] T-BA-072 Return ready, ready_with_inherited_constraints, needs_clarification, needs_approval, degraded, blocked, or stale.
- [ ] T-BA-073 Persist no-secret effective snapshots, lineage items, conflict findings, and version vectors.
- [ ] T-BA-074 Include authority epoch, Brand Profile, Domain Authority, connection binding, adapter certification, capability catalog, and Blueprint versions.
- [ ] T-BA-075 Fail closed on stale revisions for consequential writes.
- [ ] T-BA-076 Add bounded cache keyed by Tenant, Workspace, Brand, channel, location, resource, and revision vector.
- [ ] T-BA-077 Invalidate caches and projections on every relevant source change.

## Slice BA-09 — Commerce Enablement integration

- [ ] T-BA-080 Extend capability definitions with activity applicability and inheritance contracts.
- [ ] T-BA-081 Extend Blueprints with supported activity types, required profile dimensions, inherited constraints, and conflict rules.
- [ ] T-BA-082 Score Blueprints from Effective Business Profile plus live readiness evidence.
- [ ] T-BA-083 Return matched outcomes, inherited requirements, local overrides, missing capabilities, conflicts, custom bridges, and lineage.
- [ ] T-BA-084 Mark capabilities `not_relevant` through evaluated predicates rather than hard-coded screens.
- [ ] T-BA-085 Require owner or governed policy approval before applying a recommended Blueprint.

## Slice BA-10 — WordPress and WooCommerce dynamic composition

- [ ] T-BA-090 Map WordPress phases A-P and WooCommerce packs WC-01 to WC-10 to Activity Pack applicability predicates.
- [ ] T-BA-091 Recommend WordPress for content-led activities only when site and operational requirements match.
- [ ] T-BA-092 Recommend WooCommerce Standard only when one store can safely own relevant domains.
- [ ] T-BA-093 Require WooCommerce Governed Bridge when unique-item or cross-channel reservation guarantees apply.
- [ ] T-BA-094 Reject WooCommerce as an authority when required semantics are unsupported or plugin compatibility is unknown.
- [ ] T-BA-095 Add activity-aware extension/plugin compatibility mappings without treating active plugins as certified.
- [ ] T-BA-096 Add example packs for retail stock/outlet, professional services, travel DMC/OTA, SaaS subscription, and marketplace without customer-specific hardcoding.

## Slice BA-11 — Onboarding and discovery migration

- [ ] T-BA-100 Keep current `/connect` payloads backward compatible.
- [ ] T-BA-101 Convert free-text Business Type and Industry into candidate classifications with evidence.
- [ ] T-BA-102 Preserve source text and confidence without treating it as authority.
- [ ] T-BA-103 Ask dynamic clarification questions from missing required profile dimensions.
- [ ] T-BA-104 Let the owner confirm primary/secondary activities and cross-cutting packs.
- [ ] T-BA-105 Stop direct runtime dependence on free-text `industry` and `verticals_json` only after adoption and readback evidence.
- [ ] T-BA-106 Keep billing, MRR, LTV, contract, and churn fields in the commercial-account profile.

## Slice BA-12 — APIs, UI, and agent tools

- [ ] T-BA-110 Add read APIs for activity taxonomy, profile definitions, candidate profiles, effective profiles, lineage, conflicts, and impact preview.
- [ ] T-BA-111 Add governed mutation APIs for draft, validate, confirm, approve, activate, suspend, rollback, and retire.
- [ ] T-BA-112 Add Arabic RTL profile wizard driven by definition schemas and activity requirements.
- [ ] T-BA-113 Add inherited/local/blocked badges and source lineage.
- [ ] T-BA-114 Add dynamic Capability Map and Blueprint recommendations.
- [ ] T-BA-115 Ensure agents use the same Application services and never infer authority from prompt text.
- [ ] T-BA-116 Add read-only discovery mode for incomplete profiles.

## Slice BA-13 — Drift, reconciliation, and operations

- [ ] T-BA-120 Detect stale effective snapshots and missing invalidations.
- [ ] T-BA-121 Detect active profiles referencing deprecated activity types or packs.
- [ ] T-BA-122 Detect profile/connection/authority mismatch after Brand or provider changes.
- [ ] T-BA-123 Detect capability or Blueprint drift after adapter certification changes.
- [ ] T-BA-124 Add reconciliation jobs and operational alerts.
- [ ] T-BA-125 Add profile-resolution latency, cache hit rate, conflict rate, clarification rate, and stale-rejection metrics.

## Slice BA-14 — Migration and rollout

- [ ] T-BA-130 Run read-only inventory on existing Tenants and Brands.
- [ ] T-BA-131 Generate candidate profiles without activation.
- [ ] T-BA-132 Pilot at least two Brands with different activities in one Workspace.
- [ ] T-BA-133 Prove inherited defaults remain isolated and Brand-specific overrides do not leak.
- [ ] T-BA-134 Run shadow resolution beside legacy behavior.
- [ ] T-BA-135 Compare capability recommendations, connections, surfaces, and workflows.
- [ ] T-BA-136 Activate by Brand feature flag after human review.
- [ ] T-BA-137 Preserve rollback to the prior resolver revision.

## Completion evidence

Implementation cannot be marked complete until:

- the activity taxonomy and packs are versioned and data-driven;
- the commercial-account profile and Business Operating Profile are separate;
- inheritance reuses Container Authority and passes multi-parent/conflict tests;
- effective snapshots include full lineage and revision vectors;
- no Commerce write works without Brand context;
- WordPress/WooCommerce recommendations change dynamically with profile characteristics;
- stale profile revisions fail closed;
- current onboarding is migrated without silent activity activation;
- two-Brand, multi-activity, cross-Brand isolation tests pass;
- no secrets or private provider payloads appear in snapshots, evidence, logs, or agent context.
