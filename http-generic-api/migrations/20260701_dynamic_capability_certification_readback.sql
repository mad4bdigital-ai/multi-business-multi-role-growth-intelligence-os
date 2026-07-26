-- Spec 007 PR4: generic adapter certification and readback contracts.
-- Additive SQL-primary registry only.
-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- secrets_included=false

CREATE TABLE IF NOT EXISTS platform_capability_readback_contracts (
  contract_id VARCHAR(36) NOT NULL,
  contract_key VARCHAR(191) NOT NULL,
  contract_version INT UNSIGNED NOT NULL,
  capability_key VARCHAR(191) NOT NULL,
  adapter_key VARCHAR(191) NULL,
  verification_type VARCHAR(64) NOT NULL,
  acknowledgement_required TINYINT(1) NOT NULL DEFAULT 1,
  verification_required TINYINT(1) NOT NULL DEFAULT 1,
  expected_effect_class VARCHAR(64) NULL,
  input_schema_json LONGTEXT NULL,
  observed_state_schema_json LONGTEXT NOT NULL,
  provider_binding_constraints_json LONGTEXT NULL,
  certification_status ENUM('pending','certified','stale','revoked','not_required') NOT NULL DEFAULT 'pending',
  status ENUM('draft','shadow','certified','stale','revoked','disabled') NOT NULL DEFAULT 'draft',
  is_current TINYINT(1) NOT NULL DEFAULT 1,
  current_contract_key VARCHAR(191)
    GENERATED ALWAYS AS (CASE WHEN is_current = 1 THEN contract_key ELSE NULL END) STORED,
  valid_from DATETIME NULL,
  expires_at DATETIME NULL,
  revoked_at DATETIME NULL,
  source_registry VARCHAR(191) NULL,
  source_key VARCHAR(255) NULL,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (contract_id),
  UNIQUE KEY uq_pc_readback_contract_version (contract_key, contract_version),
  UNIQUE KEY uq_pc_readback_current_contract (current_contract_key),
  KEY idx_pc_readback_capability (capability_key, is_current, status),
  KEY idx_pc_readback_adapter (adapter_key, is_current, status),
  KEY idx_pc_readback_expiry (expires_at),
  CONSTRAINT chk_pc_readback_input_json CHECK (input_schema_json IS NULL OR JSON_VALID(input_schema_json)),
  CONSTRAINT chk_pc_readback_observed_json CHECK (JSON_VALID(observed_state_schema_json)),
  CONSTRAINT chk_pc_readback_provider_json CHECK (provider_binding_constraints_json IS NULL OR JSON_VALID(provider_binding_constraints_json)),
  CONSTRAINT chk_pc_readback_no_secrets CHECK (secrets_included = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW v_platform_capability_readback_readiness AS
SELECT
  c.contract_id,
  c.contract_key,
  c.contract_version,
  c.capability_key,
  c.adapter_key,
  c.verification_type,
  c.acknowledgement_required,
  c.verification_required,
  c.expected_effect_class,
  c.certification_status,
  c.status,
  c.valid_from,
  c.expires_at,
  c.revoked_at,
  c.source_registry,
  c.source_key,
  c.secrets_included,
  CASE
    WHEN c.secrets_included <> 0 THEN 'blocked_secret_policy'
    WHEN c.revoked_at IS NOT NULL OR c.status = 'revoked' OR c.certification_status = 'revoked' THEN 'revoked'
    WHEN c.expires_at IS NOT NULL AND c.expires_at <= CURRENT_TIMESTAMP THEN 'stale'
    WHEN c.status = 'certified' AND c.certification_status = 'certified' THEN 'ready'
    WHEN c.status = 'shadow' THEN 'shadow_only'
    ELSE 'pending'
  END AS readiness_state,
  c.created_at,
  c.updated_at
FROM platform_capability_readback_contracts c
WHERE c.is_current = 1;

INSERT INTO platform_capability_source_links (
  link_id,
  capability_key,
  source_kind,
  source_ref,
  source_sha,
  resolution_status,
  confidence,
  evidence_id,
  metadata_json,
  observed_at,
  updated_at
)
SELECT
  SHA2(CONCAT('spec007:readback-contract-authority:', p.capability_key), 256),
  p.capability_key,
  'readback_contract_registry',
  'platform_capability_readback_contracts',
  NULL,
  'declared',
  1.0000,
  NULL,
  JSON_OBJECT(
    'schema_version', 'dynamic-capability-readback-contract-v1',
    'authority', 'mysql_primary',
    'certification_authority_reused', 'platform_capability_certifications',
    'specialized_certification_source_reused', 'runtime_dispatch_certification_registry',
    'adapter_authority_reused', 'platform_resource_adapters',
    'provider_calls', false,
    'external_writes', false,
    'credential_payload_reads', false,
    'secrets_included', false
  ),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM platform_plugin_capabilities p
WHERE p.capability_key = 'dynamic.capability.tool_bus'
ON DUPLICATE KEY UPDATE
  resolution_status = VALUES(resolution_status),
  confidence = VALUES(confidence),
  metadata_json = VALUES(metadata_json),
  observed_at = VALUES(observed_at),
  updated_at = CURRENT_TIMESTAMP;
