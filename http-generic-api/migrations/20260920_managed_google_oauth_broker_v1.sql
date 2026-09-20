-- MAD4B Managed Google OAuth Broker v1
-- Persistent, one-time authorization sessions and secret-safe audit evidence.
-- Google access/refresh tokens are stored only inside AES-GCM token_envelope
-- and are nulled atomically on successful handoff redemption.

CREATE TABLE IF NOT EXISTS managed_google_oauth_sessions (
  session_id VARCHAR(64) NOT NULL,
  site_uuid VARCHAR(64) NOT NULL,
  origin VARCHAR(512) NOT NULL,
  callback_uri VARCHAR(1024) NOT NULL,
  access_mode VARCHAR(32) NOT NULL,
  requested_scope VARCHAR(512) NOT NULL,
  client_state_envelope MEDIUMTEXT NOT NULL,
  broker_state_hash CHAR(64) NOT NULL,
  verifier_challenge VARCHAR(128) NOT NULL,
  handoff_hash CHAR(64) NULL,
  token_envelope MEDIUMTEXT NULL,
  token_expires_in INT UNSIGNED NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  expires_at DATETIME NOT NULL,
  handoff_expires_at DATETIME NULL,
  authorized_at DATETIME NULL,
  redeemed_at DATETIME NULL,
  denied_at DATETIME NULL,
  denied_reason VARCHAR(96) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (session_id),
  UNIQUE KEY uq_managed_google_oauth_broker_state_hash (broker_state_hash),
  UNIQUE KEY uq_managed_google_oauth_handoff_hash (handoff_hash),
  KEY idx_managed_google_oauth_site_status (site_uuid, status, expires_at),
  KEY idx_managed_google_oauth_status_handoff_expiry (status, handoff_expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS managed_google_oauth_request_nonces (
  key_id VARCHAR(64) NOT NULL,
  nonce_hash CHAR(64) NOT NULL,
  site_uuid VARCHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (key_id, nonce_hash),
  KEY idx_managed_google_oauth_nonce_expiry (expires_at),
  KEY idx_managed_google_oauth_nonce_site (site_uuid, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS managed_google_oauth_audit (
  audit_id VARCHAR(64) NOT NULL,
  event VARCHAR(64) NOT NULL,
  site_uuid VARCHAR(64) NOT NULL,
  session_id VARCHAR(64) NULL,
  outcome VARCHAR(32) NOT NULL,
  reason VARCHAR(96) NULL,
  origin_sha256 CHAR(64) NULL,
  metadata_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (audit_id),
  KEY idx_managed_google_oauth_audit_site_event_time (site_uuid, event, created_at),
  KEY idx_managed_google_oauth_audit_session_time (session_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
