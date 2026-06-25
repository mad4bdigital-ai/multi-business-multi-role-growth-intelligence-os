-- Sprint 69: Capability envelope bootstrap mutation-policy declaration.
-- Scope: registry metadata only. This migration does not execute a target
-- capability, call a provider, return secrets, or grant production promotion.
--
-- D-001: Phase 0 fail-closed mutation classification correctly blocked POST
-- tools whose registry descriptors did not explicitly distinguish passive
-- dry-runs from authority-record mutations.

INSERT INTO platform_runtime_config
  (config_key, config_json, status, note)
VALUES
  ('capability_envelope_bootstrap_mutation_policy_v1',
   JSON_OBJECT(
     'policy_key','capability_envelope_bootstrap_mutation_policy_v1',
     'status','active',
     'finding_key','D-001',
     'dry_run_tool_key','capability_resolution_dry_run',
     'authority_record_mutation_tools',JSON_ARRAY(
       'capability_resolution_envelope_create',
       'capability_resolution_envelope_approve'
     ),
     'dry_run_classification',JSON_ARRAY('preview_only','no_mutation','no_execution'),
     'mutation_policy_declaration',JSON_ARRAY(
       'mutation','capability_envelope','readback'
     ),
     'approval_mutation_policy_declaration',JSON_ARRAY(
       'mutation','capability_envelope','approval_required','readback'
     ),
     'target_execution_allowed',false,
     'provider_calls_allowed',false,
     'secrets_included',false
   ),
   'active',
   'Declares fail-closed mutation-policy metadata for capability envelope bootstrap tools without executing target capabilities.'
  )
ON DUPLICATE KEY UPDATE
  config_json = VALUES(config_json),
  status = VALUES(status),
  note = VALUES(note),
  updated_at = CURRENT_TIMESTAMP;

UPDATE admin_platform_endpoint_tools
   SET tags = 'admin,capability_resolution,dry_run,preview_only,no_mutation,no_execution,no_secrets,authority_graph,managed_dedicated_dynamic,workspace,brand,activity,credential,runtime',
       updated_at = CURRENT_TIMESTAMP
 WHERE tool_key = 'capability_resolution_dry_run';

UPDATE admin_platform_endpoint_tools
   SET tags = 'admin,capability_resolution,envelope_ledger,mutation,capability_envelope,readback,no_execution,no_secrets,authority_graph,immutable_reference,managed_dedicated_dynamic',
       updated_at = CURRENT_TIMESTAMP
 WHERE tool_key = 'capability_resolution_envelope_create';

UPDATE admin_platform_endpoint_tools
   SET tags = 'admin,capability_resolution,envelope_approval,mutation,capability_envelope,approval_required,readback,no_execution,no_secrets,approval_holds,authority_graph,managed_dedicated_dynamic',
       updated_at = CURRENT_TIMESTAMP
 WHERE tool_key = 'capability_resolution_envelope_approve';
