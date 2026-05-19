-- Sprint 62k: internal release catalog for public/local apps
-- Source of truth for app update metadata used by Local Manager and future desktop/mobile apps.

CREATE TABLE IF NOT EXISTS `local_app_releases` (
  `release_id` VARCHAR(64) NOT NULL,
  `app_key` VARCHAR(96) NOT NULL,
  `platform` VARCHAR(32) NOT NULL,
  `release_channel` VARCHAR(48) NOT NULL DEFAULT 'stable',
  `version` VARCHAR(80) NOT NULL,
  `minimum_supported_version` VARCHAR(80) NULL,
  `release_tag` VARCHAR(128) NULL,
  `artifact_url` VARCHAR(1024) NOT NULL,
  `sha256_url` VARCHAR(1024) NULL,
  `sha256` VARCHAR(128) NULL,
  `update_required` TINYINT(1) NOT NULL DEFAULT 0,
  `release_notes_json` JSON NULL,
  `status` ENUM('draft','active','deprecated') NOT NULL DEFAULT 'active',
  `published_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`release_id`),
  UNIQUE KEY `uq_local_app_release_version` (`app_key`, `platform`, `release_channel`, `version`),
  KEY `idx_local_app_release_lookup` (`app_key`, `platform`, `release_channel`, `status`, `published_at`),
  KEY `idx_local_app_release_updated` (`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `local_app_releases` (
  `release_id`,
  `app_key`,
  `platform`,
  `release_channel`,
  `version`,
  `minimum_supported_version`,
  `release_tag`,
  `artifact_url`,
  `sha256_url`,
  `sha256`,
  `update_required`,
  `release_notes_json`,
  `status`,
  `published_at`
) VALUES (
  'mad4b-local-manager-windows-latest-prerelease-0-1-1',
  'mad4b-local-manager',
  'windows',
  'latest-prerelease',
  '0.1.1',
  NULL,
  'local-manager-windows-latest',
  'https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/releases/download/local-manager-windows-latest/Mad4B-Local-Manager-Setup.exe',
  'https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/releases/download/local-manager-windows-latest/Mad4B-Local-Manager-Setup.exe.sha256.json',
  NULL,
  0,
  JSON_ARRAY(
    'Adds update availability notifications in the Windows app.',
    'Aligns Local Manager sign-in/sign-up with the platform /connect flow.',
    'Improves public app UX while keeping device-token controls read-only.'
  ),
  'active',
  NOW()
) ON DUPLICATE KEY UPDATE
  `release_id` = VALUES(`release_id`),
  `minimum_supported_version` = VALUES(`minimum_supported_version`),
  `release_tag` = VALUES(`release_tag`),
  `artifact_url` = VALUES(`artifact_url`),
  `sha256_url` = VALUES(`sha256_url`),
  `sha256` = VALUES(`sha256`),
  `update_required` = VALUES(`update_required`),
  `release_notes_json` = VALUES(`release_notes_json`),
  `status` = VALUES(`status`),
  `published_at` = VALUES(`published_at`);
