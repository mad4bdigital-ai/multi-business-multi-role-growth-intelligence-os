-- Sprint 68: Session insight capability envelope actual request dispatch.
--
-- This is the first layer allowed to request an actual capability envelope ledger
-- after an approved dispatch dry-run and a passing actual-request preflight.
-- It still does not approve envelopes, create approval holds, execute adapters,
-- enable promotion_allowed, or allow target writes. No raw transcripts. No secrets.

CREATE TABLE IF NOT EXISTS `session_insight_capability_envelope_actual_requests` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `actual_request_id` VARCHAR(128) NOT NULL,
  `actual_request_preflight_id` VARCHAR(128) NOT NULL,
  `dispatch_dry_run_id` VARCHAR(128) NOT NULL,
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
  `actual_request_status` ENUM('actual_envelope_requested','actual_envelope_request_blocked','superseded') NOT NULL DEFAULT 'actual_envelope_requested',
  `actual_request_policy_status` ENUM('actual_envelope_requested_but_not_approved','blocked') NOT NULL DEFAULT 'actual_envelope_requested_but_not_approved',
  `actual_capability_envelope_requested` TINYINT(1) NOT NULL DEFAULT 1,
  `actual_capability_envelope_id` VARCHAR(128) NOT NULL,
  `actual_capability_envelope_status` VARCHAR(64) NULL,
  `actual_capability_envelope_decision` VARCHAR(96) NULL,
  `actual_capability_envelope_dispatch_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `actual_capability_envelope_apply_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `approval_hold_created` TINYINT(1) NOT NULL DEFAULT 0,
  `execution_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `target_write_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `source_preflight_sha256` CHAR(64) NOT NULL,
  `request_payload_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`request_payload_json`)),
  `request_result_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`request_result_json`)),
  `safety_contract_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`safety_contract_json`)),
  `typed_confirm` VARCHAR(128) NOT NULL,
  `created_by` VARCHAR(255) NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_session_insight_actual_request_id` (`actual_request_id`),
  UNIQUE KEY `uq_session_insight_actual_request_envelope_id` (`actual_capability_envelope_id`),
  KEY `idx_session_insight_actual_request_preflight` (`actual_request_preflight_id`, `created_at`),
  KEY `idx_session_insight_actual_request_dispatch` (`dispatch_dry_run_id`, `created_at`),
  KEY `idx_session_insight_actual_request_gate` (`request_gate_id`, `created_at`),
  KEY `idx_session_insight_actual_request_promotion` (`promotion_id`, `created_at`),
  CONSTRAINT `fk_session_insight_actual_request_preflight`
    FOREIGN KEY (`actual_request_preflight_id`) REFERENCES `session_insight_capability_envelope_actual_request_preflights` (`actual_request_preflight_id`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `fk_session_insight_actual_request_dispatch`
    FOREIGN KEY (`dispatch_dry_run_id`) REFERENCES `session_insight_capability_envelope_dispatch_dry_runs` (`dispatch_dry_run_id`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `chk_session_insight_actual_request_no_execution`
    CHECK (`approval_hold_created` = 0 AND `execution_allowed` = 0 AND `target_write_allowed` = 0),
  CONSTRAINT `chk_session_insight_actual_request_has_envelope`
    CHECK (`actual_capability_envelope_requested` = 1 AND CHAR_LENGTH(`actual_capability_envelope_id`) > 0),
  CONSTRAINT `chk_session_insight_actual_request_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW `v_session_insight_capability_envelope_actual_request_issues` AS
SELECT
  r.actual_request_id,
  r.actual_request_preflight_id,
  r.dispatch_dry_run_id,
  r.request_gate_id,
  r.capability_plan_id,
  'actual_request_missing_actual_envelope_id' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('actual_request_id', r.actual_request_id, 'actual_capability_envelope_requested', r.actual_capability_envelope_requested, 'actual_capability_envelope_id', r.actual_capability_envelope_id, 'secrets_included', false) AS evidence_json
FROM `session_insight_capability_envelope_actual_requests` r
WHERE r.actual_capability_envelope_requested <> 1
   OR TRIM(COALESCE(r.actual_capability_envelope_id, '')) = ''
UNION ALL
SELECT
  r.actual_request_id,
  r.actual_request_preflight_id,
  r.dispatch_dry_run_id,
  r.request_gate_id,
  r.capability_plan_id,
  'actual_request_claims_execution_or_target_write' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('actual_request_id', r.actual_request_id, 'approval_hold_created', r.approval_hold_created, 'execution_allowed', r.execution_allowed, 'target_write_allowed', r.target_write_allowed, 'secrets_included', false) AS evidence_json
FROM `session_insight_capability_envelope_actual_requests` r
WHERE r.approval_hold_created <> 0
   OR r.execution_allowed <> 0
   OR r.target_write_allowed <> 0
UNION ALL
SELECT
  r.actual_request_id,
  r.actual_request_preflight_id,
  r.dispatch_dry_run_id,
  r.request_gate_id,
  r.capability_plan_id,
  'actual_request_secret_flagged' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('actual_request_id', r.actual_request_id, 'secrets_included', r.secrets_included) AS evidence_json
FROM `session_insight_capability_envelope_actual_requests` r
WHERE r.secrets_included <> 0
UNION ALL
SELECT
  r.actual_request_id,
  r.actual_request_preflight_id,
  r.dispatch_dry_run_id,
  r.request_gate_id,
  r.capability_plan_id,
  'actual_request_source_preflight_not_ready' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('actual_request_id', r.actual_request_id, 'preflight_status', p.preflight_status, 'preflight_policy_status', p.preflight_policy_status, 'secrets_included', false) AS evidence_json
FROM `session_insight_capability_envelope_actual_requests` r
JOIN `session_insight_capability_envelope_actual_request_preflights` p
  ON p.actual_request_preflight_id = r.actual_request_preflight_id
WHERE p.preflight_status <> 'actual_request_preflight_passed'
   OR p.preflight_policy_status <> 'ready_for_actual_capability_envelope_request'
UNION ALL
SELECT
  r.actual_request_id,
  r.actual_request_preflight_id,
  r.dispatch_dry_run_id,
  r.request_gate_id,
  r.capability_plan_id,
  'actual_request_source_preflight_changed' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('actual_request_id', r.actual_request_id, 'stored_preflight_sha256', r.source_preflight_sha256, 'current_preflight_sha256', SHA2(p.preflight_result_json, 256), 'secrets_included', false) AS evidence_json
FROM `session_insight_capability_envelope_actual_requests` r
JOIN `session_insight_capability_envelope_actual_request_preflights` p
  ON p.actual_request_preflight_id = r.actual_request_preflight_id
WHERE r.source_preflight_sha256 <> SHA2(p.preflight_result_json, 256)
UNION ALL
SELECT
  r.actual_request_id,
  r.actual_request_preflight_id,
  r.dispatch_dry_run_id,
  r.request_gate_id,
  r.capability_plan_id,
  'actual_request_envelope_not_found' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('actual_request_id', r.actual_request_id, 'actual_capability_envelope_id', r.actual_capability_envelope_id, 'secrets_included', false) AS evidence_json
FROM `session_insight_capability_envelope_actual_requests` r
LEFT JOIN `capability_resolution_envelope_ledger` e
  ON e.envelope_id = r.actual_capability_envelope_id
WHERE e.envelope_id IS NULL;

CREATE OR REPLACE VIEW `v_session_insight_capability_envelope_approval_readiness` AS
SELECT
  r.actual_request_id,
  r.actual_request_preflight_id,
  r.dispatch_dry_run_id,
  r.request_gate_id,
  r.capability_plan_id,
  r.payload_preview_id,
  r.apply_request_id,
  r.promotion_id,
  r.promotion_type,
  r.target_surface,
  r.capability_key,
  r.operation_intent,
  r.runtime_surface,
  r.actual_capability_envelope_id,
  r.actual_capability_envelope_status,
  r.actual_capability_envelope_decision,
  r.actual_capability_envelope_dispatch_allowed,
  r.actual_capability_envelope_apply_allowed,
  e.envelope_status AS ledger_envelope_status,
  e.decision AS ledger_decision,
  e.dispatch_allowed AS ledger_dispatch_allowed,
  e.approval_required AS ledger_approval_required,
  e.blocking_gap_count AS ledger_blocking_gap_count,
  CASE
    WHEN e.envelope_id IS NULL THEN 'blocked_actual_envelope_not_found'
    WHEN r.approval_hold_created <> 0 OR r.execution_allowed <> 0 OR r.target_write_allowed <> 0 THEN 'blocked_actual_request_claims_execution'
    WHEN e.envelope_status = 'ready_requires_approval' AND e.dispatch_allowed = 1 AND e.approval_required = 1 AND e.blocking_gap_count = 0 THEN 'ready_for_capability_envelope_approval_gate'
    WHEN e.envelope_status = 'ready_for_dispatch' AND e.dispatch_allowed = 1 AND e.approval_required = 0 AND e.blocking_gap_count = 0 THEN 'ready_for_dispatch_readback_gate_without_approval'
    ELSE 'blocked_actual_envelope_not_dispatch_ready'
  END AS approval_readiness_status,
  JSON_OBJECT(
    'actual_request_id', r.actual_request_id,
    'actual_capability_envelope_id', r.actual_capability_envelope_id,
    'approval_readiness_only', true,
    'approval_hold_created', false,
    'adapter_apply_executed', false,
    'execution_allowed', false,
    'target_write_allowed', false,
    'secrets_included', false
  ) AS approval_readiness_evidence_json,
  0 AS secrets_included
FROM `session_insight_capability_envelope_actual_requests` r
LEFT JOIN `capability_resolution_envelope_ledger` e
  ON e.envelope_id = r.actual_capability_envelope_id
WHERE r.secrets_included = 0;

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`,
  `execution_scope`, `affects_layer`, `blocking`, `notes`
)
SELECT 'Session Memory Governance', 'session_insight_capability_envelope_actual_request_dispatch_policy_v1',
       JSON_OBJECT(
         'rule','session_insight_capability_envelope_actual_request_dispatch_ledger_only',
         'tools',JSON_ARRAY('session_insight_capability_envelope_actual_request_create','session_insight_capability_envelope_actual_request_list'),
         'requires_typed_confirm','REQUEST_ACTUAL_CAPABILITY_ENVELOPE_NO_EXECUTION',
         'requires_preflight_status','actual_request_preflight_passed',
         'calls_capability_resolution',true,
         'creates_actual_capability_envelope',true,
         'creates_approval_hold',false,
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
       'session_memory|capability_envelope_actual_request|ledger_only',
       'session_insight_capability_envelope_actual_requests|capability_resolution_envelope_ledger|admin_platform_endpoint_tools',
       'TRUE',
       'Actual request dispatch creates a capability envelope ledger but never approves it, executes adapters, or writes targets.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group`='Session Memory Governance'
     AND `policy_key`='session_insight_capability_envelope_actual_request_dispatch_policy_v1'
);

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
  (
    'session_insight_capability_envelope_actual_request_create',
    'Session Insight Capability Envelope Actual Request Create',
    'Create an actual capability envelope ledger from a passed preflight using typed confirmation. Does not approve, execute adapters, enable promotion_allowed, or write targets.',
    'POST',
    '/platform/session-insight-promotions/capability-envelope-actual-requests/create',
    NULL,
    JSON_OBJECT('type','object','required',JSON_ARRAY('actual_request_preflight_id','typed_confirm'),'properties',JSON_OBJECT('actual_request_preflight_id',JSON_OBJECT('type','string'),'typed_confirm',JSON_OBJECT('type','string','const','REQUEST_ACTUAL_CAPABILITY_ENVELOPE_NO_EXECUTION'),'created_by',JSON_OBJECT('type','string'),'ttl_minutes',JSON_OBJECT('type','integer','minimum',5,'maximum',1440,'default',60)),'additionalProperties',false),
    NULL,
    'admin,session_memory,capability_envelope_actual_request,typed_confirm,ledger_only,no_execution,no_target_write,no_secrets',
    1,
    670
  ),
  (
    'session_insight_capability_envelope_actual_request_list',
    'Session Insight Capability Envelope Actual Request List',
    'List actual capability envelope request ledger rows. Read-only.',
    'POST',
    '/platform/session-insight-promotions/capability-envelope-actual-requests/list',
    NULL,
    JSON_OBJECT('type','object','properties',JSON_OBJECT('actual_request_id',JSON_OBJECT('type','string'),'actual_request_preflight_id',JSON_OBJECT('type','string'),'dispatch_dry_run_id',JSON_OBJECT('type','string'),'promotion_id',JSON_OBJECT('type','string'),'actual_capability_envelope_id',JSON_OBJECT('type','string'),'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',100,'default',25)),'additionalProperties',false),
    NULL,
    'admin,session_memory,capability_envelope_actual_request,read_only,no_execution,no_target_write,no_secrets',
    1,
    671
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
