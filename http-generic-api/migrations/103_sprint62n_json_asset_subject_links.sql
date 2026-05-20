-- Sprint 62n: subject links for reusable JSON assets
-- Allows a json_assets row to be attached to platform, tenant, user, device, brand, workflow, module, conversation, or execution-trace subjects without changing json_assets itself.

CREATE TABLE IF NOT EXISTS `json_asset_subject_links` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `link_id` VARCHAR(64) NOT NULL,
  `asset_id` VARCHAR(255) NOT NULL,
  `asset_key` VARCHAR(255) NULL,
  `subject_type` ENUM('platform','tenant','user','device','brand','workflow','module','conversation','execution_trace') NOT NULL,
  `subject_ref` VARCHAR(255) NOT NULL,
  `tenant_id` VARCHAR(64) NULL,
  `user_id` VARCHAR(64) NULL,
  `subject_key` VARCHAR(255) NULL,
  `linkage_type` VARCHAR(100) NOT NULL DEFAULT 'scope_attachment',
  `scope_label` VARCHAR(128) NULL,
  `metadata_json` JSON NULL,
  `status` ENUM('active','archived') NOT NULL DEFAULT 'active',
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_json_asset_subject_link_id` (`link_id`),
  UNIQUE KEY `uq_json_asset_subject_active` (`asset_id`, `subject_type`, `subject_ref`, `linkage_type`),
  KEY `idx_json_asset_subject_asset` (`asset_id`, `status`),
  KEY `idx_json_asset_subject_tenant_user` (`tenant_id`, `user_id`, `status`),
  KEY `idx_json_asset_subject_ref` (`subject_type`, `subject_ref`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Attach the Local Manager auth-state doctrine created from the 2026-05-20 conversation to platform/global scope,
-- the Mad4B Platform tenant, and the platform admin user, while leaving json_assets reusable.
INSERT INTO `json_asset_subject_links` (
  `link_id`, `asset_id`, `asset_key`, `subject_type`, `subject_ref`, `tenant_id`, `user_id`,
  `subject_key`, `linkage_type`, `scope_label`, `metadata_json`, `status`
)
SELECT UUID(), ja.asset_id, ja.asset_key,
  'platform', 'platform:global', NULL, NULL,
  'platform', 'scope_attachment', 'platform_global',
  JSON_OBJECT(
    'reason', 'Keep doctrine available as global operational memory while also linking it to tenant/user subjects',
    'source', 'migration_103_sprint62n_json_asset_subject_links',
    'created_from_asset', ja.asset_id
  ),
  'active'
FROM `json_assets` ja
WHERE ja.asset_id = 'JSON-ASSET-LOCAL-MANAGER-AUTH-STATE-DOCTRINE-20260520T1725Z'
ON DUPLICATE KEY UPDATE
  `asset_key` = VALUES(`asset_key`),
  `metadata_json` = VALUES(`metadata_json`),
  `status` = 'active',
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `json_asset_subject_links` (
  `link_id`, `asset_id`, `asset_key`, `subject_type`, `subject_ref`, `tenant_id`, `user_id`,
  `subject_key`, `linkage_type`, `scope_label`, `metadata_json`, `status`
)
SELECT UUID(), ja.asset_id, ja.asset_key,
  'tenant', 'tenant:00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001', NULL,
  'Mad4B Platform', 'scope_attachment', 'platform_tenant',
  JSON_OBJECT(
    'reason', 'Attach Local Manager auth-state doctrine to the platform tenant per user request',
    'source', 'migration_103_sprint62n_json_asset_subject_links',
    'created_from_asset', ja.asset_id
  ),
  'active'
FROM `json_assets` ja
WHERE ja.asset_id = 'JSON-ASSET-LOCAL-MANAGER-AUTH-STATE-DOCTRINE-20260520T1725Z'
ON DUPLICATE KEY UPDATE
  `asset_key` = VALUES(`asset_key`),
  `tenant_id` = VALUES(`tenant_id`),
  `subject_key` = VALUES(`subject_key`),
  `metadata_json` = VALUES(`metadata_json`),
  `status` = 'active',
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `json_asset_subject_links` (
  `link_id`, `asset_id`, `asset_key`, `subject_type`, `subject_ref`, `tenant_id`, `user_id`,
  `subject_key`, `linkage_type`, `scope_label`, `metadata_json`, `status`
)
SELECT UUID(), ja.asset_id, ja.asset_key,
  'user', 'user:f242960c-2857-4b4d-a504-ee50f8a278b4', '00000000-0000-4000-a000-000000000001', 'f242960c-2857-4b4d-a504-ee50f8a278b4',
  'mad4b.digital@gmail.com', 'scope_attachment', 'platform_admin_user',
  JSON_OBJECT(
    'reason', 'Attach Local Manager auth-state doctrine to the signed-in platform admin user per user request',
    'source', 'migration_103_sprint62n_json_asset_subject_links',
    'created_from_asset', ja.asset_id
  ),
  'active'
FROM `json_assets` ja
WHERE ja.asset_id = 'JSON-ASSET-LOCAL-MANAGER-AUTH-STATE-DOCTRINE-20260520T1725Z'
ON DUPLICATE KEY UPDATE
  `asset_key` = VALUES(`asset_key`),
  `tenant_id` = VALUES(`tenant_id`),
  `user_id` = VALUES(`user_id`),
  `subject_key` = VALUES(`subject_key`),
  `metadata_json` = VALUES(`metadata_json`),
  `status` = 'active',
  `updated_at` = CURRENT_TIMESTAMP;
