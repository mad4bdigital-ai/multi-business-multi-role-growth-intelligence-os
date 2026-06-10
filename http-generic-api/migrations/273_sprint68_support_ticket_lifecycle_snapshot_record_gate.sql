-- Sprint 68: Support Ticket lifecycle snapshot record gate.
--
-- Registers a gated persistence route for recording a recomputed Support Ticket
-- lifecycle proposal into platform_orchestration_state_snapshots and
-- platform_orchestration_recommendations.
-- Runtime must require ticket_id, candidate_sha256, idempotency_key,
-- capability_envelope_id, and apply=true before writing. The route recomputes
-- the proposal before insert and requires an apply-allowed capability envelope.
--
-- Idempotent registry/policy migration only. No destructive SQL. No ticket
-- mutation, no workflow dispatch, no approval decision, no external send/write,
-- no provider calls, no credential payload reads, no spend changes,
-- no deploy/publish, and no secrets.

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`,
  `execution_scope`, `affects_layer`, `blocking`, `notes`
)
SELECT 'Orchestration Intelligence Governance', 'support_ticket_lifecycle_snapshot_record_gate_policy_v1',
       JSON_OBJECT(
         'rule','support_ticket_lifecycle_snapshot_record_gate',
         'route','/platform/orchestration/support-ticket/snapshot-record',
         'tool_key','support_ticket_lifecycle_snapshot_record',
         'requires',JSON_ARRAY('ticket_id','candidate_sha256','idempotency_key','capability_envelope_id','apply_true','apply_allowed_envelope','proposal_recomputed_same_cycle'),
         'writes_tables',JSON_ARRAY('platform_orchestration_state_snapshots','platform_orchestration_recommendations'),
         'idempotent_by','idempotency_key',
         'default_mode','record_dry_run',
         'no_ticket_mutation',true,
         'no_workflow_dispatch',true,
         'no_approval_decision',true,
         'no_provider_call',true,
         'no_spend_change',true,
         'no_credential_payload_read',true,
         'no_external_send',true,
         'no_external_write',true,
         'no_deploy',true,
         'no_publish',true,
         'secrets_included',false
       ),
       'TRUE',
       'support_ticket_lifecycle|orchestration_intelligence|snapshot_record|recommendation_record|gated_write',
       'supportTicketLifecycleSnapshotRecord|platformPluginRoutes|admin_platform_endpoint_tools|platform_orchestration_state_snapshots|platform_orchestration_recommendations',
       'TRUE',
       'Gated Support Ticket lifecycle snapshot/recommendation record route. Writes only after same-cycle proposal hash verification and apply-allowed capability envelope. No ticket mutation, workflow dispatch, approval decision, external send, provider call, or credential payload read.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group`='Orchestration Intelligence Governance'
     AND `policy_key`='support_ticket_lifecycle_snapshot_record_gate_policy_v1'
);

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES (
  'support_ticket_lifecycle_snapshot_record',
  'Support Ticket Lifecycle Snapshot Record',
  'Gated persistence route for Support Ticket lifecycle snapshot/recommendation candidates. Recomputes proposal and verifies candidate_sha256 before recording. Requires ticket_id, idempotency_key, capability_envelope_id, and apply=true. Writes only to platform_orchestration_state_snapshots and platform_orchestration_recommendations. Does not mutate tickets, dispatch workflows, decide approvals, send external notifications, call providers, read credential payloads, deploy, publish, or return secrets.',
  'POST',
  '/platform/orchestration/support-ticket/snapshot-record',
  NULL,
  JSON_OBJECT(
    'type','object',
    'required',JSON_ARRAY('ticket_id','candidate_sha256','idempotency_key','capability_envelope_id'),
    'properties',JSON_OBJECT(
      'ticket_id',JSON_OBJECT('type','string','minLength',1,'maxLength',128),
      'candidate_sha256',JSON_OBJECT('type','string','minLength',64,'maxLength',64),
      'idempotency_key',JSON_OBJECT('type','string','minLength',3,'maxLength',80),
      'capability_envelope_id',JSON_OBJECT('type','string','minLength',36,'maxLength',36),
      'apply',JSON_OBJECT('type','boolean','default',false)
    ),
    'additionalProperties',false
  ),
  NULL,
  'admin,orchestration_intelligence,support_ticket_lifecycle,snapshot_record,recommendation_record,gated_write,no_ticket_mutation,no_workflow_dispatch,no_external_send,no_provider_call,no_secrets',
  1,
  643
) ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `description` = VALUES(`description`),
  `http_method` = VALUES(`http_method`),
  `http_path` = VALUES(`http_path`),
  `path_param_keys` = VALUES(`path_param_keys`),
  `input_schema` = VALUES(`input_schema`),
  `fixed_body` = VALUES(`fixed_body`),
  `tags` = VALUES(`tags`),
  `is_enabled` = VALUES(`is_enabled`),
  `sort_order` = VALUES(`sort_order`),
  `updated_at` = CURRENT_TIMESTAMP;
