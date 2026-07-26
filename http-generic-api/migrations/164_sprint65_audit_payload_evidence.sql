-- Sprint 65: Audit payload evidence governance.
-- Stores bounded, redacted request/response evidence previews plus hashes.
-- Full raw payload values and secret values must not be stored in this table.

CREATE TABLE IF NOT EXISTS `audit_payload_evidence` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `evidence_id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NULL,
  `actor_id` VARCHAR(191) NULL,
  `actor_type` VARCHAR(64) NULL,
  `action` VARCHAR(191) NOT NULL,
  `resource_type` VARCHAR(100) NULL,
  `resource_id` VARCHAR(191) NULL,
  `source_table` VARCHAR(120) NULL,
  `source_pk` VARCHAR(191) NULL,
  `evidence_type` VARCHAR(80) NOT NULL DEFAULT 'request_response',
  `request_preview` LONGTEXT NULL,
  `request_sha256` VARCHAR(64) NULL,
  `response_preview` LONGTEXT NULL,
  `response_sha256` VARCHAR(64) NULL,
  `metadata_json` LONGTEXT NULL CHECK (json_valid(`metadata_json`)),
  `redaction_status` ENUM('not_required','redacted') NOT NULL DEFAULT 'not_required',
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_audit_payload_evidence_id` (`evidence_id`),
  KEY `idx_audit_payload_tenant_created` (`tenant_id`, `created_at`),
  KEY `idx_audit_payload_source` (`source_table`, `source_pk`),
  KEY `idx_audit_payload_action` (`action`),
  KEY `idx_audit_payload_redaction` (`redaction_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
(
  'audit_payload_evidence_smoke',
  'Audit Payload Evidence Smoke',
  'Run governed audit payload evidence smoke. Writes a synthetic audit log row plus bounded/redacted request-response evidence, verifies hashes/previews/readback, and confirms no secret values or tokens are returned.',
  'POST',
  '/audit/evidence/smoke',
  NULL,
  '{"type":"object","properties":{"tenant_id":{"type":"string"},"actor_id":{"type":"string"},"cleanup":{"type":"boolean","default":true},"max_preview_chars":{"type":"integer","minimum":256,"maximum":8000,"default":4000}},"additionalProperties":false}',
  NULL,
  'audit,evidence,payload,redaction,smoke,read_write,admin,security,certification,no_secrets,no_token_returned,cleanup_supported',
  1,
  259
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
  `sort_order` = VALUES(`sort_order`);
