-- Sprint 67: Require capability resolution envelopes for Hostinger SSH deploy execution.
-- Scope: policy/runtime registry only. Runtime enforcement is in hostingerSshDeployExecutor.js.
-- Dry-run planning and SSH probe/read-only diagnostics remain available without this deploy envelope.

INSERT INTO platform_runtime_config
  (config_key, config_json, status, note)
VALUES
  ('hostinger_deploy_capability_envelope_requirement_v1',
   JSON_OBJECT(
     'policy_key','hostinger_deploy_capability_envelope_requirement_v1',
     'status','active',
     'app_keys',JSON_ARRAY('remote_ssh_runtime','hostinger'),
     'tool_key','remote_runtime_hostinger_deploy_release',
     'command_key','deploy_release',
     'executor','hostingerSshDeployExecutor.js',
     'dry_run_requires_envelope',false,
     'ssh_probe_requires_envelope',false,
     'execution_requires_envelope',true,
     'envelope_table','capability_resolution_envelope_ledger',
     'required_envelope_status','ready_for_dispatch',
     'required_dispatch_allowed',true,
     'approval_required_must_be_false',true,
     'blocking_gap_count_must_be_zero',true,
     'expired_envelopes_rejected',true,
     'tenant_user_match_enforced_when_present',true,
     'accepted_intents_for_deploy',JSON_ARRAY('deploy','restart','write','remote_runtime_deploy','hostinger_ssh_deploy','deploy_release'),
     'accepted_app_keys',JSON_ARRAY('remote_ssh_runtime','hostinger'),
     'marks_envelope_referenced_before_ssh',true,
     'no_ssh_without_envelope',true,
     'feature_flag_still_required','REMOTE_RUNTIME_HOSTINGER_SSH_EXECUTOR_ENABLED',
     'approval_reason_still_required',true,
     'expected_sha_still_required',true,
     'path_allowlist_still_required',true,
     'secrets_included',false
   ),
   'active',
   'Hostinger SSH deploy execution requires a no-secret capability resolution envelope. Dry-run planning and SSH probes are excluded.'
  )
ON DUPLICATE KEY UPDATE
  config_json = VALUES(config_json),
  status = VALUES(status),
  note = VALUES(note),
  updated_at = CURRENT_TIMESTAMP;

UPDATE admin_platform_endpoint_tools
   SET input_schema = JSON_SET(CAST(input_schema AS JSON), '$.properties.capability_envelope_id', JSON_OBJECT('type','string','description','Required for dry_run=false Hostinger SSH deploy execution. Must reference capability_resolution_envelope_ledger ready_for_dispatch envelope.')),
       description = CONCAT(description, ' Actual execution also requires capability_envelope_id from capability_resolution_envelope_ledger.'),
       tags = CONCAT(tags, ',capability_envelope_required'),
       updated_at = CURRENT_TIMESTAMP
 WHERE tool_key = 'remote_runtime_hostinger_deploy_release'
   AND tags NOT LIKE '%capability_envelope_required%';

UPDATE remote_runtime_command_allowlists
   SET input_schema_json = JSON_SET(input_schema_json, '$.properties.capability_envelope_id', JSON_OBJECT('type','string','description','Required for actual deploy execution; not required for dry-run planning.')),
       notes = CONCAT(notes, ' Actual deploy execution requires capability_resolution_envelope_ledger envelope_id with ready_for_dispatch and no blocking gaps.'),
       updated_at = CURRENT_TIMESTAMP
 WHERE plugin_key = 'remote_ssh_runtime'
   AND command_key = 'deploy_release'
   AND notes NOT LIKE '%capability_resolution_envelope_ledger%';

UPDATE execution_policies
   SET policy_value = JSON_SET(
         policy_value,
         '$.requires_envelope_id', true,
         '$.envelope_table', 'capability_resolution_envelope_ledger',
         '$.requires', JSON_ARRAY_APPEND(JSON_EXTRACT(policy_value, '$.requires'), '$', 'capability_envelope_id')
       ),
       notes = CONCAT(notes, ' Capability envelope id is required before SSH deploy execution.'),
       updated_at = CURRENT_TIMESTAMP
 WHERE policy_group = 'remote_runtime_hostinger_deploy_governance'
   AND policy_key = 'hostinger_ssh_deploy_release_guard'
   AND notes NOT LIKE '%Capability envelope id is required%';
