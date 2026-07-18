-- 20260718_expand_resource_authority_shell_alias_contract.sql
-- Align the governed admin tool schema with the already-implemented, exact
-- dev-only shell alias resource authority recipes.

UPDATE admin_platform_endpoint_tools
SET description = 'Create a bounded resource authority binding for governed GitHub repository operations or the two exact dev-only migration client shell aliases. Dry-run by default; apply requires TTL, expected commit SHA, typed confirmation, and same-cycle readback. No arbitrary shell, production shell execution, provider calls, or secrets.',
    input_schema = JSON_OBJECT(
      'type', 'object',
      'required', JSON_ARRAY(
        'tenant_id',
        'workspace_id',
        'user_id',
        'resource_type',
        'resource_uri',
        'recipe_key',
        'resource_ref'
      ),
      'properties', JSON_OBJECT(
        'mode', JSON_OBJECT(
          'type', 'string',
          'enum', JSON_ARRAY('dry_run', 'apply'),
          'default', 'dry_run'
        ),
        'tenant_id', JSON_OBJECT('type', 'string', 'format', 'uuid'),
        'workspace_id', JSON_OBJECT('type', 'string', 'format', 'uuid'),
        'user_id', JSON_OBJECT('type', 'string', 'format', 'uuid'),
        'resource_type', JSON_OBJECT(
          'type', 'string',
          'enum', JSON_ARRAY('github_repo', 'shell_alias')
        ),
        'resource_uri', JSON_OBJECT(
          'type', 'string',
          'pattern', '^((github://[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)|(shell://(dev_governed_migration_client|dev_governed_migration_client_apply)))$'
        ),
        'recipe_key', JSON_OBJECT(
          'type', 'string',
          'enum', JSON_ARRAY(
            'repo_patch_apply',
            'repo_patch_batch_apply',
            'github_pr_create',
            'dev_growth_intelligence_pilot_read',
            'dev_growth_intelligence_pilot_apply'
          )
        ),
        'permission_level', JSON_OBJECT(
          'type', 'string',
          'enum', JSON_ARRAY('patch', 'admin', 'diagnostic')
        ),
        'allowed_modes', JSON_OBJECT(
          'type', 'array',
          'maxItems', 8,
          'items', JSON_OBJECT(
            'type', 'string',
            'enum', JSON_ARRAY(
              'write_file',
              'replace_block',
              'apply_unified_diff',
              'delete_file',
              'atomic_change_set',
              'create_pull_request',
              'dev_governed_migration_client',
              'dev_governed_migration_client_apply'
            )
          )
        ),
        'resource_ref', JSON_OBJECT(
          'type', 'object',
          'required', JSON_ARRAY('expected_commit_sha'),
          'properties', JSON_OBJECT(
            'branch', JSON_OBJECT('type', 'string', 'minLength', 1, 'maxLength', 255),
            'expected_commit_sha', JSON_OBJECT('type', 'string', 'pattern', '^[0-9a-fA-F]{40}$'),
            'base_sha', JSON_OBJECT('type', 'string', 'pattern', '^[0-9a-fA-F]{40}$'),
            'alias', JSON_OBJECT(
              'type', 'string',
              'enum', JSON_ARRAY('dev_governed_migration_client', 'dev_governed_migration_client_apply')
            )
          ),
          'additionalProperties', TRUE
        ),
        'ttl_minutes', JSON_OBJECT('type', 'integer', 'minimum', 5, 'maximum', 1440),
        'confirm', JSON_OBJECT('type', 'string'),
        'notes', JSON_OBJECT('type', 'string', 'maxLength', 1000),
        'created_by', JSON_OBJECT('type', 'string', 'maxLength', 64)
      ),
      'additionalProperties', FALSE
    ),
    tags = JSON_ARRAY(
      'admin',
      'resource_authority',
      'state_changing',
      'dry_run_default',
      'typed_confirmation',
      'readback',
      'github_repo',
      'shell_alias',
      'dev_only',
      'no_arbitrary_shell',
      'no_provider_call',
      'no_external_write',
      'no_secrets'
    )
WHERE tool_key = 'platform_resource_authority_grant_apply';

-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- secrets_included=false
