-- Spec 018 / Environment Authority B04-B09
-- Remove caller-controlled branch selection from governed Hostinger production
-- deployment tool/command schemas. Runtime resolves the production branch from
-- environment_branch_authority_v1 and verifies the exact Production head SHA
-- through a same-cycle GitHub readback before any deploy dispatch.
--
-- Safety attestations:
-- no_credential_payload_read
-- no_external_send
-- no_external_write
-- no_hostinger_runtime_mutation
-- migration_source_only
-- secrets_included_false

UPDATE remote_runtime_command_allowlists
SET input_schema_json = JSON_OBJECT(
      'type','object',
      'required',JSON_ARRAY('target_id','app_key','app_path','expected_commit_sha','approval_reason'),
      'properties',JSON_OBJECT(
        'target_id',JSON_OBJECT('type','string'),
        'app_key',JSON_OBJECT('type','string','enum',JSON_ARRAY('auth.mad4b.com')),
        'app_path',JSON_OBJECT('type','string','pattern','^/home/[^/]+/domains/auth\\.mad4b\\.com/nodejs$'),
        'expected_commit_sha',JSON_OBJECT('type','string','pattern','^[0-9a-f]{40}$'),
        'dry_run',JSON_OBJECT('type','boolean','default',true),
        'force_clean',JSON_OBJECT('type','boolean','default',false),
        'restart',JSON_OBJECT('type','boolean','default',true),
        'approval_reason',JSON_OBJECT('type','string','minLength',20),
        'timeout_ms',JSON_OBJECT('type','integer','minimum',1000,'maximum',300000)
      ),
      'additionalProperties',false
    ),
    notes = 'Production branch is not caller-selectable. Runtime resolves environment_branch_authority_v1, requires an exact expected_commit_sha, and performs same-cycle GitHub Production-head readback before dispatch.',
    updated_at = CURRENT_TIMESTAMP
WHERE plugin_key = 'remote_ssh_runtime'
  AND command_key = 'deploy_release';

UPDATE admin_platform_endpoint_tools
SET description = 'Approval-gated Hostinger deploy compatibility surface. Production branch is policy-derived and not caller-selectable; exact Production head SHA is mandatory and verified same-cycle before dispatch. Routine SSH production mutation remains blocked by target policy.',
    input_schema = '{"type":"object","required":["target_id","app_key","app_path","expected_commit_sha"],"properties":{"target_id":{"type":"string"},"app_key":{"type":"string","enum":["auth.mad4b.com"]},"app_path":{"type":"string"},"expected_commit_sha":{"type":"string","pattern":"^[0-9a-f]{40}$"},"dry_run":{"type":"boolean","default":true},"force_clean":{"type":"boolean","default":false},"restart":{"type":"boolean","default":true},"approval_reason":{"type":"string","minLength":20},"timeout_ms":{"type":"integer","minimum":1000,"maximum":300000}},"additionalProperties":false}',
    updated_at = CURRENT_TIMESTAMP
WHERE tool_key = 'remote_runtime_hostinger_deploy_release';

UPDATE execution_policies
SET policy_value = JSON_SET(
      COALESCE(policy_value, JSON_OBJECT()),
      '$.rule', 'hostinger_production_deploy_requires_policy_derived_branch_exact_current_production_sha_and_no_secret_output',
      '$.authority_config_key', 'environment_branch_authority_v1',
      '$.branch_selection', 'policy_derived_only',
      '$.expected_sha_semantics', 'must_equal_same_cycle_production_branch_head',
      '$.same_cycle_branch_readback_required', TRUE,
      '$.caller_branch_selection_allowed', FALSE,
      '$.secrets_included', FALSE
    ),
    notes = 'Spec 018 B04-B09: branch selection is removed from governed caller schemas; runtime resolves Production authority and rejects stale/mismatched SHA before dispatch.',
    updated_at = CURRENT_TIMESTAMP
WHERE policy_group = 'remote_runtime_hostinger_deploy_governance'
  AND policy_key = 'hostinger_ssh_deploy_release_guard';
