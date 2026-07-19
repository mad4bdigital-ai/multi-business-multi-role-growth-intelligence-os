-- 20260718_repair_resource_authority_grant_tags_csv.sql
-- Repair the platform resource authority tool tags after JSON text was written
-- into the legacy comma-separated tags column.

UPDATE admin_platform_endpoint_tools
SET tags = 'admin,resource_authority,state_changing,dry_run_default,typed_confirmation,readback,github_repo,shell_alias,dev_only,no_arbitrary_shell,no_provider_call,no_external_write,no_secrets'
WHERE tool_key = 'platform_resource_authority_grant_apply';

-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- secrets_included=false
