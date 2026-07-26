-- Sprint 68: Session insight adapter apply readiness gate.
--
-- Adds a read-only readiness gate over approved promotion proposals, approved
-- payload previews, adapter contracts, target adapter registry, and capability
-- envelope requirements. This gate never executes adapters, never enables target
-- writes, never sets promotion_allowed=1, and never writes backlog/policy/
-- canonical/provider/credential/external systems. No raw transcripts. No secrets.

CREATE OR REPLACE VIEW `v_session_insight_adapter_apply_readiness_gate` AS
SELECT
  pp.payload_preview_id,
  pp.apply_request_id,
  pp.preview_id,
  pp.promotion_id,
  pp.insight_id,
  pp.promotion_type,
  pp.target_surface,
  pp.adapter_key,
  pp.contract_key,
  pr.approval_status AS promotion_approval_status,
  pr.promotion_status,
  pr.promotion_allowed,
  pr.promotion_executor_key,
  pp.payload_status,
  pp.payload_review_status,
  pp.payload_decision_status,
  ar.request_status,
  ar.capability_envelope_required,
  ar.capability_envelope_id,
  ar.target_adapter_key,
  a.implementation_status AS adapter_implementation_status,
  a.execution_mode AS adapter_execution_mode,
  a.apply_supported AS adapter_apply_supported,
  a.apply_tool_key,
  c.contract_status,
  c.contract_mode,
  c.apply_supported AS contract_apply_supported,
  c.execution_allowed AS contract_execution_allowed,
  pp.execution_allowed,
  pp.target_write_allowed,
  CASE WHEN JSON_EXTRACT(pp.validation_result_json, '$.valid_for_dry_run_contract') = true THEN 1 ELSE 0 END AS valid_for_dry_run_contract,
  CASE
    WHEN COALESCE(pp.secrets_included,0) <> 0 OR COALESCE(pr.secrets_included,0) <> 0 OR COALESCE(ar.secrets_included,0) <> 0 OR COALESCE(a.secrets_included,0) <> 0 OR COALESCE(c.secrets_included,0) <> 0 THEN 'secret_flagged_source'
    WHEN COALESCE(pp.execution_allowed,0) <> 0 OR COALESCE(pp.target_write_allowed,0) <> 0 OR COALESCE(ar.execution_allowed,0) <> 0 THEN 'invalid_execution_or_target_write_claim'
    WHEN pr.approval_status <> 'approved' OR pr.promotion_status <> 'ready' THEN 'blocked_promotion_not_approved_ready'
    WHEN COALESCE(pr.promotion_allowed,0) <> 0 OR TRIM(COALESCE(pr.promotion_executor_key,'')) <> '' THEN 'invalid_promotion_already_execution_enabled'
    WHEN pp.payload_review_status <> 'approved' OR pp.payload_decision_status <> 'approved' THEN 'blocked_payload_not_approved'
    WHEN pp.payload_status <> 'payload_preview_generated' OR pp.payload_mode <> 'dry_run_payload_preview' THEN 'blocked_payload_preview_not_generated_dry_run'
    WHEN JSON_EXTRACT(pp.validation_result_json, '$.valid_for_dry_run_contract') <> true THEN 'blocked_payload_contract_invalid'
    WHEN pp.contract_key IS NULL OR c.contract_key IS NULL THEN 'blocked_missing_adapter_contract'
    WHEN c.contract_mode <> 'dry_run_contract' OR c.contract_status <> 'active' THEN 'blocked_contract_not_active_dry_run'
    WHEN COALESCE(c.apply_supported,0) <> 0 OR COALESCE(c.execution_allowed,0) <> 0 THEN 'invalid_contract_claims_execution'
    WHEN pp.adapter_key IS NULL OR a.adapter_key IS NULL THEN 'blocked_missing_target_adapter'
    WHEN a.implementation_status <> 'skeleton' THEN 'invalid_adapter_not_skeleton_for_foundation_gate'
    WHEN COALESCE(a.apply_supported,0) <> 0 OR TRIM(COALESCE(a.apply_tool_key,'')) <> '' THEN 'invalid_adapter_claims_apply_supported'
    ELSE 'ready_but_blocked_requires_capability_envelope_and_apply_adapter'
  END AS gate_status,
  JSON_ARRAY(
    'capability_envelope_required_before_apply',
    'target_adapter_apply_implementation_required',
    'promotion_allowed_must_remain_false_in_readiness_gate',
    'execution_allowed_false_by_policy',
    'target_write_allowed_false_by_policy'
  ) AS blockers_json,
  JSON_OBJECT(
    'payload_preview_id', pp.payload_preview_id,
    'apply_request_id', pp.apply_request_id,
    'promotion_id', pp.promotion_id,
    'promotion_approved', pr.approval_status = 'approved',
    'promotion_ready', pr.promotion_status = 'ready',
    'payload_approved', pp.payload_review_status = 'approved' AND pp.payload_decision_status = 'approved',
    'contract_valid_for_dry_run', JSON_EXTRACT(pp.validation_result_json, '$.valid_for_dry_run_contract') = true,
    'adapter_skeleton', a.implementation_status = 'skeleton',
    'capability_envelope_required', true,
    'capability_envelope_id', ar.capability_envelope_id,
    'target_adapter_key', ar.target_adapter_key,
    'promotion_allowed', false,
    'execution_allowed', false,
    'target_write_allowed', false,
    'adapter_apply_executed', false,
    'backlog_policy_canonical_write_executed', false,
    'provider_call_executed', false,
    'credential_payload_read', false,
    'external_write_executed', false,
    'raw_transcript_included', false,
    'secrets_included', false
  ) AS readiness_evidence_json,
  0 AS secrets_included
