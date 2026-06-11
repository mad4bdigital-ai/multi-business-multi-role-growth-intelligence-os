-- Sprint 68: Session insight capability envelope adapter execution gate.
--
-- Adds a governed gate after dispatch readback. This layer records explicit
-- readiness to proceed to a future adapter apply dispatch, but it still does not
-- execute adapters, enable execution_allowed, enable promotion_allowed, or write
-- targets. No raw transcripts. No secrets.

CREATE TABLE IF NOT EXISTS `session_insight_capability_envelope_adapter_execution_gates` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `adapter_execution_gate_id` VARCHAR(128) NOT NULL,
  `dispatch_readback_id` VARCHAR(128) NOT NULL,
  `approval_decision_id` VARCHAR(128) NOT NULL,
  `actual_request_id` VARCHAR(128) NOT NULL,
  `actual_request_preflight_id` VARCHAR(128) NOT NULL,
  `dispatch_dry_run_id` VARCHAR(128) NOT NULL,
  `request_gate_id` VARCHAR(128) NOT NULL,
  `capability_plan_id` VARCHAR(128) NOT NULL,
  `promotion_id` VARCHAR(96) NOT NULL,
  `insight_id` VARCHAR(96) NOT NULL,
  `capability_key` VARCHAR(128) NOT NULL,
  `operation_intent` VARCHAR(128) NOT NULL,
  `runtime_surface` VARCHAR(128) NOT NULL,
  `actual_capability_envelope_id` VARCHAR(128) NOT NULL,
  `adapter_execution_gate_status` ENUM('adapter_execution_gate_ready','adapter_execution_gate_blocked','superseded') NOT NULL DEFAULT 'adapter_execution_gate_ready',
  `adapter_execution_policy_status` ENUM('ready_for_adapter_apply_dispatch','blocked') NOT NULL DEFAULT 'ready_for_adapter_apply_dispatch',
  `typed_confirm` VARCHAR(128) NOT NULL,
  `adapter_apply_requested` TINYINT(1) NOT NULL DEFAULT 0,
  `adapter_apply_executed` TINYINT(1) NOT NULL DEFAULT 0,
  `execution_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `target_write_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `promotion_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `source_dispatch_readback_sha256` CHAR(64) NOT NULL,
  `gate_result_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`gate_result_json`)),
  `safety_contract_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`safety_contract_json`)),
  `created_by` VARCHAR(255) NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_session_insight_adapter_execution_gate_id` (`adapter_execution_gate_id`),
  UNIQUE KEY `uq_session_insight_adapter_execution_gate_readback` (`dispatch_readback_id`),
  KEY `idx_session_insight_adapter_execution_gate_envelope` (`actual_capability_envelope_id`, `created_at`),
  KEY `idx_session_insight_adapter_execution_gate_promotion` (`promotion_id`, `created_at`),
  KEY `idx_session_insight_adapter_execution_gate_status` (`adapter_execution_gate_status`, `adapter_execution_policy_status`),
  CONSTRAINT `fk_session_insight_adapter_execution_gate_readback`
    FOREIGN KEY (`dispatch_readback_id`) REFERENCES `session_insight_capability_envelope_dispatch_readbacks` (`dispatch_readback_id`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `chk_session_insight_adapter_execution_gate_no_execution`
    CHECK (`adapter_apply_requested` = 0 AND `adapter_apply_executed` = 0 AND `execution_allowed` = 0 AND `target_write_allowed` = 0 AND `promotion_allowed` = 0),
  CONSTRAINT `chk_session_insight_adapter_execution_gate_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW `v_session_insight_adapter_gate_issues` AS
SELECT
  g.adapter_execution_gate_id,
  g.dispatch_readback_id,
  g.actual_request_id,
  g.actual_capability_envelope_id,
  'adapter_execution_gate_claims_apply_or_target_write' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('adapter_execution_gate_id', g.adapter_execution_gate_id, 'adapter_apply_requested', g.adapter_apply_requested, 'adapter_apply_executed', g.adapter_apply_executed, 'execution_allowed', g.execution_allowed, 'target_write_allowed', g.target_write_allowed, 'promotion_allowed', g.promotion_allowed, 'secrets_included', false) AS evidence_json
FROM `session_insight_capability_envelope_adapter_execution_gates` g
WHERE g.adapter_apply_requested <> 0
   OR g.adapter_apply_executed <> 0
   OR g.execution_allowed <> 0
   OR g.target_write_allowed <> 0
   OR g.promotion_allowed <> 0
UNION ALL
SELECT
  g.adapter_execution_gate_id,
  g.dispatch_readback_id,
  g.actual_request_id,
  g.actual_capability_envelope_id,
  'adapter_execution_gate_secret_flagged' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('adapter_execution_gate_id', g.adapter_execution_gate_id, 'secrets_included', g.secrets_included) AS evidence_json
FROM `session_insight_capability_envelope_adapter_execution_gates` g
WHERE g.secrets_included <> 0
UNION ALL
SELECT
  g.adapter_execution_gate_id,
  g.dispatch_readback_id,
  g.actual_request_id,
  g.actual_capability_envelope_id,
  'adapter_execution_gate_source_readback_changed' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('adapter_execution_gate_id', g.adapter_execution_gate_id, 'stored_readback_sha256', g.source_dispatch_readback_sha256, 'current_readback_sha256', SHA2(r.readback_result_json, 256), 'secrets_included', false) AS evidence_json
FROM `session_insight_capability_envelope_adapter_execution_gates` g
JOIN `session_insight_capability_envelope_dispatch_readbacks` r
  ON r.dispatch_readback_id = g.dispatch_readback_id
WHERE g.source_dispatch_readback_sha256 <> SHA2(r.readback_result_json, 256)
UNION ALL
SELECT
  g.adapter_execution_gate_id,
  g.dispatch_readback_id,
  g.actual_request_id,
  g.actual_capability_envelope_id,
  'adapter_execution_gate_source_readback_not_ready' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('adapter_execution_gate_id', g.adapter_execution_gate_id, 'dispatch_readback_status', r.dispatch_readback_status, 'dispatch_readback_policy_status', r.dispatch_readback_policy_status, 'secrets_included', false) AS evidence_json
FROM `session_insight_capability_envelope_adapter_execution_gates` g
JOIN `session_insight_capability_envelope_dispatch_readbacks` r
  ON r.dispatch_readback_id = g.dispatch_readback_id
WHERE r.dispatch_readback_status <> 'dispatch_readback_passed'
   OR r.dispatch_readback_policy_status <> 'ready_for_adapter_execution_gate';

CREATE OR REPLACE VIEW `v_session_insight_adapter_apply_readiness` AS
SELECT
  g.adapter_execution_gate_id,
  g.dispatch_readback_id,
  g.approval_decision_id,
  g.actual_request_id,
  g.actual_request_preflight_id,
  g.dispatch_dry_run_id,
  g.request_gate_id,
  g.capability_plan_id,
  g.promotion_id,
  g.insight_id,
  g.capability_key,
  g.operation_intent,
  g.runtime_surface,
  g.actual_capability_envelope_id,
  g.adapter_execution_gate_status,
  g.adapter_execution_policy_status,
  g.adapter_apply_requested,
  g.adapter_apply_executed,
  g.execution_allowed,
  g.target_write_allowed,
  g.promotion_allowed,
  CASE
    WHEN g.adapter_execution_gate_status <> 'adapter_execution_gate_ready' THEN 'blocked_adapter_execution_gate_not_ready'
    WHEN g.adapter_execution_policy_status <> 'ready_for_adapter_apply_dispatch' THEN 'blocked_adapter_execution_policy_not_ready'
    WHEN g.adapter_apply_requested <> 0 OR g.adapter_apply_executed <> 0 OR g.execution_allowed <> 0 OR g.target_write_allowed <> 0 OR g.promotion_allowed <> 0 THEN 'blocked_adapter_execution_gate_claims_apply_or_write'
    ELSE 'ready_for_adapter_apply_dispatch_gate'
  END AS adapter_apply_dispatch_readiness_status,
  JSON_OBJECT(
    'adapter_execution_gate_id', g.adapter_execution_gate_id,
    'dispatch_readback_id', g.dispatch_readback_id,
    'actual_capability_envelope_id', g.actual_capability_envelope_id,
    'adapter_apply_dispatch_not_implemented', true,
    'adapter_apply_requested', false,
    'adapter_apply_executed', false,
    'execution_allowed', false,
    'target_write_allowed', false,
    'promotion_allowed', false,
    'secrets_included', false
  ) AS adapter_apply_dispatch_readiness_evidence_json,
  0 AS secrets_included
FROM `session_insight_capability_envelope_adapter_execution_gates` g
WHERE g.secrets_included = 0;

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`,
  `execution_scope`, `affects_layer`, `blocking`, `notes`
)
SELECT 'Session Memory Governance', 'session_insight_capability_envelope_adapter_execution_gate_policy_v1',
       JSON_OBJECT(
         'rule','session_insight_capability_envelope_adapter_execution_gate_no_apply',
         'tools',JSON_ARRAY('session_insight_capability_envelope_adapter_execution_gate_create','session_insight_capability_envelope_adapter_execution_gate_list'),
         'requires_typed_confirm','OPEN_ADAPTER_EXECUTION_GATE_NO_APPLY',
         'requires_dispatch_readback_status','dispatch_readback_passed',
         'opens_next_gate','adapter_apply_dispatch',
         'adapter_apply_requested',false,
         'adapter_apply_executed',false,
         'sets_promotion_allowed',false,
         'sets_execution_allowed',false,
         'sets_target_write_allowed',false,
         'provider_runtime_execution_allowed',false,
         'credential_payload_reads_allowed',false,
         'external_writes_allowed',false,
         'raw_transcript_included',false,
         'secrets_included',false
       ),
       'TRUE',
       'session_memory|capability_envelope_adapter_execution_gate|no_apply',
       'session_insight_capability_envelope_adapter_execution_gates|session_insight_capability_envelope_dispatch_readbacks|admin_platform_endpoint_tools',
       'TRUE',
       'Adapter execution gate records readiness for a future adapter apply dispatch but never applies adapters or target writes.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group`='Session Memory Governance'
     AND `policy_key`='session_insight_capability_envelope_adapter_execution_gate_policy_v1'
);

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
  (
    'session_insight_capability_envelope_adapter_execution_gate_create',
    'Session Insight Capability Envelope Adapter Execution Gate Create',
    'Open the adapter execution gate from a passed dispatch readback using typed confirmation. Does not request or execute adapter apply and does not write targets.',
    'POST',
    '/platform/session-insight-promotions/capability-envelope-adapter-execution-gates/create',
    NULL,
    JSON_OBJECT('type','object','required',JSON_ARRAY('dispatch_readback_id','typed_confirm'),'properties',JSON_OBJECT('dispatch_readback_id',JSON_OBJECT('type','string'),'typed_confirm',JSON_OBJECT('type','string','const','OPEN_ADAPTER_EXECUTION_GATE_NO_APPLY'),'created_by',JSON_OBJECT('type','string')),'additionalProperties',false),
    NULL,
    'admin,session_memory,capability_envelope_adapter_execution_gate,typed_confirm,no_apply,no_target_write,no_secrets',
    1,
    676
  ),
  (
    'session_insight_capability_envelope_adapter_execution_gate_list',
    'Session Insight Capability Envelope Adapter Execution Gate List',
    'List adapter execution gate ledgers. Read-only.',
    'POST',
    '/platform/session-insight-promotions/capability-envelope-adapter-execution-gates/list',
    NULL,
    JSON_OBJECT('type','object','properties',JSON_OBJECT('adapter_execution_gate_id',JSON_OBJECT('type','string'),'dispatch_readback_id',JSON_OBJECT('type','string'),'actual_request_id',JSON_OBJECT('type','string'),'actual_capability_envelope_id',JSON_OBJECT('type','string'),'promotion_id',JSON_OBJECT('type','string'),'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',100,'default',25)),'additionalProperties',false),
    NULL,
    'admin,session_memory,capability_envelope_adapter_execution_gate,read_only,no_apply,no_target_write,no_secrets',
    1,
    677
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
