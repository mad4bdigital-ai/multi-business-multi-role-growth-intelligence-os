-- Sprint 68: Support Ticket lifecycle snapshot apply binding.
--
-- Registry-only binding that lets the existing dynamic capability apply
-- authorization gate authorize Support Ticket lifecycle snapshot/recommendation
-- recording. This does not record snapshots by itself.
--
-- No ticket mutation, no workflow dispatch, no approval decision, no external
-- send/write, no provider call, no credential payload read, no spend change,
-- no deploy/publish, and no secrets.

INSERT INTO `app_integration_action_bindings` (
  `binding_id`, `app_key`, `action_key`, `binding_role`, `credential_source`,
  `exposure_default`, `status`, `notes`
) VALUES
  ('bind_action_support_ticket_lifecycle_snapshot_propose', 'platform_orchestration', 'support_ticket_lifecycle_snapshot_propose', 'resolver', 'none', 'manual_tools', 'active', 'No-credential proposal-only Support Ticket lifecycle snapshot/recommendation candidate surface.'),
  ('bind_action_support_ticket_lifecycle_snapshot_record', 'platform_orchestration', 'support_ticket_lifecycle_snapshot_record', 'resolver', 'none', 'manual_tools', 'active', 'No-credential gated Support Ticket lifecycle snapshot/recommendation record surface. Requires proposal hash, idempotency key, ready capability envelope, apply authorization, and apply=true before DB write.')
