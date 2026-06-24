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
