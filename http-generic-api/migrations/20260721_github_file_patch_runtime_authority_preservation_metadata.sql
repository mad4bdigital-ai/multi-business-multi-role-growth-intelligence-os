-- Metadata-only correction for GitHub file patch shadow-certification runtime-authority preservation.
-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- no_runtime_dispatch_change=true
-- no_runtime_apply_change=true
-- no_active_target_export_creation=true
-- no_tenant_authority_change=true
-- secrets_included=false

UPDATE admin_platform_endpoint_tools
SET description = 'Dry-run or apply one fixed evidence-backed shadow certification for github_file_patch_apply. It verifies consumed smoke envelopes and branch-scoped resource-authority bindings from SQL authority, activates only the canonical readback adapter, certifies the current readback contract, preserves the existing specialized runtime-certification snapshot unchanged, keeps capability exports shadow-only, creates no Tenant authority, calls no provider, performs no external write, and returns no secrets.',
    updated_at = CURRENT_TIMESTAMP
WHERE tool_key = 'github_file_patch_shadow_certification_issue';

UPDATE platform_plugin_capabilities
SET metadata_json = JSON_SET(
      COALESCE(metadata_json, JSON_OBJECT()),
      '$.runtime_authority_mode', 'preserve_current_snapshot',
      '$.runtime_authority_snapshot_in_plan_hash', TRUE,
      '$.runtime_authority_snapshot_verified_after_apply', TRUE,
      '$.runtime_dispatch_changed', FALSE,
      '$.runtime_apply_changed', FALSE
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE capability_key = 'github_file_patch_shadow_certification_issue';

UPDATE capability_apply_authorization_policy_registry
SET policy_json = JSON_SET(
      COALESCE(policy_json, JSON_OBJECT()),
      '$.runtime_authority_mode', 'preserve_current_snapshot',
      '$.runtime_authority_snapshot_in_plan_hash', TRUE,
      '$.runtime_authority_snapshot_verified_after_apply', TRUE,
      '$.runtime_dispatch_change_allowed', FALSE,
      '$.runtime_apply_change_allowed', FALSE
    ),
    notes = 'Authorize only the fixed evidence-backed shadow certification after dry-run and explicit typed confirmation while preserving the existing specialized runtime-certification snapshot unchanged.',
    updated_at = CURRENT_TIMESTAMP
WHERE policy_key = 'github_file_patch_shadow_certification_issue_apply_v1';

UPDATE execution_policies
SET policy_value = JSON_SET(
      COALESCE(policy_value, JSON_OBJECT()),
      '$.runtime_authority_mode', 'preserve_current_snapshot',
      '$.runtime_authority_snapshot_in_plan_hash', TRUE,
      '$.runtime_authority_snapshot_verified_after_apply', TRUE,
      '$.runtime_dispatch_change_forbidden', TRUE,
      '$.runtime_apply_change_forbidden', TRUE
    ),
    notes = 'Blocking evidence-backed shadow-certification policy. The pre-existing specialized runtime-certification snapshot must remain unchanged. Target export promotion and Tenant authority remain forbidden.',
    updated_at = CURRENT_TIMESTAMP
WHERE policy_group = 'Dynamic Capability Governance'
  AND policy_key = 'github_file_patch_shadow_certification_issue_policy_v1';
