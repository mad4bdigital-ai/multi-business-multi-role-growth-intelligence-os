# Data Model

All schema described here is proposed, additive, and documentation-only.

## Core tables

### `container_type_registry`

```text
container_type_key PK
display_name description
allowed_parent_types_json allowed_child_types_json
default_inheritance_profile_key classification_profile_key
max_depth supports_multi_parent status
timestamps
```

### `containers`

```text
container_id PK
tenant_id
container_key
container_type_key
canonical_subject_type canonical_subject_ref
display_name status version metadata_json
created_by updated_by created_at updated_at
```

Unique `(tenant_id, container_type_key, container_key)` and `(tenant_id, canonical_subject_type, canonical_subject_ref)`.

### `container_relationship_type_registry`

```text
relationship_type_key PK
relationship_class # containment | sharing | delegation | reference | management
directed contributes_to_ancestry contributes_to_inheritance
default_access_mode default_merge_profile_key requires_approval status
```

### `container_relationships`

```text
relationship_id PK
tenant_id from_container_id to_container_id
relationship_type_key priority conditions_json
valid_from valid_until status version
created_by approved_by metadata_json
```

Containment passes tenant, type, and cycle checks. Sharing/delegation do not contribute to ancestry.

### `container_closure`

```text
ancestor_container_id descendant_container_id depth
path_hash path_count shortest_depth longest_depth
authority_epoch computed_at
```

## Classifications and roles

```text
container_classification_type_registry
container_classifications
role_template_registry
role_template_permissions
container_role_assignments
```

Classification types declare schema, cardinality, inheritance, merge, conflict, and affected dimensions. Role assignments are versioned and support templates or validated inline permissions.

## Resource dimensions

### `container_resource_dimension_registry`

```text
dimension_key PK
resource_key_schema_json
supports_containment_inheritance supports_sharing supports_delegation
default_merge_strategy default_share_access_mode
write_requires_delegation credential_materialization_allowed status
```

Initial dimensions include connections, tools, skills, rules, policies, profiles, knowledge, logic, engines, workflows, actions, endpoints, credentials, budgets, quotas, assets, agents, roles, and brand_core.

### `container_resource_bindings`

```text
binding_id PK
container_id dimension_key resource_type resource_ref
effect permission_key operation_patterns_json capability_keys_json
inheritance_mode merge_priority conditions_json
valid_from valid_until status version
source_table source_pk created_by approved_by metadata_json
```

Effects: `allow`, `deny`, `restrict`, `require`, `share`, `delegate`. Secret values are forbidden.

## Authority and snapshots

### `container_authority_epochs`

```text
tenant_id PK
authority_epoch
last_mutation_type last_mutation_ref updated_at
```

Every authority-changing mutation advances the epoch in the same transaction or through a durable pre-execution event.

### `container_effective_context_ledger`

```text
resolution_id PK request_id
principal_type principal_id tenant_id target_container_id
container_path_hash registry_snapshot_hash authority_epoch resolver_version
request_context_json selected_paths_json
effective_classifications_json effective_roles_json effective_bindings_json
applied_denies_json applied_delegations_json override_request_id
decision blocking_codes_json expires_at resolution_sha256
secrets_included created_at
```

Immutable no-secret evidence.

## Overrides

```text
container_override_requests
container_override_approvals
```

Requests bind original resolution, path, snapshot, epoch, resource, operation, risk, TTL, approval count, status, and one-time consumption. Approval uniqueness is `(override_request_id, approver_id)`.

## Read models

```text
v_container_active_hierarchy
v_container_relationship_issues
v_container_classification_candidates
v_container_role_candidates
v_container_resource_binding_candidates
v_container_override_readiness
v_container_effective_context_recent
v_legacy_workspace_container_projection
v_platform_graph_container_projection
```

## Integrity and performance

- Index active relationships by tenant, parent, child, type, validity, and status.
- Index assignments/bindings by container, principal/dimension, validity, and status.
- Use transaction-safe cycle preflight and post-write verification.
- Bound traversal depth, nodes, paths, edges, and bindings.
- Use optimistic versions.
- Avoid hidden trigger-only behavior initially.
- Make migrations additive, idempotent, and rollbackable by disabling consumers.
