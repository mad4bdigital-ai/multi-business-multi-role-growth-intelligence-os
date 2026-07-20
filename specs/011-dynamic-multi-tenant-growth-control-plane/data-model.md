# Logical Data Model

This model is additive and maps to existing platform registries where they already provide the required authority. Proposed names are logical resources, not instructions to create duplicate tables.

## Identity and scope

- `tenants`
- `tenant_memberships`
- `workspaces`
- `workspace_memberships`
- `brands`
- `brand_access_grants`
- `business_activity_types`
- `brand_activity_bindings`

`brand_activity_bindings` carries:

```text
binding_id, tenant_id, workspace_id, brand_id, activity_type_key,
activity_pack_version_id, markets, locales, channels, objectives,
allowed_capabilities, status, effective_from, effective_to, revision
```

## Brand knowledge

- `brand_core_versions`
- `brand_core_assets`
- `brand_claim_policies`
- `brand_evidence_links`

Brand Core and Activity Pack are separate. Activity definitions do not contain tenant or brand facts.

## Activity Packs

- `activity_pack_definitions`
- `activity_pack_versions`
- `activity_pack_entity_schema_bindings`
- `activity_pack_knowledge_bindings`
- `activity_pack_kpi_bindings`
- `activity_pack_capability_bindings`
- `activity_pack_workflow_bindings`
- `activity_pack_policy_bindings`
- `activity_pack_provider_compatibility`
- `activity_pack_validation_results`

An active Activity Pack version is immutable.

## Configuration

- `configuration_definitions`
- `configuration_schema_versions`
- `configuration_scope_values`
- `configuration_versions`
- `configuration_version_entries`
- `configuration_validation_results`
- `configuration_resolution_snapshots`
- `configuration_resolution_events`

Important fields:

```text
config_key, schema_key, schema_version, scope_type, scope_id,
value_json, merge_operator, status, version, checksum,
created_by, approved_by, effective_from, supersedes_version_id
```

## Capabilities, workflows, logic, and knowledge

Existing semantic capability, workflow, engine, logic pointer, and knowledge registries remain authoritative. The control plane adds explicit source links and compatibility projections where missing.

Logical resources:

- `capability_definitions` and immutable versions.
- `workflow_definitions`, `workflow_versions`, `workflow_nodes`, `workflow_edges`.
- `logic_pointer_bindings`.
- `knowledge_profile_bindings`.
- `compatibility_results`.
- `compiled_plan_snapshots`.

## Policy and approval

- `policy_definitions`
- `policy_versions`
- `policy_scope_bindings`
- `compiled_policy_snapshots`
- `approval_holds`
- `approval_decisions`
- `capability_envelopes`

Approval records bind plan version, action IDs, resource IDs, environment, effect class, request hash, expiry, and actor.

## Providers and resources

- `connected_systems`
- `installations`
- `provider_adapter_definitions`
- `provider_adapter_versions`
- `provider_capability_bindings`
- `brand_provider_bindings`
- `resource_authority_bindings`
- `provider_certifications`
- `provider_health_evidence`

Credentials remain referenced through governed scope and are never copied into plans, configs, manifests, or evidence.

## Plans, runs, outputs, and evidence

- `plans`
- `plan_versions`
- `plan_nodes`
- `plan_dependencies`
- `workflow_runs`
- `workflow_step_runs`
- `workflow_run_transitions`
- `workflow_idempotency_records`
- `workflow_outbox`
- `output_artifacts`
- `readback_assessments`
- `platform_evidence_events`

Every plan/run stores:

```text
tenant_id, workspace_id, brand_id, activity_binding_id,
objective, environment, resolved_versions_json,
configuration_snapshot_id, policy_snapshot_id,
plan_hash, created_by, status, revision
```

## UI, events, and rollout

- `ui_manifest_definitions`
- `ui_manifest_versions`
- `ui_manifest_scope_bindings`
- `event_type_registry`
- `event_schema_versions`
- `feature_flags`
- `feature_flag_cohorts`
- `rollout_decisions`

## KPI and analytics

- `kpi_definitions`
- `activity_kpi_bindings`
- `normalized_metric_observations`

Each observation retains normalized key, activity-native key, definition version, unit, source, period, confidence, freshness, tenant, brand, and lineage.

## Mandatory scope fields

Operational rows MUST carry canonical IDs rather than names. At minimum, scope-sensitive resources include `tenant_id`; brand activity operations include `brand_id` and `activity_binding_id`; resource mutations include canonical `resource_id` and binding evidence.

## Lifecycle states

Definitions and versions use bounded states such as:

```text
draft -> validating -> ready -> active -> deprecated -> archived
                         \-> blocked
active -> rolled_back
```

Historical versions and evidence are retained. DELETE maps to archive/disable/revoke unless a separately governed purge policy exists.
