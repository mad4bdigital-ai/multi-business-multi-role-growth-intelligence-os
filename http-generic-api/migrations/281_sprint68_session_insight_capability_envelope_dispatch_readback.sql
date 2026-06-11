-- Sprint 68: Session insight capability envelope dispatch readback gate.
--
-- Adds a governed readback ledger after capability envelope approval. This layer
-- verifies the approved envelope is ready_for_dispatch, but still does not
-- dispatch adapters, enable execution, enable promotion_allowed, or write targets.
-- No raw transcripts. No secrets.

CREATE TABLE IF NOT EXISTS `session_insight_capability_envelope_dispatch_readbacks` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
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
  `dispatch_readback_status` ENUM('dispatch_readback_passed','dispatch_readback_blocked','superseded') NOT NULL DEFAULT 'dispatch_readback_passed',
  `dispatch_readback_policy_status` ENUM('ready_for_adapter_execution_gate','blocked') NOT NULL DEFAULT 'ready_for_adapter_execution_gate',
  `approval_hold_created` TINYINT(1) NOT NULL DEFAULT 1,
  `approval_hold_id` VARCHAR(128) NULL,
  `envelope_status` VARCHAR(64) NOT NULL,
  `envelope_decision` VARCHAR(96) NOT NULL,
  `envelope_dispatch_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `envelope_apply_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `envelope_approval_required` TINYINT(1) NOT NULL DEFAULT 0,
  `envelope_blocking_gap_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `adapter_apply_executed` TINYINT(1) NOT NULL DEFAULT 0,
  `execution_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `target_write_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `source_approval_decision_sha256` CHAR(64) NOT NULL,
  `readback_result_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`readback_result_json`)),
  `safety_contract_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`safety_contract_json`)),
  `created_by` VARCHAR(255) NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_session_insight_capability_dispatch_readback_id` (`dispatch_readback_id`),
  UNIQUE KEY `uq_session_insight_capability_dispatch_readback_approval` (`approval_decision_id`),
  KEY `idx_session_insight_capability_dispatch_readback_envelope` (`actual_capability_envelope_id`, `created_at`),
  KEY `idx_session_insight_capability_dispatch_readback_promotion` (`promotion_id`, `created_at`),
  KEY `idx_session_insight_capability_dispatch_readback_status` (`dispatch_readback_status`, `dispatch_readback_policy_status`),
  CONSTRAINT `fk_session_insight_capability_dispatch_readback_approval`
    FOREIGN KEY (`approval_decision_id`) REFERENCES `session_insight_capability_envelope_approval_decisions` (`approval_decision_id`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `chk_session_insight_capability_dispatch_readback_no_execution`
    CHECK (`adapter_apply_executed` = 0 AND `execution_allowed` = 0 AND `target_write_allowed` = 0),
  CONSTRAINT `chk_session_insight_capability_dispatch_readback_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW `v_session_insight_capability_envelope_dispatch_readback_issues` AS
SELECT
  r.dispatch_readback_id,
  r.approval_decision_id,
  r.actual_request_id,
  r.actual_capability_envelope_id,
  'dispatch_readback_claims_execution_or_target_write' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('dispatch_readback_id', r.dispatch_readback_id, 'adapter_apply_executed', r.adapter_apply_executed, 'execution_allowed', r.execution_allowed, 'target_write_allowed', r.target_write_allowed, 'secrets_included', false) AS evidence_json
FROM `session_insight_capability_envelope_dispatch_readbacks` r
WHERE r.adapter_apply_executed <> 0
   OR r.execution_allowed <> 0
   OR r.target_write_allowed <> 0
UNION ALL
SELECT
  r.dispatch_readback_id,
  r.approval_decision_id,
  r.actual_request_id,
  r.actual_capability_envelope_id,
  'dispatch_readback_secret_flagged' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('dispatch_readback_id', r.dispatch_readback_id, 'secrets_included', r.secrets_included) AS evidence_json
FROM `session_insight_capability_envelope_dispatch_readbacks` r
WHERE r.secrets_included <> 0
UNION ALL
SELECT
  r.dispatch_readback_id,
  r.approval_decision_id,
  r.actual_request_id,
  r.actual_capability_envelope_id,
  'dispatch_readback_source_approval_changed' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('dispatch_readback_id', r.dispatch_readback_id, 'stored_approval_sha256', r.source_approval_decision_sha256, 'current_approval_sha256', SHA2(d.approval_result_json, 256), 'secrets_included', false) AS evidence_json
FROM `session_insight_capability_envelope_dispatch_readbacks` r
JOIN `session_insight_capability_envelope_approval_decisions` d
  ON d.approval_decision_id = r.approval_decision_id
WHERE r.source_approval_decision_sha256 <> SHA2(d.approval_result_json, 256)
UNION ALL
SELECT
  r.dispatch_readback_id,
  r.approval_decision_id,
  r.actual_request_id,
  r.actual_capability_envelope_id,
  'dispatch_readback_envelope_not_ready_for_dispatch' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('dispatch_readback_id', r.dispatch_readback_id, 'envelope_status', e.envelope_status, 'decision', e.decision, 'dispatch_allowed', e.dispatch_allowed, 'blocking_gap_count', e.blocking_gap_count, 'secrets_included', false) AS evidence_json
FROM `session_insight_capability_envelope_dispatch_readbacks` r
LEFT JOIN `capability_resolution_envelope_ledger` e
  ON e.envelope_id = r.actual_capability_envelope_id
WHERE e.envelope_id IS NULL
   OR e.envelope_status <> 'ready_for_dispatch'
   OR e.decision <> 'ready_for_dispatch'
   OR e.dispatch_allowed <> 1
   OR e.blocking_gap_count <> 0;

CREATE OR REPLACE VIEW `v_session_insight_capability_envelope_adapter_execution_readiness` AS
SELECT
  r.dispatch_readback_id,
  r.approval_decision_id,
  r.actual_request_id,
  r.actual_request_preflight_id,
  r.dispatch_dry_run_id,
  r.request_gate_id,
  r.capability_plan_id,
  r.promotion_id,
  r.insight_id,
  r.capability_key,
  r.operation_intent,
  r.runtime_surface,
  r.actual_capability_envelope_id,
  r.dispatch_readback_status,
  r.dispatch_readback_policy_status,
  r.approval_hold_created,
  r.adapter_apply_executed,
  r.execution_allowed,
  r.target_write_allowed,
  CASE
    WHEN r.dispatch_readback_status <> 'dispatch_readback_passed' THEN 'blocked_dispatch_readback_not_passed'
    WHEN r.dispatch_readback_policy_status <> 'ready_for_adapter_execution_gate' THEN 'blocked_dispatch_readback_policy_not_ready'
    WHEN r.adapter_apply_executed <> 0 OR r.execution_allowed <> 0 OR r.target_write_allowed <> 0 THEN 'blocked_dispatch_readback_claims_execution'
    WHEN r.envelope_status = 'ready_for_dispatch' AND r.envelope_dispatch_allowed = 1 AND r.envelope_blocking_gap_count = 0 THEN 'ready_for_adapter_execution_gate'
    ELSE 'blocked_envelope_not_ready_for_adapter_execution_gate'
  END AS adapter_execution_readiness_status,
  JSON_OBJECT(
    'dispatch_readback_id', r.dispatch_readback_id,
    'approval_decision_id', r.approval_decision_id,
    'actual_capability_envelope_id', r.actual_capability_envelope_id,
    'adapter_execution_gate_not_implemented', true,
    'adapter_apply_executed', false,
    'execution_allowed', false,
    'target_write_allowed', false,
    'secrets_included', false
  ) AS adapter_execution_readiness_evidence_json,
  0 AS secrets_included
FROM `session_insight_capability_envelope_dispatch_readbacks` r
WHERE r.secrets_included = 0;

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`,
  `execution_scope`, `affects_layer`, `blocking`, `notes`
)
SELECT 'Session Memory Governance', 'session_insight_capability_envelope_dispatch_readback_policy_v1',
       JSON_OBJECT(
         'rule','session_insight_capability_envelope_dispatch_readback_no_execution',
         'tools',JSON_ARRAY('session_insight_capability_envelope_dispatch_readback_create','session_insight_capability_envelope_dispatch_readback_list'),
         'requires_approval_decision_status','actual_envelope_approved',
         'requires_envelope_status','ready_for_dispatch',
         'readback_only',true,
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
       'session_memory|capability_envelope_dispatch_readback|no_execution',
       'session_insight_capability_envelope_dispatch_readbacks|capability_resolution_envelope_ledger|admin_platform_endpoint_tools',
       'TRUE',
       'Capability envelope dispatch readback verifies ready_for_dispatch but never executes adapters or target writes.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group`='Session Memory Governance'
     AND `policy_key`='session_insight_capability_envelope_dispatch_readback_policy_v1'
);

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
  (
    'session_insight_capability_envelope_dispatch_readback_create',
    'Session Insight Capability Envelope Dispatch Readback Create',
    'Create a readback ledger for an approved capability envelope. Verifies ready_for_dispatch but does not execute adapters, enable promotion_allowed, or write targets.',
    'POST',
    '/platform/session-insight-promotions/capability-envelope-dispatch-readbacks/create',
    NULL,
    JSON_OBJECT('type','object','required',JSON_ARRAY('approval_decision_id'),'properties',JSON_OBJECT('approval_decision_id',JSON_OBJECT('type','string'),'created_by',JSON_OBJECT('type','string')),'additionalProperties',false),
    NULL,
    'admin,session_memory,capability_envelope_dispatch_readback,readback_only,no_execution,no_target_write,no_secrets',
    1,
    674
  ),
  (
    'session_insight_capability_envelope_dispatch_readback_list',
    'Session Insight Capability Envelope Dispatch Readback List',
    'List capability envelope dispatch readback ledgers. Read-only.',
    'POST',
    '/platform/session-insight-promotions/capability-envelope-dispatch-readbacks/list',
    NULL,
    JSON_OBJECT('type','object','properties',JSON_OBJECT('dispatch_readback_id',JSON_OBJECT('type','string'),'approval_decision_id',JSON_OBJECT('type','string'),'actual_request_id',JSON_OBJECT('type','string'),'actual_capability_envelope_id',JSON_OBJECT('type','string'),'promotion_id',JSON_OBJECT('type','string'),'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',100,'default',25)),'additionalProperties',false),
    NULL,
    'admin,session_memory,capability_envelope_dispatch_readback,read_only,no_execution,no_target_write,no_secrets',
    1,
    675
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
