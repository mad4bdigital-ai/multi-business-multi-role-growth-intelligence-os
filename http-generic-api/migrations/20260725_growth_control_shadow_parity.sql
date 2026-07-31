-- Spec 011 T206: read-only Growth Control shadow parity evidence.
-- Additive only. No backfill, provider call, external write, or cutover authority.

CREATE TABLE IF NOT EXISTS growth_control_shadow_parity_mappings (
  growth_config_key VARCHAR(128) NOT NULL,
  legacy_config_key VARCHAR(128) NOT NULL,
  growth_path VARCHAR(512) NOT NULL DEFAULT '',
  legacy_path VARCHAR(512) NOT NULL DEFAULT '',
  privilege_paths_json JSON NOT NULL,
  expected_difference ENUM('policy_difference') NULL,
  status ENUM('active','disabled') NOT NULL DEFAULT 'disabled',
  note VARCHAR(1000) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (growth_config_key),
  KEY idx_growth_control_shadow_mapping_legacy (legacy_config_key, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS growth_control_shadow_parity_evidence (
  evidence_id CHAR(36) NOT NULL,
  resolution_id CHAR(36) NULL,
  tenant_id CHAR(36) NULL,
  workspace_id CHAR(36) NULL,
  brand_key VARCHAR(128) NULL,
  growth_config_key VARCHAR(128) NOT NULL,
  legacy_config_key VARCHAR(128) NULL,
  growth_hash CHAR(64) NULL,
  legacy_hash CHAR(64) NULL,
  normalized_growth_hash CHAR(64) NULL,
  normalized_legacy_hash CHAR(64) NULL,
  classification ENUM(
    'match',
    'expected_semantic_translation',
    'policy_difference',
    'privilege_expansion',
    'adaptive_error',
    'missing_evidence',
    'unclassified_mismatch',
    'not_comparable'
  ) NOT NULL,
  severity ENUM('info','low','medium','high','critical') NOT NULL,
  action VARCHAR(64) NOT NULL,
  explanation_code VARCHAR(128) NOT NULL,
  compared_paths_json JSON NOT NULL,
  blocks_cutover TINYINT(1) NOT NULL DEFAULT 0,
  latency_ms INT UNSIGNED NOT NULL DEFAULT 0,
  observed_at TIMESTAMP(3) NOT NULL,
  provider_apply_allowed TINYINT(1) NOT NULL DEFAULT 0,
  external_write_allowed TINYINT(1) NOT NULL DEFAULT 0,
  mutation_allowed TINYINT(1) NOT NULL DEFAULT 0,
  enforcement_cutover TINYINT(1) NOT NULL DEFAULT 0,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  raw_payload_included TINYINT(1) NOT NULL DEFAULT 0,
  prompt_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (evidence_id),
  KEY idx_growth_control_shadow_scope_time (tenant_id, workspace_id, brand_key, observed_at),
  KEY idx_growth_control_shadow_config_time (growth_config_key, observed_at),
  KEY idx_growth_control_shadow_classification (classification, severity, observed_at),
  KEY idx_growth_control_shadow_resolution (resolution_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW v_growth_control_shadow_parity_summary AS
SELECT
  tenant_id,
  workspace_id,
  brand_key,
  growth_config_key,
  COUNT(*) AS sample_count,
  SUM(classification = 'match') AS match_count,
  SUM(classification NOT IN ('match','not_comparable')) AS mismatch_count,
  SUM(severity = 'critical') AS critical_mismatch_count,
  SUM(classification = 'not_comparable') AS not_comparable_count,
  ROUND(
    100 * SUM(classification NOT IN ('match','not_comparable'))
      / NULLIF(SUM(classification <> 'not_comparable'), 0),
    4
  ) AS mismatch_percent,
  ROUND(AVG(latency_ms), 3) AS average_latency_ms,
  MAX(observed_at) AS last_compared_at
FROM growth_control_shadow_parity_evidence
GROUP BY tenant_id, workspace_id, brand_key, growth_config_key;
