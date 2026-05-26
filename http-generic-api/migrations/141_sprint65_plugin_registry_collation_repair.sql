-- Sprint 65: Platform Plugin / App Integration collation repair
--
-- Problem:
--   Some older Platform Plugin tables were created with DEFAULT CHARSET=utf8mb4
--   while the server default was utf8mb4_uca1400_ai_ci. Newer registry tables
--   use utf8mb4_unicode_ci. Natural joins across app_key/action_key then fail
--   with ER_CANT_AGGREGATE_2COLLATIONS.
--
-- Safety model:
--   1. Create prefixed backup snapshots of every table being changed.
--   2. Set the current database default to utf8mb4_unicode_ci for future DDL.
--   3. Repair the original runtime table names in place so application code and
--      registry bindings do not need a table-name switch.
--   4. Do not use ALTER TABLE ... CONVERT TO CHARACTER SET because MariaDB JSON
--      columns are LONGTEXT utf8mb4_bin; broad conversion can weaken JSON column
--      semantics. Only string/enumerated runtime key and metadata columns are
--      modified explicitly.

ALTER DATABASE CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `zz_collation_backup_20260526_app_integrations` LIKE `app_integrations`;
INSERT IGNORE INTO `zz_collation_backup_20260526_app_integrations` SELECT * FROM `app_integrations`;

CREATE TABLE IF NOT EXISTS `zz_collation_backup_20260526_user_app_connections` LIKE `user_app_connections`;
INSERT IGNORE INTO `zz_collation_backup_20260526_user_app_connections` SELECT * FROM `user_app_connections`;

CREATE TABLE IF NOT EXISTS `zz_collation_backup_20260526_workspace_app_links` LIKE `workspace_app_links`;
INSERT IGNORE INTO `zz_collation_backup_20260526_workspace_app_links` SELECT * FROM `workspace_app_links`;

CREATE TABLE IF NOT EXISTS `zz_collation_backup_20260526_app_action_grants` LIKE `app_action_grants`;
INSERT IGNORE INTO `zz_collation_backup_20260526_app_action_grants` SELECT * FROM `app_action_grants`;

CREATE TABLE IF NOT EXISTS `zz_collation_backup_20260526_app_action_requests` LIKE `app_action_requests`;
INSERT IGNORE INTO `zz_collation_backup_20260526_app_action_requests` SELECT * FROM `app_action_requests`;

ALTER TABLE `app_integrations`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY `app_key`              VARCHAR(64)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'google_drive|notion|github|slack|webhook|api_key|mcp',
  MODIFY `display_name`         VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY `description`          TEXT         CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  MODIFY `auth_type`            ENUM('oauth2','api_key','webhook','mcp','basic_auth','bearer_token') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY `oauth_authorize_url`  VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  MODIFY `oauth_token_url`      VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  MODIFY `oauth_revoke_url`     VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  MODIFY `oauth_scopes_default` TEXT         CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT 'Space-separated default OAuth scopes',
  MODIFY `icon_url`             VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  MODIFY `docs_url`             VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  MODIFY `category`             VARCHAR(64)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT 'files|communication|code|productivity|crm|custom',
  MODIFY `status`               ENUM('active','beta','deprecated') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active';

ALTER TABLE `user_app_connections`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY `connection_id`          VARCHAR(36)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY `user_id`                VARCHAR(36)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY `tenant_id`              VARCHAR(36)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY `app_key`                VARCHAR(64)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY `display_label`          VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT 'User-chosen label e.g. "My Work Drive"',
  MODIFY `auth_type`              ENUM('oauth2','api_key','webhook','mcp','basic_auth','bearer_token','custom_headers','client_credentials') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY `encrypted_credentials`  TEXT         CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  MODIFY `credential_ref`         VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  MODIFY `scopes_granted`         TEXT         CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT 'Actual scopes returned by the provider',
  MODIFY `account_label`          VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT 'e.g. user@gmail.com — identifier only, no tokens',
  MODIFY `mcp_endpoint`           VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT 'MCP server URL (auth in encrypted_credentials)',
  MODIFY `webhook_url`            VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT 'Webhook target URL',
  MODIFY `api_base_url`           VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT 'Base URL for custom API connections',
  MODIFY `status`                 ENUM('active','expired','revoked','error') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  MODIFY `validation_status`      VARCHAR(64)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL;

ALTER TABLE `workspace_app_links`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY `link_id`         VARCHAR(36)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY `workspace_id`    VARCHAR(36)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY `workspace_key`   VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  MODIFY `tenant_id`       VARCHAR(36)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY `connection_id`   VARCHAR(36)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY `app_key`         VARCHAR(64)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY `linked_by`       VARCHAR(36)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT 'user_id who linked this connection to the workspace',
  MODIFY `status`          ENUM('active','suspended','removed') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  MODIFY `permission_mode` ENUM('strict','permissive') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'strict';

ALTER TABLE `app_action_grants`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY `grant_id`      VARCHAR(36)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY `connection_id` VARCHAR(36)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY `workspace_id`  VARCHAR(36)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT 'NULL = all workspaces this connection is linked to',
  MODIFY `agent_id`      VARCHAR(36)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT 'NULL = all agents',
  MODIFY `app_key`       VARCHAR(64)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY `action_key`    VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'e.g. google_drive.read_file, notion.create_page',
  MODIFY `grant_mode`    ENUM('explicit','default_permissive','auto_approved') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'explicit',
  MODIFY `granted_by`    VARCHAR(36)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT 'user_id who granted this',
  MODIFY `status`        ENUM('active','revoked','expired') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active';

ALTER TABLE `app_action_requests`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY `request_id`     VARCHAR(36)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY `connection_id`  VARCHAR(36)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY `workspace_id`   VARCHAR(36)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  MODIFY `agent_id`       VARCHAR(36)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY `run_id`         VARCHAR(36)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT 'Execution run that triggered this request',
  MODIFY `app_key`        VARCHAR(64)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY `action_key`     VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY `request_reason` TEXT         CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT 'Agent-provided explanation for why it needs this',
  MODIFY `status`         ENUM('pending','approved','denied','expired') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  MODIFY `reviewed_by`    VARCHAR(36)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL;
