-- Tenant blocked tool export registry cleanup
--
-- Purpose:
--   Align the legacy Tenant tool registry with current compiled capability
--   manifests after runtime listing and dispatch became manifest-aware.
--
-- Scope:
--   Disable only the eight reviewed Tenant tools that are currently enabled
--   while their current compiled manifest status is blocked.
--
-- Safety:
--   Idempotent registry-only update. No provider call, credential payload read,
--   external write, raw secret access, schema change, or destructive SQL.

UPDATE tenant_platform_endpoint_tools AS t
JOIN platform_capability_compiled_manifests AS m
  ON m.capability_key = CONCAT('tenant_tool.', t.tool_key)
 AND m.is_current = 1
 AND m.status = 'blocked'
SET t.is_enabled = 0,
    t.description = CASE
      WHEN LOCATE('[disabled: current capability manifest blocked]', COALESCE(t.description, '')) = 0
        THEN CONCAT(COALESCE(t.description, ''), ' [disabled: current capability manifest blocked]')
      ELSE t.description
    END,
    t.tags = CONCAT_WS(
      ',',
      NULLIF(TRIM(BOTH ',' FROM COALESCE(t.tags, '')), ''),
      CASE WHEN FIND_IN_SET('manifest_blocked', COALESCE(t.tags, '')) = 0 THEN 'manifest_blocked' END,
      CASE WHEN FIND_IN_SET('fail_closed', COALESCE(t.tags, '')) = 0 THEN 'fail_closed' END
    ),
    t.updated_at = CURRENT_TIMESTAMP
WHERE t.is_enabled = 1
  AND t.tool_key IN (
    'connect_credential_intake_create',
    'connector_agent_runtime',
    'gpt_session_conversation_ref_capture_current',
    'gpt_session_conversation_ref_mark_primary',
    'local_gateway_tools_call',
    'support_ticket_event_append',
    'tenant_agent_surface_deployment_upsert',
    'tenant_repository_intelligence_v3_v4_readiness_smoke'
  );
