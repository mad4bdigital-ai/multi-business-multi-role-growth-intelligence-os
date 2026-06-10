-- Sprint 68: Session insight capability envelope request planner.
--
-- Adds a plan-only ledger for suggesting capability-envelope request parameters
-- from the read-only adapter apply readiness gate. This migration does not call
-- capability resolution tools, does not create approval holds, does not execute
-- adapters, does not enable target writes, and does not set promotion_allowed=1.
-- No raw transcripts. No secrets.

CREATE TABLE IF NOT EXISTS `session_insight_capability_envelope_plans` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `capability_plan_id` VARCHAR(128) NOT NULL,
  `payload_preview_id` VARCHAR(128) NOT NULL,
  `apply_request_id` VARCHAR(128) NOT NULL,
  `promotion_id` VARCHAR(96) NOT NULL,
  `insight_id` VARCHAR(96) NOT NULL,
  `target_surface` VARCHAR(96) NOT NULL,
  `promotion_type` VARCHAR(64) NOT NULL,
  `adapter_key` VARCHAR(128) NULL,
  `contract_key` VARCHAR(160) NULL,
  `plan_status` ENUM('planned_not_requested','superseded','rejected') NOT NULL DEFAULT 'planned_not_requested',
  `gate_status` VARCHAR(128) NOT NULL,
  `capability_key` VARCHAR(128) NOT NULL,
  `operation_intent` VARCHAR(128) NOT NULL,
  `runtime_surface` VARCHAR(128) NOT NULL,
  `actual_capability_envelope_requested` TINYINT(1) NOT NULL DEFAULT 0,
  `actual_capability_envelope_id` VARCHAR(128) NULL,
  `execution_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `target_write_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `plan_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`plan_json`)),
  `safety_contract_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`safety_contract_json`)),
  `created_by` VARCHAR(255) NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_session_insight_capability_plan_id` (`capability_plan_id`),
  KEY `idx_session_insight_capability_plan_payload` (`payload_preview_id`, `created_at`),
  KEY `idx_session_insight_capability_plan_apply` (`apply_request_id`, `created_at`),
  KEY `idx_session_insight_capability_plan_surface` (`target_surface`, `plan_status`),
  CONSTRAINT `fk_session_insight_capability_plan_payload_preview`
    FOREIGN KEY (`payload_preview_id`) REFERENCES `session_insight_promotion_payload_previews` (`payload_preview_id`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `chk_session_insight_capability_plan_no_execution` CHECK (`actual_capability_envelope_requested` = 0 AND `execution_allowed` = 0 AND `target_write_allowed` = 0),
  CONSTRAINT `chk_session_insight_capability_plan_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW `v_session_insight_capability_envelope_plan_issues` AS
SELECT
  p.capability_plan_id,
  p.payload_preview_id,
  p.apply_request_id,
  p.promotion_id,
  'capability_plan_claims_actual_envelope_or_execution' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('capability_plan_id', p.capability_plan_id, 'actual_capability_envelope_requested', p.actual_capability_envelope_requested, 'actual_capability_envelope_id', p.actual_capability_envelope_id, 'execution_allowed', p.execution_allowed, 'target_write_allowed', p.target_write_allowed, 'secrets_included', false) AS evidence_json
FROM `session_insight_capability_envelope_plans` p
WHERE p.actual_capability_envelope_requested <> 0
   OR p.actual_capability_envelope_id IS NOT NULL
   OR p.execution_allowed <> 0
   OR p.target_write_allowed <> 0
UNION ALL
SELECT
  p.capability_plan_id,
  p.payload_preview_id,
  p.apply_request_id,
  p.promotion_id,
  'capability_plan_secret_flagged' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('capability_plan_id', p.capability_plan_id, 'secrets_included', p.secrets_included) AS evidence_json
FROM `session_insight_capability_envelope_plans` p
WHERE p.secrets_included <> 0
UNION ALL
SELECT
  p.capability_plan_id,
  p.payload_preview_id,
  p.apply_request_id,
  p.promotion_id,
  'capability_plan_source_gate_not_ready_but_blocked' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('capability_plan_id', p.capability_plan_id, 'gate_status', p.gate_status, 'secrets_included', false) AS evidence_json
FROM `session_insight_capability_envelope_plans` p
WHERE p.gate_status <> 'ready_but_blocked_requires_capability_envelope_and_apply_adapter'
UNION ALL
SELECT
  p.capability_plan_id,
  p.payload_preview_id,
  p.apply_request_id,
  p.promotion_id,
  'capability_plan_claims_runtime_effect' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('capability_plan_id', p.capability_plan_id, 'safety_contract_json', JSON_EXTRACT(p.safety_contract_json, '$'), 'secrets_included', false) AS evidence_json
FROM `session_insight_capability_envelope_plans` p
WHERE JSON_EXTRACT(p.safety_contract_json, '$.actual_capability_envelope_requested') <> false
   OR JSON_EXTRACT(p.safety_contract_json, '$.approval_hold_created') <> false
   OR JSON_EXTRACT(p.safety_contract_json, '$.adapter_apply_executed') <> false
   OR JSON_EXTRACT(p.safety_contract_json, '$.backlog_policy_canonical_write_executed') <> false
   OR JSON_EXTRACT(p.safety_contract_json, '$.provider_call_executed') <> false
   OR JSON_EXTRACT(p.safety_contract_json, '$.external_write_executed') <> false;

