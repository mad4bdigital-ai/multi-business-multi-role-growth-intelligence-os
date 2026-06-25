# Data Isolation Checklist

## Shared versus scoped data

- [x] Shared canonical assets contain no tenant-specific secret or private preference.
- [x] Shared catalog projection references canonical assets without copying tenant data.
- [x] Tenant/user use creates scoped bindings or evidence, not shared-asset mutation.
- [x] Every optional variant is tenant-bound even when user-owned.
- [x] Every profile selection, preference, proposal, experiment, and manifest has explicit subject scope.

## Query boundaries

- [x] Tenant ID comes from the authenticated principal.
- [x] Repository queries begin with tenant scope for tenant-owned rows.
- [x] User-owned preferences require tenant + user scope.
- [x] Container, variant, connection, and role references are validated against the same tenant.
- [x] Admin diagnostics are separate from Tenant APIs and audited.
- [x] Cursor tokens cannot be replayed across tenants or incompatible filters.

## Variants and profiles

- [x] Variant owner scope cannot reference another tenant's user, role, workspace, brand, or activity.
- [x] Personal variants are not visible to other users unless explicitly promoted/shared through governed scope.
- [x] Profile selections affect only the declared principal/context.
- [x] Reset and rollback operate only on the caller's authorized scope.
- [x] Shared base updates never copy tenant patch content into another tenant.

## Credentials

- [x] Credential values stay in existing vault/secret authorities.
- [x] Manifests and variants contain opaque references only.
- [x] Connection selection validates tenant/user/workspace/brand eligibility.
- [x] Cross-tenant credential references are blocked before secret materialization.
- [x] Logs and adaptive evidence contain readiness summaries, not credential payloads.

## Learning and telemetry

- [x] User behavioral evidence is scoped to tenant and user where applicable.
- [x] Adaptation consent and visibility controls are represented.
- [x] Platform-wide learning cannot directly consume tenant content as a shared asset.
- [x] Promotion candidates remove tenant identifiers, credential references, confidential content, and proprietary instructions before review.
- [x] Aggregated signals include minimum cohort/privacy policy before cross-tenant use.
- [x] User preference export/reset does not alter tenant policy or shared runtime evidence required for audit.

## Memory and context

- [x] Memory scope links remain linkage evidence, not runtime authorization.
- [x] Memory retrieval uses tenant/user/workspace/brand/activity/role scope.
- [x] Personal memories cannot become tenant or platform policy without explicit promotion.
- [x] Effective manifests disclose source categories without leaking another principal's private values.

## Retention and deletion

- [x] Profiles, variants, proposals, experiments, and ledgers have explicit lifecycle states.
- [x] Preference deletion/reset semantics are separate from immutable security/audit evidence.
- [x] Expired proposals and canaries cannot affect future resolution.
- [x] Retention policies must preserve regulatory/audit requirements without retaining unnecessary personal detail.
- [ ] Data retention periods approved by policy owners.
- [ ] Subject export/deletion tests implemented.

## Invitation, membership, and personal-context isolation

- [x] An invitation targets exactly one Tenant and cannot create or modify another Tenant.
- [x] Exact Brand/Workspace/Department/Group/Role/resource scopes are tenant- and object-bound.
- [x] Accepting one invitation cannot change memberships or grants in unrelated Tenants.
- [x] A personal-account Tenant and personal Workspace are separate from company Tenants and hidden from their administrators.
- [x] Company resources, artifacts, knowledge, connections, and credentials cannot be copied into personal space without explicit authorized policy.
- [x] Active context contains one Tenant boundary and cannot aggregate unrelated Tenant data implicitly.
- [x] Context switching revalidates current membership, grants, Brand/Workspace scope, and authority epoch.
- [x] Revocation invalidates only affected Tenant contexts and preserves unrelated personal/company contexts.
- [x] Public invitation preview reveals only safe labels and no private member, asset, credential, or data details.
- [x] Identity-provider linkage does not grant Tenant membership or resource access by itself.
- [ ] Cross-Tenant invitation token substitution tests implemented.
- [ ] Personal/company data crossover and context-confusion tests implemented.

## Tenant and Workspace isolation

