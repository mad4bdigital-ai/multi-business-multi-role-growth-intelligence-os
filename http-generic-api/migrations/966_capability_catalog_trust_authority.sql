-- ADDITIVE, NOT AUTO-APPLIED: requires governance + DBA approval.
-- One database authority shared by all runtime replicas. No private keys
-- or plaintext nonces are stored here.
CREATE TABLE IF NOT EXISTS platform_capability_catalog_keys (
  kid VARCHAR(80) NOT NULL,
  tenant_id VARCHAR(80) NOT NULL,
  site_id VARCHAR(80) NOT NULL,
  environment VARCHAR(20) NOT NULL,
  purpose VARCHAR(64) NOT NULL,
  issuer VARCHAR(80) NOT NULL,
  key_ref VARCHAR(255) NOT NULL,
  public_key_pem TEXT NOT NULL,
  not_before_epoch BIGINT NOT NULL,
  not_after_epoch BIGINT NOT NULL,
  status VARCHAR(20) NOT NULL,
  revoked TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (kid),
  KEY idx_capcat_tenant_site_active (tenant_id,site_id,environment,purpose,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_capability_catalog_consumed_nonces (
  scope_sha256 VARBINARY(64) NOT NULL,
  expires_epoch BIGINT NOT NULL,
  PRIMARY KEY (scope_sha256),
  KEY idx_capcat_nonce_expiry (expires_epoch)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- CRITICAL: do not purge nonce rows until long after all signed receipts expire.
-- Require separately certified pruning, replica-sharing and transaction isolation.
