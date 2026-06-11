-- Sprint 68: External Delivery no-send orchestration graph plugin
-- Purpose:
--   Registers the Support Ticket External Delivery orchestration graph as a read-only/no-send
--   orchestration plugin over the existing support ticket external-delivery tools and generic
--   support-ticket/approval/credential reference surfaces.
-- Safety:
--   Idempotent metadata/readback migration. No provider calls. No external send. No secrets.

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
    WHEN p.plugin_key IN ('ads_provider_governance_orchestrator','support_ticket_lifecycle_orchestrator','support_ticket_external_delivery_orchestrator') THEN 7
    ELSE 1
  END AS expected_stage_count,
  CASE
    WHEN p.plugin_key IN ('ads_provider_governance_orchestrator','support_ticket_lifecycle_orchestrator','support_ticket_external_delivery_orchestrator') THEN 6
    ELSE 0
  END AS expected_edge_count,
  CASE
    WHEN p.status = 'active'
     AND COALESCE(sc.active_stage_count, 0) >= CASE WHEN p.plugin_key IN ('ads_provider_governance_orchestrator','support_ticket_lifecycle_orchestrator','support_ticket_external_delivery_orchestrator') THEN 7 ELSE 1 END
     AND COALESCE(ec.active_edge_count, 0) >= CASE WHEN p.plugin_key IN ('ads_provider_governance_orchestrator','support_ticket_lifecycle_orchestrator','support_ticket_external_delivery_orchestrator') THEN 6 ELSE 0 END
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
  'support_ticket_external_delivery_orchestrator',
  'Support Ticket External Delivery Orchestrator',
  'support_ticket_external_delivery',
  'orchestration_graph',
  'platform_admin',
  'v1',
  'foundation_no_send',
  'orchestration_intelligence_engine',
  'support_ticket_external_delivery_orchestration_readback_policy_v1',
  'platform_orchestration_readback',
  JSON_OBJECT(
    'domain','support_ticket_external_delivery',
    'graph_version','v1',
    'subject_type','ticket_external_delivery',
    'execution_enabled_default',false,
    'external_send_enabled_default',false,
    'stages',JSON_ARRAY('delivery_readiness','approval_policy','credential_candidates','credential_binding','provider_gate','execution_plan_record','completion_certification')
  ),
  JSON_OBJECT(
    'no_provider_call',true,
    'no_spend_change',true,
    'no_credential_payload_read',true,
    'no_raw_secrets',true,
    'no_external_send',true,
    'no_external_write',true,
    'provider_dispatch_disabled',true,
    'recommendation_only',true,
    'secrets_included',false
  ),
  'active',
  'Read-only/no-send graph over support ticket external delivery readiness, approval, credential references, provider gate, execution plan record, and completion certification surfaces.',
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
  ('support_ticket_external.delivery_readiness','support_ticket_external_delivery_orchestrator',10,'External Delivery Readiness','readiness_readback',JSON_ARRAY('ticket_id','tenant_id'),JSON_ARRAY('external_delivery_readiness_state'),JSON_ARRAY('tickets','ticket_lifecycle_events'),JSON_ARRAY('support_ticket_external_delivery_readiness'),JSON_ARRAY('support_ticket_external_delivery_orchestration_readback_policy_v1'),JSON_ARRAY('ticket_exists','delivery_readiness_is_classified','no_external_send'),JSON_OBJECT('no_external_send',true,'no_provider_call',true,'secrets_included',false),'active','Reads external delivery readiness and customer-update state without sending.',0),
  ('support_ticket_external.approval_policy','support_ticket_external_delivery_orchestrator',20,'External Delivery Approval Policy','approval_readback',JSON_ARRAY('external_delivery_readiness_state'),JSON_ARRAY('external_delivery_approval_state'),JSON_ARRAY('tickets','approval_holds','ticket_lifecycle_events'),JSON_ARRAY('support_ticket_external_delivery_approval_request','support_ticket_external_delivery_approval_decision'),JSON_ARRAY('support_ticket_external_delivery_orchestration_readback_policy_v1'),JSON_ARRAY('approval_policy_known','approval_decision_not_auto_applied','no_external_send'),JSON_OBJECT('approval_required_for_external_send',true,'no_external_send',true,'secrets_included',false),'active','Classifies approval request/decision surfaces for external delivery; does not decide or send.',0),
  ('support_ticket_external.credential_candidates','support_ticket_external_delivery_orchestrator',30,'External Credential Candidates','credential_readback',JSON_ARRAY('external_delivery_approval_state'),JSON_ARRAY('credential_candidate_state'),JSON_ARRAY('secret_references','api_credentials','connected_systems','user_app_connections'),JSON_ARRAY('support_ticket_external_credential_candidates','support_ticket_external_secret_intake_plan'),JSON_ARRAY('support_ticket_external_delivery_orchestration_readback_policy_v1'),JSON_ARRAY('credential_candidates_listable','raw_secret_payloads_not_read'),JSON_OBJECT('no_raw_secrets',true,'no_credential_payload_read',true,'no_external_send',true,'secrets_included',false),'active','Reads credential candidate metadata only; never reads raw secret payloads.',0),
  ('support_ticket_external.credential_binding','support_ticket_external_delivery_orchestrator',40,'External Credential Binding','credential_binding_readback',JSON_ARRAY('credential_candidate_state'),JSON_ARRAY('credential_binding_state'),JSON_ARRAY('approval_holds','secret_references','api_credentials','ticket_lifecycle_events'),JSON_ARRAY('support_ticket_external_credential_binding_request','support_ticket_external_credential_binding_decision','support_ticket_external_credential_activate_and_bind'),JSON_ARRAY('support_ticket_external_delivery_orchestration_readback_policy_v1'),JSON_ARRAY('credential_binding_requires_approved_hold','validated_reference_only','no_raw_secret_payloads'),JSON_OBJECT('approved_hold_required',true,'validated_only',true,'no_raw_secrets',true,'no_external_send',true,'secrets_included',false),'active','Reads/binds only governed credential references when separately approved; graph itself performs no binding.',0),
  ('support_ticket_external.provider_gate','support_ticket_external_delivery_orchestrator',50,'External Provider Gate','provider_gate_readback',JSON_ARRAY('credential_binding_state'),JSON_ARRAY('provider_gate_state'),JSON_ARRAY('admin_platform_endpoint_tools','execution_policies','rate_limit_rules'),JSON_ARRAY('support_ticket_external_send_provider_gate_plan','support_ticket_external_send_provider_gate_attempt','support_ticket_external_provider_contracts'),JSON_ARRAY('support_ticket_external_delivery_orchestration_readback_policy_v1'),JSON_ARRAY('provider_gate_classified','adapter_contract_registry_checked','external_send_remains_disabled'),JSON_OBJECT('provider_dispatch_disabled',true,'no_external_send',true,'secrets_included',false),'active','Classifies provider dispatch gate and adapter contracts without enabling send.',0),
  ('support_ticket_external.execution_plan_record','support_ticket_external_delivery_orchestrator',60,'External Send Execution Plan Record','execution_plan_record',JSON_ARRAY('provider_gate_state'),JSON_ARRAY('external_send_plan_record_state'),JSON_ARRAY('execution_plans','workflow_runs','step_runs','ticket_lifecycle_events'),JSON_ARRAY('support_ticket_external_send_execution_plan','support_ticket_external_send_execution_record'),JSON_ARRAY('support_ticket_external_delivery_orchestration_readback_policy_v1'),JSON_ARRAY('dry_run_or_record_only','no_external_send_performed','rate_limit_policy_known'),JSON_OBJECT('record_only',true,'approval_required',true,'no_external_send',true,'secrets_included',false),'active','Records/reads dry-run or record-only execution planning; does not send externally.',0),
  ('support_ticket_external.completion_certification','support_ticket_external_delivery_orchestrator',70,'External Delivery Completion Certification','completion_certification',JSON_ARRAY('external_send_plan_record_state'),JSON_ARRAY('external_delivery_completion_certification_state'),JSON_ARRAY('tickets','ticket_lifecycle_events','execution_plans','workflow_runs','step_runs'),JSON_ARRAY('support_ticket_external_delivery_completion_certify'),JSON_ARRAY('support_ticket_external_delivery_orchestration_readback_policy_v1'),JSON_ARRAY('completion_certified_no_send','external_send_performed_false','live_external_send_disabled'),JSON_OBJECT('no_external_send',true,'live_external_send_enabled',false,'secrets_included',false),'active','Certifies external delivery completion readiness under no-send/sandbox conditions.',0)
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
  ('support_ticket_external.readiness_to_approval','support_ticket_external_delivery_orchestrator','support_ticket_external.delivery_readiness','support_ticket_external.approval_policy','requires_delivery_readiness',JSON_OBJECT('requires','external_delivery_readiness_state_known'),JSON_OBJECT('no_external_send',true,'secrets_included',false),'active','Approval policy is classified after external delivery readiness is known.',0),
  ('support_ticket_external.approval_to_credential_candidates','support_ticket_external_delivery_orchestrator','support_ticket_external.approval_policy','support_ticket_external.credential_candidates','requires_approval_policy',JSON_OBJECT('requires','approval_state_known_or_not_required'),JSON_OBJECT('no_raw_secrets',true,'no_external_send',true,'secrets_included',false),'active','Credential candidates are considered only after approval policy is known.',0),
  ('support_ticket_external.candidates_to_binding','support_ticket_external_delivery_orchestrator','support_ticket_external.credential_candidates','support_ticket_external.credential_binding','requires_candidate_metadata',JSON_OBJECT('requires','credential_candidate_state_known'),JSON_OBJECT('approved_hold_required',true,'no_raw_secrets',true,'no_external_send',true,'secrets_included',false),'active','Credential binding remains a separately approved reference operation.',0),
  ('support_ticket_external.binding_to_provider_gate','support_ticket_external_delivery_orchestrator','support_ticket_external.credential_binding','support_ticket_external.provider_gate','requires_binding_state',JSON_OBJECT('requires','credential_binding_state_known'),JSON_OBJECT('provider_dispatch_disabled',true,'no_external_send',true,'secrets_included',false),'active','Provider gate classification depends on credential binding/reference readiness.',0),
  ('support_ticket_external.provider_gate_to_plan','support_ticket_external_delivery_orchestrator','support_ticket_external.provider_gate','support_ticket_external.execution_plan_record','requires_provider_gate',JSON_OBJECT('requires','provider_gate_state_known','live_send','blocked'),JSON_OBJECT('record_only',true,'no_external_send',true,'secrets_included',false),'active','Execution plan records remain dry-run/record-only under no-send gate.',0),
  ('support_ticket_external.plan_to_certification','support_ticket_external_delivery_orchestrator','support_ticket_external.execution_plan_record','support_ticket_external.completion_certification','completion_certification_no_send',JSON_OBJECT('requires','external_send_plan_record_state_known','external_send_performed',false),JSON_OBJECT('no_external_send',true,'live_external_send_enabled',false,'secrets_included',false),'active','Completion certification can be recorded only under no-send evidence.',0)
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

