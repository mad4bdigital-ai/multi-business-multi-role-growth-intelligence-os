-- Sprint 42: platform runtime config
-- Durable runtime settings that admin tools can update without deploying a new
-- Cloud Run revision. Used first by activation bootstrap before env fallback.

CREATE TABLE IF NOT EXISTS `platform_runtime_config` (
  `config_key`  VARCHAR(128) NOT NULL,
  `config_json` JSON         NOT NULL,
  `status`      ENUM('active','disabled') NOT NULL DEFAULT 'active',
  `note`        VARCHAR(255) NULL,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`config_key`),
  KEY `idx_prc_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

