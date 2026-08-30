-- Sprint 69: remaining passive capability-resolution descriptor policy.
-- Scope: additive registry metadata only. This migration does not execute a target
-- capability, call a provider, read credential payloads, return secrets, or grant
-- production promotion.
-- no_provider_call
-- no_credential_payload_read
-- no_raw_secrets
-- no_external_send
-- no_external_write
-- secrets_included=false
--
-- D-001 follow-up: main migration 20260625_repository_mutation_descriptor_policy_recovery.sql
-- governs envelope create/approve and repo_patch descriptors. This migration closes
-- only the remaining passive POST dry-run classification gap.

INSERT INTO platform_runtime_config
  (config_key, config_json, status, note)
VALUES
  ('capability_resolution_dry_run_descriptor_policy_v1',
   JSON_OBJECT(
     'policy_key','capability_resolution_dry_run_descriptor_policy_v1',
     'status','active',
     'finding_key','D-001',
     'tool_key','capability_resolution_dry_run',
     'classification',JSON_ARRAY('preview_only','no_mutation','no_execution'),
     'target_execution_allowed',false,
     'provider_calls_allowed',false,
     'credential_payloads_read',false,
     'secrets_included',false
   ),
   'active',
   'Declares the remaining passive capability-resolution dry-run descriptor without weakening fail-closed mutation policy.'
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
