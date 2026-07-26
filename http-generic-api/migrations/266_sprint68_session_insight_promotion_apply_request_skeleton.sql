-- Sprint 68: Session insight promotion apply request skeleton.
--
-- Adds a capability-gated request ledger for turning dry-run previews into
-- future apply work. This migration does not execute promotions, does not assign
-- executors, does not set promotion_allowed=1, and does not write backlog,
-- policy, canonical, provider, credential, or external systems.
--
-- Idempotent. Additive only. No secrets.

CREATE TABLE IF NOT EXISTS `session_insight_promotion_apply_requests` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `apply_request_id` VARCHAR(128) NOT NULL,
  `preview_id` VARCHAR(128) NOT NULL,
  `promotion_id` VARCHAR(96) NOT NULL,
  `insight_id` VARCHAR(96) NOT NULL,
  `promotion_type` VARCHAR(64) NOT NULL,
  `target_surface` VARCHAR(96) NOT NULL,
  `requested_operation` VARCHAR(128) NOT NULL,
  `request_status` ENUM('blocked_requires_capability_envelope','ready_for_adapter_design','rejected','superseded') NOT NULL DEFAULT 'blocked_requires_capability_envelope',
  `capability_envelope_required` TINYINT(1) NOT NULL DEFAULT 1,
  `capability_envelope_id` VARCHAR(128) NULL,
  `adapter_key_required` TINYINT(1) NOT NULL DEFAULT 1,
  `target_adapter_key` VARCHAR(128) NULL,
  `execution_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `execution_status` ENUM('not_executed','blocked','superseded') NOT NULL DEFAULT 'not_executed',
  `proposed_write_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`proposed_write_json`)),
  `gating_result_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`gating_result_json`)),
  `safety_contract_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`safety_contract_json`)),
  `requested_by` VARCHAR(255) NULL,
  `decision_notes` TEXT NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_session_insight_promotion_apply_request` (`apply_request_id`),
  KEY `idx_session_insight_promotion_apply_request_preview` (`preview_id`, `created_at`),
  KEY `idx_session_insight_promotion_apply_request_promotion` (`promotion_id`, `request_status`),
  KEY `idx_session_insight_promotion_apply_request_surface` (`target_surface`, `request_status`),
  CONSTRAINT `fk_session_insight_promotion_apply_request_preview`
    FOREIGN KEY (`preview_id`) REFERENCES `session_insight_promotion_execution_previews` (`preview_id`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `chk_session_insight_promotion_apply_request_no_execution` CHECK (`execution_allowed` = 0),
  CONSTRAINT `chk_session_insight_promotion_apply_request_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW `v_session_insight_promotion_apply_request_issues` AS
SELECT
  r.apply_request_id,
  r.preview_id,
  r.promotion_id,
  r.promotion_type,
  r.target_surface,
  'execution_allowed_on_apply_request_skeleton' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('apply_request_id', r.apply_request_id, 'execution_allowed', r.execution_allowed, 'secrets_included', false) AS evidence_json
FROM `session_insight_promotion_apply_requests` r
WHERE r.execution_allowed <> 0
UNION ALL
SELECT
  r.apply_request_id,
  r.preview_id,
  r.promotion_id,
  r.promotion_type,
  r.target_surface,
  'apply_request_secret_flagged' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('apply_request_id', r.apply_request_id, 'secrets_included', r.secrets_included) AS evidence_json
FROM `session_insight_promotion_apply_requests` r
WHERE r.secrets_included <> 0
UNION ALL
SELECT
  r.apply_request_id,
  r.preview_id,
  r.promotion_id,
  r.promotion_type,
  r.target_surface,
  'apply_request_without_capability_gate' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('apply_request_id', r.apply_request_id, 'capability_envelope_required', r.capability_envelope_required, 'capability_envelope_id', r.capability_envelope_id, 'secrets_included', false) AS evidence_json
FROM `session_insight_promotion_apply_requests` r
WHERE r.capability_envelope_required <> 1
   OR r.capability_envelope_id IS NOT NULL
UNION ALL
SELECT
  r.apply_request_id,
  r.preview_id,
  r.promotion_id,
  r.promotion_type,
  r.target_surface,
  'apply_request_without_adapter_gate' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('apply_request_id', r.apply_request_id, 'adapter_key_required', r.adapter_key_required, 'target_adapter_key', r.target_adapter_key, 'secrets_included', false) AS evidence_json
FROM `session_insight_promotion_apply_requests` r
WHERE r.adapter_key_required <> 1
   OR r.target_adapter_key IS NOT NULL
UNION ALL
SELECT
  r.apply_request_id,
  r.preview_id,
  r.promotion_id,
  r.promotion_type,
  r.target_surface,
  'apply_request_claims_runtime_effect' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('apply_request_id', r.apply_request_id, 'safety_contract_json', JSON_EXTRACT(r.safety_contract_json, '$'), 'secrets_included', false) AS evidence_json
FROM `session_insight_promotion_apply_requests` r
WHERE JSON_EXTRACT(r.safety_contract_json, '$.runtime_promotion_executed') <> false
   OR JSON_EXTRACT(r.safety_contract_json, '$.backlog_policy_canonical_write_executed') <> false
   OR JSON_EXTRACT(r.safety_contract_json, '$.provider_call_executed') <> false
   OR JSON_EXTRACT(r.safety_contract_json, '$.external_write_executed') <> false;

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`,
  `execution_scope`, `affects_layer`, `blocking`, `notes`
)
SELECT 'Session Memory Governance', 'session_insight_promotion_apply_request_skeleton_policy_v1',
       JSON_OBJECT(
         'rule','session_insight_promotion_apply_request_skeleton_only',
         'tool','session_insight_promotion_apply_request_create',
         'accepted_source','session_insight_promotion_execution_previews',
         'requires_capability_envelope',true,
         'requires_target_adapter',true,
         'execution_allowed',false,
         'sets_promotion_allowed',false,
         'assigns_executor',false,
         'writes_backlog_policy_or_canonical',false,
         'provider_calls_allowed',false,
         'credential_payload_reads_allowed',false,
         'external_writes_allowed',false,
         'raw_transcript_included',false,
         'secrets_included',false
       ),
       'session_memory|promotion_apply_request|capability_gate_skeleton',
       'session_insight_promotion_apply_requests|session_insight_promotion_execution_previews|admin_platform_endpoint_tools',
       'TRUE',
       'Apply request skeleton records a blocked request for a future capability-envelope and adapter layer. It never executes promotion.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group`='Session Memory Governance'
     AND `policy_key`='session_insight_promotion_apply_request_skeleton_policy_v1'
);

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES (
  'session_insight_promotion_apply_request_create',
  'Session Insight Promotion Apply Request Create',
  'Create a blocked capability-gated apply request from a dry-run preview. Skeleton only: never executes promotions, never writes backlog/policy/canonicals, never assigns executors, never calls providers, never reads credentials, and never returns secrets.',
  'POST',
  '/platform/session-insight-promotions/apply/request',
  NULL,
  JSON_OBJECT('type','object','required',JSON_ARRAY('preview_id'),'properties',JSON_OBJECT('preview_id',JSON_OBJECT('type','string'),'requested_by',JSON_OBJECT('type','string'),'decision_notes',JSON_OBJECT('type','string'),'request_notes',JSON_OBJECT('type','string')),'additionalProperties',false),
  NULL,
  'admin,session_memory,promotion_apply_request,skeleton,capability_gate,no_execution,no_secrets',
  1,
  653
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
