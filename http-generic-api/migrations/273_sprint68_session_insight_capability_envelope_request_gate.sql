-- Sprint 68: Session insight capability envelope request gate.
--
-- Adds a review-gated request ledger above capability envelope plans. This layer
-- prepares request payloads for human review only. It does not call capability
-- resolution, does not create approval holds, does not create or approve actual
-- capability envelopes, does not execute adapters, does not enable target writes,
-- and does not set promotion_allowed=1. No raw transcripts. No secrets.

CREATE TABLE IF NOT EXISTS `session_insight_capability_envelope_request_gates` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `request_gate_id` VARCHAR(128) NOT NULL,
  `capability_plan_id` VARCHAR(128) NOT NULL,
  `payload_preview_id` VARCHAR(128) NOT NULL,
  `apply_request_id` VARCHAR(128) NOT NULL,
  `promotion_id` VARCHAR(96) NOT NULL,
  `insight_id` VARCHAR(96) NOT NULL,
  `target_surface` VARCHAR(96) NOT NULL,
  `promotion_type` VARCHAR(64) NOT NULL,
  `capability_key` VARCHAR(128) NOT NULL,
  `operation_intent` VARCHAR(128) NOT NULL,
  `runtime_surface` VARCHAR(128) NOT NULL,
  `request_gate_status` ENUM('request_gate_created_requires_review','superseded','rejected') NOT NULL DEFAULT 'request_gate_created_requires_review',
  `request_review_status` ENUM('request_review_required','request_approved','request_rejected') NOT NULL DEFAULT 'request_review_required',
  `request_policy_status` ENUM('blocked_until_request_gate_approved','request_approved_but_not_dispatched','rejected') NOT NULL DEFAULT 'blocked_until_request_gate_approved',
  `actual_capability_envelope_requested` TINYINT(1) NOT NULL DEFAULT 0,
  `actual_capability_envelope_id` VARCHAR(128) NULL,
  `approval_hold_created` TINYINT(1) NOT NULL DEFAULT 0,
  `execution_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `target_write_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `request_payload_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`request_payload_json`)),
  `safety_contract_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`safety_contract_json`)),
  `created_by` VARCHAR(255) NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_session_insight_capability_request_gate_id` (`request_gate_id`),
  KEY `idx_session_insight_capability_request_gate_plan` (`capability_plan_id`, `created_at`),
  KEY `idx_session_insight_capability_request_gate_payload` (`payload_preview_id`, `created_at`),
  KEY `idx_session_insight_capability_request_gate_review` (`request_review_status`, `request_gate_status`),
  CONSTRAINT `fk_session_insight_capability_request_gate_plan`
    FOREIGN KEY (`capability_plan_id`) REFERENCES `session_insight_capability_envelope_plans` (`capability_plan_id`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `chk_session_insight_capability_request_gate_no_execution`
    CHECK (`actual_capability_envelope_requested` = 0 AND `actual_capability_envelope_id` IS NULL AND `approval_hold_created` = 0 AND `execution_allowed` = 0 AND `target_write_allowed` = 0),
  CONSTRAINT `chk_session_insight_capability_request_gate_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW `v_session_insight_capability_envelope_request_gate_issues` AS
SELECT
  g.request_gate_id,
  g.capability_plan_id,
  g.payload_preview_id,
  g.apply_request_id,
  'request_gate_claims_actual_envelope_or_execution' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('request_gate_id', g.request_gate_id, 'actual_capability_envelope_requested', g.actual_capability_envelope_requested, 'actual_capability_envelope_id', g.actual_capability_envelope_id, 'approval_hold_created', g.approval_hold_created, 'execution_allowed', g.execution_allowed, 'target_write_allowed', g.target_write_allowed, 'secrets_included', false) AS evidence_json
FROM `session_insight_capability_envelope_request_gates` g
WHERE g.actual_capability_envelope_requested <> 0
   OR g.actual_capability_envelope_id IS NOT NULL
   OR g.approval_hold_created <> 0
   OR g.execution_allowed <> 0
   OR g.target_write_allowed <> 0
UNION ALL
SELECT
  g.request_gate_id,
  g.capability_plan_id,
  g.payload_preview_id,
  g.apply_request_id,
  'request_gate_secret_flagged' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('request_gate_id', g.request_gate_id, 'secrets_included', g.secrets_included) AS evidence_json