FROM `session_insight_promotion_payload_previews` pp
LEFT JOIN `session_insight_promotions` pr
  ON pr.promotion_id = pp.promotion_id
LEFT JOIN `session_insight_promotion_apply_requests` ar
  ON ar.apply_request_id = pp.apply_request_id
LEFT JOIN `session_insight_promotion_target_adapters` a
  ON a.adapter_key = pp.adapter_key
 AND a.status = 'active'
LEFT JOIN `session_insight_promotion_adapter_contracts` c
  ON c.contract_key = pp.contract_key
 AND c.status = 'active'
WHERE pp.secrets_included = 0;

CREATE OR REPLACE VIEW `v_session_insight_adapter_apply_readiness_gate_issues` AS
SELECT
  g.payload_preview_id,
  g.apply_request_id,
  g.promotion_id,
  g.gate_status,
  'apply_readiness_gate_source_claims_execution' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('payload_preview_id', g.payload_preview_id, 'promotion_allowed', g.promotion_allowed, 'execution_allowed', g.execution_allowed, 'target_write_allowed', g.target_write_allowed, 'adapter_apply_supported', g.adapter_apply_supported, 'contract_apply_supported', g.contract_apply_supported, 'secrets_included', false) AS evidence_json
FROM `v_session_insight_adapter_apply_readiness_gate` g
WHERE COALESCE(g.promotion_allowed,0) <> 0
   OR COALESCE(g.execution_allowed,0) <> 0
   OR COALESCE(g.target_write_allowed,0) <> 0
   OR COALESCE(g.adapter_apply_supported,0) <> 0
   OR COALESCE(g.contract_apply_supported,0) <> 0
   OR COALESCE(g.contract_execution_allowed,0) <> 0
UNION ALL
SELECT
  g.payload_preview_id,
  g.apply_request_id,
  g.promotion_id,
  g.gate_status,
  'apply_readiness_gate_secret_flagged' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('payload_preview_id', g.payload_preview_id, 'secrets_included', g.secrets_included) AS evidence_json
FROM `v_session_insight_adapter_apply_readiness_gate` g
WHERE g.secrets_included <> 0
UNION ALL
SELECT
  g.payload_preview_id,
  g.apply_request_id,
  g.promotion_id,
  g.gate_status,
  'apply_readiness_gate_payload_approved_but_invalid_contract' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('payload_preview_id', g.payload_preview_id, 'valid_for_dry_run_contract', g.valid_for_dry_run_contract, 'secrets_included', false) AS evidence_json
FROM `v_session_insight_adapter_apply_readiness_gate` g
WHERE g.payload_review_status = 'approved'
  AND COALESCE(g.valid_for_dry_run_contract,0) <> 1;

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`,
  `execution_scope`, `affects_layer`, `blocking`, `notes`
)
SELECT 'Session Memory Governance', 'session_insight_adapter_apply_readiness_gate_policy_v1',
       JSON_OBJECT(
         'rule','session_insight_adapter_apply_readiness_gate_read_only',
         'tool','session_insight_adapter_apply_readiness_gate_list',
         'read_only_gate',true,
         'requires_promotion_approved',true,
         'requires_payload_approved',true,
         'requires_valid_dry_run_contract',true,
         'requires_target_adapter_implementation_for_future_apply',true,
         'requires_capability_envelope_for_future_apply',true,
         'sets_promotion_allowed',false,
         'sets_execution_allowed',false,
         'sets_target_write_allowed',false,
         'assigns_executor',false,
         'adapter_apply_executed',false,
         'writes_backlog_policy_or_canonical',false,
         'provider_calls_allowed',false,
         'credential_payload_reads_allowed',false,
         'external_writes_allowed',false,
         'raw_transcript_included',false,
         'secrets_included',false
       ),
       'TRUE',
       'session_memory|adapter_apply_readiness_gate|dry_run_contract|capability_gate',
       'v_session_insight_adapter_apply_readiness_gate|session_insight_promotion_payload_previews|session_insight_promotion_target_adapters',
       'TRUE',
       'Adapter apply readiness gate is read-only and reports readiness/blockers without enabling execution or target writes.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group`='Session Memory Governance'
     AND `policy_key`='session_insight_adapter_apply_readiness_gate_policy_v1'
);

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES (
  'session_insight_adapter_apply_readiness_gate_list',
  'Session Insight Adapter Apply Readiness Gate List',
  'Read adapter apply readiness gate status over approved promotions, approved payload previews, dry-run contracts, adapters, and capability requirements. Read-only: never executes adapters, never enables target writes, never calls providers, never reads credentials, and never returns secrets.',
  'POST',
  '/platform/session-insight-promotions/adapter-apply-readiness/list',
  NULL,
  JSON_OBJECT('type','object','properties',JSON_OBJECT('payload_preview_id',JSON_OBJECT('type','string'),'apply_request_id',JSON_OBJECT('type','string'),'promotion_id',JSON_OBJECT('type','string'),'promotion_type',JSON_OBJECT('type','string'),'target_surface',JSON_OBJECT('type','string'),'adapter_key',JSON_OBJECT('type','string'),'contract_key',JSON_OBJECT('type','string'),'gate_status',JSON_OBJECT('type','string'),'q',JSON_OBJECT('type','string'),'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',100,'default',25)),'additionalProperties',false),
  NULL,
  'admin,session_memory,adapter_apply_readiness,read_only,no_execution,no_secrets',
  1,
  659
)
ON DUPLICATE KEY UPDATE
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
