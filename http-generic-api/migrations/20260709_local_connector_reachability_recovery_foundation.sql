-- Local Connector Reachability Recovery — Lane B persistence foundation.
-- Additive-only draft. Do not apply until reviewed through governed migration flow.
-- No secrets, signed URLs, plaintext device tokens, or raw machine identifiers are stored here.

CREATE TABLE IF NOT EXISTS local_connector_devices (
  canonical_device_id VARCHAR(191) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  current_config_id VARCHAR(64) NULL,
  device_label VARCHAR(191) NULL,
  install_generation INT NOT NULL DEFAULT 1,
  device_fingerprint_hash CHAR(64) NULL,
  lifecycle_status VARCHAR(64) NOT NULL DEFAULT 'registered',
  reachability_status VARCHAR(64) NOT NULL DEFAULT 'unknown',
  last_seen_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (canonical_device_id),
  KEY idx_lcr_devices_tenant_user_status (tenant_id, user_id, lifecycle_status),
  KEY idx_lcr_devices_config (current_config_id),
  KEY idx_lcr_devices_last_seen (last_seen_at)
);

CREATE TABLE IF NOT EXISTS local_connector_device_aliases (
  alias_id VARCHAR(64) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  canonical_device_id VARCHAR(191) NOT NULL,
  alias_kind VARCHAR(64) NOT NULL,
  alias_value_hash CHAR(64) NOT NULL,
  display_label VARCHAR(191) NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  first_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (alias_id),
  UNIQUE KEY uq_lcr_device_alias_scope_hash (tenant_id, user_id, alias_kind, alias_value_hash),
  KEY idx_lcr_device_alias_device (canonical_device_id),
  KEY idx_lcr_device_alias_scope_primary (tenant_id, user_id, is_primary)
);

CREATE TABLE IF NOT EXISTS local_connector_routes (
  route_id VARCHAR(64) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  canonical_device_id VARCHAR(191) NOT NULL,
  config_id VARCHAR(64) NULL,
  route_class VARCHAR(64) NOT NULL,
  authority_path VARCHAR(64) NOT NULL,
  route_origin VARCHAR(128) NULL,
  route_host_hash CHAR(64) NULL,
  route_generation INT NOT NULL DEFAULT 1,
  registered_route_count INT NOT NULL DEFAULT 0,
  route_status VARCHAR(64) NOT NULL DEFAULT 'unknown',
  profile_source VARCHAR(64) NULL,
  profile_key VARCHAR(191) NULL,
  last_registered_at DATETIME(3) NULL,
  last_verified_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (route_id),
  UNIQUE KEY uq_lcr_route_device_class_generation (canonical_device_id, route_class, route_generation),
  KEY idx_lcr_routes_scope_device (tenant_id, user_id, canonical_device_id),
  KEY idx_lcr_routes_status (route_status, last_verified_at)
);

CREATE TABLE IF NOT EXISTS local_connector_heartbeats (
  heartbeat_id VARCHAR(64) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  canonical_device_id VARCHAR(191) NOT NULL,
  source_surface VARCHAR(64) NOT NULL,
  observed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  local_service_status VARCHAR(64) NOT NULL DEFAULT 'unknown',
  route_count INT NULL,
  registered_route_count INT NULL,
  connector_auth_configured TINYINT(1) NULL,
  heartbeat_status VARCHAR(64) NOT NULL DEFAULT 'observed',
  evidence_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (heartbeat_id),
  KEY idx_lcr_heartbeats_device_observed (canonical_device_id, observed_at),
  KEY idx_lcr_heartbeats_scope_observed (tenant_id, user_id, observed_at),
  KEY idx_lcr_heartbeats_status (heartbeat_status, observed_at)
);

CREATE TABLE IF NOT EXISTS local_connector_probe_results (
  probe_id VARCHAR(64) NOT NULL,
  correlation_id VARCHAR(64) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  canonical_device_id VARCHAR(191) NOT NULL,
  probe_kind VARCHAR(64) NOT NULL,
  path_class VARCHAR(64) NOT NULL,
  result_status VARCHAR(64) NOT NULL,
  http_status INT NULL,
  platform_error_code VARCHAR(128) NULL,
  latency_ms INT NULL,
  retry_count INT NOT NULL DEFAULT 0,
  observed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  evidence_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (probe_id),
  KEY idx_lcr_probe_correlation (correlation_id),
  KEY idx_lcr_probe_device_observed (canonical_device_id, observed_at),
  KEY idx_lcr_probe_scope_observed (tenant_id, user_id, observed_at),
  KEY idx_lcr_probe_status (result_status, platform_error_code, observed_at)
);

CREATE TABLE IF NOT EXISTS local_connector_recovery_plans (
  recovery_plan_id VARCHAR(64) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  canonical_device_id VARCHAR(191) NOT NULL,
  plan_status VARCHAR(64) NOT NULL DEFAULT 'preview',
  recovery_mode VARCHAR(64) NOT NULL,
  risk_class VARCHAR(64) NOT NULL DEFAULT 'medium',
  fresh_authorization_required TINYINT(1) NOT NULL DEFAULT 1,
  privileged_installer_allowed TINYINT(1) NOT NULL DEFAULT 0,
  target_selection_json JSON NOT NULL,
  steps_json JSON NOT NULL,
  readback_requirements_json JSON NOT NULL,
  blocking_reasons_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NULL,
  verification_status VARCHAR(64) NOT NULL DEFAULT 'not_verified',
  PRIMARY KEY (recovery_plan_id),
  KEY idx_lcr_recovery_scope_device (tenant_id, user_id, canonical_device_id),
  KEY idx_lcr_recovery_status (plan_status, verification_status, created_at),
  KEY idx_lcr_recovery_expires (expires_at)
);
