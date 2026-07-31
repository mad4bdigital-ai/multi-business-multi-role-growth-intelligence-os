-- Spec 011 T302: Brand activity binding readiness evidence.
-- Additive only. No backfill, provider call, external write, or cutover authority.

CREATE TABLE IF NOT EXISTS growth_control_activity_binding_readiness_evidence (
  evidence_id CHAR(36) NOT NULL,
  activity_binding_id CHAR(36) NOT NULL,
  binding_revision INT UNSIGNED NOT NULL,
  target_status ENUM('ready','blocked') NOT NULL,
  evidence_sha256 CHAR(64) NOT NULL,
  checks_json JSON NOT NULL,
  assessed_by VARCHAR(128) NOT NULL,
  request_id VARCHAR(191) NULL,
  correlation_id VARCHAR(191) NULL,
  assessed_at TIMESTAMP(3) NOT NULL,
  provider_calls TINYINT(1) NOT NULL DEFAULT 0,
  external_writes TINYINT(1) NOT NULL DEFAULT 0,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (evidence_id),
  KEY idx_activity_binding_readiness_revision (activity_binding_id, binding_revision, assessed_at),
  KEY idx_activity_binding_readiness_status (target_status, assessed_at),
  CONSTRAINT fk_activity_binding_readiness_binding
    FOREIGN KEY (activity_binding_id)
    REFERENCES growth_control_brand_activity_bindings(activity_binding_id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
