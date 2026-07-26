-- Sprint 65: DB-driven connector shell policy metadata
-- Makes local_connector_shell_allowlists suitable as the runtime source of truth
-- for local connector shell aliases. Existing command_template rows remain valid.

ALTER TABLE `local_connector_shell_allowlists`
  ADD COLUMN IF NOT EXISTS `status` VARCHAR(32) NOT NULL DEFAULT 'active' AFTER `description`,
  ADD COLUMN IF NOT EXISTS `risk_class` VARCHAR(64) NOT NULL DEFAULT 'read_only' AFTER `status`,
  ADD COLUMN IF NOT EXISTS `source` VARCHAR(64) NOT NULL DEFAULT 'db' AFTER `risk_class`,
  ADD COLUMN IF NOT EXISTS `policy_version` INT NOT NULL DEFAULT 1 AFTER `source`,
  ADD COLUMN IF NOT EXISTS `checksum` VARCHAR(64) NULL AFTER `policy_version`,
  ADD COLUMN IF NOT EXISTS `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER `created_at`;

CREATE UNIQUE INDEX IF NOT EXISTS `uq_lc_shell_policy_config_alias`
  ON `local_connector_shell_allowlists` (`config_id`, `alias`);

CREATE INDEX IF NOT EXISTS `idx_lc_shell_policy_config_status_alias`
  ON `local_connector_shell_allowlists` (`config_id`, `status`, `alias`);

UPDATE `local_connector_shell_allowlists`
   SET `status` = 'active',
       `risk_class` = 'read_only',
       `source` = COALESCE(NULLIF(`source`, ''), 'db'),
       `policy_version` = GREATEST(COALESCE(`policy_version`, 1), 1)
 WHERE `status` IS NULL OR `status` = '' OR `risk_class` IS NULL OR `risk_class` = '';

INSERT INTO `local_connector_shell_allowlists`
  (`config_id`, `alias`, `command_template`, `allow_extra_args`, `description`, `status`, `risk_class`, `source`, `policy_version`)
VALUES
  ('8db63b00-4fce-11f1-b256-614c56cd019b', 'repo_status_growth_os', '"C:\\Program Files\\Git\\cmd\\git.exe" -C "D:\\Nagy\\Multi-Business-Multi-Role-Growth-Intelligence-OS" status --short', 0, 'Read-only git status for Growth Intelligence OS local repo', 'active', 'read_only', 'db_seed', 2),
  ('8db63b00-4fce-11f1-b256-614c56cd019b', 'repo_diff_name_status_growth_os', '"C:\\Program Files\\Git\\cmd\\git.exe" -C "D:\\Nagy\\Multi-Business-Multi-Role-Growth-Intelligence-OS" diff --name-status', 0, 'Read-only git diff --name-status for Growth Intelligence OS local repo', 'active', 'read_only', 'db_seed', 2)
ON DUPLICATE KEY UPDATE
  `command_template` = VALUES(`command_template`),
  `allow_extra_args` = VALUES(`allow_extra_args`),
  `description` = VALUES(`description`),
  `status` = VALUES(`status`),
  `risk_class` = VALUES(`risk_class`),
  `source` = VALUES(`source`),
  `policy_version` = GREATEST(`policy_version`, VALUES(`policy_version`));
