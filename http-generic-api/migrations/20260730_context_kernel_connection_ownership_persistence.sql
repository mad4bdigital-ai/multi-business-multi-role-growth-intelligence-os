-- Spec 012: hierarchical connection ownership persistence foundation.
-- Additive artifact only. This file is not applied by this pull request.
-- Existing workspace_registry.workspace_type semantics remain unchanged.
-- Legacy rows remain unclassified until a separately authorized classification process.

ALTER TABLE `workspace_registry`
  ADD COLUMN IF NOT EXISTS `workspace_ownership_type`
    ENUM('personal','company') NULL AFTER `workspace_type`,
  ADD COLUMN IF NOT EXISTS `owner_user_id`
    VARCHAR(36) NULL AFTER `workspace_ownership_type`,
  ADD COLUMN IF NOT EXISTS `ownership_revision`
    BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER `owner_user_id`;

CREATE TABLE IF NOT EXISTS `connection_ownership_scopes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ownership_id` VARCHAR(36) NOT NULL,
  `connection_id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL,
  `workspace_id` VARCHAR(36) NOT NULL,
  `brand_id` VARCHAR(36) NULL,
  `owner_scope_type`
    ENUM('personal_workspace','company_workspace','brand') NOT NULL,
  `owner_scope_ref` VARCHAR(64) NOT NULL,
  `owner_user_id` VARCHAR(36) NULL,
  `connected_by_user_id` VARCHAR(36) NULL,
  `provider_key` VARCHAR(64) NOT NULL,
  `provider_account_ref` VARCHAR(255) NULL,
  `provider_account_binding_hash` CHAR(64) NULL,
  `provider_account_binding_version` VARCHAR(32) NULL,
  `authorization_revision` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `connection_revision` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `status` ENUM('active','disabled','revoked','expired','unclassified')
    NOT NULL DEFAULT 'unclassified',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_connection_ownership_id` (`ownership_id`),
  UNIQUE KEY `uq_connection_ownership_connection` (`connection_id`),
  KEY `idx_connection_owner_scope`
    (`tenant_id`, `workspace_id`, `owner_scope_type`, `owner_scope_ref`, `status`),
  KEY `idx_connection_owner_user`
    (`tenant_id`, `workspace_id`, `owner_user_id`, `status`),
  KEY `idx_connection_owner_brand`
    (`tenant_id`, `workspace_id`, `brand_id`, `status`),
  KEY `idx_connection_provider_account_ref`
    (`tenant_id`, `provider_key`, `provider_account_ref`),
  KEY `idx_connection_provider_account_hash`
    (`tenant_id`, `provider_key`, `provider_account_binding_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `provider_authorization_states` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `state_ref` VARCHAR(36) NOT NULL,
  `flow_type` ENUM('authorize','reconnect') NOT NULL,
  `provider_key` VARCHAR(64) NOT NULL,
  `principal_ref` VARCHAR(64) NOT NULL,
  `user_id` VARCHAR(36) NULL,
  `tenant_id` VARCHAR(36) NOT NULL,
  `workspace_id` VARCHAR(36) NOT NULL,
  `brand_id` VARCHAR(36) NULL,
  `owner_scope_type`
    ENUM('personal_workspace','company_workspace','brand') NOT NULL,
  `owner_scope_ref` VARCHAR(64) NOT NULL,
  `target_connection_id` VARCHAR(36) NULL,
  `expected_connection_revision` BIGINT UNSIGNED NULL,
  `expected_provider_account_ref` VARCHAR(255) NULL,
  `expected_provider_account_binding_hash` CHAR(64) NULL,
  `requested_provider_scopes_json` TEXT NULL,
  `redirect_target_ref` VARCHAR(255) NOT NULL,
  `nonce_hash` CHAR(64) NOT NULL,
  `state_signature_hash` CHAR(64) NOT NULL,
  `signature_version` VARCHAR(32) NOT NULL,
  `state_revision` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `claim_revision` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `claim_token_hash` CHAR(64) NULL,
  `claimed_at` DATETIME NULL,
  `consumed_at` DATETIME NULL,
  `completion_revision` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `status`
    ENUM('issued','claimed','consumed','expired','cancelled','failed')
    NOT NULL DEFAULT 'issued',
  `failure_code` VARCHAR(128) NULL,
  `issued_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_provider_authorization_state_ref` (`state_ref`),
  UNIQUE KEY `uq_provider_authorization_nonce`
    (`provider_key`, `tenant_id`, `nonce_hash`),
  KEY `idx_provider_authorization_context`
    (`tenant_id`, `workspace_id`, `brand_id`, `status`, `expires_at`),
  KEY `idx_provider_authorization_target`
    (`tenant_id`, `target_connection_id`, `status`),
  KEY `idx_provider_authorization_principal`
    (`principal_ref`, `status`, `expires_at`),
  KEY `idx_provider_authorization_claim`
    (`state_ref`, `status`, `state_revision`, `claim_revision`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE OR REPLACE VIEW `v_context_kernel_connection_ownership_compatibility` AS
SELECT
  c.connection_id,
  c.tenant_id,
  c.user_id AS legacy_connected_user_id,
  c.app_key AS provider_key,
  c.status AS connection_status,
  l.link_id,
  l.workspace_id,
  l.workspace_key,
  l.status AS link_status,
  w.tenant_id AS workspace_tenant_id,
  w.workspace_type,
  w.workspace_ownership_type,
  w.owner_user_id AS workspace_owner_user_id,
  w.ownership_revision AS workspace_ownership_revision,
  o.ownership_id,
  o.owner_scope_type,
  o.owner_scope_ref,
  o.owner_user_id AS connection_owner_user_id,
  o.connected_by_user_id AS ownership_connected_by_user_id,
  o.brand_id,
  o.provider_account_ref,
  o.provider_account_binding_hash,
  o.provider_account_binding_version,
  o.authorization_revision,
  o.connection_revision,
  o.status AS ownership_status,
  CASE
    WHEN w.workspace_id IS NULL THEN 'workspace_missing'
    WHEN NOT (BINARY w.tenant_id <=> BINARY l.tenant_id)
      THEN 'workspace_tenant_conflict'
    WHEN w.workspace_ownership_type IS NULL THEN 'workspace_unclassified'
    WHEN o.ownership_id IS NULL THEN 'connection_unclassified'
    WHEN o.status = 'unclassified' THEN 'connection_unclassified'
    WHEN NOT (BINARY o.tenant_id <=> BINARY c.tenant_id)
      OR NOT (BINARY o.workspace_id <=> BINARY l.workspace_id)
      THEN 'ownership_context_conflict'
    WHEN NOT (BINARY o.provider_key <=> BINARY c.app_key)
      THEN 'provider_key_conflict'
    WHEN o.owner_scope_type = 'personal_workspace'
      AND w.workspace_ownership_type <> 'personal'
      THEN 'personal_workspace_type_conflict'
    WHEN o.owner_scope_type = 'company_workspace'
      AND w.workspace_ownership_type <> 'company'
      THEN 'company_workspace_type_conflict'
    WHEN o.owner_scope_type = 'personal_workspace'
      AND (o.owner_user_id IS NULL
        OR NOT (BINARY o.owner_user_id <=> BINARY w.owner_user_id))
      THEN 'personal_owner_conflict'
    WHEN o.owner_scope_type IN ('personal_workspace','company_workspace')
      AND NOT (BINARY o.owner_scope_ref <=> BINARY l.workspace_id)
      THEN 'workspace_owner_scope_ref_conflict'
    WHEN o.owner_scope_type = 'brand' AND o.brand_id IS NULL
      THEN 'brand_owner_missing'
    WHEN o.owner_scope_type = 'brand'
      AND NOT (BINARY o.owner_scope_ref <=> BINARY o.brand_id)
      THEN 'brand_owner_scope_ref_conflict'
    WHEN o.provider_account_ref IS NULL
      AND o.provider_account_binding_hash IS NULL
      THEN 'provider_account_binding_missing'
    ELSE 'classified'
  END AS ownership_resolution_status
FROM `user_app_connections` c
INNER JOIN `workspace_app_links` l
  ON BINARY l.connection_id <=> BINARY c.connection_id
  AND BINARY l.tenant_id <=> BINARY c.tenant_id
  AND BINARY l.app_key <=> BINARY c.app_key
LEFT JOIN `workspace_registry` w
  ON BINARY w.workspace_id <=> BINARY l.workspace_id
LEFT JOIN `connection_ownership_scopes` o
  ON BINARY o.connection_id <=> BINARY c.connection_id;
