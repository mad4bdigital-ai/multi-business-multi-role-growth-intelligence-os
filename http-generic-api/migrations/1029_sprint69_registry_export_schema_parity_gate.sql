-- Migration execution safety
-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- secrets_included=false
--
-- Keep active platform endpoint exports byte-for-byte aligned with their
-- canonical endpoint schema rows. Provider dispatch resolves contracts from
-- SQL endpoint authority; stale exported schemas can turn successful provider
-- responses into false contract failures or hide missing response schemas.

UPDATE platform_endpoint_tool_exports export_row
JOIN endpoints endpoint_row
  ON endpoint_row.id = export_row.source_endpoint_id
SET export_row.input_schema_json = endpoint_row.schema_json,
    export_row.notes = CONCAT(
      COALESCE(export_row.notes, ''),
      CASE WHEN COALESCE(export_row.notes, '') = '' THEN '' ELSE '\n' END,
      '1029_sprint69_registry_export_schema_parity_gate: synchronized input_schema_json from canonical endpoints.schema_json.'
    ),
    export_row.updated_at = CURRENT_TIMESTAMP
WHERE export_row.status = 'active'
  AND endpoint_row.status = 'active'
  AND endpoint_row.schema_json IS NOT NULL
  AND NOT (export_row.input_schema_json <=> endpoint_row.schema_json);

CREATE OR REPLACE VIEW v_platform_endpoint_export_schema_parity AS
SELECT
  export_row.id AS export_row_id,
  export_row.export_key,
  export_row.tool_name,
  export_row.scope_class,
  export_row.status AS export_status,
  export_row.source_endpoint_id,
  endpoint_row.id AS endpoint_row_id,
  endpoint_row.endpoint_id,
  endpoint_row.parent_action_key,
  endpoint_row.endpoint_key,
  endpoint_row.method,
  endpoint_row.endpoint_path_or_function,
  endpoint_row.status AS endpoint_status,
  endpoint_row.execution_readiness,
  endpoint_row.transport_action_key,
  CASE WHEN export_row.source_endpoint_id IS NULL THEN 1 ELSE 0 END AS missing_source_endpoint,
  CASE WHEN export_row.source_endpoint_id IS NOT NULL AND endpoint_row.id IS NULL THEN 1 ELSE 0 END AS missing_endpoint_row,
  CASE WHEN endpoint_row.id IS NOT NULL AND endpoint_row.status <> 'active' THEN 1 ELSE 0 END AS endpoint_inactive,
  CASE WHEN endpoint_row.id IS NOT NULL AND endpoint_row.execution_readiness <> 'ready' THEN 1 ELSE 0 END AS endpoint_not_ready,
  CASE
    WHEN export_row.status = 'active'
     AND endpoint_row.status = 'active'
     AND NOT (export_row.input_schema_json <=> endpoint_row.schema_json)
    THEN 1 ELSE 0
  END AS schema_mismatch,
  CASE
    WHEN export_row.status <> 'active' THEN 'ignored_inactive_export'
    WHEN export_row.source_endpoint_id IS NULL THEN 'missing_source_endpoint'
    WHEN endpoint_row.id IS NULL THEN 'missing_endpoint_row'
    WHEN endpoint_row.status <> 'active' THEN 'endpoint_inactive'
    WHEN endpoint_row.execution_readiness <> 'ready' THEN 'endpoint_not_ready'
    WHEN NOT (export_row.input_schema_json <=> endpoint_row.schema_json) THEN 'schema_mismatch'
    ELSE 'pass'
  END AS schema_parity_status,
  export_row.updated_at AS export_updated_at,
  endpoint_row.updated_at AS endpoint_updated_at
FROM platform_endpoint_tool_exports export_row
LEFT JOIN endpoints endpoint_row
  ON endpoint_row.id = export_row.source_endpoint_id
WHERE export_row.status = 'active';
