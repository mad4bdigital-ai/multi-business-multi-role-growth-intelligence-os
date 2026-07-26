-- Sprint 68: Session insight adapter dry-run contracts foundation.
--
-- Adds adapter-specific dry-run payload contracts for session insight promotion
-- target adapters. These contracts describe what would be written by a future
-- adapter, but remain dry-run/readback only.
--
-- Foundation only: no apply support, no executor assignment, no backlog/policy/
-- canonical/provider/credential/external writes, no raw transcripts, no secrets.

CREATE TABLE IF NOT EXISTS `session_insight_promotion_adapter_contracts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `contract_key` VARCHAR(160) NOT NULL,
  `adapter_key` VARCHAR(128) NOT NULL,
  `promotion_type` VARCHAR(64) NOT NULL,
  `target_surface` VARCHAR(96) NOT NULL,
  `contract_version` VARCHAR(40) NOT NULL DEFAULT 'v1',
  `contract_status` ENUM('active','inactive','deprecated') NOT NULL DEFAULT 'active',
  `contract_mode` ENUM('dry_run_contract') NOT NULL DEFAULT 'dry_run_contract',
  `payload_schema_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`payload_schema_json`)),
  `required_fields_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`required_fields_json`)),
  `forbidden_fields_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`forbidden_fields_json`)),
  `sample_payload_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`sample_payload_json`)),
  `validator_rules_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`validator_rules_json`)),
  `safety_contract_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`safety_contract_json`)),
  `apply_supported` TINYINT(1) NOT NULL DEFAULT 0,
  `execution_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `status` ENUM('active','inactive','deprecated') NOT NULL DEFAULT 'active',
  `notes` TEXT NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_session_insight_adapter_contract_key` (`contract_key`),
  UNIQUE KEY `uq_session_insight_adapter_contract_adapter` (`adapter_key`, `contract_version`),
  KEY `idx_session_insight_adapter_contract_surface` (`target_surface`, `promotion_type`, `status`),
  CONSTRAINT `fk_session_insight_adapter_contract_adapter`
    FOREIGN KEY (`adapter_key`) REFERENCES `session_insight_promotion_target_adapters` (`adapter_key`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `chk_session_insight_adapter_contract_no_apply` CHECK (`apply_supported` = 0 AND `execution_allowed` = 0),
  CONSTRAINT `chk_session_insight_adapter_contract_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW `v_session_insight_adapter_contract_issues` AS
SELECT
  c.contract_key,
  c.adapter_key,
  c.promotion_type,
  c.target_surface,
  'contract_claims_apply_or_execution' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('contract_key', c.contract_key, 'apply_supported', c.apply_supported, 'execution_allowed', c.execution_allowed, 'secrets_included', false) AS evidence_json
FROM `session_insight_promotion_adapter_contracts` c
WHERE c.apply_supported <> 0 OR c.execution_allowed <> 0
UNION ALL
SELECT
  c.contract_key,
  c.adapter_key,
  c.promotion_type,
  c.target_surface,
  'contract_not_dry_run_mode' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('contract_key', c.contract_key, 'contract_mode', c.contract_mode, 'secrets_included', false) AS evidence_json
FROM `session_insight_promotion_adapter_contracts` c
WHERE c.contract_mode <> 'dry_run_contract'
UNION ALL
SELECT
  c.contract_key,
  c.adapter_key,
  c.promotion_type,
  c.target_surface,
  'contract_secret_flagged' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('contract_key', c.contract_key, 'secrets_included', c.secrets_included) AS evidence_json
FROM `session_insight_promotion_adapter_contracts` c
WHERE c.secrets_included <> 0
UNION ALL
SELECT
  CONCAT('missing_contract.', a.adapter_key) AS contract_key,
  a.adapter_key,
  a.promotion_type,
  a.target_surface,
  'adapter_missing_active_dry_run_contract' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('adapter_key', a.adapter_key, 'promotion_type', a.promotion_type, 'target_surface', a.target_surface, 'secrets_included', false) AS evidence_json