CREATE OR REPLACE VIEW `v_platform_orchestration_external_delivery_readiness` AS
SELECT
  'support_ticket_external_delivery_orchestrator' AS plugin_key,
  COALESCE(g.stage_count, 0) AS stage_count,
  COALESCE(g.edge_count, 0) AS edge_count,
  7 AS expected_stage_count,
  6 AS expected_edge_count,
  (SELECT COUNT(*) FROM `admin_platform_endpoint_tools` WHERE tool_key LIKE 'support_ticket_external%' AND is_enabled = 1) AS enabled_external_delivery_tool_count,
  (SELECT COUNT(*) FROM `admin_platform_endpoint_tools` WHERE tool_key LIKE 'support_ticket_external%' AND is_enabled = 1 AND tags LIKE '%no_external_send%') AS no_external_send_tool_count,
  (SELECT COUNT(*) FROM `admin_platform_endpoint_tools` WHERE tool_key = 'support_ticket_external_delivery_completion_certify' AND is_enabled = 1) AS completion_certification_tool_count,
  CASE
    WHEN COALESCE(g.stage_count, 0) >= 7
     AND COALESCE(g.edge_count, 0) >= 6
     AND (SELECT COUNT(*) FROM `admin_platform_endpoint_tools` WHERE tool_key = 'support_ticket_external_delivery_completion_certify' AND is_enabled = 1) >= 1
    THEN 'ready_no_send_external_delivery_graph'
    ELSE 'degraded_external_delivery_graph_incomplete'
  END AS readiness_status,
  JSON_OBJECT(
    'plugin_key','support_ticket_external_delivery_orchestrator',
    'stage_count', COALESCE(g.stage_count, 0),
    'edge_count', COALESCE(g.edge_count, 0),
    'enabled_external_delivery_tool_count', (SELECT COUNT(*) FROM `admin_platform_endpoint_tools` WHERE tool_key LIKE 'support_ticket_external%' AND is_enabled = 1),
    'completion_certification_tool_count', (SELECT COUNT(*) FROM `admin_platform_endpoint_tools` WHERE tool_key = 'support_ticket_external_delivery_completion_certify' AND is_enabled = 1),
    'external_send_performed', false,
    'live_external_send_enabled', false,
    'no_provider_call', true,
    'no_raw_secrets', true,
    'no_external_send', true,
    'secrets_included', false
  ) AS evidence_json,
  0 AS secrets_included
