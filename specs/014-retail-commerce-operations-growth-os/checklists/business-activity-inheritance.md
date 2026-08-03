# Business Activity, Business Profile, and Inheritance Review Gate

## Profile separation

- [ ] `commercial_profiles` remains customer-commercial/account metadata rather than Commerce runtime authority.
- [ ] Business Operating Profile has separate schema, lifecycle, revisions, permissions, and evidence.
- [ ] Free-text industry and onboarding Business Type are candidate evidence only.
- [ ] Brand remains mandatory for every Commerce execution path.

## Dynamic taxonomy

- [ ] Activity types are registry-driven, versioned, and extendable without runtime code changes.
- [ ] Primary, secondary, and cross-cutting activities are supported.
- [ ] Parent cycles, excessive depth, invalid ancestors, and deprecated dependencies are rejected.
- [ ] No user-specific or Brand-specific hardcoding exists in activity definitions.

## Inheritance

- [ ] Dynamic Container Authority is reused rather than duplicated.
- [ ] Platform, Tenant, Workspace, Brand, channel, location, and resource scopes are represented.
- [ ] Workspace defaults do not create Brand or Commerce authority.
- [ ] Merge strategy is defined per dimension.
- [ ] Denies and restrictive parent policies cannot be broadened by descendants.
- [ ] Equal-priority conflicts block rather than silently select a value.
- [ ] Inheritance fences and approval-required overrides are supported.
- [ ] Multi-parent ordering is explicit and deterministic.

## Effective profile

- [ ] Effective snapshot contains complete lineage.
- [ ] Version vector includes profiles, activities, packs, graph, authority, connections, adapters, catalog, Blueprint, and policies.
- [ ] Authority epoch and context hash are included.
- [ ] Stale snapshots fail closed for consequential writes.
- [ ] Cache keys preserve Tenant, Workspace, Brand, channel, location, resource, and revision vector.
- [ ] Invalidation reaches discovery results, Blueprint scores, plan drafts, surfaces, search, and agent contexts.

## Activity Capability Packs

- [ ] Packs are versioned registry records.
- [ ] Required, optional, forbidden, and incompatible capabilities are modeled.
- [ ] Applicability is declarative and bounded.
- [ ] Arbitrary JavaScript, SQL, network access, and provider calls are forbidden in predicates.
- [ ] Pack cycles and incompatible compositions are rejected.
- [ ] Pack lineage remains visible in capability and Blueprint assessments.

## Commerce Enablement

- [ ] Capability Catalog supports activity applicability and inheritance contracts.
- [ ] Blueprints declare supported activities and required profile dimensions.
- [ ] Blueprint scoring uses effective-profile and live-readiness evidence.
- [ ] Recommendations expose inherited constraints, local overrides, conflicts, and missing capabilities.
- [ ] Recommendation never creates mutation authority.

## WordPress and WooCommerce

- [ ] WordPress is selected based on content/site needs, not as a universal default.
- [ ] WooCommerce Standard is limited to compatible single-writer semantics.
- [ ] WooCommerce Governed Bridge is required for cross-channel unique-item or external-authority reservation.
- [ ] Active plugins are treated as inventory, not certification.
- [ ] WordPress A-P and WooCommerce WC-01 to WC-10 packs activate dynamically by profile predicates.
- [ ] Unsupported activity semantics block or constrain the WooCommerce Blueprint.

## Onboarding and migration

- [ ] Existing `/connect` payload remains backward compatible.
- [ ] Legacy `industry` and `verticals_json` values become draft candidates, not active authority.
- [ ] Owner confirmation is required before first active Business Operating Profile.
- [ ] No default Brand is inferred during migration.
- [ ] Impact preview precedes profile activation or primary-activity change.
- [ ] Rollback creates a new revision and preserves immutable history.

## Security and privacy

- [ ] Profile snapshots contain no credentials, tokens, signed URLs, raw provider payloads, private file content, or unnecessary PII.
- [ ] Agent prompts cannot override governed profile or activity authority.
- [ ] Cross-Brand profile, cache, search, file, provider, and workflow isolation are tested.
- [ ] Sensitivity and evidence requirements are defined per profile dimension.

## Verification

- [ ] JSON Schema parses and validates representative records.
- [ ] At least 70 acceptance cases are automated or explicitly mapped.
- [ ] Two different Brands in one Workspace produce isolated effective profiles and different capability recommendations.
- [ ] Multi-activity conflict, stale revision, restrictive inheritance, and rollback tests pass.
- [ ] Architecture Drift, Resolver, Unit & Integration, Docs, Spec Kit, and readback checks pass.
- [ ] No no-op commit is used to trigger CI.
