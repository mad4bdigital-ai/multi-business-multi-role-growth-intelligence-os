-- Transactional outbox and one-way shadow synchronization foundation.
-- Additive only. External delivery is disabled by default.
-- Payloads must not contain credentials, tokens, private keys, or other secrets.

CREATE TABLE IF NOT EXISTS platform_outbox_event_types (
  event_type VARCHAR(160) NOT NULL PRIMARY KEY,
  current_schema_version SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  producer_key VARCHAR(120) NOT NULL,
  payload_classification ENUM('public','internal','restricted') NOT NULL DEFAULT 'internal',
  contains_pii TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('draft','active','paused','retired') NOT NULL DEFAULT 'draft',
  description VARCHAR(500) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  KEY idx_platform_outbox_event_types_status (status, event_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_outbox_mask_policies (
  policy_key VARCHAR(120) NOT NULL PRIMARY KEY,
  policy_version SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  description VARCHAR(500) NULL,
  policy_json JSON NOT NULL,
  checksum_sha256 CHAR(64) NOT NULL,
  status ENUM('draft','active','retired') NOT NULL DEFAULT 'draft',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  KEY idx_platform_outbox_mask_policies_status (status, policy_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_outbox_consumers (
  consumer_key VARCHAR(120) NOT NULL PRIMARY KEY,
  display_name VARCHAR(191) NOT NULL,
  target_environment ENUM('development','staging','shadow','external') NOT NULL DEFAULT 'shadow',
  transport_key ENUM('noop','https_batch_v1') NOT NULL DEFAULT 'noop',
  endpoint_url VARCHAR(2048) NULL,
  auth_scheme ENUM('none','bearer','x_api_key') NOT NULL DEFAULT 'none',
  credential_ref VARCHAR(191) NULL,
  mask_policy_key VARCHAR(120) NULL,
  status ENUM('disabled','shadow','active','paused') NOT NULL DEFAULT 'disabled',
  batch_size SMALLINT UNSIGNED NOT NULL DEFAULT 100,
  timeout_ms INT UNSIGNED NOT NULL DEFAULT 10000,
  max_attempts TINYINT UNSIGNED NOT NULL DEFAULT 8,
  retry_base_seconds INT UNSIGNED NOT NULL DEFAULT 30,
  last_success_at DATETIME(6) NULL,
  last_failure_at DATETIME(6) NULL,
  last_error_code VARCHAR(120) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  KEY idx_platform_outbox_consumers_status (status, target_environment),
  KEY idx_platform_outbox_consumers_policy (mask_policy_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_outbox_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id CHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NULL,
  workspace_id CHAR(36) NULL,
  aggregate_type VARCHAR(100) NOT NULL,
  aggregate_id VARCHAR(191) NOT NULL,
  event_type VARCHAR(160) NOT NULL,
  schema_version SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  payload_json JSON NOT NULL,
  metadata_json JSON NULL,
  payload_sha256 CHAR(64) NOT NULL,
  payload_classification ENUM('public','internal','restricted') NOT NULL DEFAULT 'internal',
  contains_pii TINYINT(1) NOT NULL DEFAULT 0,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  source_environment ENUM('production','staging','development','test') NOT NULL,
  occurred_at DATETIME(6) NOT NULL,
  available_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  retention_expires_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_platform_outbox_events_event_id (event_id),
  KEY idx_platform_outbox_events_available (available_at, occurred_at, id),
  KEY idx_platform_outbox_events_type (event_type, schema_version, occurred_at),
  KEY idx_platform_outbox_events_aggregate (aggregate_type, aggregate_id, occurred_at),
  KEY idx_platform_outbox_events_source (source_environment, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_outbox_deliveries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id CHAR(36) NOT NULL,
  consumer_key VARCHAR(120) NOT NULL,
  status ENUM('pending','claimed','delivered','failed','dead_letter','skipped') NOT NULL DEFAULT 'pending',
  attempt_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  claim_token CHAR(36) NULL,
  claim_expires_at DATETIME(6) NULL,
  next_attempt_at DATETIME(6) NULL,
  response_status INT NULL,
  last_error_code VARCHAR(120) NULL,
  last_error_message VARCHAR(500) NULL,
  delivered_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_platform_outbox_deliveries_event_consumer (event_id, consumer_key),
  KEY idx_platform_outbox_deliveries_pending (consumer_key, status, next_attempt_at, id),
  KEY idx_platform_outbox_deliveries_claim (claim_token, claim_expires_at),
  KEY idx_platform_outbox_deliveries_status (status, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO platform_outbox_mask_policies (
  policy_key, policy_version, description, policy_json, checksum_sha256, status
) VALUES (
  'default_shadow_mask_v1',
  1,
  'Default deny-and-mask policy for production-to-shadow synchronization. Secrets are removed and common PII fields are masked.',
  JSON_OBJECT(
    'deny_keys', JSON_ARRAY('password','password_hash','access_token','refresh_token','token','secret','private_key','authorization','cookie','recovery_code','api_key','credential'),
    'mask_keys', JSON_ARRAY('email','phone','mobile','name','full_name','address','ip','ip_address','user_agent'),
    'maximum_event_bytes', 131072,
    'secrets_allowed', FALSE
  ),
  SHA2(CAST(JSON_OBJECT(
    'deny_keys', JSON_ARRAY('password','password_hash','access_token','refresh_token','token','secret','private_key','authorization','cookie','recovery_code','api_key','credential'),
    'mask_keys', JSON_ARRAY('email','phone','mobile','name','full_name','address','ip','ip_address','user_agent'),
    'maximum_event_bytes', 131072,
    'secrets_allowed', FALSE
  ) AS CHAR), 256),
  'active'
)
ON DUPLICATE KEY UPDATE
  description = VALUES(description),
  policy_json = VALUES(policy_json),
  checksum_sha256 = VALUES(checksum_sha256),
  status = VALUES(status),
  updated_at = CURRENT_TIMESTAMP(6);

INSERT INTO platform_outbox_consumers (
  consumer_key, display_name, target_environment, transport_key,
  endpoint_url, auth_scheme, credential_ref, mask_policy_key,
  status, batch_size, timeout_ms, max_attempts, retry_base_seconds
) VALUES (
  'prod_shadow_v1',
  'Production shadow synchronization v1',
  'shadow',
  'noop',
  NULL,
  'none',
  NULL,
  'default_shadow_mask_v1',
  'disabled',
  100,
  10000,
  8,
  30
)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  target_environment = VALUES(target_environment),
  mask_policy_key = VALUES(mask_policy_key),
  updated_at = CURRENT_TIMESTAMP(6);

INSERT INTO admin_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES (
  'platform_outbox_worker',
  'Platform Outbox Worker',
  'Inspect or run the governed transactional outbox worker. External delivery remains disabled until the consumer, masking policy, endpoint allowlist, and credential reference are explicitly activated.',
  'POST',
  '/admin/control',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'tool',JSON_OBJECT('type','string','const','shell'),
      'action',JSON_OBJECT('type','string','const','run'),
      'alias',JSON_OBJECT('type','string','const','platform_outbox_worker'),
      'extra_args',JSON_OBJECT('type','array','items',JSON_OBJECT('type','string'),'maxItems',8)
    ),
    'required',JSON_ARRAY('tool','action','alias'),
    'additionalProperties',false
  ),
  NULL,
  'admin,outbox,shadow_sync,hostinger_cron,hetzner_ready,idempotent,no_secrets,outbound_disabled_by_default,built_in_shell_alias',
  1,
  232
)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  http_method = VALUES(http_method),
  http_path = VALUES(http_path),
  path_param_keys = VALUES(path_param_keys),
  input_schema = VALUES(input_schema),
  fixed_body = VALUES(fixed_body),
  tags = VALUES(tags),
  is_enabled = VALUES(is_enabled),
  sort_order = VALUES(sort_order);