FROM (
  SELECT stage_count, edge_count
    FROM `v_platform_orchestration_graph_readiness`
   WHERE plugin_key = 'support_ticket_external_delivery_orchestrator'
   LIMIT 1
) g;

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`,
  `execution_scope`, `affects_layer`, `blocking`, `notes`
)
SELECT 'Orchestration Intelligence Governance', 'support_ticket_external_delivery_orchestration_readback_policy_v1',
       JSON_OBJECT(
         'rule','support_ticket_external_delivery_orchestration_readback_no_send',
         'plugin_key','support_ticket_external_delivery_orchestrator',
         'readback_tool_key','platform_orchestration_readback',
         'views',JSON_ARRAY('v_platform_orchestration_graph_readiness','v_platform_orchestration_external_delivery_readiness'),
         'input_tables',JSON_ARRAY('tickets','ticket_lifecycle_events','approval_holds','secret_references','api_credentials','connected_systems','admin_platform_endpoint_tools','execution_policies','execution_plans','workflow_runs','step_runs'),
         'no_provider_call',true,
         'no_spend_change',true,
         'no_credential_payload_read',true,
         'no_raw_secrets',true,
         'no_external_send',true,
         'no_external_write',true,
         'live_external_send_enabled',false,
         'secrets_included',false
       ),
       'TRUE',
       'support_ticket_external_delivery|orchestration_readback|no_send|completion_certification',
       'supportTicketExternalDeliveryOrchestrationReadback|platformOrchestrationReadback|platform_orchestration_stages|admin_platform_endpoint_tools',
       'TRUE',
       'Read-only/no-send Support Ticket External Delivery orchestration graph. Does not send, call providers, or read credential payloads.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group`='Orchestration Intelligence Governance'
     AND `policy_key`='support_ticket_external_delivery_orchestration_readback_policy_v1'
);
