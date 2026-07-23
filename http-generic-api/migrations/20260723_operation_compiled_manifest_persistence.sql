-- Spec 011 Phase 1D: immutable compiled operation manifests and transactional current pointers.
--
-- This additive migration stores compiler output without duplicating endpoint,
-- credential, provider transport, resource-authority, or dispatch authority.
-- Runtime activation remains disabled until later governed rollout work.
--
-- Safety contract:
-- - no provider call
-- - no external send
-- - no credential payload read
-- - no raw secrets
-- - no runtime activation
-- - no tool projection
-- - no destructive SQL
-- - secrets_included=false

CREATE TABLE IF NOT EXISTS operation_compiled_manifests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  manifest_id CHAR(36) NOT NULL,
  operation_registry_id BIGINT UNSIGNED NOT NULL,
  manifest_version INT UNSIGNED NOT NULL,
  scope_fingerprint CHAR(64) NOT NULL,
  source_revision_hash CHAR(64) NOT NULL,
  manifest_hash CHAR(64) NOT NULL,
  compiler_version VARCHAR(64) NOT NULL,
  validation_status ENUM('valid', 'invalid', 'blocked', 'superseded', 'revoked') NOT NULL DEFAULT 'valid',
  rollout_mode ENUM('disabled', 'shadow', 'canary', 'active', 'fallback') NOT NULL DEFAULT 'shadow',
  certification_status ENUM('uncertified', 'certified', 'expired', 'revoked') NOT NULL DEFAULT 'uncertified',
  manifest_json JSON NOT NULL COMMENT 'Immutable non-secret compiled binding graph.',
  expires_at TIMESTAMP NULL,
  revoked_at TIMESTAMP NULL,
  created_by VARCHAR(191) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_operation_compiled_manifests_id (manifest_id),
  UNIQUE KEY uq_operation_compiled_manifests_version (operation_registry_id, scope_fingerprint, manifest_version),
  UNIQUE KEY uq_operation_compiled_manifests_hash (operation_registry_id, scope_fingerprint, manifest_hash),
  UNIQUE KEY uq_operation_compiled_manifests_identity_scope (manifest_id, operation_registry_id, scope_fingerprint),
  KEY idx_operation_compiled_manifests_lifecycle (validation_status, rollout_mode, certification_status),
  KEY idx_operation_compiled_manifests_source_revision (source_revision_hash),
  KEY idx_operation_compiled_manifests_expiry (expires_at, revoked_at),
  CONSTRAINT fk_operation_compiled_manifests_operation
    FOREIGN KEY (operation_registry_id) REFERENCES operation_registry (id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Immutable compiled operation binding manifests; execution authorities remain external.';

CREATE TABLE IF NOT EXISTS operation_compiled_manifest_current (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_registry_id BIGINT UNSIGNED NOT NULL,
  scope_fingerprint CHAR(64) NOT NULL,
  manifest_id CHAR(36) NOT NULL,
  pointer_revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_by VARCHAR(191) NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_operation_compiled_manifest_current_scope (operation_registry_id, scope_fingerprint),
  KEY idx_operation_compiled_manifest_current_manifest (manifest_id, operation_registry_id, scope_fingerprint),
  CONSTRAINT fk_operation_compiled_manifest_current_operation
    FOREIGN KEY (operation_registry_id) REFERENCES operation_registry (id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_operation_compiled_manifest_current_manifest
    FOREIGN KEY (manifest_id, operation_registry_id, scope_fingerprint)
    REFERENCES operation_compiled_manifests (manifest_id, operation_registry_id, scope_fingerprint)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Single transactional current-manifest pointer per operation version and scope.';

CREATE OR REPLACE VIEW v_operation_compiled_manifest_readback AS
SELECT
  m.manifest_id,
  o.operation_id,
  o.operation_key,
  o.version AS operation_version,
  m.manifest_version,
  m.scope_fingerprint,
  m.source_revision_hash,
  m.manifest_hash,
  m.compiler_version,
  m.validation_status,
  m.rollout_mode,
  m.certification_status,
  CASE WHEN p.manifest_id = m.manifest_id THEN 1 ELSE 0 END AS is_current,
  p.pointer_revision,
  m.expires_at,
  m.revoked_at,
  CASE
    WHEN m.revoked_at IS NOT NULL OR m.validation_status = 'revoked' OR m.certification_status = 'revoked' THEN 'revoked'
    WHEN m.expires_at IS NOT NULL AND m.expires_at <= CURRENT_TIMESTAMP THEN 'expired'
    WHEN m.validation_status <> 'valid' THEN 'validation_blocked'
    WHEN m.rollout_mode = 'disabled' THEN 'rollout_disabled'
    WHEN m.certification_status <> 'certified' THEN 'uncertified'
    WHEN p.manifest_id <> m.manifest_id OR p.manifest_id IS NULL THEN 'not_current'
    ELSE 'eligible_for_runtime_verification'
  END AS readiness_status,
  m.created_by,
  m.created_at,
  p.updated_by AS current_updated_by,
  p.updated_at AS current_updated_at,
  0 AS secrets_included
FROM operation_compiled_manifests m
JOIN operation_registry o ON o.id = m.operation_registry_id
LEFT JOIN operation_compiled_manifest_current p
  ON p.operation_registry_id = m.operation_registry_id
 AND p.scope_fingerprint = m.scope_fingerprint;
