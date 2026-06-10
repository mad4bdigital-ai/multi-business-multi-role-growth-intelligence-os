-- Sprint 68: Support Ticket lifecycle orchestration readback.
--
-- Registers the Support Ticket lifecycle orchestration graph and read-only
-- readiness view above existing ticket/runtime/approval tables. This slice
-- does not create tickets, mutate workflows, decide approvals, send external
-- notifications, call providers, read credential payloads, change spend,
-- deploy, or publish. It only seeds graph metadata and readback policy.
--
-- Idempotent. Additive/read-only surface only. No secrets.

CREATE OR REPLACE VIEW `v_platform_orchestration_graph_readiness` AS
SELECT
  p.plugin_key,
  p.display_name,
  p.domain_key,
  p.engine_key,
  p.policy_key,
  p.readback_tool_key,
  p.status AS plugin_status,
  COALESCE(sc.stage_count, 0) AS stage_count,
  COALESCE(sc.active_stage_count, 0) AS active_stage_count,
  COALESCE(ec.edge_count, 0) AS edge_count,
  COALESCE(ec.active_edge_count, 0) AS active_edge_count,
  CASE
    WHEN p.plugin_key IN ('ads_provider_governance_orchestrator','support_ticket_lifecycle_orchestrator') THEN 7
    ELSE 1
  END AS expected_stage_count,
  CASE
    WHEN p.plugin_key IN ('ads_provider_governance_orchestrator','support_ticket_lifecycle_orchestrator') THEN 6
    ELSE 0
  END AS expected_edge_count,
  CASE
    WHEN p.status = 'active'
     AND COALESCE(sc.active_stage_count, 0) >= CASE WHEN p.plugin_key IN ('ads_provider_governance_orchestrator','support_ticket_lifecycle_orchestrator') THEN 7 ELSE 1 END
     AND COALESCE(ec.active_edge_count, 0) >= CASE WHEN p.plugin_key IN ('ads_provider_governance_orchestrator','support_ticket_lifecycle_orchestrator') THEN 6 ELSE 0 END
    THEN 'ready_readonly_graph_seeded'
    ELSE 'degraded_graph_incomplete'
  END AS readiness_status,
  JSON_OBJECT(
    'plugin_key', p.plugin_key,
    'stage_count', COALESCE(sc.stage_count, 0),
    'active_stage_count', COALESCE(sc.active_stage_count, 0),
    'edge_count', COALESCE(ec.edge_count, 0),
    'active_edge_count', COALESCE(ec.active_edge_count, 0),
    'readback_tool_key', p.readback_tool_key,
    'no_provider_call', true,
    'no_credential_payload_read', true,
    'no_spend_change', true,
    'no_external_send', true,
    'secrets_included', false
  ) AS evidence_json,
  0 AS secrets_included
FROM `platform_orchestration_plugins` p
LEFT JOIN (
  SELECT plugin_key,
         COUNT(*) AS stage_count,
         SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_stage_count
    FROM `platform_orchestration_stages`
   GROUP BY plugin_key
) sc ON sc.plugin_key = p.plugin_key
LEFT JOIN (
  SELECT plugin_key,
         COUNT(*) AS edge_count,
         SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_edge_count
    FROM `platform_orchestration_edges`
   GROUP BY plugin_key
) ec ON ec.plugin_key = p.plugin_key;