FROM `session_insight_promotion_target_adapters` a
LEFT JOIN `session_insight_promotion_adapter_contracts` c
  ON c.adapter_key = a.adapter_key
 AND c.status = 'active'
WHERE a.status = 'active'
  AND a.secrets_included = 0
  AND c.contract_key IS NULL;

CREATE OR REPLACE VIEW `v_session_insight_apply_request_contract_readiness` AS
SELECT
  r.apply_request_id,
  r.preview_id,
  r.promotion_id,
  r.promotion_type,
  r.target_surface,
  ar.adapter_key,
  ar.adapter_readiness_status,
  c.contract_key,
  c.contract_version,
  c.contract_status,
  c.contract_mode,
  c.apply_supported,
  c.execution_allowed AS contract_execution_allowed,
  CASE
    WHEN r.execution_allowed <> 0 THEN 'invalid_apply_request_execution_allowed'
    WHEN ar.adapter_key IS NULL THEN 'blocked_missing_adapter'
    WHEN c.contract_key IS NULL THEN 'blocked_missing_adapter_contract'
    WHEN c.contract_mode <> 'dry_run_contract' THEN 'blocked_contract_not_dry_run'
    WHEN c.apply_supported <> 0 OR c.execution_allowed <> 0 THEN 'blocked_contract_claims_execution'
    WHEN c.contract_status <> 'active' OR c.status <> 'active' THEN 'blocked_contract_not_active'
    ELSE 'mapped_dry_run_contract_blocked_for_apply_adapter'
  END AS contract_readiness_status,
  JSON_OBJECT(
    'apply_request_id', r.apply_request_id,
    'adapter_key', ar.adapter_key,
    'contract_key', c.contract_key,
    'dry_run_contract_only', true,
    'execution_allowed', false,
    'apply_supported', false,
    'capability_envelope_required', true,
    'target_adapter_implementation_required', true,
    'backlog_policy_canonical_write_executed', false,
    'provider_call_executed', false,
    'credential_payload_read', false,
    'external_write_executed', false,
    'secrets_included', false
  ) AS readiness_evidence_json,
  0 AS secrets_included
FROM `session_insight_promotion_apply_requests` r
LEFT JOIN `v_session_insight_apply_request_adapter_readiness` ar
  ON ar.apply_request_id = r.apply_request_id
LEFT JOIN `session_insight_promotion_adapter_contracts` c
  ON c.adapter_key = ar.adapter_key
 AND c.status = 'active'
WHERE r.secrets_included = 0;

