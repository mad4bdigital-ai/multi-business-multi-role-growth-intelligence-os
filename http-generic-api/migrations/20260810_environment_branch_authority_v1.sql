-- Spec 018 / Environment Authority
-- Make environment branch roles SQL-addressable while preserving the repository
-- policy file as a compatibility fallback. Production deployment authority is
-- the protected Production branch; main remains staging/source-of-change only.
--
-- Safety attestations:
-- no_provider_call
-- no_credential_payload_read
-- no_external_send
-- no_external_write
-- no_runtime_mutation
-- secrets_included_false

INSERT INTO platform_runtime_config (config_key, config_json, status, note)
VALUES (
  'environment_branch_authority_v1',
  JSON_OBJECT(
    'schema_version', 'mad4b.environment-branch-authority.v1',
    'staging_branch', 'main',
    'production_branch', 'Production',
    'promotion_source_branch', 'main',
    'promotion_target_branch', 'Production',
    'production_host', 'auth.mad4b.com',
    'production_provider', 'hostinger',
    'production_deployment_mode', 'hostinger_auto_deploy',
    'force_push_allowed', FALSE,
    'secrets_included', FALSE
  ),
  'active',
  'Spec 018 environment branch authority. main is staging/source-of-change; Production is the only production deployment authority.'
)
ON DUPLICATE KEY UPDATE
  config_json = VALUES(config_json),
  status = 'active',
  note = VALUES(note),
  updated_at = CURRENT_TIMESTAMP;

-- Narrow registry/tool contracts so callers cannot advertise main as a valid
-- Hostinger production deploy branch. The direct runtime route is separately
-- fail-closed by target metadata for normal SSH writes until the executor is
-- wired to the environment authority resolver.
UPDATE remote_runtime_command_allowlists
SET input_schema_json = JSON_OBJECT(
      'type','object',
      'required',JSON_ARRAY('target_id','app_key','app_path','branch','expected_commit_sha','approval_reason'),
      'properties',JSON_OBJECT(
        'target_id',JSON_OBJECT('type','string'),
        'app_key',JSON_OBJECT('type','string','enum',JSON_ARRAY('auth.mad4b.com')),
        'app_path',JSON_OBJECT('type','string','pattern','^/home/[^/]+/domains/auth\\.mad4b\\.com/nodejs$'),
        'branch',JSON_OBJECT('type','string','enum',JSON_ARRAY('Production'),'default','Production'),
        'expected_commit_sha',JSON_OBJECT('type','string','pattern','^[0-9a-f]{40}$'),
        'dry_run',JSON_OBJECT('type','boolean','default',true),
        'force_clean',JSON_OBJECT('type','boolean','default',false),
        'restart',JSON_OBJECT('type','boolean','default',true),
        'approval_reason',JSON_OBJECT('type','string','minLength',20),
        'timeout_ms',JSON_OBJECT('type','integer','minimum',1000,'maximum',300000)
      ),
      'additionalProperties',false
    ),
    notes = 'Production deploy contract accepts only the SQL-authoritative Production branch and an exact commit SHA. Routine SSH writes remain blocked by target policy; Hostinger Auto Deploy is the normal production path.',
    updated_at = CURRENT_TIMESTAMP
WHERE plugin_key = 'remote_ssh_runtime'
  AND command_key = 'deploy_release';

UPDATE admin_platform_endpoint_tools
SET description = 'Approval-gated Hostinger deploy compatibility surface. Production branch authority is resolved as Production; exact commit SHA is mandatory. Routine SSH production mutation remains blocked by target policy.',
    input_schema = '{"type":"object","required":["target_id","app_key","app_path","branch","expected_commit_sha"],"properties":{"target_id":{"type":"string"},"app_key":{"type":"string","enum":["auth.mad4b.com"]},"app_path":{"type":"string"},"branch":{"type":"string","enum":["Production"],"default":"Production"},"expected_commit_sha":{"type":"string","pattern":"^[0-9a-f]{40}$"},"dry_run":{"type":"boolean","default":true},"force_clean":{"type":"boolean","default":false},"restart":{"type":"boolean","default":true},"approval_reason":{"type":"string","minLength":20},"timeout_ms":{"type":"integer","minimum":1000,"maximum":300000}},"additionalProperties":false}',
    updated_at = CURRENT_TIMESTAMP
WHERE tool_key = 'remote_runtime_hostinger_deploy_release';

UPDATE execution_policies
SET policy_value = JSON_OBJECT(
      'rule','hostinger_production_deploy_requires_environment_authority_exact_sha_and_no_secret_output',
      'target_id','b49fe2ae-5974-11f1-9baf-8e76a7e1749f',
      'app_key','auth.mad4b.com',
      'authority_config_key','environment_branch_authority_v1',
      'staging_branch','main',
      'production_branch','Production',
      'allowed_paths',JSON_ARRAY('/home/*/domains/auth.mad4b.com/nodejs'),
      'allowed_branches',JSON_ARRAY('Production'),
      'requires',JSON_ARRAY('expected_commit_sha','production_branch_authority_match','approval_reason','path_allowlist_match','bounded_output','same_cycle_health_readback'),
      'forbidden',JSON_ARRAY('production deploy from main','caller-selected production branch','freeform shell','secret response','unbounded logs','deploy without expected sha','force push')
    ),
    notes = 'Spec 018: main is staging/source-of-change; Production is the only production deployment authority. Exact SHA and same-cycle readback remain mandatory.',
    updated_at = CURRENT_TIMESTAMP
WHERE policy_group = 'remote_runtime_hostinger_deploy_governance'
  AND policy_key = 'hostinger_ssh_deploy_release_guard';

-- Preserve Hostinger SSH as break-glass-only/non-routine for the known platform
-- production target while the normal path is protected Production -> Hostinger
-- Auto Deploy. These fields are already consumed before credential/network I/O.
UPDATE remote_runtime_targets
SET metadata_json = JSON_SET(
      COALESCE(metadata_json, JSON_OBJECT()),
      '$.deployment_strategy', 'github_production_auto_deploy',
      '$.production_branch', 'Production',
      '$.staging_branch', 'main',
      '$.deployment_allowed', FALSE,
      '$.ssh_normal_updates_allowed', FALSE,
      '$.ssh_break_glass_only', TRUE,
      '$.environment_authority_config_key', 'environment_branch_authority_v1',
      '$.secrets_included', FALSE
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE target_id = 'b49fe2ae-5974-11f1-9baf-8e76a7e1749f'
  AND plugin_key = 'remote_ssh_runtime'
  AND provider_family = 'hostinger';
