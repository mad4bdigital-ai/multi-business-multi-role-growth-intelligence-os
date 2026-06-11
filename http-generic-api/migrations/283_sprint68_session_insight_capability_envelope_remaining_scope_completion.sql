-- Sprint 68: Session insight capability envelope remaining scope completion.
--
-- This layer closes the remaining roadmap as a governed completion ledger after
-- the adapter execution gate. It enumerates adapter apply dispatch/readback,
-- target write gate/readback, rollback, UI/admin queue, and orchestration
-- readiness as controlled stages. It does not execute adapter apply, does not
-- enable runtime execution, does not set promotion_allowed, and does not write
-- targets. No raw transcripts. No secrets.

CREATE TABLE IF NOT EXISTS `session_insight_capability_envelope_remaining_scope_completions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `remaining_scope_completion_id` VARCHAR(128) NOT NULL,
  `adapter_execution_gate_id` VARCHAR(128) NOT NULL,
  `dispatch_readback_id` VARCHAR(128) NOT NULL,
  `approval_decision_id` VARCHAR(128) NOT NULL,
  `actual_request_id` VARCHAR(128) NOT NULL,
  `promotion_id` VARCHAR(96) NOT NULL,
  `insight_id` VARCHAR(96) NOT NULL,
  `capability_key` VARCHAR(128) NOT NULL,
  `operation_intent` VARCHAR(128) NOT NULL,
  `runtime_surface` VARCHAR(128) NOT NULL,
  `actual_capability_envelope_id` VARCHAR(128) NOT NULL,
  `completion_status` ENUM('remaining_scope_completed_as_gated_no_execution','remaining_scope_blocked','superseded') NOT NULL DEFAULT 'remaining_scope_completed_as_gated_no_execution',
  `completion_policy_status` ENUM('all_remaining_stages_gated_no_execution','blocked') NOT NULL DEFAULT 'all_remaining_stages_gated_no_execution',
  `typed_confirm` VARCHAR(128) NOT NULL,
  `adapter_apply_dispatch_gate_status` ENUM('ready_but_not_requested','blocked') NOT NULL DEFAULT 'ready_but_not_requested',
  `adapter_apply_readback_status` ENUM('blocked_until_adapter_apply_dispatch','not_applicable_no_execution') NOT NULL DEFAULT 'blocked_until_adapter_apply_dispatch',
  `target_write_gate_status` ENUM('blocked_until_adapter_apply_readback','not_applicable_no_execution') NOT NULL DEFAULT 'blocked_until_adapter_apply_readback',
  `target_write_readback_status` ENUM('blocked_until_target_write','not_applicable_no_execution') NOT NULL DEFAULT 'blocked_until_target_write',
  `rollback_plan_status` ENUM('required_before_target_write','not_applicable_no_write') NOT NULL DEFAULT 'required_before_target_write',
  `generalized_registry_status` ENUM('ready_for_multi_target_extension','blocked') NOT NULL DEFAULT 'ready_for_multi_target_extension',
  `ui_review_queue_status` ENUM('ready_for_admin_queue_surface','blocked') NOT NULL DEFAULT 'ready_for_admin_queue_surface',
  `orchestration_test_status` ENUM('ready_for_e2e_no_write_tests','blocked') NOT NULL DEFAULT 'ready_for_e2e_no_write_tests',
  `adapter_apply_requested` TINYINT(1) NOT NULL DEFAULT 0,
  `adapter_apply_executed` TINYINT(1) NOT NULL DEFAULT 0,
  `execution_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `target_write_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `target_write_executed` TINYINT(1) NOT NULL DEFAULT 0,
  `promotion_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `source_adapter_execution_gate_sha256` CHAR(64) NOT NULL,
  `completion_result_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`completion_result_json`)),
  `safety_contract_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`safety_contract_json`)),
  `created_by` VARCHAR(255) NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_session_insight_remaining_scope_completion_id` (`remaining_scope_completion_id`),
  UNIQUE KEY `uq_session_insight_remaining_scope_completion_gate` (`adapter_execution_gate_id`),
  KEY `idx_session_insight_remaining_scope_completion_promotion` (`promotion_id`, `created_at`),
  KEY `idx_session_insight_remaining_scope_completion_envelope` (`actual_capability_envelope_id`, `created_at`),
  CONSTRAINT `fk_session_insight_remaining_scope_completion_gate`
    FOREIGN KEY (`adapter_execution_gate_id`) REFERENCES `session_insight_capability_envelope_adapter_execution_gates` (`adapter_execution_gate_id`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `chk_session_insight_remaining_scope_completion_no_execution`
    CHECK (`adapter_apply_requested` = 0 AND `adapter_apply_executed` = 0 AND `execution_allowed` = 0 AND `target_write_allowed` = 0 AND `target_write_executed` = 0 AND `promotion_allowed` = 0),
  CONSTRAINT `chk_session_insight_remaining_scope_completion_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW `v_session_insight_remaining_scope_completion_issues` AS
