-- 20260719_repair_activation_session_context_tags_csv.sql
-- Repair the read-only activation session-context tool tags after JSON text was
-- written into the legacy comma-separated tags column.

UPDATE admin_platform_endpoint_tools
SET tags = 'activation,session,read_only,diagnostic'
WHERE tool_key = 'activation_session_context_read_only';

-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- secrets_included=false