INSERT INTO `session_insight_promotion_adapter_contracts` (
  `contract_key`, `adapter_key`, `promotion_type`, `target_surface`, `contract_version`,
  `contract_status`, `contract_mode`, `payload_schema_json`, `required_fields_json`,
  `forbidden_fields_json`, `sample_payload_json`, `validator_rules_json`,
  `safety_contract_json`, `apply_supported`, `execution_allowed`, `status`, `notes`, `secrets_included`
) VALUES
  (
    'session_insight.runtime_repair_backlog.dry_run_contract.v1',
    'session_insight.runtime_repair_backlog.skeleton_adapter',
    'runtime_repair_backlog_item',
    'runtime_repair_backlog',
    'v1', 'active', 'dry_run_contract',
    JSON_OBJECT('type','object','additionalProperties',false,'required',JSON_ARRAY('title','problem_statement','evidence_summary','suggested_next_action','source_promotion_id','source_insight_id','risk_level','confidence'),'properties',JSON_OBJECT('title',JSON_OBJECT('type','string','maxLength',255),'problem_statement',JSON_OBJECT('type','string','maxLength',2000),'evidence_summary',JSON_OBJECT('type','string','maxLength',2000),'suggested_next_action',JSON_OBJECT('type','string','maxLength',1000),'source_promotion_id',JSON_OBJECT('type','string'),'source_insight_id',JSON_OBJECT('type','string'),'risk_level',JSON_OBJECT('type','string'),'confidence',JSON_OBJECT('type','number'))),
    JSON_ARRAY('title','problem_statement','evidence_summary','suggested_next_action','source_promotion_id','source_insight_id','risk_level','confidence'),
    JSON_ARRAY('secret','password','token','credential','credential_payload','provider_call','external_write','execute','apply_now'),
    JSON_OBJECT('title','Runtime repair backlog draft','problem_statement','Dry-run only runtime gap summary.','evidence_summary','Source session insight candidate and promotion proposal summary only.','suggested_next_action','Design a governed repair task after capability approval.','source_promotion_id','promo_example','source_insight_id','insight_example','risk_level','medium','confidence',0.5),
    JSON_ARRAY('must_include_source_ids','must_exclude_secret_terms','must_not_execute_provider_call','must_not_assign_executor','must_not_set_promotion_allowed'),
    JSON_OBJECT('dry_run_contract_only',true,'apply_supported',false,'execution_allowed',false,'runtime_promotion_executed',false,'backlog_policy_canonical_write_executed',false,'provider_call_executed',false,'credential_payload_read',false,'external_write_executed',false,'raw_transcript_included',false,'secrets_included',false),
    0, 0, 'active', 'Dry-run payload contract only for a future runtime repair backlog adapter.', 0
  ),
  (
    'session_insight.development_backlog.dry_run_contract.v1',
    'session_insight.development_backlog.skeleton_adapter',
    'development_backlog_item',
    'development_backlog',
    'v1', 'active', 'dry_run_contract',
    JSON_OBJECT('type','object','additionalProperties',false,'required',JSON_ARRAY('title','description','acceptance_criteria','source_promotion_id','source_insight_id','risk_level','confidence'),'properties',JSON_OBJECT('title',JSON_OBJECT('type','string','maxLength',255),'description',JSON_OBJECT('type','string','maxLength',4000),'acceptance_criteria',JSON_OBJECT('type','array','items',JSON_OBJECT('type','string')),'source_promotion_id',JSON_OBJECT('type','string'),'source_insight_id',JSON_OBJECT('type','string'),'risk_level',JSON_OBJECT('type','string'),'confidence',JSON_OBJECT('type','number'))),
    JSON_ARRAY('title','description','acceptance_criteria','source_promotion_id','source_insight_id','risk_level','confidence'),
    JSON_ARRAY('secret','password','token','credential','credential_payload','provider_call','external_write','execute','apply_now'),
    JSON_OBJECT('title','Development backlog draft','description','Dry-run only development idea summary.','acceptance_criteria',JSON_ARRAY('Governed capability envelope exists','Adapter implementation is tested','Release readiness passes'),'source_promotion_id','promo_example','source_insight_id','insight_example','risk_level','medium','confidence',0.5),
    JSON_ARRAY('must_include_acceptance_criteria','must_include_source_ids','must_exclude_secret_terms','must_not_write_backlog','must_not_set_promotion_allowed'),
    JSON_OBJECT('dry_run_contract_only',true,'apply_supported',false,'execution_allowed',false,'runtime_promotion_executed',false,'backlog_policy_canonical_write_executed',false,'provider_call_executed',false,'credential_payload_read',false,'external_write_executed',false,'raw_transcript_included',false,'secrets_included',false),
    0, 0, 'active', 'Dry-run payload contract only for a future development backlog adapter.', 0
  ),
  (
    'session_insight.integration_backlog.dry_run_contract.v1',
    'session_insight.integration_backlog.skeleton_adapter',
    'integration_backlog_item',
    'integration_backlog',
    'v1', 'active', 'dry_run_contract',
    JSON_OBJECT('type','object','additionalProperties',false,'required',JSON_ARRAY('title','integration_need','target_system','source_promotion_id','source_insight_id','risk_level','confidence'),'properties',JSON_OBJECT('title',JSON_OBJECT('type','string','maxLength',255),'integration_need',JSON_OBJECT('type','string','maxLength',3000),'target_system',JSON_OBJECT('type','string','maxLength',255),'source_promotion_id',JSON_OBJECT('type','string'),'source_insight_id',JSON_OBJECT('type','string'),'risk_level',JSON_OBJECT('type','string'),'confidence',JSON_OBJECT('type','number'))),
    JSON_ARRAY('title','integration_need','target_system','source_promotion_id','source_insight_id','risk_level','confidence'),
    JSON_ARRAY('secret','password','token','credential','credential_payload','provider_call','external_write','execute','apply_now'),
    JSON_OBJECT('title','Integration backlog draft','integration_need','Dry-run only integration need summary.','target_system','to_be_resolved_by_review','source_promotion_id','promo_example','source_insight_id','insight_example','risk_level','medium','confidence',0.5),
    JSON_ARRAY('must_include_target_system','must_include_source_ids','must_exclude_secret_terms','must_not_call_provider','must_not_set_promotion_allowed'),
    JSON_OBJECT('dry_run_contract_only',true,'apply_supported',false,'execution_allowed',false,'runtime_promotion_executed',false,'backlog_policy_canonical_write_executed',false,'provider_call_executed',false,'credential_payload_read',false,'external_write_executed',false,'raw_transcript_included',false,'secrets_included',false),
    0, 0, 'active', 'Dry-run payload contract only for a future integration backlog adapter.', 0
  )