SELECT
  c.remaining_scope_completion_id,
  c.adapter_execution_gate_id,
  c.actual_request_id,
  c.actual_capability_envelope_id,
  'remaining_scope_completion_claims_execution_or_write' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('remaining_scope_completion_id', c.remaining_scope_completion_id, 'adapter_apply_requested', c.adapter_apply_requested, 'adapter_apply_executed', c.adapter_apply_executed, 'execution_allowed', c.execution_allowed, 'target_write_allowed', c.target_write_allowed, 'target_write_executed', c.target_write_executed, 'promotion_allowed', c.promotion_allowed, 'secrets_included', false) AS evidence_json
FROM `session_insight_capability_envelope_remaining_scope_completions` c
WHERE c.adapter_apply_requested <> 0
   OR c.adapter_apply_executed <> 0
   OR c.execution_allowed <> 0
   OR c.target_write_allowed <> 0
   OR c.target_write_executed <> 0
   OR c.promotion_allowed <> 0
UNION ALL
SELECT
  c.remaining_scope_completion_id,
  c.adapter_execution_gate_id,
  c.actual_request_id,
  c.actual_capability_envelope_id,
  'remaining_scope_completion_secret_flagged' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('remaining_scope_completion_id', c.remaining_scope_completion_id, 'secrets_included', c.secrets_included) AS evidence_json
FROM `session_insight_capability_envelope_remaining_scope_completions` c
WHERE c.secrets_included <> 0
UNION ALL
SELECT
  c.remaining_scope_completion_id,
  c.adapter_execution_gate_id,
  c.actual_request_id,
  c.actual_capability_envelope_id,
  'remaining_scope_completion_source_gate_changed' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('remaining_scope_completion_id', c.remaining_scope_completion_id, 'stored_gate_sha256', c.source_adapter_execution_gate_sha256, 'current_gate_sha256', SHA2(g.gate_result_json, 256), 'secrets_included', false) AS evidence_json
FROM `session_insight_capability_envelope_remaining_scope_completions` c
JOIN `session_insight_capability_envelope_adapter_execution_gates` g
  ON g.adapter_execution_gate_id = c.adapter_execution_gate_id
WHERE c.source_adapter_execution_gate_sha256 <> SHA2(g.gate_result_json, 256)
UNION ALL
SELECT
  c.remaining_scope_completion_id,
  c.adapter_execution_gate_id,
  c.actual_request_id,
  c.actual_capability_envelope_id,
  'remaining_scope_completion_source_gate_not_ready' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('remaining_scope_completion_id', c.remaining_scope_completion_id, 'adapter_execution_gate_status', g.adapter_execution_gate_status, 'adapter_execution_policy_status', g.adapter_execution_policy_status, 'secrets_included', false) AS evidence_json
FROM `session_insight_capability_envelope_remaining_scope_completions` c
JOIN `session_insight_capability_envelope_adapter_execution_gates` g
  ON g.adapter_execution_gate_id = c.adapter_execution_gate_id
WHERE g.adapter_execution_gate_status <> 'adapter_execution_gate_ready'
   OR g.adapter_execution_policy_status <> 'ready_for_adapter_apply_dispatch';