INSERT INTO `platform_orchestration_plugins` (
  `plugin_key`, `display_name`, `domain_key`, `plugin_type`, `owner_scope`, `version`,
  `lifecycle_stage`, `engine_key`, `policy_key`, `readback_tool_key`,
  `manifest_json`, `safety_contract_json`, `status`, `notes`, `secrets_included`
) VALUES (
  'support_ticket_lifecycle_orchestrator',
  'Support Ticket Lifecycle Orchestrator',
  'support_ticket_lifecycle',
  'orchestration_graph',
  'platform_admin',
  'v1',
  'foundation',
  'orchestration_intelligence_engine',
  'orchestration_intelligence_policy_v1',
  'platform_orchestration_readback',
  JSON_OBJECT(
    'domain','support_ticket_lifecycle',
    'graph_version','v1',
    'subject_type','ticket',
    'execution_enabled_default',false,
    'stages',JSON_ARRAY('intake_state','authority_snapshot','lifecycle_timeline','runtime_links','approval_state','diagnostic_remediation','recommendation_candidate')
  ),
  JSON_OBJECT(
    'no_provider_call',true,
    'no_spend_change',true,
    'no_credential_payload_read',true,
    'no_external_send',true,
    'no_external_write',true,
    'no_deploy',true,
    'no_publish',true,
    'recommendation_only',true,
    'secrets_included',false
  ),
  'active',
  'Read-only graph over support ticket lifecycle, timeline, workflow/runtime links, approval state, and diagnostic/remediation readiness.',
  0
) ON DUPLICATE KEY UPDATE
  `display_name`=VALUES(`display_name`),
  `domain_key`=VALUES(`domain_key`),
  `engine_key`=VALUES(`engine_key`),
  `policy_key`=VALUES(`policy_key`),
  `readback_tool_key`=VALUES(`readback_tool_key`),
  `manifest_json`=VALUES(`manifest_json`),
  `safety_contract_json`=VALUES(`safety_contract_json`),
  `status`=VALUES(`status`),
  `notes`=VALUES(`notes`),
  `secrets_included`=0,
  `updated_at`=CURRENT_TIMESTAMP;