ON DUPLICATE KEY UPDATE
  `contract_status` = 'active',
  `contract_mode` = 'dry_run_contract',
  `payload_schema_json` = VALUES(`payload_schema_json`),
  `required_fields_json` = VALUES(`required_fields_json`),
  `forbidden_fields_json` = VALUES(`forbidden_fields_json`),
  `sample_payload_json` = VALUES(`sample_payload_json`),
  `validator_rules_json` = VALUES(`validator_rules_json`),
  `safety_contract_json` = VALUES(`safety_contract_json`),
  `apply_supported` = 0,
  `execution_allowed` = 0,
  `status` = 'active',
  `notes` = VALUES(`notes`),
  `secrets_included` = 0,
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`,
  `execution_scope`, `affects_layer`, `blocking`, `notes`
)
SELECT 'Session Memory Governance', 'session_insight_adapter_dry_run_contract_policy_v1',
       JSON_OBJECT(
         'rule','session_insight_adapter_dry_run_contract_only',
         'tool','session_insight_adapter_contract_list',
         'dry_run_contract_only',true,
         'apply_supported',false,
         'execution_allowed',false,
         'requires_capability_envelope',true,
         'requires_target_adapter_implementation',true,
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
       'session_memory|promotion_adapter_contract|dry_run_contract',
       'session_insight_promotion_adapter_contracts|session_insight_promotion_apply_requests|admin_platform_endpoint_tools',
       'TRUE',
       'Adapter dry-run contracts describe future target payload shapes only. No adapter execution is enabled.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group`='Session Memory Governance'
     AND `policy_key`='session_insight_adapter_dry_run_contract_policy_v1'
);

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES (
  'session_insight_adapter_contract_list',
  'Session Insight Adapter Contract List',
  'Read adapter-specific dry-run payload contracts and apply-request contract readiness. Readback only: never executes adapters, never writes backlog/policy/canonicals, never calls providers, never reads credentials, and never returns secrets.',
  'POST',
  '/platform/session-insight-promotions/adapter-contracts/list',
  NULL,
  JSON_OBJECT('type','object','properties',JSON_OBJECT('contract_key',JSON_OBJECT('type','string'),'adapter_key',JSON_OBJECT('type','string'),'promotion_type',JSON_OBJECT('type','string'),'target_surface',JSON_OBJECT('type','string'),'contract_status',JSON_OBJECT('type','string','enum',JSON_ARRAY('active','inactive','deprecated')),'status',JSON_OBJECT('type','string','enum',JSON_ARRAY('active','inactive','deprecated')),'q',JSON_OBJECT('type','string'),'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',100,'default',25)),'additionalProperties',false),
  NULL,
  'admin,session_memory,adapter_contract,dry_run,read_only,no_execution,no_secrets',
  1,
  655
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
