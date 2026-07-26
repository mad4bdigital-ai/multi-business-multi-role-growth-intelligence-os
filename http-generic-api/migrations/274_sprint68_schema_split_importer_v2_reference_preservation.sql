-- Sprint 68: Schema Split Importer v2 reference preservation
-- Purpose:
--   Keep parent action schemas as references/manifests while splitting executable
--   OpenAPI operation contracts into endpoints.schema_json with import metadata.
--   Idempotent; no DELETE/TRUNCATE/DROP.

ALTER TABLE schema_import_jobs
  ADD COLUMN IF NOT EXISTS source_sha256 VARCHAR(64) NULL AFTER source_filename,
  ADD COLUMN IF NOT EXISTS source_bytes INT UNSIGNED NOT NULL DEFAULT 0 AFTER source_sha256,
  ADD COLUMN IF NOT EXISTS parent_schema_ref TEXT NULL AFTER source_bytes,
  ADD COLUMN IF NOT EXISTS preserve_parent_schema_reference TINYINT(1) NOT NULL DEFAULT 0 AFTER parent_schema_ref,
  ADD COLUMN IF NOT EXISTS metadata_json LONGTEXT NULL AFTER endpoint_snapshots;

INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
  (
    'schema_import_action_ref',
    'Import Schema From Action Reference',
    'Resolve an action parent schema reference and split it into endpoint-level schema_json contracts while preserving the parent action as a lightweight reference. Does not return secrets.',
    'POST',
    '/admin/schema-import/action-ref',
    NULL,
    '{"type":"object","required":["action_key"],"properties":{"action_key":{"type":"string"},"imported_by":{"type":"string"},"preserve_parent_schema_reference":{"type":"boolean","default":true},"dry_run":{"type":"boolean","default":false}}}',
    NULL,
    'schema,admin,openapi,reference_preservation,no_secrets',
    1,
    94
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
  sort_order = VALUES(sort_order),
  updated_at = CURRENT_TIMESTAMP;
