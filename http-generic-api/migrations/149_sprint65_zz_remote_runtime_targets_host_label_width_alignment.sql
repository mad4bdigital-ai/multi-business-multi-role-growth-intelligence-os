-- Staging-local additive compatibility bridge for the immutable migration 150 writer.
-- connected_systems.display_name is VARCHAR(255), so host_label must preserve that domain.
-- No data DML, provider access, credential access, or runtime mutation; secrets_included=false.

CREATE TABLE IF NOT EXISTS `remote_runtime_targets` (
  `target_id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(64) NOT NULL,
  `user_id` VARCHAR(64) DEFAULT NULL,
  `plugin_key` VARCHAR(64) NOT NULL DEFAULT 'remote_ssh_runtime',
  `target_kind` ENUM('hosting_account','local_path') NOT NULL,
  `provider_family` VARCHAR(64) DEFAULT NULL,
  `connector_family` VARCHAR(64) DEFAULT NULL,
  `system_id` VARCHAR(36) DEFAULT NULL,
  `connection_id` VARCHAR(36) DEFAULT NULL,
  `local_path_id` VARCHAR(36) DEFAULT NULL,
  `host_label` VARCHAR(255) NOT NULL,
  `root_path` VARCHAR(1024) DEFAULT NULL,
  `path_allowlist_json` LONGTEXT DEFAULT NULL CHECK (JSON_VALID(path_allowlist_json)),
  `command_allowlist_json` LONGTEXT DEFAULT NULL CHECK (JSON_VALID(command_allowlist_json)),
  `metadata_json` LONGTEXT DEFAULT NULL CHECK (JSON_VALID(metadata_json)),
  `status` ENUM('planned','active','disabled','archived') NOT NULL DEFAULT 'planned',
  `validation_status` ENUM('unknown','pending_configuration','valid','invalid','inaccessible','partial') NOT NULL DEFAULT 'unknown',
  `created_by` VARCHAR(191) DEFAULT NULL,
  `updated_by` VARCHAR(191) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`target_id`),
  UNIQUE KEY `uq_remote_runtime_system_target` (`system_id`),
  UNIQUE KEY `uq_remote_runtime_connection_target` (`connection_id`),
  UNIQUE KEY `uq_remote_runtime_local_path_target` (`local_path_id`),
  KEY `idx_remote_runtime_tenant_plugin` (`tenant_id`, `plugin_key`, `target_kind`, `status`),
  KEY `idx_remote_runtime_provider` (`provider_family`, `connector_family`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE IF EXISTS `remote_runtime_targets`
  MODIFY COLUMN `host_label` VARCHAR(255) NOT NULL;