ON DUPLICATE KEY UPDATE
  `app_key` = VALUES(`app_key`),
  `action_key` = VALUES(`action_key`),
  `binding_role` = VALUES(`binding_role`),
  `credential_source` = VALUES(`credential_source`),
  `exposure_default` = VALUES(`exposure_default`),
  `status` = VALUES(`status`),
  `notes` = VALUES(`notes`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `app_integration_tool_bindings` (
  `binding_id`, `app_key`, `tool_key`, `tool_surface`, `binding_role`,
  `credential_source`, `exposure_scope`, `status`, `notes`
) VALUES
  ('bind_tool_support_ticket_lifecycle_snapshot_propose', 'platform_orchestration', 'support_ticket_lifecycle_snapshot_propose', 'admin_platform_tool', 'read_only', 'none', 'admin', 'active', 'Proposal-only Support Ticket lifecycle snapshot/recommendation candidate tool.'),
  ('bind_tool_support_ticket_lifecycle_snapshot_record', 'platform_orchestration', 'support_ticket_lifecycle_snapshot_record', 'admin_platform_tool', 'state_changing', 'none', 'admin', 'active', 'Gated state-changing snapshot/recommendation record tool. Writes only orchestration snapshot/recommendation rows; no ticket mutation, workflow dispatch, provider calls, credential payload reads, external send, spend changes, or secrets.')
ON DUPLICATE KEY UPDATE
  `app_key` = VALUES(`app_key`),
  `tool_key` = VALUES(`tool_key`),
  `tool_surface` = VALUES(`tool_surface`),
  `binding_role` = VALUES(`binding_role`),
  `credential_source` = VALUES(`credential_source`),
  `exposure_scope` = VALUES(`exposure_scope`),
  `status` = VALUES(`status`),
  `notes` = VALUES(`notes`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `capability_apply_authorization_policy_registry` (
  `policy_key`, `app_key`, `capability_key`, `operation_intent`, `runtime_surface`,
  `status`, `allow_external_write`, `allow_credential_binding`, `allow_no_credential_binding`,
  `requires_ready_for_dispatch`, `requires_dispatch_allowed`, `requires_zero_blocking_gaps`,
  `requires_audit_evidence`, `requires_readback`, `requires_typed_confirmation`,
  `requires_same_cycle_dry_run`, `allowed_source_tiers_json`, `policy_json`, `notes`
) VALUES (
  'support_ticket_lifecycle_snapshot_record_apply_v1',
  'platform_orchestration',
  'support_ticket_lifecycle_snapshot_record',
  'support_ticket_lifecycle_snapshot_record',
  'support_ticket_lifecycle_snapshot_record',
  'active',
  0,
  0,
  1,
  1,
  1,
  1,
  1,
  1,
  0,
  0,
  JSON_ARRAY('platform_managed_fallback'),
  JSON_OBJECT(
    'rule','support_ticket_lifecycle_snapshot_record_apply_authorization',
    'writes_tables',JSON_ARRAY('platform_orchestration_state_snapshots','platform_orchestration_recommendations'),
    'requires',JSON_ARRAY('ready_for_dispatch','dispatch_allowed','zero_blocking_gaps','no_credential_binding','apply_allowed_before_write','proposal_hash_match','idempotency_key'),
    'no_ticket_mutation',true,
    'no_workflow_dispatch',true,
    'no_approval_decision',true,
    'no_external_write',true,
    'no_external_send',true,
    'no_provider_call',true,
    'no_credential_payload_read',true,
    'no_spend_change',true,
    'no_deploy',true,
    'no_publish',true,
    'secrets_included',false
  ),
  'Internal no-credential Support Ticket lifecycle snapshot/recommendation record apply authorization policy. Allows only orchestration snapshot/recommendation DB writes after same-cycle proposal verification and ready capability envelope.'
) ON DUPLICATE KEY UPDATE
  `app_key` = VALUES(`app_key`),
  `capability_key` = VALUES(`capability_key`),
  `operation_intent` = VALUES(`operation_intent`),
  `runtime_surface` = VALUES(`runtime_surface`),
  `status` = VALUES(`status`),
  `allow_external_write` = VALUES(`allow_external_write`),
  `allow_credential_binding` = VALUES(`allow_credential_binding`),
  `allow_no_credential_binding` = VALUES(`allow_no_credential_binding`),
  `requires_ready_for_dispatch` = VALUES(`requires_ready_for_dispatch`),
  `requires_dispatch_allowed` = VALUES(`requires_dispatch_allowed`),
  `requires_zero_blocking_gaps` = VALUES(`requires_zero_blocking_gaps`),
  `requires_audit_evidence` = VALUES(`requires_audit_evidence`),
  `requires_readback` = VALUES(`requires_readback`),
  `requires_typed_confirmation` = VALUES(`requires_typed_confirmation`),
  `requires_same_cycle_dry_run` = VALUES(`requires_same_cycle_dry_run`),
  `allowed_source_tiers_json` = VALUES(`allowed_source_tiers_json`),
  `policy_json` = VALUES(`policy_json`),
  `notes` = VALUES(`notes`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`,
  `execution_scope`, `affects_layer`, `blocking`, `notes`
)
SELECT 'Orchestration Intelligence Governance', 'support_ticket_lifecycle_snapshot_apply_binding_policy_v1',
       JSON_OBJECT(
         'rule','support_ticket_lifecycle_snapshot_apply_binding',
         'app_key','platform_orchestration',
         'capability_key','support_ticket_lifecycle_snapshot_record',
         'apply_policy_key','support_ticket_lifecycle_snapshot_record_apply_v1',
         'credential_source','none',
         'no_ticket_mutation',true,
         'no_workflow_dispatch',true,
         'no_approval_decision',true,
         'no_external_write',true,
         'no_external_send',true,
         'no_provider_call',true,
         'no_credential_payload_read',true,
         'secrets_included',false
       ),
       'TRUE',
       'support_ticket_lifecycle|snapshot_record|apply_authorization|platform_orchestration|no_credential',
       'capability_apply_authorization_policy_registry|app_integration_action_bindings|app_integration_tool_bindings|supportTicketLifecycleSnapshotRecord',
       'TRUE',
       'Registry-only Support Ticket lifecycle snapshot record apply authorization binding. Allows apply authorization for orchestration snapshot/recommendation writes only.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group`='Orchestration Intelligence Governance'
     AND `policy_key`='support_ticket_lifecycle_snapshot_apply_binding_policy_v1'
);