CREATE OR REPLACE VIEW `v_session_insight_capability_envelope_plan_readiness` AS
SELECT
  g.payload_preview_id,
  g.apply_request_id,
  g.promotion_id,
  g.promotion_type,
  g.target_surface,
  g.adapter_key,
  g.contract_key,
  g.gate_status,
  latest.capability_plan_id,
  latest.plan_status,
  latest.capability_key,
  latest.operation_intent,
  latest.runtime_surface,
  latest.actual_capability_envelope_requested,
  latest.execution_allowed,
  latest.target_write_allowed,
  CASE
    WHEN g.gate_status <> 'ready_but_blocked_requires_capability_envelope_and_apply_adapter' THEN 'blocked_gate_not_ready_for_capability_plan'
    WHEN latest.capability_plan_id IS NULL THEN 'ready_for_capability_envelope_plan'
    WHEN latest.actual_capability_envelope_requested <> 0 OR latest.execution_allowed <> 0 OR latest.target_write_allowed <> 0 THEN 'invalid_capability_plan_claims_execution'
    ELSE 'capability_envelope_plan_created_not_requested'
  END AS capability_plan_readiness_status,
  JSON_OBJECT(
    'payload_preview_id', g.payload_preview_id,
    'apply_request_id', g.apply_request_id,
    'capability_plan_id', latest.capability_plan_id,
    'capability_key', latest.capability_key,
    'operation_intent', latest.operation_intent,
    'runtime_surface', latest.runtime_surface,
    'plan_only', true,
    'actual_capability_envelope_requested', false,
    'approval_hold_created', false,
    'adapter_apply_executed', false,
    'execution_allowed', false,
    'target_write_allowed', false,
    'secrets_included', false
  ) AS readiness_evidence_json,
  0 AS secrets_included
FROM `v_session_insight_adapter_apply_readiness_gate` g
LEFT JOIN (
  SELECT p.*
    FROM `session_insight_capability_envelope_plans` p
    JOIN (
      SELECT payload_preview_id, MAX(id) AS max_id
        FROM `session_insight_capability_envelope_plans`
       WHERE secrets_included = 0
       GROUP BY payload_preview_id
    ) mx ON mx.max_id = p.id
) latest ON latest.payload_preview_id = g.payload_preview_id
WHERE g.secrets_included = 0;

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`,
  `execution_scope`, `affects_layer`, `blocking`, `notes`
)
SELECT 'Session Memory Governance', 'session_insight_capability_envelope_planner_policy_v1',
       JSON_OBJECT(
         'rule','session_insight_capability_envelope_planner_plan_only',
         'tools',JSON_ARRAY('session_insight_capability_envelope_plan_create','session_insight_capability_envelope_plan_list'),
         'accepted_source','v_session_insight_adapter_apply_readiness_gate',
         'requires_gate_status','ready_but_blocked_requires_capability_envelope_and_apply_adapter',
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
       'session_memory|capability_envelope_planner|adapter_apply_readiness_gate',
       'session_insight_capability_envelope_plans|v_session_insight_adapter_apply_readiness_gate|admin_platform_endpoint_tools',
       'TRUE',
       'Capability envelope planner writes plan rows only and never invokes capability envelope creation or approval.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group`='Session Memory Governance'
     AND `policy_key`='session_insight_capability_envelope_planner_policy_v1'
);

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
  (
    'session_insight_capability_envelope_plan_create',
    'Session Insight Capability Envelope Plan Create',
    'Create a plan-only capability envelope request suggestion from the adapter apply readiness gate. Does not call capability resolution, does not create approval holds, and never executes adapters or target writes.',
    'POST',
    '/platform/session-insight-promotions/capability-envelope-plans/create',
    NULL,
    JSON_OBJECT('type','object','properties',JSON_OBJECT('payload_preview_id',JSON_OBJECT('type','string'),'apply_request_id',JSON_OBJECT('type','string'),'created_by',JSON_OBJECT('type','string')),'additionalProperties',false),
    NULL,
    'admin,session_memory,capability_envelope_plan,plan_only,no_execution,no_secrets',
    1,
    660
  ),
  (
    'session_insight_capability_envelope_plan_list',
    'Session Insight Capability Envelope Plan List',
    'List plan-only capability envelope suggestions. Read-only and does not call capability resolution, does not create approval holds, and never executes adapters or target writes.',
    'POST',
    '/platform/session-insight-promotions/capability-envelope-plans/list',
    NULL,
    JSON_OBJECT('type','object','properties',JSON_OBJECT('capability_plan_id',JSON_OBJECT('type','string'),'payload_preview_id',JSON_OBJECT('type','string'),'apply_request_id',JSON_OBJECT('type','string'),'promotion_id',JSON_OBJECT('type','string'),'target_surface',JSON_OBJECT('type','string'),'capability_key',JSON_OBJECT('type','string'),'plan_status',JSON_OBJECT('type','string'),'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',100,'default',25)),'additionalProperties',false),
    NULL,
    'admin,session_memory,capability_envelope_plan,read_only,no_execution,no_secrets',
    1,
    661
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
