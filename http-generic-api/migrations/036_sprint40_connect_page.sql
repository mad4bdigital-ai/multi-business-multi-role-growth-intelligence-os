-- Sprint 40: tenant_backend_connections table + new admin user for connector

-- ── Table: per-tenant backend connection mode ─────────────────────────────────
CREATE TABLE IF NOT EXISTS `tenant_backend_connections` (
  `connection_id`    VARCHAR(36) NOT NULL,
  `tenant_id`        VARCHAR(36) NOT NULL,
  `connection_mode`  ENUM('managed','dedicated') NOT NULL DEFAULT 'managed',
  `cloudflare_mode`  ENUM('managed','dedicated') NOT NULL DEFAULT 'managed',
  `google_auth_mode` ENUM('managed','dedicated') NOT NULL DEFAULT 'managed',
  `status`           ENUM('active','pending','inactive') NOT NULL DEFAULT 'pending',
  `device_count`     INT NOT NULL DEFAULT 0,
  `notes`            TEXT NULL,
  `activated_at`     DATETIME NULL,
  `created_at`       DATETIME NOT NULL DEFAULT NOW(),
  `updated_at`       DATETIME NOT NULL DEFAULT NOW() ON UPDATE NOW(),
  PRIMARY KEY (`connection_id`),
  UNIQUE KEY `uq_tbc_tenant` (`tenant_id`),
  KEY `idx_tbc_status` (`status`)
) ENGINE=InnoDB;

-- ── New admin user (connector owner for mohammedlap device) ───────────────────
INSERT IGNORE INTO `users`
  (user_id, email, display_name, status)
VALUES
  ('00000000-0000-4000-a000-000000000005', 'admin.connector@mad4b.com', 'Platform Connector Admin', 'active');

INSERT IGNORE INTO `memberships`
  (user_id, tenant_id, role, status)
VALUES
  ('00000000-0000-4000-a000-000000000005',
   '00000000-0000-4000-a000-000000000001',
   'admin', 'active');

-- ── Local connector config for new admin user (mohammedlap device) ────────────
-- tunnel_url uses existing connector.mad4b.com — connector_secret set via /install
INSERT IGNORE INTO `local_connector_user_configs`
  (config_id, user_id, tenant_id, device_id, tunnel_url, connector_secret, is_enabled)
VALUES
  ('00000000-0000-4000-b000-000000000002',
   '00000000-0000-4000-a000-000000000005',
   '00000000-0000-4000-a000-000000000001',
   'mohammedlap',
   'https://connector.mad4b.com',
   NULL,
   1);

-- ── Shell allowlist for new admin config ─────────────────────────────────────
INSERT IGNORE INTO `local_connector_shell_allowlists`
  (config_id, alias, command_template, allow_extra_args, description)
VALUES
  ('00000000-0000-4000-b000-000000000002', 'node_ver',       'node --version',              0, 'Node.js version'),
  ('00000000-0000-4000-b000-000000000002', 'git_status',     'git status',                  0, 'Git status'),
  ('00000000-0000-4000-b000-000000000002', 'n8n_health',     'curl -s --max-time 10 http://127.0.0.1:5678/', 0, 'n8n health'),
  ('00000000-0000-4000-b000-000000000002', 'list_processes',  'tasklist /FO CSV /NH',       0, 'Running processes'),
  ('00000000-0000-4000-b000-000000000002', 'nslookup_test',  'nslookup n8n.mad4b.com',      0, 'DNS lookup n8n');
