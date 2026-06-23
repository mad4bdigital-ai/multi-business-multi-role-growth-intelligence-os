-- Sprint 69: Shared growth-audit evidence support for Admin and Tenant principals
-- Purpose:
--   1. Backfill canonical brand_key/doc_key values for legacy Brand Core rows.
--   2. Register the descriptor-backed read-only audit preparation tool for tenant discovery.
--   3. Register Google Workspace file-read provider candidates in shadow mode only.
-- Safety:
--   Additive registry/data normalization only. No provider call. No external send.
--   No provider write. No browser execution. No secret read or return.
--   Tenant authority remains enforced from the signed principal and workspace evidence.

UPDATE `brand_core` AS bc
JOIN `brands` AS b
  ON LOWER(TRIM(COALESCE(b.`brand_name`, b.`normalized_brand_name`, '')))
   = LOWER(TRIM(COALESCE(bc.`brand_name`, '')))
SET
  bc.`brand_key` = COALESCE(NULLIF(TRIM(bc.`brand_key`), ''), NULLIF(TRIM(b.`target_key`), '')),
  bc.`doc_key` = COALESCE(
    NULLIF(TRIM(bc.`doc_key`), ''),
    NULLIF(TRIM(bc.`asset_key`), ''),
    NULLIF(TRIM(bc.`asset_type`), ''),
    NULLIF(TRIM(bc.`document_name`), '')
  )
WHERE
  (bc.`brand_key` IS NULL OR TRIM(bc.`brand_key`) = '' OR bc.`doc_key` IS NULL OR TRIM(bc.`doc_key`) = '')
  AND b.`target_key` IS NOT NULL
  AND TRIM(b.`target_key`) <> '';

INSERT INTO `system_layer_tool_descriptor_source_registry`
  (`source_key`, `module_path`, `descriptor_export`, `handler_resolution_mode`, `tool_count_expected`, `status`, `metadata_json`, `secrets_included`)
VALUES
  (
    'growth_audit_evidence_v1',
    'growthAuditEvidence.js',
    'GROWTH_AUDIT_EVIDENCE_SYSTEM_TOOLS',
    'handler_name_or_snake_to_camel',
    2,
    'active',
    JSON_OBJECT(
      'admin_tenant_shared', TRUE,
      'read_only_prepare', TRUE,
      'tenant_authority_from_signed_principal', TRUE,
      'visitor_issue_requires_rendered_visible', TRUE,
      'no_provider_write', TRUE,
      'no_external_send', TRUE,
      'secrets_included', FALSE
    ),
    0
  )
