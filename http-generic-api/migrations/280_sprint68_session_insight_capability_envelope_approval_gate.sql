-- Sprint 68: Session insight capability envelope approval gate.
--
-- Adds a governed ledger for approving an actual capability envelope created by
-- the session insight actual-request layer. Approval may create an approval hold
-- through the existing capability envelope approval tool, but it must not execute
-- adapters, enable promotion_allowed, or write targets. No raw transcripts. No secrets.

CREATE TABLE IF NOT EXISTS `session_insight_capability_envelope_approval_decisions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
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
  `approval_decision_status` ENUM('actual_envelope_approved','actual_envelope_approval_blocked','superseded') NOT NULL DEFAULT 'actual_envelope_approved',
  `approval_policy_status` ENUM('approved_but_not_executed','blocked') NOT NULL DEFAULT 'approved_but_not_executed',
  `approval_hold_created` TINYINT(1) NOT NULL DEFAULT 1,
  `approval_hold_id` VARCHAR(128) NULL,
  `envelope_status_after_approval` VARCHAR(64) NULL,
  `envelope_decision_after_approval` VARCHAR(96) NULL,
  `execution_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `target_write_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `adapter_apply_executed` TINYINT(1) NOT NULL DEFAULT 0,
  `source_actual_request_sha256` CHAR(64) NOT NULL,
  `approval_result_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`approval_result_json`)),
  `safety_contract_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`safety_contract_json`)),
  `typed_confirm` VARCHAR(128) NOT NULL,
  `approved_by` VARCHAR(255) NULL,
  `approval_notes` TEXT NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_session_insight_capability_approval_decision_id` (`approval_decision_id`),
  UNIQUE KEY `uq_session_insight_capability_approval_actual_request` (`actual_request_id`),
  KEY `idx_session_insight_capability_approval_envelope` (`actual_capability_envelope_id`, `created_at`),
  KEY `idx_session_insight_capability_approval_dispatch` (`dispatch_dry_run_id`, `created_at`),
  KEY `idx_session_insight_capability_approval_promotion` (`promotion_id`, `created_at`),
  CONSTRAINT `fk_session_insight_capability_approval_actual_request`
    FOREIGN KEY (`actual_request_id`) REFERENCES `session_insight_capability_envelope_actual_requests` (`actual_request_id`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `chk_session_insight_capability_approval_no_execution`
    CHECK (`execution_allowed` = 0 AND `target_write_allowed` = 0 AND `adapter_apply_executed` = 0),
  CONSTRAINT `chk_session_insight_capability_approval_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW `v_session_insight_capability_envelope_approval_decision_issues` AS
SELECT
  d.approval_decision_id,
  d.actual_request_id,
  d.actual_capability_envelope_id,
  'approval_decision_claims_execution_or_target_write' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('approval_decision_id', d.approval_decision_id, 'execution_allowed', d.execution_allowed, 'target_write_allowed', d.target_write_allowed, 'adapter_apply_executed', d.adapter_apply_executed, 'secrets_included', false) AS evidence_json
FROM `session_insight_capability_envelope_approval_decisions` d
WHERE d.execution_allowed <> 0
   OR d.target_write_allowed <> 0
   OR d.adapter_apply_executed <> 0
UNION ALL
SELECT
  d.approval_decision_id,
  d.actual_request_id,
  d.actual_capability_envelope_id,
  'approval_decision_secret_flagged' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('approval_decision_id', d.approval_decision_id, 'secrets_included', d.secrets_included) AS evidence_json
FROM `session_insight_capability_envelope_approval_decisions` d
WHERE d.secrets_included <> 0
UNION ALL
SELECT
  d.approval_decision_id,
  d.actual_request_id,
  d.actual_capability_envelope_id,
  'approval_decision_source_request_changed' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('approval_decision_id', d.approval_decision_id, 'stored_actual_request_sha256', d.source_actual_request_sha256, 'current_actual_request_sha256', SHA2(r.request_result_json, 256), 'secrets_included', false) AS evidence_json
FROM `session_insight_capability_envelope_approval_decisions` d
JOIN `session_insight_capability_envelope_actual_requests` r
  ON r.actual_request_id = d.actual_request_id
WHERE d.source_actual_request_sha256 <> SHA2(r.request_result_json, 256)
UNION ALL
SELECT
  d.approval_decision_id,
  d.actual_request_id,
  d.actual_capability_envelope_id,
  'approval_decision_envelope_not_dispatch_ready_after_approval' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('approval_decision_id', d.approval_decision_id, 'envelope_status', e.envelope_status, 'decision', e.decision, 'dispatch_allowed', e.dispatch_allowed, 'blocking_gap_count', e.blocking_gap_count, 'secrets_included', false) AS evidence_json
FROM `session_insight_capability_envelope_approval_decisions` d
LEFT JOIN `capability_resolution_envelope_ledger` e
  ON e.envelope_id = d.actual_capability_envelope_id
WHERE e.envelope_id IS NULL
   OR e.envelope_status <> 'ready_for_dispatch'
   OR e.decision <> 'ready_for_dispatch'
   OR e.dispatch_allowed <> 1
   OR e.blocking_gap_count <> 0;

CREATE OR REPLACE VIEW `v_session_insight_dispatch_readback_readiness` AS
SELECT
  d.approval_decision_id,
  d.actual_request_id,
  d.actual_request_preflight_id,
  d.dispatch_dry_run_id,
  d.request_gate_id,
  d.capability_plan_id,
  d.promotion_id,
  d.capability_key,
  d.operation_intent,
  d.runtime_surface,
  d.actual_capability_envelope_id,
  d.approval_hold_created,
  d.execution_allowed,
  d.target_write_allowed,
  e.envelope_status,
  e.decision,
  e.dispatch_allowed,
  e.apply_allowed,
  e.approval_required,
  e.blocking_gap_count,
  CASE
    WHEN d.execution_allowed <> 0 OR d.target_write_allowed <> 0 OR d.adapter_apply_executed <> 0 THEN 'blocked_approval_decision_claims_execution'
    WHEN e.envelope_id IS NULL THEN 'blocked_actual_envelope_not_found'
    WHEN e.envelope_status = 'ready_for_dispatch' AND e.dispatch_allowed = 1 AND e.blocking_gap_count = 0 THEN 'ready_for_dispatch_readback_gate'
    ELSE 'blocked_envelope_not_ready_for_dispatch_readback'
  END AS dispatch_readback_readiness_status,
  JSON_OBJECT(
    'approval_decision_id', d.approval_decision_id,
    'actual_request_id', d.actual_request_id,
    'actual_capability_envelope_id', d.actual_capability_envelope_id,
    'dispatch_readback_only', true,
    'adapter_apply_executed', false,
    'execution_allowed', false,
    'target_write_allowed', false,
    'secrets_included', false
  ) AS dispatch_readback_readiness_evidence_json,
  0 AS secrets_included
FROM `session_insight_capability_envelope_approval_decisions` d
LEFT JOIN `capability_resolution_envelope_ledger` e
  ON e.envelope_id = d.actual_capability_envelope_id
WHERE d.secrets_included = 0;

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`,
  `execution_scope`, `affects_layer`, `blocking`, `notes`
)
SELECT 'Session Memory Governance', 'session_insight_capability_envelope_approval_gate_policy_v1',
       JSON_OBJECT(
         'rule','session_insight_capability_envelope_approval_gate_no_execution',
         'tools',JSON_ARRAY('session_insight_capability_envelope_approval_decide','session_insight_capability_envelope_approval_list'),
         'requires_typed_confirm','APPROVE_ACTUAL_CAPABILITY_ENVELOPE_NO_EXECUTION',
         'requires_actual_request_status','actual_envelope_requested',
         'may_create_approval_hold',true,
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
       'session_memory|capability_envelope_approval_gate|no_execution',
       'session_insight_capability_envelope_approval_decisions|capability_resolution_envelope_ledger|approval_holds|admin_platform_endpoint_tools',
       'TRUE',
       'Capability envelope approval gate may approve the envelope but never executes adapters or target writes.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group`='Session Memory Governance'
     AND `policy_key`='session_insight_capability_envelope_approval_gate_policy_v1'
);

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
  (
    'session_insight_capability_envelope_approval_decide',
    'Session Insight Capability Envelope Approval Decide',
    'Approve an actual capability envelope using typed confirmation. May create an approval hold, but does not execute adapters, enable promotion_allowed, or write targets.',
    'POST',
    '/platform/session-insight-promotions/capability-envelope-approvals/decision',
    NULL,
    JSON_OBJECT('type','object','required',JSON_ARRAY('actual_request_id','typed_confirm'),'properties',JSON_OBJECT('actual_request_id',JSON_OBJECT('type','string'),'typed_confirm',JSON_OBJECT('type','string','const','APPROVE_ACTUAL_CAPABILITY_ENVELOPE_NO_EXECUTION'),'approved_by',JSON_OBJECT('type','string'),'approval_notes',JSON_OBJECT('type','string'),'ttl_minutes',JSON_OBJECT('type','integer','minimum',5,'maximum',1440,'default',120)),'additionalProperties',false),
    NULL,
    'admin,session_memory,capability_envelope_approval,typed_confirm,no_execution,no_target_write,no_secrets',
    1,
    672
  ),
  (
    'session_insight_capability_envelope_approval_list',
    'Session Insight Capability Envelope Approval List',
    'List session insight capability envelope approval decisions. Read-only.',
    'POST',
    '/platform/session-insight-promotions/capability-envelope-approvals/list',
    NULL,
    JSON_OBJECT('type','object','properties',JSON_OBJECT('approval_decision_id',JSON_OBJECT('type','string'),'actual_request_id',JSON_OBJECT('type','string'),'actual_capability_envelope_id',JSON_OBJECT('type','string'),'promotion_id',JSON_OBJECT('type','string'),'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',100,'default',25)),'additionalProperties',false),
    NULL,
    'admin,session_memory,capability_envelope_approval,read_only,no_execution,no_target_write,no_secrets',
    1,
    673
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
