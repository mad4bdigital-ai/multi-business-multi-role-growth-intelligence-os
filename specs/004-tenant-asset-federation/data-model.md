# Data Model

## 1. Modeling principles

1. Shared canonical assets remain in their existing source tables.
2. Ordinary tenant or user use creates bindings and preferences, not copies.
3. Optional variants are created only for explicit customization.
4. Context topology, roles, and resource authority reuse Dynamic Container Authority.
5. Credentials remain in existing connection/vault authorities.
6. Adaptation records proposals and experiments, never hidden authority mutation.
7. New schema is additive and can be disabled without deleting shared assets or existing grants.

## 2. Reused authorities

### Shared definitions

- `agents`
- `agent_skills`
- `workflows`
- `actions`
- `app_integrations`
- `plugins`
- `logic_definitions`
- engine and knowledge registries
- `execution_policies`
- `platform_engine_policy_registry`
- `platform_engine_policy_rules`

### Context and authority

- `containers`
- `container_relationships`
- `container_closure`
- `container_classifications`
- `container_role_assignments`
- `container_resource_bindings`
- `container_resource_dimension_registry`
- `container_effective_context_ledger`
- `container_authority_epochs`

### Runtime readiness

- `connected_systems`
- `connections`
- `user_app_connections`
- `installations`
- action grants, resource grants, approvals, quotas, and certification registries

### Existing preference, variant, and learning evidence

- `user_agent_surface_preferences`
- dashboard preference tables
- `platform_package_variants`
- `platform_package_variant_patches`
- `platform_variant_edit_sessions`
- `adaptation_records`
- `tenant_growth_recommendation_events`
- `intent_resolutions`
- execution and result evidence tables

## 3. Shared catalog projection

### `platform_asset_catalog_registry`

A normalized registry that points to canonical assets without duplicating their full payload.

Key fields:

- `asset_ref` — stable global ID;
- `asset_type`;
- `canonical_source_table`;
- `canonical_source_key`;
- `canonical_version_ref`;
- `base_checksum`;
- `tenant_visibility`: `public_to_tenants | entitled | managed_only | platform_internal`;
- `customization_policy`: `none | preference_only | patchable | extend_only`;
- `modifiable_path_profile_key`;
- `risk_class`;
- `required_capability_keys_json`;
- `required_connection_profile_key`;
- `status` and timestamps.

The catalog is an identity and policy projection. Canonical content remains in its source table.

## 4. Composition authorities

### `context_composition_profiles`

Stores reusable or user-selected runtime composition profiles.

Key fields:

- `profile_id`;
- `tenant_id`;
- `profile_key`;
- `display_name`;
- `owner_principal_type`: `platform | tenant | user | group`;
- `owner_principal_id` nullable for platform templates;
- `target_container_id` nullable;
- `profile_class`: `template | custom | adaptive_candidate`;
- `status`: `draft | active | disabled | archived`;
- `version`;
- `created_by`, `approved_by`, timestamps.

### `context_composition_profile_rules`

One row per dimension or policy family.

Key fields:

- `profile_rule_id`;
- `profile_id`;
- `dimension_key`;
- `policy_family` nullable;
- `composition_mode`: `guarded_union | strict_intersection | deny_wins | minimum | maximum | nearest_replace | priority_replace | stable_topological_merge | ordered_append_dedupe | bounded_weighted_merge`;
- `required_layers_json`;
- `layer_precedence_json`;
- `missing_layer_behavior`: `block | ignore_optional`;
- `conflict_behavior`: `block | require_review`;
- `conditions_json`;
- `status` and version.

The dimension registry remains the authority for which modes are allowed. Profile rules can choose only an allowed subset.

### `principal_composition_profile_selections`

Selects a profile for one principal and context.

- `selection_id`;
- `tenant_id`;
- `principal_type` and `principal_id`;
- optional `container_id`, `workspace_id`, `brand_key`, `business_activity_type_key`, `role_template_key`;
- `dimension_key` or `policy_family`;
- `profile_id`;
- priority, validity, status, version.

Specific selections outrank broader selections only where the registered operator allows replacement. They never outrank mandatory policy.

## 5. Typed policy atom registry

### `policy_field_semantics_registry`

Defines how each policy field may compose.

- `policy_family`;
- `field_key`;
- `value_schema_json`;
- `semantic_type`;
- `default_operator`;
- `allowed_operators_json`;
- `safety_polarity`: `deny_wins | true_wins | false_wins | neutral`;
- `mandatory_floor_json`;
- `user_customizable`;
- `variant_customizable`;
- `explanation_template`;
- status and version.

### `scoped_policy_atoms`

Normalized scoped policy values linked to platform policy sources or future tenant-local policy records.

