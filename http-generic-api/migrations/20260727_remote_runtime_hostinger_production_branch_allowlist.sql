-- Allow the governed Hostinger deploy executor to deploy exact SHAs from
-- canonical main or the protected Production promotion branch.
-- This migration only updates existing registry contracts and policies.
-- Safety attestations:
-- no_provider_call
-- no_credential_payload_read
-- no_external_send
-- no_external_write
-- secrets_included_false

UPDATE remote_runtime_command_allowlists
SET input_schema_json = JSON_OBJECT(
      'type','object',
      'required',JSON_ARRAY('target_id','app_key','app_path','branch','expected_commit_sha','approval_reason'),
      'properties',JSON_OBJECT(
        'target_id',JSON_OBJECT('type','string'),
        'app_key',JSON_OBJECT('type','string','enum',JSON_ARRAY('auth.mad4b.com')),
        'app_path',JSON_OBJECT('type','string','pattern','^/home/[^/]+/domains/auth\\.mad4b\\.com/nodejs$'),
        'branch',JSON_OBJECT('type','string','enum',JSON_ARRAY('main','Production')),
        'expected_commit_sha',JSON_OBJECT('type','string','pattern','^[0-9a-f]{40}$'),
        'dry_run',JSON_OBJECT('type','boolean','default',true),
        'force_clean',JSON_OBJECT('type','boolean','default',false),
        'restart',JSON_OBJECT('type','boolean','default',true),
        'approval_reason',JSON_OBJECT('type','string','minLength',20),
        'timeout_ms',JSON_OBJECT('type','integer','minimum',1000,'maximum',300000)
      ),
      'additionalProperties',false
    ),
    notes = 'Approval-gated Hostinger SSH deploy release command. Executor uses fixed git checkout to an expected main or Production commit, bounded output, no raw secret responses, and no freeform shell.',
    updated_at = CURRENT_TIMESTAMP
WHERE plugin_key = 'remote_ssh_runtime'
  AND command_key = 'deploy_release';

UPDATE admin_platform_endpoint_tools
SET description = 'Approval-gated production deploy for Hostinger SSH targets. Defaults to dry_run=true. Actual execution requires REMOTE_RUNTIME_HOSTINGER_SSH_EXECUTOR_ENABLED=true, approval_reason, path allowlist, an expected main or Production commit SHA, bounded output, and never returns secrets.',
    input_schema = '{"type":"object","required":["target_id","app_key","app_path","branch","expected_commit_sha"],"properties":{"target_id":{"type":"string"},"app_key":{"type":"string","enum":["auth.mad4b.com"]},"app_path":{"type":"string"},"branch":{"type":"string","enum":["main","Production"]},"expected_commit_sha":{"type":"string","pattern":"^[0-9a-f]{40}$"},"dry_run":{"type":"boolean","default":true},"force_clean":{"type":"boolean","default":false},"restart":{"type":"boolean","default":true},"approval_reason":{"type":"string","minLength":20},"timeout_ms":{"type":"integer","minimum":1000,"maximum":300000}},"additionalProperties":false}',
    updated_at = CURRENT_TIMESTAMP
WHERE tool_key = 'remote_runtime_hostinger_deploy_release';

UPDATE execution_policies
SET policy_value = JSON_OBJECT(
      'rule','hostinger_ssh_deploy_requires_expected_promoted_sha_approval_and_no_secret_output',
      'target_id','b49fe2ae-5974-11f1-9baf-8e76a7e1749f',
      'app_key','auth.mad4b.com',
      'allowed_paths',JSON_ARRAY('/home/*/domains/auth.mad4b.com/nodejs'),
      'allowed_branches',JSON_ARRAY('main','Production'),
      'requires',JSON_ARRAY('expected_commit_sha','approval_reason','path_allowlist_match','bounded_output','same_cycle_health_readback'),
      'forbidden',JSON_ARRAY('freeform shell','secret response','unbounded logs','deploy without expected sha','provider dispatch enablement','deployment from any branch other than main or Production')
    ),
    notes = 'Hostinger SSH deploy can only run through the governed executor from main or Production with expected SHA, approval, no secret output, bounded logs, and health readback.',
    updated_at = CURRENT_TIMESTAMP
WHERE policy_group = 'remote_runtime_hostinger_deploy_governance'
  AND policy_key = 'hostinger_ssh_deploy_release_guard';

UPDATE runtime_dispatch_certification_registry
SET smoke_strategy = 'dry-run then approved deploy to expected main or Production SHA, bounded log readback, /health and OpenClaude health route readback',
    notes = 'Tool row stays disabled until this route and corrective allowlist migration are deployed and a dry-run/readback smoke passes. Provider dispatch remains disabled.',
    updated_at = CURRENT_TIMESTAMP
WHERE certification_key = 'hostinger_ssh_deploy_release_v1';
