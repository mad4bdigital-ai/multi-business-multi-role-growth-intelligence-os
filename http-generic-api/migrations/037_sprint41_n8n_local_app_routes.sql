-- Sprint 41: n8n activation modes + per-device local app routes
-- Adds durable routing metadata for devices that expose connector, n8n, browser,
-- and future local apps through one Cloudflare tunnel hostname.

ALTER TABLE `tenant_backend_connections`
  ADD COLUMN IF NOT EXISTS `n8n_activation_mode`
    ENUM('managed_main_server','self_hosted_local')
    NOT NULL DEFAULT 'managed_main_server'
    COMMENT 'managed_main_server = platform n8n.mad4b.com account, self_hosted_local = user device n8n route';

CREATE TABLE IF NOT EXISTS `local_connector_app_routes` (
  `route_id`     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `config_id`    VARCHAR(36)  NOT NULL,
  `app_key`      VARCHAR(64)  NOT NULL COMMENT 'connector|n8n|browser|future app key',
  `route_mode`   ENUM('host','path') NOT NULL DEFAULT 'path',
  `hostname`     VARCHAR(255) NOT NULL,
  `path_prefix`  VARCHAR(128) NULL,
  `local_port`   INT UNSIGNED NOT NULL,
  `service_url`  VARCHAR(512) NOT NULL,
  `public_url`   VARCHAR(512) NOT NULL,
  `status`       ENUM('planned','active','disabled') NOT NULL DEFAULT 'planned',
  `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`route_id`),
  UNIQUE KEY `uq_lcar_config_app` (`config_id`, `app_key`),
  KEY `idx_lcar_config` (`config_id`),
  KEY `idx_lcar_hostname` (`hostname`),
  CONSTRAINT `fk_lcar_config` FOREIGN KEY (`config_id`)
    REFERENCES `local_connector_user_configs` (`config_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
