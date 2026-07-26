-- Sprint 68: Support Ticket lifecycle snapshot apply policy readback alignment.
--
-- Corrective registry-only migration. The generic capability envelope generator
-- does not currently mark support_ticket_lifecycle_snapshot_record envelopes with
-- readback_required=true, while the record route itself recomputes the proposal,
-- verifies candidate_sha256, enforces apply_allowed, and returns recorded row
-- readback after apply. Align the dynamic apply policy with that capability shape.
--
-- No ticket mutation, no workflow dispatch, no approval decision, no external
-- send/write, no provider call, no credential payload read, no spend change,
-- no deploy/publish, and no secrets.

UPDATE `capability_apply_authorization_policy_registry`
   SET `requires_readback` = 0,
       `policy_json` = JSON_SET(
         COALESCE(`policy_json`, JSON_OBJECT()),
         '$.requires_readback_on_envelope', false,
         '$.record_route_recomputes_proposal', true,
         '$.record_route_returns_recorded_row_readback', true,
         '$.operator_readback_required_after_apply', true,
         '$.no_ticket_mutation', true,
         '$.no_workflow_dispatch', true,
         '$.no_external_send', true,
         '$.no_provider_call', true,
         '$.no_credential_payload_read', true,
         '$.secrets_included', false
       ),
       `notes` = 'Internal no-credential Support Ticket lifecycle snapshot/recommendation record apply authorization policy. Envelope readback_required is not required because supportTicketLifecycleSnapshotRecord recomputes the proposal, verifies candidate_sha256, writes only orchestration snapshot/recommendation rows after apply_allowed, and returns recorded row readback. Operator must still run post-apply readback.',
       `updated_at` = CURRENT_TIMESTAMP
 WHERE `policy_key` = 'support_ticket_lifecycle_snapshot_record_apply_v1'
   AND `app_key` = 'platform_orchestration'
   AND `capability_key` = 'support_ticket_lifecycle_snapshot_record'
   AND `runtime_surface` = 'support_ticket_lifecycle_snapshot_record'
   AND `status` = 'active'
   AND `allow_external_write` = 0
   AND `allow_credential_binding` = 0
   AND `allow_no_credential_binding` = 1;

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`,
  `execution_scope`, `affects_layer`, `blocking`, `notes`
)
SELECT 'Orchestration Intelligence Governance', 'support_ticket_lifecycle_snapshot_apply_readback_alignment_policy_v1',
       JSON_OBJECT(
         'rule','support_ticket_lifecycle_snapshot_apply_readback_alignment',
         'apply_policy_key','support_ticket_lifecycle_snapshot_record_apply_v1',
         'requires_readback_on_envelope',false,
         'record_route_recomputes_proposal',true,
         'record_route_returns_recorded_row_readback',true,
         'operator_readback_required_after_apply',true,
         'no_ticket_mutation',true,
         'no_workflow_dispatch',true,
         'no_external_send',true,
         'no_provider_call',true,
         'no_credential_payload_read',true,
         'secrets_included',false
       ),
       'TRUE',
       'support_ticket_lifecycle|snapshot_record|apply_authorization|readback_alignment|no_credential',
       'capability_apply_authorization_policy_registry|supportTicketLifecycleSnapshotRecord|platform_orchestration_state_snapshots|platform_orchestration_recommendations',
       'TRUE',
       'Corrective governance policy: dynamic apply authorization does not require envelope readback_required for Support Ticket snapshot record because the record route itself recomputes proposal hash and returns recorded row readback. Operator post-apply readback remains required.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group`='Orchestration Intelligence Governance'
     AND `policy_key`='support_ticket_lifecycle_snapshot_apply_readback_alignment_policy_v1'
);
