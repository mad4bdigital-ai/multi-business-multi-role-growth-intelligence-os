-- 20260719_expand_resource_authority_tenant_gpt_oauth_smoke.sql
-- Temporarily expose one exact production shell-alias recipe for the
-- Tenant GPT OAuth live-smoke script. The resulting grant remains
-- diagnostic-only, TTL-bound, typed-confirmed, and same-cycle read back.

UPDATE admin_platform_endpoint_tools
SET description = 'Create a bounded resource authority binding for governed GitHub repository operations, the two exact dev-only migration client aliases, or the temporary Tenant GPT OAuth production smoke alias. Dry-run by default; apply requires TTL, expected commit SHA, typed confirmation, and same-cycle readback. No arbitrary shell, provider calls, external writes, or secrets.',
    input_schema = JSON_SET(
      input_schema,
      '$.properties.resource_uri.pattern', '^((github://[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)|(shell://(dev_governed_migration_client|dev_governed_migration_client_apply|tenant_gpt_oauth_live_smoke)))$',
      '$.properties.recipe_key.enum', JSON_ARRAY('repo_patch_apply','repo_patch_batch_apply','github_pr_create','dev_growth_intelligence_pilot_read','dev_growth_intelligence_pilot_apply','tenant_gpt_oauth_live_smoke'),
      '$.properties.permission_level.enum', JSON_ARRAY('patch','admin','diagnostic'),
      '$.properties.allowed_modes.items.enum', JSON_ARRAY('write_file','replace_block','apply_unified_diff','delete_file','atomic_change_set','create_pull_request','dev_governed_migration_client','dev_governed_migration_client_apply','tenant_gpt_oauth_live_smoke'),
      '$.properties.resource_ref.properties.alias.enum', JSON_ARRAY('dev_governed_migration_client','dev_governed_migration_client_apply','tenant_gpt_oauth_live_smoke')
    ),
    tags = 'admin,resource_authority,state_changing,dry_run_default,typed_confirmation,readback,github_repo,shell_alias,bounded_production_smoke,temporary,no_arbitrary_shell,no_provider_call,no_external_write,no_secrets'
WHERE tool_key = 'platform_resource_authority_grant_apply';

-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- arbitrary_shell_allowed=false
-- temporary_production_smoke=true
-- secrets_included=false