INSERT INTO `platform_orchestration_stages` (
  `stage_key`, `plugin_key`, `stage_order`, `display_name`, `stage_type`,
  `required_inputs_json`, `produced_outputs_json`, `required_tables_json`, `required_tools_json`,
  `required_policies_json`, `acceptance_criteria_json`, `safety_contract_json`, `status`, `notes`, `secrets_included`
) VALUES
  ('support_ticket.intake_state','support_ticket_lifecycle_orchestrator',10,'Ticket Intake State','state_readiness',JSON_ARRAY('ticket_id','tenant_id'),JSON_ARRAY('ticket_state'),JSON_ARRAY('tickets'),JSON_ARRAY('support_ticket_admin_get','support_ticket_admin_list'),JSON_ARRAY('support_ticket_lifecycle_orchestration_readback_policy_v1'),JSON_ARRAY('ticket_row_exists_or_scope_listed','status_lifecycle_customer_status_known'),JSON_OBJECT('no_external_send',true,'no_provider_call',true,'secrets_included',false),'active','Reads current ticket lifecycle, customer status, SLA, queue and assignment metadata.',0),
  ('support_ticket.authority_snapshot','support_ticket_lifecycle_orchestrator',20,'Authority Snapshot','authority_readiness',JSON_ARRAY('ticket_state'),JSON_ARRAY('authority_state'),JSON_ARRAY('ticket_permission_snapshots','ticket_resource_links'),JSON_ARRAY('support_ticket_resolve_brand_refs'),JSON_ARRAY('support_ticket_lifecycle_orchestration_readback_policy_v1'),JSON_ARRAY('permission_or_resource_authority_state_known','no_secret_payloads'),JSON_OBJECT('no_credential_payload_read',true,'no_provider_call',true,'secrets_included',false),'active','Reads permission and linked-resource metadata for governed ticket authority.',0),
  ('support_ticket.lifecycle_timeline','support_ticket_lifecycle_orchestrator',30,'Lifecycle Timeline','timeline_readiness',JSON_ARRAY('ticket_state'),JSON_ARRAY('timeline_state'),JSON_ARRAY('ticket_lifecycle_events'),JSON_ARRAY('support_ticket_admin_get'),JSON_ARRAY('support_ticket_lifecycle_orchestration_readback_policy_v1'),JSON_ARRAY('event_timeline_readable','customer_internal_visibility_classified'),JSON_OBJECT('no_external_send',true,'no_external_write',true,'secrets_included',false),'active','Reads lifecycle events only; event creation remains a separate route/tool.',0),
  ('support_ticket.runtime_links','support_ticket_lifecycle_orchestrator',40,'Runtime Links','runtime_readiness',JSON_ARRAY('ticket_state','timeline_state'),JSON_ARRAY('runtime_link_state'),JSON_ARRAY('ticket_workflow_links','execution_plans','workflow_runs','step_runs'),JSON_ARRAY('support_ticket_runtime_sync'),JSON_ARRAY('support_ticket_lifecycle_orchestration_readback_policy_v1'),JSON_ARRAY('plan_run_step_state_known','failed_or_awaiting_runtime_classified'),JSON_OBJECT('no_deploy',true,'no_publish',true,'no_provider_call',true,'secrets_included',false),'active','Reads linked plan/run/step evidence and classifies runtime readiness without dispatch.',0),
  ('support_ticket.approval_state','support_ticket_lifecycle_orchestrator',50,'Approval State','approval_readiness',JSON_ARRAY('runtime_link_state'),JSON_ARRAY('approval_state'),JSON_ARRAY('ticket_workflow_links','approval_holds'),JSON_ARRAY('support_ticket_decide_approval_hold'),JSON_ARRAY('support_ticket_lifecycle_orchestration_readback_policy_v1'),JSON_ARRAY('approval_requirements_known','approval_decision_not_auto_applied'),JSON_OBJECT('approval_required_for_mutation',true,'no_external_write',true,'secrets_included',false),'active','Reads approval hold links and status; does not decide approvals.',0),
  ('support_ticket.diagnostic_remediation','support_ticket_lifecycle_orchestrator',60,'Diagnostic and Remediation State','diagnostic_readiness',JSON_ARRAY('ticket_state','runtime_link_state','approval_state'),JSON_ARRAY('diagnostic_remediation_state'),JSON_ARRAY('ticket_lifecycle_events','ticket_workflow_links','platform_pending_tasks'),JSON_ARRAY('support_ticket_run_diagnostic_chain','support_ticket_auto_resolve_candidates'),JSON_ARRAY('support_ticket_lifecycle_orchestration_readback_policy_v1'),JSON_ARRAY('diagnostic_state_classified','remediation_not_auto_applied'),JSON_OBJECT('recommendation_only',true,'no_external_write',true,'secrets_included',false),'active','Reads diagnostic and remediation evidence into blocker/next-action classification only.',0),
  ('support_ticket.recommendation_candidate','support_ticket_lifecycle_orchestrator',70,'Recommendation Candidate','recommendation_candidate',JSON_ARRAY('ticket_state','authority_state','timeline_state','runtime_link_state','approval_state','diagnostic_remediation_state'),JSON_ARRAY('support_ticket_recommendation_candidate'),JSON_ARRAY('platform_orchestration_recommendations','platform_pending_tasks'),JSON_ARRAY('platform_orchestration_readback'),JSON_ARRAY('recommendation_before_execution_policy_v1','no_hidden_execution_policy_v1'),JSON_ARRAY('candidate_is_recommendation_only','separate_capability_envelope_required_before_any_write'),JSON_OBJECT('provider_execution_allowed',false,'requires_separate_capability_envelope',true,'secrets_included',false),'active','Produces future next-best-action candidates only; execution remains separately gated.',0)
ON DUPLICATE KEY UPDATE
  `plugin_key`=VALUES(`plugin_key`),
  `stage_order`=VALUES(`stage_order`),
  `display_name`=VALUES(`display_name`),
  `stage_type`=VALUES(`stage_type`),
  `required_inputs_json`=VALUES(`required_inputs_json`),
  `produced_outputs_json`=VALUES(`produced_outputs_json`),
  `required_tables_json`=VALUES(`required_tables_json`),
  `required_tools_json`=VALUES(`required_tools_json`),
  `required_policies_json`=VALUES(`required_policies_json`),
  `acceptance_criteria_json`=VALUES(`acceptance_criteria_json`),
  `safety_contract_json`=VALUES(`safety_contract_json`),
  `status`=VALUES(`status`),
  `notes`=VALUES(`notes`),
  `secrets_included`=0,
  `updated_at`=CURRENT_TIMESTAMP;

