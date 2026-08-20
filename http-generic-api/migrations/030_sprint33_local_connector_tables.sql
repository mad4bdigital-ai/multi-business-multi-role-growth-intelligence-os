-- Sprint 33: Local Connector — per-user device config, shell allowlist, file access rules
-- Backs localConnectorOrchestrator.js. All actions are audited via agent_actions.

-- ── Per-user device configuration ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `local_connector_user_configs` (
  `config_id`    VARCHAR(36)   NOT NULL,
  `user_id`      VARCHAR(36)   NOT NULL,
  `tenant_id`    VARCHAR(36)   NOT NULL,
  `device_id`    VARCHAR(128)  NOT NULL COMMENT 'Stable identifier for the local machine (hostname or UUID)',
  `tunnel_url`   VARCHAR(1024) NULL      COMMENT 'Cloudflare Tunnel URL for this device connector',
  `is_enabled`   TINYINT(1)    NOT NULL DEFAULT 1,
  `created_at`   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`config_id`),
  UNIQUE KEY `uq_user_device` (`user_id`, `tenant_id`, `device_id`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Migration 017 may have created this table first with a legacy shape. CREATE TABLE
-- IF NOT EXISTS does not reconcile an existing table, so make the column contract
-- explicit before migration 032 seeds tunnel_url.
ALTER TABLE `local_connector_user_configs`
  ADD COLUMN IF NOT EXISTS `tunnel_url` VARCHAR(1024) NULL
    COMMENT 'Cloudflare Tunnel URL for this device connector' AFTER `device_id`;

-- ── Shell command allowlist ────────────────────────────────────────────────────
-- Each row is one alias an agent can invoke via the connector.

CREATE TABLE IF NOT EXISTS `local_connector_shell_allowlists` (
  `id`                INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `config_id`         VARCHAR(36)   NOT NULL,
  `alias`             VARCHAR(128)  NOT NULL COMMENT 'Short name used by agents: e.g. git_status',
  `command_template`  VARCHAR(1024) NOT NULL COMMENT 'Shell template — {args} is substituted with extra_args',
  `allow_extra_args`  TINYINT(1)    NOT NULL DEFAULT 0 COMMENT 'Whether the agent may pass additional arguments',
  `description`       VARCHAR(512)  NULL,
  `created_at`        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_config_alias` (`config_id`, `alias`),
  CONSTRAINT `fk_shell_config` FOREIGN KEY (`config_id`)
    REFERENCES `local_connector_user_configs` (`config_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── File access rules ──────────────────────────────────────────────────────────
-- Governs which paths an agent may read or write on the local device.

CREATE TABLE IF NOT EXISTS `local_connector_file_access_rules` (
  `id`           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `config_id`    VARCHAR(36)   NOT NULL,
  `path_pattern` VARCHAR(1024) NOT NULL COMMENT 'Exact path or glob pattern',
  `access_mode`  ENUM('read','write','read_write') NOT NULL DEFAULT 'read',
  `description`  VARCHAR(512)  NULL,
  `created_at`   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_config` (`config_id`),
  CONSTRAINT `fk_file_config` FOREIGN KEY (`config_id`)
    REFERENCES `local_connector_user_configs` (`config_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
