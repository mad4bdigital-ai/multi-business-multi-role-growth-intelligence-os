-- Sprint 68: Session Insight target write readback validator.
-- Read-only post-write validation. No target write creation, target item mutation,
-- rollback execution, provider calls, credential payload reads, external writes,
-- raw transcripts, or secrets.
-- Safety markers: no_provider_call, no_credential_payload_read, no_raw_secrets,
-- no_external_send, no_external_write, secrets_included_false.

CREATE TABLE IF NOT EXISTS `session_insight_target_write_readbacks` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `readback_id` VARCHAR(128) NOT NULL,
  `target_write_id` VARCHAR(128) NOT NULL,
  `target_item_id` VARCHAR(128) NOT NULL,
  `remaining_scope_completion_id` VARCHAR(128) NOT NULL,
  `actual_request_id` VARCHAR(128) NOT NULL,
  `actual_capability_envelope_id` VARCHAR(128) NOT NULL,
  `promotion_id` VARCHAR(96) NOT NULL,
  `insight_id` VARCHAR(96) NOT NULL,
  `target_surface` VARCHAR(96) NOT NULL,
  `promotion_type` VARCHAR(64) NOT NULL,
  `readback_status` ENUM('target_write_readback_passed','target_write_readback_failed') NOT NULL,
  `readback_mode` ENUM('read_only_validation') NOT NULL DEFAULT 'read_only_validation',
  `target_item_exists` TINYINT(1) NOT NULL DEFAULT 0,
  `target_link_matches` TINYINT(1) NOT NULL DEFAULT 0,
  `source_payload_matches` TINYINT(1) NOT NULL DEFAULT 0,
  `target_write_status_matches` TINYINT(1) NOT NULL DEFAULT 0,
  `duplicate_target_write_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `duplicate_target_item_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `provider_call_executed` TINYINT(1) NOT NULL DEFAULT 0,
  `credential_payload_read` TINYINT(1) NOT NULL DEFAULT 0,
  `external_write_executed` TINYINT(1) NOT NULL DEFAULT 0,
  `raw_transcript_included` TINYINT(1) NOT NULL DEFAULT 0,
  `target_modified_by_readback` TINYINT(1) NOT NULL DEFAULT 0,
  `readback_result_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`readback_result_json`)),
  `safety_contract_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`safety_contract_json`)),
  `created_by` VARCHAR(255) NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_session_insight_target_write_readback_id` (`readback_id`),
  KEY `idx_session_insight_target_write_readback_write` (`target_write_id`, `created_at`),
  KEY `idx_session_insight_target_write_readback_status` (`readback_status`, `target_surface`),
  CONSTRAINT `fk_session_insight_target_write_readback_write`
    FOREIGN KEY (`target_write_id`) REFERENCES `session_insight_backlog_target_writes` (`target_write_id`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `chk_session_insight_target_write_readback_read_only`
    CHECK (`provider_call_executed` = 0 AND `credential_payload_read` = 0 AND `external_write_executed` = 0 AND `raw_transcript_included` = 0 AND `target_modified_by_readback` = 0),
  CONSTRAINT `chk_session_insight_target_write_readback_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW `v_session_insight_target_write_readback_issues` AS
SELECT readback_id, target_write_id, target_item_id, promotion_id,
       'target_write_readback_failed' AS issue_code, 'fail' AS severity,
       JSON_OBJECT('readback_id', readback_id, 'readback_result_json', JSON_EXTRACT(readback_result_json, '$'), 'secrets_included', false) AS evidence_json
  FROM `session_insight_target_write_readbacks`
 WHERE readback_status <> 'target_write_readback_passed'
UNION ALL
SELECT readback_id, target_write_id, target_item_id, promotion_id,
       'target_write_readback_claims_runtime_effect' AS issue_code, 'fail' AS severity,
       JSON_OBJECT('readback_id', readback_id, 'provider_call_executed', provider_call_executed, 'credential_payload_read', credential_payload_read, 'external_write_executed', external_write_executed, 'raw_transcript_included', raw_transcript_included, 'target_modified_by_readback', target_modified_by_readback, 'secrets_included', false) AS evidence_json
  FROM `session_insight_target_write_readbacks`
 WHERE provider_call_executed <> 0 OR credential_payload_read <> 0 OR external_write_executed <> 0 OR raw_transcript_included <> 0 OR target_modified_by_readback <> 0
UNION ALL
SELECT readback_id, target_write_id, target_item_id, promotion_id,
       'target_write_readback_secret_flagged' AS issue_code, 'fail' AS severity,
       JSON_OBJECT('readback_id', readback_id, 'secrets_included', secrets_included) AS evidence_json
  FROM `session_insight_target_write_readbacks`
 WHERE secrets_included <> 0;

