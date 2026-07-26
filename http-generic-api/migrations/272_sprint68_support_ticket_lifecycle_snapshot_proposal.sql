-- Sprint 68: Support Ticket lifecycle snapshot proposal surface.
--
-- Registers a proposal-only route/tool that derives a snapshot_candidate and
-- recommendation_candidate from existing Support Ticket lifecycle, runtime,
-- approval, pending-task, and orchestration readback metadata. It does not
-- write platform_orchestration_state_snapshots or platform_orchestration_recommendations yet.
--
-- Idempotent. No ticket mutation, no workflow dispatch, no approval decision,
-- no provider calls, no credential payload reads, no external send/write,
-- no spend changes, no deploy/publish, and no secrets.

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`,
  `execution_scope`, `affects_layer`, `blocking`, `notes`
)
SELECT 'Orchestration Intelligence Governance', 'support_ticket_lifecycle_snapshot_proposal_policy_v1',
       JSON_OBJECT(
         'rule','support_ticket_lifecycle_snapshot_proposal_only',
         'route','/platform/orchestration/support-ticket/snapshot-propose',
         'tool_key','support_ticket_lifecycle_snapshot_propose',
         'writes_database',false,
         'produces',JSON_ARRAY('snapshot_candidate','recommendation_candidate'),
         'requires_ticket_id',true,
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
       'support_ticket_lifecycle|orchestration_intelligence|snapshot_proposal|recommendation_proposal|ticket_readiness',
       'supportTicketLifecycleSnapshotProposal|platformPluginRoutes|admin_platform_endpoint_tools|tickets|ticket_lifecycle_events|ticket_workflow_links|platform_orchestration_*',
       'TRUE',
       'Proposal-only Support Ticket lifecycle snapshot/recommendation surface. No persistence, ticket mutation, workflow dispatch, approval decision, external send, provider call, or credential payload read is performed.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group`='Orchestration Intelligence Governance'
     AND `policy_key`='support_ticket_lifecycle_snapshot_proposal_policy_v1'
);

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES (
  'support_ticket_lifecycle_snapshot_propose',
  'Support Ticket Lifecycle Snapshot Propose',
  'Proposal-only snapshot and recommendation candidate generator for Support Ticket lifecycle orchestration. Requires ticket_id and derives metadata from ticket lifecycle, workflow/runtime, approval, pending-task, and orchestration readback tables. Does not write snapshots or recommendations, mutate tickets, dispatch workflows, decide approvals, send external notifications, call providers, read credential payloads, deploy, publish, or return secrets.',
  'POST',
  '/platform/orchestration/support-ticket/snapshot-propose',
  NULL,
  JSON_OBJECT(
    'type','object',
    'required',JSON_ARRAY('ticket_id'),
    'properties',JSON_OBJECT(
      'ticket_id',JSON_OBJECT('type','string','minLength',1,'maxLength',128)
    ),
    'additionalProperties',false
  ),
  NULL,
  'admin,orchestration_intelligence,support_ticket_lifecycle,snapshot_proposal,recommendation_proposal,read_only,no_execution,no_secrets,no_ticket_mutation,no_workflow_dispatch,no_external_send,no_provider_call',
  1,
  642
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
