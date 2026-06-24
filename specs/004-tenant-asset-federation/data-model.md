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

## 11. Dynamic Blueprint and Layer Inheritance authorities

### `platform_layer_type_registry`

Defines every inheritable or instantiable layer family and its canonical source.

Key fields:

- `layer_type_key`;
- canonical source table/key;
- supports Blueprints, runtime instances, hierarchy, multi-parent, variants, and resource bindings;
- allowed parent/child layer types;
- default and allowed merge strategies;
- modifiable-path profile;
- risk class, version, and status.

Initial layer types include:

```text
department
group
role
member_profile
agent_profile
business_activity
knowledge_tree
skill_set
workflow_set
policy_set
app_set
plugin_set
action_set
tool_set
engine_set
logic_set
graph_fragment
dashboard_profile
metric_set
validator_set
prompt_profile
output_template
```

### `platform_layer_relationship_type_registry`

Defines typed relationships such as `contains`, `inherits_from`, `references`, `requires`, `conflicts_with`, `replaces`, `supersedes`, `compatible_with`, `managed_by`, and `assigned_to`, including source/target type constraints, direction, transitivity, cardinality, conflict behavior, and version.

### `platform_layer_blueprints`

- Blueprint ID/key and layer type;
- platform or Business-Type owner;
- Business-Type key where applicable;
- canonical template source reference;
- required/recommended/optional adoption class;
- version/checksum/status;
- compatibility and entitlement conditions;
- default settings profile;
- customization and upgrade policy;
- risk/certification metadata.

### `platform_layer_blueprint_relationships`

Stores Blueprint hierarchy and dependency edges with typed relationship, source/target Blueprint versions, conditions, priority, validity, and provenance.

### `platform_layer_blueprint_closure`

Stores bounded transitive closure for Blueprint hierarchy, dependency traversal, cycle detection, impact analysis, deterministic checksums, and fast preview.

### `platform_layer_blueprint_resource_bindings`

Links Blueprints to canonical shared resources without copying them.

Binding purposes include:

```text
required
recommended
allowed
default
denied
validator
fallback
```

Each row stores resource dimension/reference, effect, priority, conditions, inheritance behavior, validity, and provenance.

### `brand_business_type_bindings`

- tenant and Brand;
- Business Type key;
- binding role: primary, secondary, specialization, seasonal, or experimental;
- classification source/confidence;
- inheritance profile reference;
- priority, effective dates, status, approval, and provenance.

The binding grants no execution authority.

### `layer_inheritance_profiles`

- tenant and Brand;
- profile key/version/status;
- contributing Business Types and priorities;
- required/recommended/optional Blueprint selection policy;
- per-layer merge strategy;
- exclusion, replacement, pin, upgrade, and auto-adoption behavior;
- local override policy;
- publisher, approval, checksum, and timestamps.

### `layer_inheritance_profile_rules`

Stores one rule per layer family, Blueprint family, Business Type, condition, or conflict group, including merge mode, required layers, allowed exclusions/replacements, upgrade channel, and block/review behavior.

### `layer_inheritance_runs`

Immutable preview/apply evidence:

- input Brand/Business-Type/profile versions;
- eligible, selected, excluded, replaced, conflicted, and blocked Blueprints;
- proposed instance/resource changes;
- impact on members, agents, roles, grants, schedules, approvals, variants, artifacts, cost, and authority epochs;
- status, approval, checksum, and readback.

### `layer_inheritance_conflicts`

Typed conflict records for equivalent, overlapping, incompatible, stale, ambiguous, or locally patched Blueprints, with candidate resolutions and decision evidence.

### `brand_layer_instances`

Generic projection of Brand-scoped operational instances while specialized domain tables retain full fields.

- layer instance ID;
- tenant and Brand;
- layer type;
- canonical runtime table/key;
- source mode: inherited, local, imported, or promoted;
- source Blueprint/version;
- inheritance profile/version;
- lifecycle status;
- effective settings checksum;
- local override/variant reference;
- authority epoch and timestamps.