ON DUPLICATE KEY UPDATE
  `module_path` = VALUES(`module_path`),
  `descriptor_export` = VALUES(`descriptor_export`),
  `handler_resolution_mode` = VALUES(`handler_resolution_mode`),
  `tool_count_expected` = VALUES(`tool_count_expected`),
  `status` = VALUES(`status`),
  `metadata_json` = VALUES(`metadata_json`),
  `secrets_included` = 0,
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `tenant_platform_endpoint_tools`
  (`tool_key`, `display_name`, `description`, `http_method`, `http_path`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`)
VALUES
  (
    'growth_audit_evidence_prepare',
    'Prepare Growth Audit Evidence',
    'Resolve a tenant-authorized brand, legacy-compatible Brand Core, public site inspection plan, and Google resource read plans. Read-only preparation only; no provider call, external send, browser action, or secret return.',
    'POST',
    '/system/tools/call',
    JSON_OBJECT(
      'type', 'object',
      'properties', JSON_OBJECT(
        'tool_args', JSON_OBJECT(
          'type', 'object',
          'properties', JSON_OBJECT(
            'brand_ref', JSON_OBJECT('type', 'string', 'minLength', 1, 'maxLength', 2048),
            'site_url', JSON_OBJECT('type', 'string', 'maxLength', 2048),
            'resource_urls', JSON_OBJECT('type', 'array', 'maxItems', 20, 'items', JSON_OBJECT('type', 'string', 'maxLength', 2048)),
            'business_objective', JSON_OBJECT('type', 'string', 'maxLength', 1000)
          ),
          'required', JSON_ARRAY('brand_ref'),
          'additionalProperties', FALSE
        )
      ),
      'required', JSON_ARRAY('tool_args'),
      'additionalProperties', FALSE
    ),
    JSON_OBJECT('name', 'growth_audit_evidence_prepare'),
    'tenant,growth_intelligence,audit,evidence,brand_core,read_only,no_provider_call,no_external_send,no_secrets,system_layer_tool,descriptor_backed',
    1,
    372
  )
ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `description` = VALUES(`description`),
  `http_method` = VALUES(`http_method`),
  `http_path` = VALUES(`http_path`),
  `input_schema` = VALUES(`input_schema`),
  `fixed_body` = VALUES(`fixed_body`),
  `tags` = VALUES(`tags`),
  `is_enabled` = VALUES(`is_enabled`),
  `sort_order` = VALUES(`sort_order`);

INSERT INTO `platform_capability_provider_bindings`
  (`binding_id`, `capability_key`, `app_key`, `parent_action_key`, `endpoint_key`, `adapter_key`, `policy_key`, `priority`, `rollout_mode`, `connection_resolution_policy_json`, `input_mapping_json`, `output_mapping_json`, `status`, `notes`)
VALUES
  (
    'files-object-read-google-doc-export-shadow-v1',
    'files.object.read',
    'google_drive',
    'google_drive_api',
    'drive_export_workspace_file',
    'google_workspace_file_read_adapter_v1',
    'growth_audit_file_read_shadow_v1',
    10,
    'shadow',
    JSON_OBJECT('tenant_resource_grant_required', TRUE, 'brand_core_managed_resource_allowed', TRUE, 'signed_principal_authority_required', TRUE),
    JSON_OBJECT('product', 'google_docs', 'file_id_from_governed_resource_plan', TRUE, 'mimeType', 'text/plain'),
    JSON_OBJECT('bounded_text', TRUE, 'chunk_continuation_required', TRUE, 'secrets_included', FALSE),
    'active',
    'Shadow-only candidate for governed Google Docs text export. Does not activate tenant provider execution.'
  ),
  (
    'files-object-read-google-sheet-metadata-shadow-v1',
    'files.object.read',
    'google_sheets',
    'google_sheets_api',
    'getSpreadsheet',
    'google_workspace_file_read_adapter_v1',
    'growth_audit_file_read_shadow_v1',
    20,
    'shadow',
    JSON_OBJECT('tenant_resource_grant_required', TRUE, 'brand_core_managed_resource_allowed', TRUE, 'signed_principal_authority_required', TRUE),
    JSON_OBJECT('product', 'google_sheets', 'phase', 'metadata'),
    JSON_OBJECT('sheet_metadata_only', TRUE, 'secrets_included', FALSE),
    'active',
    'Shadow-only Google Sheets metadata candidate. No tenant provider execution is enabled by this row.'
  ),
  (
    'files-object-read-google-sheet-values-shadow-v1',
    'files.object.read',
    'google_sheets',
    'google_sheets_api',
    'getSheetValues',
    'google_workspace_file_read_adapter_v1',
    'growth_audit_file_read_shadow_v1',
    30,
    'shadow',
    JSON_OBJECT('tenant_resource_grant_required', TRUE, 'brand_core_managed_resource_allowed', TRUE, 'signed_principal_authority_required', TRUE),
    JSON_OBJECT('product', 'google_sheets', 'phase', 'values', 'range_required', TRUE),
    JSON_OBJECT('bounded_rows', TRUE, 'chunk_continuation_required', TRUE, 'secrets_included', FALSE),
    'active',
    'Shadow-only Google Sheets values candidate. No tenant provider execution is enabled by this row.'
  )
ON DUPLICATE KEY UPDATE
  `capability_key` = VALUES(`capability_key`),
  `app_key` = VALUES(`app_key`),
  `parent_action_key` = VALUES(`parent_action_key`),
  `endpoint_key` = VALUES(`endpoint_key`),
  `adapter_key` = VALUES(`adapter_key`),
  `policy_key` = VALUES(`policy_key`),
  `priority` = VALUES(`priority`),
  `rollout_mode` = VALUES(`rollout_mode`),
  `connection_resolution_policy_json` = VALUES(`connection_resolution_policy_json`),
  `input_mapping_json` = VALUES(`input_mapping_json`),
  `output_mapping_json` = VALUES(`output_mapping_json`),
  `status` = VALUES(`status`),
  `notes` = VALUES(`notes`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `execution_policies`
  (`policy_group`, `policy_key`, `policy_value`, `active`, `execution_scope`, `affects_layer`, `blocking`, `notes`)
VALUES
  (
    'Growth Audit Evidence Governance',
    'growth_audit_evidence_admin_tenant_policy_v1',
    JSON_OBJECT(
      'tool', 'growth_audit_evidence_prepare',
      'admin_tenant_shared', TRUE,
      'tenant_identity_source', 'signed_jwt_only',
      'brand_authority_required', TRUE,
      'brand_core_pointer_first', TRUE,
      'visitor_issue_requires_rendered_visible', TRUE,
      'html_presence_alone_insufficient', TRUE,
      'browser_runtime_priority', JSON_ARRAY('browser4_essam_v1'),
      'native_edge_visual_capture_allowed', FALSE,
      'google_file_read_rollout', 'shadow',
      'provider_calls_from_prepare', FALSE,
      'mutations_allowed', FALSE,
      'external_sends_allowed', FALSE,
      'secrets_included', FALSE
    ),
    'TRUE',
    'growth_audit|brand_core|site_inspection|google_workspace_read|admin|tenant',
    'growthAuditEvidence|systemLayerRoutes|brandReferenceResolver|brandCoreResolver|pathResolverDbLoader',
    'TRUE',
    'Shared read-only audit preparation resolves canonical brand context and evidence plans. Tenant provider execution remains blocked until shadow bindings are certified and promoted separately.'
  )
ON DUPLICATE KEY UPDATE
  `policy_value` = VALUES(`policy_value`),
  `active` = VALUES(`active`),
  `execution_scope` = VALUES(`execution_scope`),
  `affects_layer` = VALUES(`affects_layer`),
  `blocking` = VALUES(`blocking`),
  `notes` = VALUES(`notes`),
  `updated_at` = CURRENT_TIMESTAMP;
