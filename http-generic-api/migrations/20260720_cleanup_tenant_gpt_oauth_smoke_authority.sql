-- 20260720_cleanup_tenant_gpt_oauth_smoke_authority.sql
-- Remove the temporary production OAuth smoke authority after verified
-- authorize, token exchange, replay rejection, claim checks, and cleanup.
-- Permanent Tenant GPT OAuth and the governed GitHub raw endpoint remain active.

UPDATE admin_platform_endpoint_tools
SET description = 'Create a bounded resource authority binding for governed GitHub repository operations or the two exact dev-only migration client aliases. Dry-run by default; apply requires TTL, expected commit SHA, typed confirmation, and same-cycle readback. No arbitrary shell, provider calls, external writes, or secrets.',
    input_schema = JSON_SET(
      input_schema,
      '$.properties.resource_uri.pattern', '^((github://[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)|(shell://(dev_governed_migration_client|dev_governed_migration_client_apply)))$',
      '$.properties.recipe_key.enum', JSON_ARRAY('repo_patch_apply','repo_patch_batch_apply','github_pr_create','dev_growth_intelligence_pilot_read','dev_growth_intelligence_pilot_apply'),
      '$.properties.permission_level.enum', JSON_ARRAY('patch','admin','diagnostic'),
      '$.properties.allowed_modes.items.enum', JSON_ARRAY('write_file','replace_block','apply_unified_diff','delete_file','atomic_change_set','create_pull_request','dev_governed_migration_client','dev_governed_migration_client_apply'),
      '$.properties.resource_ref.properties.alias.enum', JSON_ARRAY('dev_governed_migration_client','dev_governed_migration_client_apply')
    ),
    tags = 'admin,resource_authority,state_changing,dry_run_default,typed_confirmation,readback,github_repo,shell_alias,no_arbitrary_shell,no_provider_call,no_external_write,no_secrets'
WHERE tool_key = 'platform_resource_authority_grant_apply';

UPDATE platform_resource_authority_bindings
SET status = 'revoked',
    expires_at = LEAST(expires_at, UTC_TIMESTAMP()),
    notes = CONCAT_WS('\n', NULLIF(notes, ''), 'Tenant GPT OAuth production smoke authority removed after verified closeout on 2026-07-20.'),
    updated_at = UTC_TIMESTAMP()
WHERE resource_type = 'shell_alias'
  AND resource_uri = 'shell://tenant_gpt_oauth_live_smoke'
  AND status = 'active';

-- backward_compatible=true
-- internal_registry_write_only=true
-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- arbitrary_shell_allowed=false
-- temporary_production_smoke_cleanup=true
-- same_cycle_readback_required=true
-- secrets_included=false