FROM `session_insight_capability_envelope_request_gates` g
WHERE g.secrets_included <> 0
UNION ALL
SELECT
  g.request_gate_id,
  g.capability_plan_id,
  g.payload_preview_id,
  g.apply_request_id,
  'request_gate_source_plan_claims_actual_envelope_or_execution' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('request_gate_id', g.request_gate_id, 'capability_plan_id', p.capability_plan_id, 'actual_capability_envelope_requested', p.actual_capability_envelope_requested, 'execution_allowed', p.execution_allowed, 'target_write_allowed', p.target_write_allowed, 'secrets_included', false) AS evidence_json
FROM `session_insight_capability_envelope_request_gates` g
JOIN `session_insight_capability_envelope_plans` p
  ON p.capability_plan_id = g.capability_plan_id
WHERE p.actual_capability_envelope_requested <> 0
   OR p.actual_capability_envelope_id IS NOT NULL
   OR p.execution_allowed <> 0
   OR p.target_write_allowed <> 0
UNION ALL
SELECT
  g.request_gate_id,
  g.capability_plan_id,
  g.payload_preview_id,
  g.apply_request_id,
  'request_gate_claims_runtime_effect' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('request_gate_id', g.request_gate_id, 'safety_contract_json', JSON_EXTRACT(g.safety_contract_json, '$'), 'secrets_included', false) AS evidence_json
FROM `session_insight_capability_envelope_request_gates` g
WHERE JSON_EXTRACT(g.safety_contract_json, '$.actual_capability_envelope_requested') <> false
   OR JSON_EXTRACT(g.safety_contract_json, '$.approval_hold_created') <> false
   OR JSON_EXTRACT(g.safety_contract_json, '$.adapter_apply_executed') <> false
   OR JSON_EXTRACT(g.safety_contract_json, '$.backlog_policy_canonical_write_executed') <> false
   OR JSON_EXTRACT(g.safety_contract_json, '$.provider_call_executed') <> false
   OR JSON_EXTRACT(g.safety_contract_json, '$.external_write_executed') <> false;

CREATE OR REPLACE VIEW `v_session_insight_capability_envelope_request_gate_readiness` AS
SELECT
  p.capability_plan_id,
  p.payload_preview_id,
  p.apply_request_id,
  p.promotion_id,
  p.promotion_type,
  p.target_surface,
  p.capability_key,
  p.operation_intent,
  p.runtime_surface,
  p.plan_status,
  pr.capability_plan_readiness_status,
  latest.request_gate_id,
  latest.request_gate_status,
  latest.request_review_status,
  latest.request_policy_status,
  latest.actual_capability_envelope_requested,
  latest.approval_hold_created,
  latest.execution_allowed,
  latest.target_write_allowed,
  CASE
    WHEN pr.capability_plan_readiness_status <> 'capability_envelope_plan_created_not_requested' THEN 'blocked_plan_not_ready_for_request_gate'
    WHEN latest.request_gate_id IS NULL THEN 'ready_for_capability_envelope_request_gate'
    WHEN latest.actual_capability_envelope_requested <> 0 OR latest.approval_hold_created <> 0 OR latest.execution_allowed <> 0 OR latest.target_write_allowed <> 0 THEN 'invalid_request_gate_claims_execution'
    WHEN latest.request_review_status = 'request_review_required' THEN 'capability_request_gate_created_requires_review'
    WHEN latest.request_review_status = 'request_approved' THEN 'request_gate_approved_but_not_dispatched'
    WHEN latest.request_review_status = 'request_rejected' THEN 'request_gate_rejected'
    ELSE 'capability_request_gate_status_unknown'
  END AS request_gate_readiness_status,
  JSON_OBJECT(
    'capability_plan_id', p.capability_plan_id,
    'request_gate_id', latest.request_gate_id,
    'payload_preview_id', p.payload_preview_id,
    'apply_request_id', p.apply_request_id,
    'capability_key', p.capability_key,
    'operation_intent', p.operation_intent,
    'runtime_surface', p.runtime_surface,
    'request_gate_only', true,
    'actual_capability_envelope_requested', false,
    'approval_hold_created', false,
    'adapter_apply_executed', false,
    'execution_allowed', false,
    'target_write_allowed', false,
    'secrets_included', false
  ) AS readiness_evidence_json,
  0 AS secrets_included
