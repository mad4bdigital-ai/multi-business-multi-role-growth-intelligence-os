-- Sprint 05: Logic Graph and Packs

CREATE TABLE IF NOT EXISTS `logic_definitions` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `logic_id`        VARCHAR(36) NOT NULL,
  `logic_key`       VARCHAR(128) NOT NULL,
  `display_name`    VARCHAR(255) NOT NULL,
  `logic_type`      ENUM('parent','child','supervisory','execution','review','audit','training') NOT NULL DEFAULT 'execution',
  `parent_logic_id` VARCHAR(36) NULL,
  `tenant_id`       VARCHAR(36) NULL,
  `body_json`       TEXT NULL,
  `source_url`      VARCHAR(1024) NULL,
  `package_version` VARCHAR(64) NULL,
  `skill_manifest`  LONGTEXT NULL,
  `version`         VARCHAR(32) NOT NULL DEFAULT '1.0',
  `status`          ENUM('active','draft','deprecated','archived') NOT NULL DEFAULT 'draft',
  `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_logic_id` (`logic_id`),
  KEY `idx_logic_key` (`logic_key`),
  KEY `idx_parent` (`parent_logic_id`),
  KEY `idx_type` (`logic_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS `logic_packs` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `pack_id`         VARCHAR(36) NOT NULL,
  `pack_key`        VARCHAR(128) NOT NULL,
  `display_name`    VARCHAR(255) NOT NULL,
  `pack_type`       ENUM('review','audit','supervision','training','sop','operational','custom') NOT NULL DEFAULT 'operational',
  `service_mode`    ENUM('self_serve','assisted','managed') NOT NULL DEFAULT 'self_serve',
  `parent_pack_id`  VARCHAR(36) NULL,
  `tenant_id`       VARCHAR(36) NULL,
  `contents_json`   TEXT NULL,
  `status`          ENUM('active','draft','deprecated') NOT NULL DEFAULT 'draft',
  `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pack_id` (`pack_id`),
  KEY `idx_pack_key` (`pack_key`),
  KEY `idx_type` (`pack_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS `pack_attachments` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `attachment_id`  VARCHAR(36) NOT NULL,
  `pack_id`        VARCHAR(36) NOT NULL,
  `target_type`    ENUM('tenant','workflow','logic','action','brand') NOT NULL,
  `target_id`      VARCHAR(128) NOT NULL,
  `attached_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `attached_by`    VARCHAR(36) NULL,
  `status`         ENUM('active','detached') NOT NULL DEFAULT 'active',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_attachment_id` (`attachment_id`),
  KEY `idx_pack` (`pack_id`),
  KEY `idx_target` (`target_type`, `target_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS `adaptation_records` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `adaptation_id`   VARCHAR(36) NOT NULL,
  `logic_id`        VARCHAR(36) NOT NULL,
  `tenant_id`       VARCHAR(36) NOT NULL,
  `adapted_by`      VARCHAR(36) NULL,
  `adaptation_type` ENUM('override','extension','restriction','annotation') NOT NULL DEFAULT 'override',
  `original_json`   TEXT NULL,
  `adapted_json`    TEXT NOT NULL,
  `reason`          VARCHAR(512) NULL,
  `approved_by`     VARCHAR(36) NULL,
  `status`          ENUM('pending','approved','rejected','reverted') NOT NULL DEFAULT 'pending',
  `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_adaptation_id` (`adaptation_id`),
  KEY `idx_logic` (`logic_id`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
