-- Tenant blocked capability export cleanup
--
-- Purpose:
--   Align the capability export registry with current compiled Tenant manifests
--   after runtime listing, direct dispatch, and Tenant tool catalog rows became
--   fail-closed.
--
-- Scope:
--   Disable only the eight reviewed Tenant capability export rows that remain
--   active while their current compiled manifest status is blocked.
--
-- Safety:
--   Idempotent registry-only update. No provider call, credential payload read,
--   external write, raw secret access, schema change, destructive SQL, or
--   manifest mutation.

UPDATE platform_plugin_capability_exports AS e
JOIN platform_capability_compiled_manifests AS m
  ON m.capability_key = e.capability_key
 AND m.is_current = 1
 AND m.status = 'blocked'
SET e.export_status = 'disabled',
    e.notes = CASE
      WHEN LOCATE('[disabled: current capability manifest blocked]', COALESCE(e.notes, '')) = 0
        THEN CONCAT(COALESCE(e.notes, ''), ' [disabled: current capability manifest blocked]')
      ELSE e.notes
    END,
    e.updated_at = CURRENT_TIMESTAMP
WHERE e.export_status = 'active'
  AND e.exposure_scope = 'tenant'
  AND e.export_surface = 'tenant_platform_tool'
  AND e.source_table = 'tenant_platform_endpoint_tools'
  AND e.export_key IN (
    'tenant_tool_export.connect_credential_intake_create',
    'tenant_tool_export.connector_agent_runtime',
    'tenant_tool_export.gpt_session_conversation_ref_capture_current',
    'tenant_tool_export.gpt_session_conversation_ref_mark_primary',
    'tenant_tool_export.local_gateway_tools_call',
    'tenant_tool_export.support_ticket_event_append',
    'tenant_tool_export.tenant_agent_surface_deployment_upsert',
    'tenant_tool_export.tenant_repository_intelligence_v3_v4_readiness_smoke'
  );