FROM `session_insight_capability_envelope_plans` p
LEFT JOIN `v_session_insight_capability_envelope_plan_readiness` pr
  ON pr.capability_plan_id = p.capability_plan_id
LEFT JOIN (
  SELECT g.*
    FROM `session_insight_capability_envelope_request_gates` g
    JOIN (
      SELECT capability_plan_id, MAX(id) AS max_id
        FROM `session_insight_capability_envelope_request_gates`
       WHERE secrets_included = 0
       GROUP BY capability_plan_id
    ) mx ON mx.max_id = g.id
) latest ON latest.capability_plan_id = p.capability_plan_id
WHERE p.secrets_included = 0;

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`,
  `execution_scope`, `affects_layer`, `blocking`, `notes`
)
SELECT 'Session Memory Governance', 'session_insight_capability_envelope_request_gate_policy_v1',
       JSON_OBJECT(
         'rule','session_insight_capability_envelope_request_gate_review_only',
         'tools',JSON_ARRAY('session_insight_capability_envelope_request_gate_create','session_insight_capability_envelope_request_gate_list'),
         'accepted_source','session_insight_capability_envelope_plans',
         'requires_plan_status','planned_not_requested',
         'creates_actual_capability_envelope',false,
         'creates_approval_hold',false,
         'adapter_apply_executed',false,
         'sets_promotion_allowed',false,
         'sets_execution_allowed',false,
         'sets_target_write_allowed',false,
         'writes_backlog_policy_or_canonical',false,
         'provider_calls_allowed',false,
         'credential_payload_reads_allowed',false,
         'external_writes_allowed',false,
         'raw_transcript_included',false,
         'secrets_included',false
       ),
       'TRUE',
       'session_memory|capability_envelope_request_gate|review_gate',
       'session_insight_capability_envelope_request_gates|session_insight_capability_envelope_plans|admin_platform_endpoint_tools',
       'TRUE',
       'Capability envelope request gate creates review-gated request rows only and never invokes capability envelope creation or approval.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group`='Session Memory Governance'
     AND `policy_key`='session_insight_capability_envelope_request_gate_policy_v1'
);

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
  (
    'session_insight_capability_envelope_request_gate_create',
    'Session Insight Capability Envelope Request Gate Create',
    'Create a review-gated capability-envelope request row from a plan. Does not call capability resolution, does not create approval holds, and never executes adapters or target writes.',
    'POST',
    '/platform/session-insight-promotions/capability-envelope-request-gates/create',
    NULL,
    JSON_OBJECT('type','object','required',JSON_ARRAY('capability_plan_id'),'properties',JSON_OBJECT('capability_plan_id',JSON_OBJECT('type','string'),'created_by',JSON_OBJECT('type','string')),'additionalProperties',false),
    NULL,
    'admin,session_memory,capability_envelope_request_gate,review_gate,no_execution,no_secrets',
    1,
    662
  ),
  (
    'session_insight_capability_envelope_request_gate_list',
    'Session Insight Capability Envelope Request Gate List',
    'List review-gated capability-envelope request rows. Read-only and does not call capability resolution, does not create approval holds, and never executes adapters or target writes.',
    'POST',
    '/platform/session-insight-promotions/capability-envelope-request-gates/list',
    NULL,
    JSON_OBJECT('type','object','properties',JSON_OBJECT('request_gate_id',JSON_OBJECT('type','string'),'capability_plan_id',JSON_OBJECT('type','string'),'payload_preview_id',JSON_OBJECT('type','string'),'apply_request_id',JSON_OBJECT('type','string'),'promotion_id',JSON_OBJECT('type','string'),'target_surface',JSON_OBJECT('type','string'),'capability_key',JSON_OBJECT('type','string'),'request_review_status',JSON_OBJECT('type','string','enum',JSON_ARRAY('request_review_required','request_approved','request_rejected')),'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',100,'default',25)),'additionalProperties',false),
    NULL,
    'admin,session_memory,capability_envelope_request_gate,read_only,no_execution,no_secrets',
    1,
    663
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