CREATE OR REPLACE VIEW `v_session_insight_target_write_readback_readiness` AS
SELECT w.target_write_id, w.target_item_id, w.promotion_id, w.insight_id, w.target_surface, w.promotion_type,
       w.target_write_status, w.target_write_executed,
       latest.readback_id, latest.readback_status,
       CASE
         WHEN w.target_write_status <> 'target_write_executed' OR w.target_write_executed <> 1 THEN 'blocked_target_write_not_executed'
         WHEN latest.readback_id IS NULL THEN 'ready_for_target_write_readback'
         WHEN latest.readback_status = 'target_write_readback_passed' THEN 'target_write_readback_passed'
         ELSE 'target_write_readback_failed'
       END AS target_write_readback_readiness_status,
       JSON_OBJECT('target_write_id', w.target_write_id, 'readback_id', latest.readback_id, 'readback_only', true, 'target_item_modified_by_readback', false, 'rollback_executed', false, 'provider_call_executed', false, 'credential_payload_read', false, 'external_write_executed', false, 'raw_transcript_included', false, 'secrets_included', false) AS readiness_evidence_json,
       0 AS secrets_included
  FROM `session_insight_backlog_target_writes` w
  LEFT JOIN (
    SELECT r.* FROM `session_insight_target_write_readbacks` r
    JOIN (SELECT target_write_id, MAX(id) max_id FROM `session_insight_target_write_readbacks` WHERE secrets_included = 0 GROUP BY target_write_id) mx ON mx.max_id = r.id
  ) latest ON latest.target_write_id = w.target_write_id
 WHERE w.secrets_included = 0;

INSERT INTO `execution_policies` (`policy_group`, `policy_key`, `policy_value`, `active`, `execution_scope`, `affects_layer`, `blocking`, `notes`)
SELECT 'Session Memory Governance', 'session_insight_target_write_readback_policy_v1',
       JSON_OBJECT('rule','session_insight_target_write_readback_read_only','tools',JSON_ARRAY('session_insight_target_write_readback_create','session_insight_target_write_readback_list'),'creates_target_write',false,'modifies_target_item',false,'executes_rollback',false,'provider_calls_allowed',false,'credential_payload_reads_allowed',false,'external_writes_allowed',false,'raw_transcript_included',false,'secrets_included',false),
       'TRUE','session_memory|target_write_readback|post_write_validation','session_insight_target_write_readbacks|session_insight_backlog_target_writes|session_insight_backlog_target_items|admin_platform_endpoint_tools','TRUE','Target write readback validates already-executed internal target writes without target mutation or rollback.'
WHERE NOT EXISTS (SELECT 1 FROM `execution_policies` WHERE `policy_group`='Session Memory Governance' AND `policy_key`='session_insight_target_write_readback_policy_v1');

INSERT INTO `admin_platform_endpoint_tools` (`tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`) VALUES
('session_insight_target_write_readback_create','Session Insight Target Write Readback Create','Read-only validation for an already executed Session Insight backlog target write. No target mutation, rollback, provider calls, credentials, external writes, raw transcripts, or secrets.','POST','/platform/session-insight-promotions/target-write-readbacks/create',NULL,JSON_OBJECT('type','object','required',JSON_ARRAY('target_write_id'),'properties',JSON_OBJECT('target_write_id',JSON_OBJECT('type','string'),'created_by',JSON_OBJECT('type','string')),'additionalProperties',false),NULL,'admin,session_memory,target_write_readback,read_only,no_target_write,no_rollback,no_secrets',1,683),
('session_insight_target_write_readback_list','Session Insight Target Write Readback List','List read-only target write readbacks and diagnostics. No target mutation, rollback, provider calls, credentials, external writes, raw transcripts, or secrets.','POST','/platform/session-insight-promotions/target-write-readbacks/list',NULL,JSON_OBJECT('type','object','properties',JSON_OBJECT('readback_id',JSON_OBJECT('type','string'),'target_write_id',JSON_OBJECT('type','string'),'target_item_id',JSON_OBJECT('type','string'),'promotion_id',JSON_OBJECT('type','string'),'target_surface',JSON_OBJECT('type','string'),'readback_status',JSON_OBJECT('type','string'),'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',100,'default',25)),'additionalProperties',false),NULL,'admin,session_memory,target_write_readback,read_only,no_target_write,no_rollback,no_secrets',1,684)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), description=VALUES(description), http_method=VALUES(http_method), http_path=VALUES(http_path), path_param_keys=VALUES(path_param_keys), input_schema=VALUES(input_schema), fixed_body=VALUES(fixed_body), tags=VALUES(tags), is_enabled=VALUES(is_enabled), sort_order=VALUES(sort_order), updated_at=CURRENT_TIMESTAMP;