INSERT INTO `platform_orchestration_edges` (
  `edge_key`, `plugin_key`, `from_stage_key`, `to_stage_key`, `edge_type`,
  `condition_json`, `safety_contract_json`, `status`, `notes`, `secrets_included`
) VALUES
  ('support_ticket.intake_to_authority','support_ticket_lifecycle_orchestrator','support_ticket.intake_state','support_ticket.authority_snapshot','requires_ticket_state',JSON_OBJECT('requires','ticket_state_known'),JSON_OBJECT('no_provider_call',true,'secrets_included',false),'active','Authority/readiness classification starts after ticket state is known.',0),
  ('support_ticket.authority_to_timeline','support_ticket_lifecycle_orchestrator','support_ticket.authority_snapshot','support_ticket.lifecycle_timeline','parallel_or_requires_known',JSON_OBJECT('requires','authority_or_resource_state_known'),JSON_OBJECT('no_external_send',true,'secrets_included',false),'active','Timeline is interpreted with authority/resource context.',0),
  ('support_ticket.timeline_to_runtime','support_ticket_lifecycle_orchestrator','support_ticket.lifecycle_timeline','support_ticket.runtime_links','requires_timeline_state',JSON_OBJECT('requires','timeline_state_known'),JSON_OBJECT('no_deploy',true,'secrets_included',false),'active','Runtime link readiness depends on known lifecycle event state.',0),
  ('support_ticket.runtime_to_approval','support_ticket_lifecycle_orchestrator','support_ticket.runtime_links','support_ticket.approval_state','requires_runtime_state',JSON_OBJECT('requires','runtime_link_state_known'),JSON_OBJECT('approval_required_for_mutation',true,'secrets_included',false),'active','Approval state is classified after runtime links are known.',0),
  ('support_ticket.approval_to_diagnostic','support_ticket_lifecycle_orchestrator','support_ticket.approval_state','support_ticket.diagnostic_remediation','requires_approval_state',JSON_OBJECT('requires','approval_state_known_or_not_required'),JSON_OBJECT('recommendation_only',true,'secrets_included',false),'active','Diagnostic/remediation recommendations account for approval state.',0),
  ('support_ticket.diagnostic_to_recommendation','support_ticket_lifecycle_orchestrator','support_ticket.diagnostic_remediation','support_ticket.recommendation_candidate','recommendation_only',JSON_OBJECT('requires','diagnostic_remediation_state_known','execution_without_envelope','blocked_requires_separate_capability_envelope'),JSON_OBJECT('provider_execution_allowed',false,'requires_separate_capability_envelope',true,'secrets_included',false),'active','Recommendations are produced without executing remediation or external delivery.',0)
ON DUPLICATE KEY UPDATE
  `plugin_key`=VALUES(`plugin_key`),
  `from_stage_key`=VALUES(`from_stage_key`),
  `to_stage_key`=VALUES(`to_stage_key`),
  `edge_type`=VALUES(`edge_type`),
  `condition_json`=VALUES(`condition_json`),
  `safety_contract_json`=VALUES(`safety_contract_json`),
  `status`=VALUES(`status`),
  `notes`=VALUES(`notes`),
  `secrets_included`=0,
  `updated_at`=CURRENT_TIMESTAMP;

