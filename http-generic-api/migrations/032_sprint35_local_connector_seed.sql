-- Sprint 35: Local Connector — add connector_secret column and seed Nagy admin device config

-- ── Add connector_secret column for per-device auth ───────────────────────────

ALTER TABLE `local_connector_user_configs`
  ADD COLUMN `connector_secret` VARCHAR(256) NULL
    COMMENT 'Shared secret: Cloud Run sends it as Bearer token, local server validates it';

-- ── Seed: Nagy admin (mohammedlap) connected via connector.mad4b.com ───────────────

INSERT IGNORE INTO `local_connector_user_configs`
  (config_id, user_id, tenant_id, device_id, tunnel_url, connector_secret, is_enabled)
VALUES (
  '00000000-0000-4000-b000-000000000001',
  '00000000-0000-4000-a000-000000000002',   -- Nagy admin user
  '00000000-0000-4000-a000-000000000001',   -- platform tenant
  'mohammedlap',
  'https://connector.mad4b.com',
  NULL,                                     -- set connector_secret via /install or env var
  1
);

-- ── Seed: shell allowlist for mohammedlap ─────────────────────────────────────────

INSERT IGNORE INTO `local_connector_shell_allowlists`
  (config_id, alias, command_template, allow_extra_args, description)
VALUES
  ('00000000-0000-4000-b000-000000000001', 'node_ver',       'node --version',                       0, 'Node.js version on local machine'),
  ('00000000-0000-4000-b000-000000000001', 'nslookup_test',  'nslookup n8n.mad4b.com',               0, 'DNS lookup for n8n.mad4b.com'),
  ('00000000-0000-4000-b000-000000000001', 'n8n_health',     'curl -s --max-time 10 http://127.0.0.1:5678/', 0, 'n8n local health check'),
  ('00000000-0000-4000-b000-000000000001', 'git_status',     'git status',                           0, 'Git status of working directory'),
  ('00000000-0000-4000-b000-000000000001', 'list_processes',  'tasklist /FO CSV /NH',                0, 'Running processes (CSV)');

-- ── Seed: file access rules for mohammedlap ───────────────────────────────────────

INSERT IGNORE INTO `local_connector_file_access_rules`
  (config_id, path_pattern, access_mode, description)
VALUES
  ('00000000-0000-4000-b000-000000000001', 'D:\\n8n-data\\n8n.log',        'read', 'n8n runtime log'),
  ('00000000-0000-4000-b000-000000000001', 'D:\\n8n-data\\connector.log',  'read', 'Connector runtime log');