- `atom_id`;
- `tenant_id` nullable only for platform atoms;
- `policy_family`, `field_key`;
- `source_table`, `source_pk`, `source_version`;
- `source_layer`;
- optional container, role, and user scope;
- `value_json`;
- `priority`;
- mandatory flag, validity, status, checksum.

This may initially be implemented as bridge views before becoming a mutation surface.

## 6. User preference authority

### `user_runtime_preference_profiles`

A versioned no-secret profile for one user.

- tenant/user identity;
- locale, language, explanation depth, output and notification preferences;
- preferred shared asset refs and rankings;
- default composition profile selections;
- autonomy and review preferences within registered limits;
- adaptation consent and visibility controls;
- version, status, checksum, timestamps.

Preference payloads use a registered schema and explicit allowlist. Unknown keys are rejected.

## 7. Optional generic variants

Existing package variants remain valid for package assets. A generic layer is required for non-package shared assets.

### `platform_asset_variants`

- `variant_id`;
- `tenant_id`;
- `base_asset_ref`;
- `base_version_ref` and checksum;
- `owner_scope_type`: `tenant | workspace | brand | business_activity | role | user`;
- `owner_scope_ref`;
- `variant_key`;
- `display_name`;
- `status`: `draft | active | disabled | archived | conflict`;
- `current_version`;
- `created_by`, timestamps.

### `platform_asset_variant_patches`

- `patch_id`;
- `variant_id`;
- `variant_version`;
- `patch_type`: `append | override | remove | disable | reorder | policy_tightening`;
- `target_path`;
- `patch_json`;
- `risk_class`;
- approval and certification state;
- checksum and provenance.

Patches are rejected when they target non-modifiable or mandatory fields.

### `platform_asset_variant_upgrade_runs`

Stores preview/apply evidence for a shared base update, including changed paths, conflicts, proposed checksum, approvals, and readback.

## 8. Effective runtime manifest

### `effective_runtime_manifest_ledger`

Extends—not replaces—`container_effective_context_ledger` with a full no-secret runtime manifest.

Key fields:

- `manifest_id`;
- linked `container_resolution_id`;
- tenant, principal, request, session, and target context;
- authority epoch and registry snapshot hash;
- composition profile selections and versions;
- policy atom source IDs and typed operator results;
- selected shared asset refs and versions;
- selected variants and patch checksums;
- preference profile version;
- connection/installation/certification readiness summaries;
- approvals, quotas, and blocking codes;
- final decision;
- manifest checksum;
- expiry and timestamps;
- `provider_call_made`, `credential_payload_read`, `secrets_included` flags.

This manifest is the attribution key for execution outcomes and adaptive learning.

## 9. Adaptive growth authorities

### `adaptive_change_proposals`

- proposal identity and target scope;
- proposal class A–E;
- current and proposed state summaries;
- objective and expected impact;
- evidence references and confidence;
- risk and required approval;
- simulation plan, measurement plan, rollback plan;
- status and expiry.

### `adaptive_simulation_runs`

- proposal and corpus version;
- baseline/proposed manifest summaries;
- policy, readiness, cost, latency, and predicted outcome deltas;
- guardrail results;
- reproducible checksum;
- no provider write.

### `adaptive_experiments`

- exact cohort scope;
- baseline and treatment refs;
- immutable start snapshot;
- success and guardrail metrics;
- minimum sample and measurement window;
- status, rollback trigger, approval evidence.

### `adaptive_outcome_measurements`

- experiment/proposal/manifest links;
- metric key, value, confidence, observed window;
- attribution quality and evidence refs.

### `platform_asset_promotion_candidates`

Stores privacy-reviewed candidates for a new or improved shared asset. Promotion remains a separate admin certification and release workflow.

## 10. Bridge views

- `v_shared_asset_catalog_effective`
- `v_context_composition_profile_effective`
- `v_policy_atoms_effective_candidates`
- `v_optional_variants_effective_candidates`
- `v_principal_runtime_preferences_effective`
- `v_contextual_authority_bridge_parity`
- `v_runtime_policy_bridge_parity`
- `v_effective_runtime_readiness`
- `v_adaptive_proposal_readiness`

## 11. Indexing and integrity

- every tenant-owned row begins with `tenant_id` in lookup indexes;
- principal/context/profile selection indexes support exact scoped resolution;
- variant uniqueness covers tenant + base asset + owner scope + variant key;
- checksums bind base versions, profile versions, and patch content;
- authority epoch invalidates affected cached manifests;
- no cross-tenant foreign or logical reference is accepted;
- JSON fields have bounded schemas and secret-like key rejection;
- high-volume ledgers support time partitioning or retention policies after measured need.

## 12. Migration philosophy

The first migration creates registries and views only. It does not seed one row per shared asset per tenant. Projections are built from canonical registries, and tenant rows are created only for profiles, preferences, variants, experiments, or explicit scoped bindings.
