-- Sprint 68: Session insight contract payload preview generator.
--
-- Adds a readback-only payload preview table for generating target-specific
-- payloads from apply requests and adapter dry-run contracts.
--
-- Preview only: no adapter execution, no target writes, no promotion_allowed=1,
-- no backlog/policy/canonical/provider/credential/external writes, no raw
-- transcripts, no secrets.

CREATE TABLE IF NOT EXISTS `session_insight_promotion_payload_previews` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `payload_preview_id` VARCHAR(128) NOT NULL,
  `apply_request_id` VARCHAR(128) NOT NULL,
  `preview_id` VARCHAR(128) NOT NULL,
  `promotion_id` VARCHAR(96) NOT NULL,
  `insight_id` VARCHAR(96) NOT NULL,
  `adapter_key` VARCHAR(128) NULL,
  `contract_key` VARCHAR(160) NULL,
  `target_surface` VARCHAR(96) NOT NULL,
  `promotion_type` VARCHAR(64) NOT NULL,
  `payload_status` ENUM('payload_preview_generated','payload_preview_blocked','superseded') NOT NULL DEFAULT 'payload_preview_generated',
  `payload_mode` ENUM('dry_run_payload_preview') NOT NULL DEFAULT 'dry_run_payload_preview',
  `execution_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `target_write_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `payload_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`payload_json`)),
  `validation_result_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`validation_result_json`)),
  `safety_contract_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`safety_contract_json`)),
  `created_by` VARCHAR(255) NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_session_insight_payload_preview_id` (`payload_preview_id`),
  KEY `idx_session_insight_payload_preview_apply_request` (`apply_request_id`, `created_at`),
  KEY `idx_session_insight_payload_preview_contract` (`contract_key`, `payload_status`),
  KEY `idx_session_insight_payload_preview_surface` (`target_surface`, `promotion_type`, `payload_status`),
  CONSTRAINT `fk_session_insight_payload_preview_apply_request`
    FOREIGN KEY (`apply_request_id`) REFERENCES `session_insight_promotion_apply_requests` (`apply_request_id`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `chk_session_insight_payload_preview_no_execution` CHECK (`execution_allowed` = 0 AND `target_write_allowed` = 0),
  CONSTRAINT `chk_session_insight_payload_preview_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW `v_session_insight_payload_preview_issues` AS
SELECT
  p.payload_preview_id,
  p.apply_request_id,
  p.promotion_id,
  p.contract_key,
  p.target_surface,
  'payload_preview_claims_execution_or_target_write' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('payload_preview_id', p.payload_preview_id, 'execution_allowed', p.execution_allowed, 'target_write_allowed', p.target_write_allowed, 'secrets_included', false) AS evidence_json
FROM `session_insight_promotion_payload_previews` p
WHERE p.execution_allowed <> 0 OR p.target_write_allowed <> 0
UNION ALL
SELECT
  p.payload_preview_id,
  p.apply_request_id,
  p.promotion_id,
  p.contract_key,
  p.target_surface,
  'payload_preview_secret_flagged' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('payload_preview_id', p.payload_preview_id, 'secrets_included', p.secrets_included) AS evidence_json
FROM `session_insight_promotion_payload_previews` p
WHERE p.secrets_included <> 0
UNION ALL
SELECT
  p.payload_preview_id,
  p.apply_request_id,
  p.promotion_id,
  p.contract_key,
  p.target_surface,
  'payload_preview_not_dry_run_mode' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('payload_preview_id', p.payload_preview_id, 'payload_mode', p.payload_mode, 'secrets_included', false) AS evidence_json
FROM `session_insight_promotion_payload_previews` p
WHERE p.payload_mode <> 'dry_run_payload_preview'
UNION ALL
SELECT
  p.payload_preview_id,
  p.apply_request_id,
  p.promotion_id,
  p.contract_key,
  p.target_surface,
  'payload_preview_invalid_for_contract' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('payload_preview_id', p.payload_preview_id, 'validation_result_json', JSON_EXTRACT(p.validation_result_json, '$'), 'secrets_included', false) AS evidence_json
FROM `session_insight_promotion_payload_previews` p
WHERE JSON_EXTRACT(p.validation_result_json, '$.valid_for_dry_run_contract') <> true
UNION ALL
SELECT
  p.payload_preview_id,
  p.apply_request_id,
  p.promotion_id,
  p.contract_key,
  p.target_surface,
  'payload_preview_claims_runtime_effect' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('payload_preview_id', p.payload_preview_id, 'safety_contract_json', JSON_EXTRACT(p.safety_contract_json, '$'), 'secrets_included', false) AS evidence_json
FROM `session_insight_promotion_payload_previews` p
WHERE JSON_EXTRACT(p.safety_contract_json, '$.adapter_apply_executed') <> false
   OR JSON_EXTRACT(p.safety_contract_json, '$.runtime_promotion_executed') <> false
   OR JSON_EXTRACT(p.safety_contract_json, '$.backlog_policy_canonical_write_executed') <> false
   OR JSON_EXTRACT(p.safety_contract_json, '$.provider_call_executed') <> false
   OR JSON_EXTRACT(p.safety_contract_json, '$.external_write_executed') <> false;

CREATE OR REPLACE VIEW `v_session_insight_payload_preview_readiness` AS
SELECT
  r.apply_request_id,
  r.promotion_id,
  r.promotion_type,
  r.target_surface,
  cr.contract_key,
  cr.contract_readiness_status,
  pp.payload_preview_id,
  pp.payload_status,
  pp.payload_mode,
  pp.execution_allowed,
  pp.target_write_allowed,
  CASE
    WHEN cr.contract_readiness_status <> 'mapped_dry_run_contract_blocked_for_apply_adapter' THEN 'blocked_contract_not_ready_for_payload_preview'
    WHEN pp.payload_preview_id IS NULL THEN 'ready_for_payload_preview_generation'
    WHEN pp.execution_allowed <> 0 OR pp.target_write_allowed <> 0 THEN 'invalid_payload_preview_claims_execution'
    WHEN JSON_EXTRACT(pp.validation_result_json, '$.valid_for_dry_run_contract') <> true THEN 'invalid_payload_preview_contract_validation_failed'
    ELSE 'payload_preview_generated_blocked_for_apply_adapter'
  END AS payload_preview_readiness_status,
  JSON_OBJECT(
    'apply_request_id', r.apply_request_id,
    'payload_preview_id', pp.payload_preview_id,
    'contract_key', cr.contract_key,
    'dry_run_payload_preview_only', true,
    'execution_allowed', false,
    'target_write_allowed', false,
    'adapter_apply_executed', false,
    'backlog_policy_canonical_write_executed', false,
    'provider_call_executed', false,
    'external_write_executed', false,
    'secrets_included', false
  ) AS readiness_evidence_json,
  0 AS secrets_included
FROM `session_insight_promotion_apply_requests` r
LEFT JOIN `v_session_insight_apply_request_contract_readiness` cr
  ON cr.apply_request_id = r.apply_request_id
LEFT JOIN `session_insight_promotion_payload_previews` pp
  ON pp.apply_request_id = r.apply_request_id
 AND pp.secrets_included = 0
WHERE r.secrets_included = 0;

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`,
  `execution_scope`, `affects_layer`, `blocking`, `notes`
)
SELECT 'Session Memory Governance', 'session_insight_contract_payload_preview_policy_v1',
       JSON_OBJECT(
         'rule','session_insight_contract_payload_preview_only',
         'tool','session_insight_contract_payload_preview_generate',
         'accepted_source','session_insight_promotion_apply_requests',
         'requires_active_dry_run_contract',true,
         'payload_preview_only',true,
         'execution_allowed',false,
         'target_write_allowed',false,
         'sets_promotion_allowed',false,
         'assigns_executor',false,
         'writes_backlog_policy_or_canonical',false,
         'provider_calls_allowed',false,
         'credential_payload_reads_allowed',false,
         'external_writes_allowed',false,
         'raw_transcript_included',false,
         'secrets_included',false
       ),
       'TRUE',
       'session_memory|promotion_payload_preview|dry_run_contract',
       'session_insight_promotion_payload_previews|session_insight_promotion_adapter_contracts|admin_platform_endpoint_tools',
       'TRUE',
       'Contract payload preview generates dry-run payloads only and never writes target surfaces.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group`='Session Memory Governance'
     AND `policy_key`='session_insight_contract_payload_preview_policy_v1'
);

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES (
  'session_insight_contract_payload_preview_generate',
  'Session Insight Contract Payload Preview Generate',
  'Generate a dry-run payload preview from a capability-gated apply request and active adapter contract. Preview/readback only: never executes adapters, never writes target surfaces, never calls providers, never reads credentials, and never returns secrets.',
  'POST',
  '/platform/session-insight-promotions/payload-preview/generate',
  NULL,
  JSON_OBJECT('type','object','required',JSON_ARRAY('apply_request_id'),'properties',JSON_OBJECT('apply_request_id',JSON_OBJECT('type','string'),'created_by',JSON_OBJECT('type','string')),'additionalProperties',false),
  NULL,
  'admin,session_memory,payload_preview,dry_run,read_only,no_execution,no_secrets',
  1,
  656
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
