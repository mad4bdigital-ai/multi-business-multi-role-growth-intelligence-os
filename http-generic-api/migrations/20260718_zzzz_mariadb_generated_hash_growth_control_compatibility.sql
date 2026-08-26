-- MariaDB 11.4 compatibility bridge for immutable migration 20260719.
-- SHA2() is not permitted in a STORED generated column (ERROR 1901).
-- Materialize the same 32-byte scope digest and maintain it through
-- DDL-defined BEFORE INSERT/UPDATE triggers. No DML or provider/runtime action.

CREATE TABLE IF NOT EXISTS growth_control_config_versions (
  config_version_id CHAR(36) NOT NULL,
  config_key VARCHAR(128) NOT NULL,
  version_number INT UNSIGNED NOT NULL,
  scope_type ENUM('platform','activity','tenant','workspace','brand','profile','workflow','workflow_node','plan','execution') NOT NULL,
  scope_key VARCHAR(700) NOT NULL,
  scope_key_hash BINARY(32) NOT NULL,
  tenant_id VARCHAR(36) NULL,
  workspace_id VARCHAR(36) NULL,
  brand_key VARCHAR(255) NULL,
  activity_type_key VARCHAR(255) NULL,
  activity_binding_id CHAR(36) NULL,
  profile_key VARCHAR(191) NULL,
  workflow_key VARCHAR(255) NULL,
  workflow_version INT UNSIGNED NULL,
  workflow_node_id VARCHAR(191) NULL,
  plan_id VARCHAR(191) NULL,
  execution_id VARCHAR(191) NULL,
  values_json LONGTEXT NOT NULL,
  lifecycle ENUM('draft','validating','ready','active','blocked','deprecated','archived','rolled_back') NOT NULL DEFAULT 'draft',
  version_revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  supersedes_version_id CHAR(36) NULL,
  effective_from DATETIME NULL,
  effective_to DATETIME NULL,
  checksum_sha256 CHAR(64) NOT NULL,
  idempotency_key VARCHAR(191) NOT NULL,
  created_by VARCHAR(128) NOT NULL,
  approved_by VARCHAR(128) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (config_version_id),
  UNIQUE KEY uq_growth_config_scope_version (config_key, scope_key_hash, version_number),
  UNIQUE KEY uq_growth_config_idempotency (idempotency_key),
  KEY idx_growth_config_resolution (config_key, scope_key(191), lifecycle, version_number),
  KEY idx_growth_config_tenant_brand (tenant_id, workspace_id, brand_key, activity_type_key),
  CONSTRAINT chk_growth_config_version_no_secrets CHECK (secrets_included = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE TRIGGER trg_growth_control_config_versions_scope_key_hash_bi
BEFORE INSERT ON growth_control_config_versions
FOR EACH ROW
SET NEW.scope_key_hash = UNHEX(SHA2(CONCAT('growth-control-scope-v1:', NEW.scope_key), 256));

CREATE OR REPLACE TRIGGER trg_growth_control_config_versions_scope_key_hash_bu
BEFORE UPDATE ON growth_control_config_versions
FOR EACH ROW
SET NEW.scope_key_hash = UNHEX(SHA2(CONCAT('growth-control-scope-v1:', NEW.scope_key), 256));