CREATE OR REPLACE VIEW `v_session_insight_remaining_scope_completion_readiness` AS
SELECT
  c.remaining_scope_completion_id,
  c.adapter_execution_gate_id,
  c.dispatch_readback_id,
  c.approval_decision_id,
  c.actual_request_id,
  c.promotion_id,
  c.capability_key,
  c.operation_intent,
  c.runtime_surface,
  c.actual_capability_envelope_id,
  c.completion_status,
  c.completion_policy_status,
  CASE
    WHEN c.completion_status <> 'remaining_scope_completed_as_gated_no_execution' THEN 'blocked_completion_not_ready'
    WHEN c.completion_policy_status <> 'all_remaining_stages_gated_no_execution' THEN 'blocked_completion_policy_not_ready'
    WHEN c.adapter_apply_requested <> 0 OR c.adapter_apply_executed <> 0 OR c.execution_allowed <> 0 OR c.target_write_allowed <> 0 OR c.target_write_executed <> 0 OR c.promotion_allowed <> 0 THEN 'blocked_completion_claims_execution_or_write'
    ELSE 'remaining_scope_complete_as_gated_no_execution'
  END AS remaining_scope_readiness_status,
  JSON_OBJECT(
    'remaining_scope_completion_id', c.remaining_scope_completion_id,
    'adapter_apply_dispatch_gate_status', c.adapter_apply_dispatch_gate_status,
    'adapter_apply_readback_status', c.adapter_apply_readback_status,
    'target_write_gate_status', c.target_write_gate_status,
    'target_write_readback_status', c.target_write_readback_status,
    'rollback_plan_status', c.rollback_plan_status,
    'generalized_registry_status', c.generalized_registry_status,
    'ui_review_queue_status', c.ui_review_queue_status,
    'orchestration_test_status', c.orchestration_test_status,
    'adapter_apply_requested', false,
    'adapter_apply_executed', false,
    'execution_allowed', false,
    'target_write_allowed', false,
    'target_write_executed', false,
    'promotion_allowed', false,
    'secrets_included', false
  ) AS remaining_scope_readiness_evidence_json,
  0 AS secrets_included
FROM `session_insight_capability_envelope_remaining_scope_completions` c
WHERE c.secrets_included = 0;

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`,
  `execution_scope`, `affects_layer`, `blocking`, `notes`
)
SELECT 'Session Memory Governance', 'session_insight_capability_envelope_remaining_scope_completion_policy_v1',
       JSON_OBJECT(
         'rule','session_insight_remaining_scope_completed_as_gated_no_execution',
         'tools',JSON_ARRAY('session_insight_remaining_scope_completion_create','session_insight_remaining_scope_completion_list'),
         'requires_typed_confirm','COMPLETE_REMAINING_SCOPE_AS_GATED_NO_EXECUTION',
         'covers',JSON_ARRAY('adapter_apply_dispatch_gate','adapter_apply_readback','target_write_gate','target_write_readback','rollback_plan','multi_target_registry','ui_review_queue','e2e_orchestration_tests'),
         'adapter_apply_requested',false,
         'adapter_apply_executed',false,
         'sets_promotion_allowed',false,
         'sets_execution_allowed',false,
         'sets_target_write_allowed',false,
         'target_write_executed',false,
         'provider_runtime_execution_allowed',false,
         'credential_payload_reads_allowed',false,
         'external_writes_allowed',false,
         'raw_transcript_included',false,
         'secrets_included',false
       ),
       'TRUE',
       'session_memory|remaining_scope_completion|no_execution',
       'session_insight_capability_envelope_remaining_scope_completions|admin_platform_endpoint_tools',
       'TRUE',
       'Completes remaining roadmap as gated no-execution readiness without adapter apply or target writes.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group`='Session Memory Governance'
     AND `policy_key`='session_insight_capability_envelope_remaining_scope_completion_policy_v1'
);

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
  (
    'session_insight_remaining_scope_completion_create',
    'Session Insight Remaining Scope Completion Create',
    'Complete the remaining session insight roadmap as gated no-execution readiness. Does not apply adapters or write targets.',
    'POST',
    '/platform/session-insight-promotions/remaining-scope-completions/create',
    NULL,
    JSON_OBJECT('type','object','required',JSON_ARRAY('adapter_execution_gate_id','typed_confirm'),'properties',JSON_OBJECT('adapter_execution_gate_id',JSON_OBJECT('type','string'),'typed_confirm',JSON_OBJECT('type','string','const','COMPLETE_REMAINING_SCOPE_AS_GATED_NO_EXECUTION'),'created_by',JSON_OBJECT('type','string')),'additionalProperties',false),
    NULL,
    'admin,session_memory,remaining_scope_completion,typed_confirm,no_apply,no_target_write,no_secrets',
    1,
    678
  ),
  (
    'session_insight_remaining_scope_completion_list',
    'Session Insight Remaining Scope Completion List',
    'List remaining scope completion ledgers. Read-only.',
    'POST',
    '/platform/session-insight-promotions/remaining-scope-completions/list',
    NULL,
    JSON_OBJECT('type','object','properties',JSON_OBJECT('remaining_scope_completion_id',JSON_OBJECT('type','string'),'adapter_execution_gate_id',JSON_OBJECT('type','string'),'actual_request_id',JSON_OBJECT('type','string'),'promotion_id',JSON_OBJECT('type','string'),'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',100,'default',25)),'additionalProperties',false),
    NULL,
    'admin,session_memory,remaining_scope_completion,read_only,no_apply,no_target_write,no_secrets',
    1,
    679
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
