-- Migration execution safety: no_provider_call true; no_credential_payload_read true; no_raw_secrets true;
-- no_external_send true; no_external_write true; secrets_included=false.
-- Sprint 69: export the governed Capability Vault record-only ingestion route as an admin tool.
-- Registry metadata only. The route remains admin-only, transactional, audited, idempotent,
-- same-cycle readback verified, and cannot execute or install source assets.

INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys,
   input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
  (
    'platform_capability_vault_repo_ingestion_record',
    'Platform Capability Vault Repo Ingestion Record',
    'Record one pinned repository snapshot as governed source, planned resolution, capability candidate, and preview job metadata. Requires explicit record-only confirmation; performs no source execution, installation, dispatch grant, external send, or secret return.',
    'POST',
    '/platform/capability-vault/repo-ingestion-record',
    '[]',
    '{"type":"object","additionalProperties":false,"required":["source_repo_full_name","source_commit_sha","files","confirm_record_only"],"properties":{"source_repo_full_name":{"type":"string","pattern":"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$"},"source_commit_sha":{"type":"string","pattern":"^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$"},"default_branch":{"type":"string"},"parent_repo_full_name":{"type":"string"},"license_spdx":{"type":"string"},"description":{"type":"string"},"runtime_language":{"type":"string"},"confirm_record_only":{"type":"boolean","const":true},"files":{"type":"array","maxItems":5000,"items":{"type":"object","additionalProperties":true}}}}',
    NULL,
    'admin,capability-vault,repo-ingestion,record_only,state_changing,audited,idempotent,readback_required,no_execution,no_install,no_external_send,no_secrets',
    1,
    43185
  )
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  http_method = VALUES(http_method),
  http_path = VALUES(http_path),
  path_param_keys = VALUES(path_param_keys),
  input_schema = VALUES(input_schema),
  fixed_body = VALUES(fixed_body),
  tags = VALUES(tags),
  is_enabled = VALUES(is_enabled),
  sort_order = VALUES(sort_order);

INSERT INTO platform_tool_dispatch_bindings
  (binding_id, parent_action_key, endpoint_key, source_endpoint_id, export_key,
   tool_key, surface_class, scope_class, capability_key, operation_intent,
   runtime_surface, readback_policy_key, partial_success_policy_key,
   atomicity_mode, status, metadata_json)
VALUES
  (
    'ptdb_capability_vault_repo_ingestion_record',
    'http_generic_api',
    'platform_capability_vault_repo_ingestion_record',
    NULL,
    NULL,
    'platform_capability_vault_repo_ingestion_record',
    'admin_platform_endpoint_tool',
    'admin',
    'platform_capability_vault_repo_ingestion_record',
    'capability_vault_repo_ingestion_record',
    'platform_capability_vault_record_only',
    'capability_vault_record_only_same_cycle_v1',
    'capability_vault_record_only_transaction_rollback_v1',
    'transactional_guarded',
    'active',
    JSON_OBJECT(
      'confirm_record_only_required', TRUE,
      'full_commit_sha_required', TRUE,
      'max_files', 5000,
      'transactional', TRUE,
      'intent_and_completion_audit', TRUE,
      'same_cycle_readback', TRUE,
      'executes_source_assets', FALSE,
      'installs_source_assets', FALSE,
      'grants_dispatch_or_apply', FALSE,
      'external_send', FALSE,
      'secrets_included', FALSE
    )
  )
ON DUPLICATE KEY UPDATE
  parent_action_key = VALUES(parent_action_key),
  endpoint_key = VALUES(endpoint_key),
  source_endpoint_id = VALUES(source_endpoint_id),
  export_key = VALUES(export_key),
  tool_key = VALUES(tool_key),
  surface_class = VALUES(surface_class),
  scope_class = VALUES(scope_class),
  capability_key = VALUES(capability_key),
  operation_intent = VALUES(operation_intent),
  runtime_surface = VALUES(runtime_surface),
  readback_policy_key = VALUES(readback_policy_key),
  partial_success_policy_key = VALUES(partial_success_policy_key),
  atomicity_mode = VALUES(atomicity_mode),
  status = VALUES(status),
  metadata_json = VALUES(metadata_json),
  updated_at = CURRENT_TIMESTAMP;