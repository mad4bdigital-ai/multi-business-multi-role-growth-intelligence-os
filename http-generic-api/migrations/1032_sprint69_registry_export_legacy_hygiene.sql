-- Migration execution safety
-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- secrets_included=false
--
-- Archive active platform endpoint export rows that are not callable and cannot
-- pass canonical endpoint parity because their source endpoint is missing,
-- missing from the endpoint table, or deprecated/inactive. The corresponding
-- admin tool rows, if any, are not modified by this migration.

UPDATE platform_endpoint_tool_exports export_row
LEFT JOIN endpoints endpoint_row
  ON endpoint_row.id = export_row.source_endpoint_id
SET export_row.status = 'archived',
    export_row.notes = CONCAT(
      COALESCE(export_row.notes, ''),
      CASE WHEN COALESCE(export_row.notes, '') = '' THEN '' ELSE '\n' END,
      '1032_sprint69_registry_export_legacy_hygiene: archived non-callable export lacking active canonical endpoint authority.'
    ),
    export_row.updated_at = CURRENT_TIMESTAMP
WHERE export_row.status = 'active'
  AND NOT EXISTS (
    SELECT 1
      FROM platform_tool_dispatch_bindings binding_row
     WHERE binding_row.export_key = export_row.export_key
       AND binding_row.status = 'active'
  )
  AND (
    export_row.source_endpoint_id IS NULL
    OR endpoint_row.id IS NULL
    OR endpoint_row.status <> 'active'
  );
