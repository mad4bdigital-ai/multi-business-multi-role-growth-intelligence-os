# Data Model

## 1. Generic catalog authority

### `platform_asset_catalog`

Registers tenant-adoptable platform assets without duplicating their canonical source rows.

Key fields:

- `asset_ref`
- `asset_type`
- `canonical_source_table`
- `canonical_source_key`
- `base_version`
- `base_checksum`
- `adoption_policy`: `tenant_adoptable | managed_only | platform_internal`
- `default_ownership_mode`: `overlay | fork`
- `edit_policy`: `editable | extend_only | immutable`
- `risk_class`
- `credential_requirement_profile`
- `status`

The catalog is a projection and never replaces the canonical source table.

## 2. Tenant-owned instances

### `tenant_asset_instances`

One tenant-owned identity for an adopted asset.

Key fields:

- `instance_id`
- `tenant_id`
- `asset_ref`
- `instance_key`
- `display_name`
- `ownership_mode`: `overlay | fork`
- `base_version`
- `base_checksum`
- `current_version_id`
- `upgrade_state`: `current | update_available | conflict | detached`
- `status`: `draft | active | suspended | archived`
- `created_by`
- timestamps

Unique active identity: tenant + asset reference + instance key.

## 3. Version authority

### `tenant_asset_versions`

Key fields:

- `version_id`
- `instance_id`
- `version_number`
- `content_mode`: `json_patch | snapshot`
- `content_json`
- `resolved_checksum`
- `base_version`
- `parent_version_id`
- `change_summary`
- `created_by`
- `status`: `draft | published | superseded | rejected`

Raw credentials and secret references are forbidden in `content_json`.

## 4. Composition profiles

### `tenant_asset_composition_profiles`

Key fields:

- `profile_id`
- `tenant_id`
- `profile_key`
- `asset_type` nullable for all asset types
- `composition_mode`: `union | intersection`
- `required_scope_dimensions_json`
- `scope_precedence_json`
- `conflict_policy`: `block | require_review`
- `status`
- `created_by`

Default precedence is based first on binding specificity and then on configured tie-break order.

## 5. Scope bindings

### `tenant_asset_scope_bindings`

Key fields:

- `binding_id`
- `tenant_id`
- `instance_id`
- `profile_id`
- `workspace_id` nullable
- `brand_key` nullable
- `business_activity_type_key` nullable
- `role_key` nullable
- `effect`: `allow | deny`
- `priority`
- `status`
- `valid_from`
- `expires_at`
- `created_by`

At least one scope dimension or tenant-root marker is required. Explicit mandatory deny is evaluated before union/intersection composition.

## 6. Tenant asset grants

### `tenant_asset_grants`

Key fields:

- `grant_id`
- `tenant_id`
- `instance_id`
- `grantee_type`: `tenant | workspace | brand | business_activity | role | agent | user`
- `grantee_ref`
- `permission`: `view | adopt | use | edit | grant | configure_credentials | manage_versions | execute | administer`
- `status`
- `expires_at`
- `granted_by`

The generic grant is the future unified authority. Existing `agent_skill_grants`, `agent_workflow_bindings`, `app_action_grants`, `workspace_resource_grants`, and related tables remain runtime authority until bridge certification.

## 7. Credential and connection bindings

### `tenant_asset_connection_bindings`

Contains no secrets.

Key fields:

- `binding_id`
- `tenant_id`
- `instance_id`
- `connection_id`
- `installation_id` nullable
- `credential_scope`: `tenant | workspace | brand | user | connection`
- scope dimensions
- `required_capability_key`
- `validation_state`
- `certification_state`
- `status`
- timestamps

Connection and credential values stay in governed connection/vault authorities.

## 8. Upgrade and conflict records

### `tenant_asset_upgrade_runs`

Tracks overlay rebase or fork import plans.

- old/new base version and checksums;
- changed paths;
- conflict paths;
- proposed resolved checksum;
- dry-run/apply state;
- approval evidence where required;
- same-cycle readback.

## 9. Resolution ledger

### `tenant_asset_resolution_ledger`

Records no-secret evidence for each effective resolution:

- principal and tenant hashes/IDs;
- context dimensions;
- selected profile and mode;
- applicable bindings;
- selected versions;
- deny/conflict reasons;
- credential and certification readiness summaries;
- effective checksum;
- execution readiness;
- timestamp.

## 10. Effective views

- `v_tenant_effective_asset_catalog`
- `v_tenant_effective_asset_grants`
- `v_tenant_effective_asset_versions`
- `v_tenant_effective_asset_readiness`
- `v_tenant_asset_upgrade_gaps`
- `v_tenant_asset_bridge_parity`

These views must not expose raw credential values or cross-tenant rows.
