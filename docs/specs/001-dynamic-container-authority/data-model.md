# Data Model

All schema changes described here are proposed and additive. This document does not authorize migration execution.

## Core tables

### `container_type_registry`

```text
container_type_key
display_name
description
allowed_parent_types_json
allowed_child_types_json
default_inheritance_profile_key
classification_profile_key
max_depth
supports_multi_parent
status
timestamps
```

Initial types: `platform`, `tenant`, `workspace`, `brand`, `activity`, `workflow`, `project`, `campaign`, `department`.

### `containers`

```text
container_id
tenant_id
container_key
container_type_key
display_name
canonical_subject_type
canonical_subject_ref
status
version
metadata_json
created_by
updated_by
created_at
updated_at
```

Recommended uniqueness:

```text
(container_id)
(tenant_id, container_type_key, container_key)
(tenant_id, canonical_subject_type, canonical_subject_ref)
```

### `container_relationship_type_registry`

```text
relationship_type_key
display_name
relationship_class        # containment | sharing | delegation | reference | management
directed
contributes_to_ancestry
contributes_to_inheritance
default_access_mode       # none | read_only
default_merge_profile_key
requires_approval
status
```

Initial relationships: `contains`, `shares_with`, `delegates_to`, `references`, `managed_by`, `derived_from`.

### `container_relationships`

```text
relationship_id
tenant_id
from_container_id
to_container_id
relationship_type_key
priority
conditions_json
valid_from
valid_until
status
created_by
approved_by
metadata_json
```

Containment must pass tenant, type-compatibility, and cycle checks. Sharing and delegation do not contribute to ancestry.

### `container_closure`

```text
ancestor_container_id
descendant_container_id
depth
path_hash
path_count
shortest_depth
longest_depth
computed_at
```

Multiple paths may connect the same pair. Detailed bounded path evidence belongs in the effective-context ledger.

## Dynamic classifications

### `container_classification_type_registry`

```text
classification_type_key
display_name
value_schema_json
cardinality
inheritance_mode
merge_strategy
conflict_policy
affected_dimensions_json
required_for_types_json
status
```

### `container_classifications`

```text
classification_id
container_id
classification_type_key
value_json
priority
valid_from
valid_until
status
assigned_by
source
metadata_json
```

Classifications influence resolution but never grant authority by themselves.

## Roles

### `role_template_registry`

```text
role_template_key
display_name
description
risk_ceiling
composable
status
```

### `role_template_permissions`

```text
role_template_key
permission_key
effect
resource_dimension_key
operation_pattern
conditions_json
priority
```

### `container_role_assignments`

```text
assignment_id
container_id
principal_type
principal_id
role_template_key
inline_permissions_json
inheritance_mode
valid_from
valid_until
status
assigned_by
approved_by
metadata_json
```

Templates and direct assignments are both supported. Deny/restrict wins over allow.

## Resource dimensions

### `container_resource_dimension_registry`

```text
dimension_key
display_name
resource_key_schema_json
supports_containment_inheritance
supports_sharing
supports_delegation
default_merge_strategy
default_share_access_mode
write_requires_delegation
credential_materialization_allowed
status
```

Initial dimensions:

```text
connections tools skills rules policies profiles knowledge logic engines
workflows actions endpoints credentials budgets quotas assets agents roles brand_core
```

### `container_resource_bindings`

```text
binding_id
container_id
dimension_key
resource_type
resource_ref
effect
permission_key
operation_patterns_json
capability_keys_json
inheritance_mode
merge_priority
conditions_json
valid_from
valid_until
status
source_table
source_pk
created_by
approved_by
metadata_json
```

Effects: `allow`, `deny`, `restrict`, `require`, `share`, `delegate`. Secret values are forbidden.

## Effective-context ledger

### `container_effective_context_ledger`

```text
resolution_id
request_id
principal_type
principal_id
tenant_id
target_container_id
container_path_hash
registry_snapshot_hash
request_context_json
selected_paths_json
effective_classifications_json
effective_roles_json
effective_bindings_json
applied_denies_json
applied_delegations_json
override_request_id
decision
blocking_codes_json
expires_at
resolution_sha256
secrets_included
created_at
```

This is immutable no-secret execution authority evidence.

## Overrides

### `container_override_requests`

```text
override_request_id
capability_envelope_id
original_resolution_id
principal_id
principal_role
target_container_id
container_path_hash
dimension_key
resource_type
resource_ref
operation_intent
risk_class
override_class
reason
requested_ttl_minutes
required_approval_count
status
expires_at
created_at
```

### `container_override_approvals`

```text
override_approval_id
override_request_id
approval_hold_id
approver_id
approver_role
decision
decision_note
decided_at
```

Unique `(override_request_id, approver_id)`. Destructive, credential, and deployment classes require two distinct approvers. Critical TTL is capped at 15 minutes; other TTL at 60 minutes.

## Read models and compatibility

```text
v_container_active_hierarchy
v_container_relationship_issues
v_container_classification_effective_candidates
v_container_role_effective_candidates
v_container_resource_binding_candidates
v_container_override_readiness
v_container_effective_context_recent
v_legacy_workspace_container_projection
v_platform_graph_container_projection
```

Legacy adapters initially project from tenants, workspaces, brands, business activities, workflows, memberships, role assignments, resource grants, app links, action grants, skills, policies, and workflow bindings.

## Integrity and performance

- Index active relationships by parent, child, type, validity, and status.
- Index assignments/bindings by container, principal/dimension, validity, and status.
- Bound traversal depth and path count.
- Use optimistic versioning.
- Avoid trigger-based hidden side effects in the first implementation.
- Make migrations additive, idempotent, and rollbackable by disabling consumers.
