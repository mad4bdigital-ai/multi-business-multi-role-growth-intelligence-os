-- Migration execution safety
-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- secrets_included=false
--
-- Migration 1029 made endpoint export schema drift visible and synchronized
-- active exports that still point at active canonical endpoint rows. This
-- cleanup archives active export rows that are not callable through active
-- dispatch bindings and either point at deprecated endpoint rows or have no
-- source endpoint row at all. Standalone admin tools remain governed through
-- admin_platform_endpoint_tools; this migration only removes stale endpoint
-- export projections from the parity surface.

UPDATE platform_endpoint_tool_exports export_row
LEFT JOIN endpoints endpoint_row
  ON endpoint_row.id = export_row.source_endpoint_id
SET export_row.status = 'archived',
    export_row.notes = CONCAT(
      COALESCE(export_row.notes, ''),
      CASE WHEN COALESCE(export_row.notes, '') = '' THEN '' ELSE '\n' END,
      '1031_sprint69_registry_export_orphan_cleanup: archived non-callable export after parity view classified it as orphaned or deprecated and no active dispatch binding referenced it.'
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