### `brand_layer_instance_relationships`

Stores typed operational Brand hierarchy/dependency edges between layer instances.

### `brand_layer_instance_closure`

Stores Brand-scoped transitive closure, depth, path/version checksum, source relationships, and validation evidence.

### `brand_layer_resource_bindings`

Stores effective inherited or local references from Brand layer instances to canonical shared resources, including purpose, effect, priority, conditions, source Blueprint, profile version, local override, and status.

### `brand_layer_override_patches`

Sparse bounded Brand, Department, Group, Role, or Principal-profile overrides against inherited settings or resource bindings. Protected authority, credential, audit, and mandatory-policy paths remain non-modifiable.

### `layer_inheritance_upgrade_runs`

Compares new Blueprint versions with active instances and local patches, classifying each change as auto-safe, review-required, conflict, blocked, pinned, superseded, or revoked.

### Specialized Brand organization authorities

- `brand_departments`;
- `brand_department_relationships` and `brand_department_closure`;
- `brand_department_memberships`;
- `brand_groups`;
- `brand_group_relationships` and `brand_group_closure`;
- `brand_group_memberships`;
- scoped Role/member/Agent profile authorities;
- `principal_authority_settings` and `principal_authority_epochs`.

These rows reference Business-Type Blueprints and shared assets; they do not duplicate shared definitions.

## 12. Extended authority-plane data model

The following are proposed authorities or bridge contracts. They are not an instruction to create every table in one migration. Existing canonical tables are reused whenever they already own the behavior.

### Identity and organization

- `principal_registry` — user, agent, service, and group identity, tenant ownership, assurance, status, and recertification.
- `principal_group_memberships` — bounded nested group membership with validity and cycle protection.
- `principal_delegation_chains` — exact delegated scope, operations, source authority, expiry, and maximum depth.
- `separation_of_duties_rules` — incompatible requester, approver, executor, and publisher combinations.

### Tenant federation and lifecycle

- extend/project `tenant_relationships` into contextual authority with relationship policy and delegated operations;
- `tenant_lifecycle_runs` — suspension, ownership transfer, offboarding, export, legal hold, erasure, and completion evidence;
- `tenant_ownership_transfers` — current/future owner, approvals, effective time, and rollback;
- `tenant_orphan_resource_reviews` — variants, grants, connections, approvals, artifacts, and scheduled work requiring disposition.

### Data governance

- `data_classification_registry` — sensitivity, audience, allowed purpose, retention, and protection requirements;
- `data_processing_purpose_registry` — purpose and allowed source/use/sink categories;
- `principal_data_use_preferences` — consent/opt-out and transparency settings where applicable;
- `data_residency_policy_registry` — allowed storage, processing, model, and provider regions;
- `data_subject_request_runs` — access, correction, export, restriction, and erasure lifecycle;
- `legal_holds` — exact data scope, reason, approver, validity, and deletion suppression;
- `retention_execution_runs` — preview, approval, archive/delete action, checksum, and readback.

### Commercial and FinOps

Existing plans, subscriptions, entitlements, quotas, usage, credits, and `budget_quota_authority_registry` remain sources.

- `runtime_cost_estimates` — units, currency, model/provider/action inputs, confidence, and expiry;
- `runtime_cost_reservations` — idempotent reserved amount/units tied to manifest and operation;
- `runtime_cost_settlements` — realized cost, provider evidence, refund/adjustment, and ledger refs;
- `commercial_entitlement_bindings` — plan/tenant/asset/capability/operation availability;
- `cost_attribution_ledger` — user/workspace/brand/activity/objective attribution.

### Model governance

Existing `ai_model_registry`, `ai_model_providers`, runtime settings, and model-run ledgers are reused.

- `model_capability_profiles` — modality, language, context, tools, structured output, safety, latency, and data-handling capabilities;
- `model_context_policies` — tenant/plan/activity/risk/region/provider/model eligibility and fallback constraints;
- `model_evaluation_suites` — dataset, rubric, evaluator, metric, risk, locale, and minimum threshold;
- `model_evaluation_runs` — exact model/prompt/tool/workflow versions, results, failures, and evidence;
- `model_quality_scorecards` — bounded current quality, calibration, latency, reliability, cost, and freshness;
- `model_deprecation_runs` — impacted assets, replacements, migration, deadlines, and rollback.