CREATE OR REPLACE VIEW `v_platform_orchestration_support_ticket_lifecycle_readiness` AS
SELECT
  'support_ticket_lifecycle_orchestrator' AS plugin_key,
  COALESCE(g.stage_count, 0) AS stage_count,
  COALESCE(g.edge_count, 0) AS edge_count,
  7 AS expected_stage_count,
  6 AS expected_edge_count,
  (SELECT COUNT(*) FROM `tickets`) AS ticket_rows,
  (SELECT COUNT(*) FROM `tickets` WHERE status IN ('open','in_review','awaiting_approval')) AS active_ticket_rows,
  (SELECT COUNT(*) FROM `tickets` WHERE lifecycle_state = 'merged_validation_pending') AS runtime_validation_pending_rows,
  (SELECT COUNT(*) FROM `tickets` WHERE status = 'awaiting_approval' OR lifecycle_state LIKE '%approval%') AS awaiting_approval_rows,
  (SELECT COUNT(*) FROM `ticket_lifecycle_events`) AS lifecycle_event_rows,
  (SELECT COUNT(*) FROM `ticket_workflow_links`) AS workflow_link_rows,
  (SELECT COUNT(*) FROM `execution_plans`) AS execution_plan_rows,
  (SELECT COUNT(*) FROM `workflow_runs`) AS workflow_run_rows,
  (SELECT COUNT(*) FROM `step_runs`) AS step_run_rows,
  (SELECT COUNT(*) FROM `approval_holds`) AS approval_hold_rows,
  CASE
    WHEN COALESCE(g.stage_count, 0) >= 7 AND COALESCE(g.edge_count, 0) >= 6
    THEN 'ready_readonly_support_ticket_lifecycle_graph'
    ELSE 'degraded_support_ticket_lifecycle_graph_incomplete'
  END AS readiness_status,
  JSON_OBJECT(
    'open', (SELECT COUNT(*) FROM `tickets` WHERE status = 'open'),
    'in_review', (SELECT COUNT(*) FROM `tickets` WHERE status = 'in_review'),
    'awaiting_approval', (SELECT COUNT(*) FROM `tickets` WHERE status = 'awaiting_approval'),
    'resolved', (SELECT COUNT(*) FROM `tickets` WHERE status = 'resolved'),
    'closed', (SELECT COUNT(*) FROM `tickets` WHERE status = 'closed'),
    'runtime_validation_pending', (SELECT COUNT(*) FROM `tickets` WHERE lifecycle_state = 'merged_validation_pending')
  ) AS state_distribution_json,
  JSON_OBJECT(
    'plugin_key','support_ticket_lifecycle_orchestrator',
    'stage_count', COALESCE(g.stage_count, 0),
    'edge_count', COALESCE(g.edge_count, 0),
    'readback_tool_key','platform_orchestration_readback',
    'no_provider_call', true,
    'no_credential_payload_read', true,
    'no_spend_change', true,
    'no_external_send', true,
    'no_external_write', true,
    'no_deploy', true,
    'no_publish', true,
    'secrets_included', false
  ) AS safety_json,
  JSON_OBJECT(
    'tables', JSON_ARRAY('tickets','ticket_lifecycle_events','ticket_workflow_links','ticket_resource_links','ticket_permission_snapshots','execution_plans','workflow_runs','step_runs','approval_holds','platform_pending_tasks'),
    'mode','read_only',
    'snapshot_recording_enabled_by_this_migration', false,
    'recommendation_recording_enabled_by_this_migration', false,
    'secrets_included', false
  ) AS evidence_json,
  0 AS secrets_included
FROM (
  SELECT stage_count, edge_count
    FROM `v_platform_orchestration_graph_readiness`
   WHERE plugin_key = 'support_ticket_lifecycle_orchestrator'
   LIMIT 1
) g;

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`,
  `execution_scope`, `affects_layer`, `blocking`, `notes`
)
SELECT 'Orchestration Intelligence Governance', 'support_ticket_lifecycle_orchestration_readback_policy_v1',
       JSON_OBJECT(
         'rule','support_ticket_lifecycle_orchestration_readback_read_only',
         'plugin_key','support_ticket_lifecycle_orchestrator',
         'readback_tool_key','platform_orchestration_readback',
         'views',JSON_ARRAY('v_platform_orchestration_graph_readiness','v_platform_orchestration_support_ticket_lifecycle_readiness'),
         'input_tables',JSON_ARRAY('tickets','ticket_lifecycle_events','ticket_workflow_links','ticket_resource_links','ticket_permission_snapshots','execution_plans','workflow_runs','step_runs','approval_holds','platform_pending_tasks'),
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
       'support_ticket_lifecycle|orchestration_readback|ticket_readiness|runtime_link_readiness',
       'supportTicketLifecycleOrchestrationReadback|platformOrchestrationReadback|platform_orchestration_stages|tickets|ticket_lifecycle_events',
       'TRUE',
       'Read-only Support Ticket lifecycle orchestration readback. No ticket mutation, external send, provider call, or credential payload read is performed.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group`='Orchestration Intelligence Governance'
     AND `policy_key`='support_ticket_lifecycle_orchestration_readback_policy_v1'
);
