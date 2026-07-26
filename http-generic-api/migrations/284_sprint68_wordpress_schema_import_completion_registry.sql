-- Sprint 68: WordPress schema import completion registry alignment
-- Purpose:
--   Persist the final registry adjustments made during WOVacation WordPress runtime validation:
--   1) expose action-ref Drive mirror inputs on the governed admin tool schema;
--   2) keep the execution-ready wordpress_create_post alias synced to the canonical postWpV2Posts schema;
--   3) align wordpress_get_post provider_family for authenticated readback.
-- Safety:
--   Idempotent UPDATE-only migration. No secrets. No provider execution.

UPDATE admin_platform_endpoint_tools
   SET input_schema = '{"type":"object","required":["action_key"],"properties":{"action_key":{"type":"string"},"imported_by":{"type":"string"},"preserve_parent_schema_reference":{"type":"boolean","default":true},"mirror_drive_if_needed":{"type":"boolean","default":false,"description":"When true, mirror the action parent schema from an approved Drive file into json_assets before importing."},"source_drive_file_id":{"type":"string","description":"Optional explicit Google Drive file id. If omitted, the route may use the action schema file id or governed notes-derived Drive file id."},"dry_run":{"type":"boolean","default":false}}}',
       tags = 'schema,admin,openapi,reference_preservation,drive_mirror,no_secrets'
 WHERE tool_key = 'schema_import_action_ref';

UPDATE endpoints legacy
JOIN endpoints canonical
  ON canonical.parent_action_key = legacy.parent_action_key
 AND canonical.endpoint_key = 'postWpV2Posts'
 AND canonical.status = 'active'
SET legacy.schema_json = canonical.schema_json,
    legacy.import_job_id = canonical.import_job_id,
    legacy.schema_imported_at = COALESCE(legacy.schema_imported_at, CURRENT_TIMESTAMP),
    legacy.child_openai_schema_file_id = canonical.child_openai_schema_file_id,
    legacy.schema_overlay_parent_action_key = canonical.schema_overlay_parent_action_key,
    legacy.schema_overlay_status = 'validated_alias_schema_synced_from_postWpV2Posts',
    legacy.schema_overlay_notes = JSON_OBJECT(
      'source_endpoint_key', 'postWpV2Posts',
      'source_import_job_id', canonical.import_job_id,
      'reason', 'Preserve execution-ready legacy alias after Schema Split Importer v2 canonical endpoint import',
      'secrets_included', false
    ),
    legacy.inventory_source = 'schema_import_alias_sync:postWpV2Posts'
WHERE legacy.parent_action_key = 'wordpress_api'
  AND legacy.endpoint_key = 'wordpress_create_post'
  AND legacy.status = 'active';

UPDATE endpoints
   SET provider_family = 'wordpress_cms',
       schema_overlay_status = 'validated_readback_alias_provider_family_synced',
       schema_overlay_notes = JSON_OBJECT(
         'reason', 'Align readback alias provider_family with wordpress_api runtime binding after live draft validation',
         'source_endpoint_key', 'getWpV2PostsById',
         'secrets_included', false
       ),
       updated_at = CURRENT_TIMESTAMP
 WHERE parent_action_key = 'wordpress_api'
   AND endpoint_key = 'wordpress_get_post'
   AND status = 'active'
   AND provider_family <> 'wordpress_cms';