### Runtime orchestration and consistency

- `runtime_operations` — universal operation identity, exact manifest, state, deadline, cancellation, and idempotency;
- `runtime_operation_outbox` — transactionally emitted no-secret events;
- `runtime_operation_inbox` — consumer deduplication and processing result;
- `runtime_dead_letters` — failed event/operation, attempts, classification, and recovery owner;
- `runtime_saga_instances` and `runtime_saga_steps` — multi-step effects and compensations;
- `runtime_resource_reservations` — cost, quota, lock, provider slot, and other bounded reservations;
- `runtime_concurrency_policies` — tenant/resource/action limits, priority, fairness, and backpressure.

### Artifact and knowledge provenance

Existing `output_artifacts`, JSON assets, graph evidence, and runtime verification remain sources.

- `artifact_versions` — immutable schema version, content checksum, manifest, source run, sensitivity, audience, license, freshness, and verification;
- `artifact_provenance_edges` — derived-from, cites, transforms, supersedes, corrects, or retracts;
- `artifact_verification_runs` — validators, results, confidence, and evidence;
- `knowledge_index_versions` — source set, chunking/embedding model, retrieval policy, and invalidation state;
- `artifact_data_disposition_runs` — retention, export, correction, retraction, and erasure propagation.

### Temporal, environment, region, and jurisdiction

- `context_time_schedules` — scheduled profile, policy, variant, grant, or connection changes;
- `environment_registry` — local, development, staging, production, managed, and dedicated environments;
- `environment_resource_bindings` — environment-scoped connection, credential, asset, model, and approval eligibility;
- `region_jurisdiction_registry` — region, jurisdiction, residency, provider, and data constraints;
- manifests include `as_of`, environment, region, jurisdiction, and clock/version evidence.

### Supply chain and compatibility

Existing plugin, package, version, trust, capability, and certification tables remain sources.

- `publisher_identity_registry` — verified publisher and signing identities;
- `package_supply_chain_manifests` — digest, signature, SBOM, dependency lock, license, requested capabilities, scan evidence;
- `package_update_channels` — staged channels, cohorts, minimum runtime, rollback, and revocation;
- `contract_schema_registry` — API, asset, policy DSL, manifest, prompt/tool, and event schemas;
- `contract_compatibility_rules` — backward/forward/full/breaking policy and deprecation windows;
- `client_capability_profiles` — supported contracts and negotiated behavior.

### Portability and resilience

- `tenant_export_runs` and `tenant_export_manifests` — no-secret portable snapshot, checksums, ownership, and scope;
- `tenant_import_runs` — validation, ID mapping, conflicts, and result evidence;
- `data_subject_export_runs` — user-scoped export and delivery evidence;
- existing backup/restore authorities are extended to profiles, variants, manifests, proposals, experiments, and authority epochs;
- `disaster_mode_runs` — affected region/provider, declared degraded policy, owner, RPO/RTO, and recovery evidence.

### Human operations

- `human_work_queues` — queue scope, owner, service class, and escalation policy;
- `human_work_items` — exact request/approval/review/rollback task and manifest link;
- `approver_availability` — availability, backup approver, timezone, capacity, and validity;
- `managed_service_handoffs` — customer/operator state, SLA timers, and completion evidence.

### Capability ontology and evaluation

- populate/extend asset equivalence into `capability_ontology_registry` and `capability_implementation_bindings`;
- `capability_compatibility_edges` — requires, conflicts, replaces, supersedes, and compatible-with;
- `quality_evaluation_suites` and `quality_evaluation_runs` cover assets, models, workflows, prompts, languages, activities, and risks;
- `recommendation_exposure_ledger` records ranking/exposure for bias and feedback-loop analysis.

## 12. Indexing and integrity

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