- [x] Every Workspace has exactly one owning Tenant and cannot move across Tenants by rebinding.
- [x] Workspace Brand, Department, Group, Activity, Agent, and resource bindings reference objects in the same Tenant.
- [x] Workspace grants never create Tenant membership or cross-Tenant authority.
- [x] Owning one Tenant does not expose Workspaces or resources in another Tenant.
- [x] Personal-account Workspaces are invisible to company Tenant administrators.
- [x] Company resources cannot be copied into personal space without explicit export/copy policy, authorization, provenance, and data-governance review.
- [x] Multi-Brand Workspaces remain inside one Tenant and preserve Brand-specific policy and access boundaries.
- [x] Active context identifies one Tenant boundary and prevents implicit mixed-Tenant views.
- [x] Workspace archive/deletion preserves required audit and disposes only scoped operational dependencies.
- [x] Tenant offboarding enumerates and processes every owned Workspace.
- [ ] Same-Tenant binding and cross-Tenant rejection tests implemented for every Workspace binding type.
- [ ] Personal/company isolation and multi-Brand data-separation tests implemented.

## Blueprint inheritance and Brand isolation

- [x] Business-Type Blueprints are reusable templates and contain no Brand credentials, memberships, or private content by default.
- [x] Every inherited operational instance begins with tenant and Brand scope.
- [x] Brand layer relationships and closure never traverse into another Brand.
- [x] Shared resource bindings store canonical references and provenance, not copied tenant data.
- [x] Brand-local overrides remain tenant/Brand scoped and cannot modify another Brand's inherited instance.
- [x] Member and Agent profile assignments validate the same tenant/Brand/Department/Group before authority resolution.
- [x] Knowledge inheritance references only data whose audience, purpose, residency, and Brand policy permit use.
- [x] Cross-Brand learning or Blueprint promotion never copies raw Brand content automatically.
- [x] Removing a Business-Type binding preserves or disposes Brand-local data according to an approved plan; it never deletes canonical shared assets.
- [x] Export/import preserves Blueprint and canonical source references while remapping Brand-scoped instance IDs safely.
- [x] Backup/restore validates Brand and Blueprint provenance and rejects cross-Brand reference corruption.
- [ ] Brand inheritance crossover test suite implemented for every layer family.
- [ ] Knowledge/resource binding audience and residency tests implemented.

## Federation, lifecycle, and portability

- [x] Parent/partner/managed-client/white-label relationships require explicit delegated scope.
- [x] Group and service identities remain tenant-bound and cannot resolve cross-tenant members implicitly.
- [x] Tenant ownership transfer and offboarding include connection, grant, variant, approval, schedule, artifact, and export disposition.
- [x] Tenant and user exports are no-secret, checksummed, scope-authorized, and auditable.
- [x] Imports validate tenant ownership, stable IDs, conflicts, schema compatibility, and prohibited references.
- [x] Legal hold blocks deletion without granting new access.
- [x] Erasure propagation covers preferences, adaptive evidence, derived artifacts, and indexes subject to minimal audit retention.

## Data location and model use

- [x] Residency and jurisdiction restrict storage, indexing, model, provider, and connector eligibility.
- [x] Environment and region bindings are validated before credential materialization.
- [x] Model routing cannot move tenant content to an ineligible provider or region through fallback.
- [x] Simulation and evaluation corpora remain tenant-scoped unless an approved aggregate dataset is used.
- [x] Cross-tenant aggregation uses minimum cohorts, privacy policy, weighting, and opt-out controls where applicable.

## Artifact and recovery isolation

- [x] Provenance exposes safe source IDs/evidence without another tenant's private content.
- [x] Correction/retraction/erasure propagation never crosses tenant boundaries accidentally.
- [x] Backup and restore preserve tenant ownership and validate no cross-tenant reference after recovery.
- [x] Disaster/degraded modes cannot widen tenant or data access.

## Verification

- [ ] Cross-tenant list/get/search/mutation tests pass for every new resource.
- [ ] Inference and promotion pipelines pass privacy review.
- [ ] Query plans and indexes confirm tenant-leading lookups.
- [ ] No-secret scans pass across database, logs, OpenAPI examples, and runtime responses.
