-- Sprint 67: Require capability resolution envelopes for WordPress write/publish execution.
-- Scope: policy/runtime registry only. Runtime enforcement is in wordpressBlogPublishOrchestrator.js.
-- Credential intake and diagnostic routes remain allowed without an envelope because they do not execute WordPress writes.

INSERT INTO platform_runtime_config
  (config_key, config_json, status, note)
VALUES
  ('wordpress_write_capability_envelope_requirement_v1',
   JSON_OBJECT(
     'policy_key','wordpress_write_capability_envelope_requirement_v1',
     'status','active',
     'app_key','wordpress_rest',
     'workflow_key','wordpress_blog_publish_or_recover_credentials_workflow',
     'orchestrator','wordpressBlogPublishOrchestrator.js',
     'requires_envelope_for_operation_intents',JSON_ARRAY('draft','write','create','publish','wordpress_create_post','wordpress_publish'),
     'credential_intake_requires_envelope',false,
     'diagnostics_require_envelope',false,
     'execution_requires_envelope',true,
     'envelope_table','capability_resolution_envelope_ledger',
     'required_envelope_status','ready_for_dispatch',
     'required_dispatch_allowed',true,
     'approval_required_must_be_false',true,
     'blocking_gap_count_must_be_zero',true,
     'expired_envelopes_rejected',true,
     'app_key_must_match','wordpress_rest',
     'tenant_user_match_enforced_when_present',true,
     'accepted_intents_for_publish',JSON_ARRAY('publish','write','create','wordpress_publish','wordpress_create_post'),
     'accepted_intents_for_draft',JSON_ARRAY('draft','write','create','publish','wordpress_create_post'),
     'marks_envelope_referenced_before_write',true,
     'no_execution_without_envelope',true,
     'secrets_included',false
   ),
   'active',
   'WordPress writes require a no-secret capability resolution envelope before execution. Credential intake and diagnostics are excluded.'
  )
ON DUPLICATE KEY UPDATE
  config_json = VALUES(config_json),
  status = VALUES(status),
  note = VALUES(note),
  updated_at = CURRENT_TIMESTAMP;

UPDATE workflows
   SET input_contract_profile = CONCAT(input_contract_profile, '; capability_envelope_id_required_for_write_execution'),
       notes = CONCAT(notes, ' Capability resolution envelope is required before WordPress write/publish execution.'),
       updated_at = CURRENT_TIMESTAMP
 WHERE workflow_key = 'wordpress_blog_publish_or_recover_credentials_workflow'
   AND input_contract_profile NOT LIKE '%capability_envelope_id_required_for_write_execution%';

UPDATE task_routes
   SET required_variable_profile = CONCAT(required_variable_profile, ',capability_envelope_id'),
       notes = CONCAT(notes, ' Runtime execution requires capability_envelope_id; credential intake and diagnostics remain allowed without execution.'),
       updated_at = CURRENT_TIMESTAMP
 WHERE task_key = 'wordpress_blog_publish_or_recover_credentials'
   AND required_variable_profile NOT LIKE '%capability_envelope_id%';
