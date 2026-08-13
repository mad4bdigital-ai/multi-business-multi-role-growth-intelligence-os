-- Remote MCP Dynamic Permission Tree and Governed Scope Projection v1.
-- Additive metadata-only foundation. Does not apply migrations, call providers, mutate environments,
-- read credentials, enable provider writes, or expose secrets.

CREATE TABLE IF NOT EXISTS platform_oauth_scope_registry (
  scope_key VARCHAR(128) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  description VARCHAR(1000) NOT NULL,
  effect_class VARCHAR(64) NOT NULL,
  risk_class VARCHAR(64) NOT NULL,
  default_request TINYINT(1) NOT NULL DEFAULT 0,
  incremental_request TINYINT(1) NOT NULL DEFAULT 1,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  introduced_by_commit VARCHAR(64) NULL,
  deprecated_by_scope VARCHAR(128) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (scope_key),
  KEY idx_platform_oauth_scope_status (status, default_request)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_resource_scope_bindings (
  resource_key VARCHAR(128) NOT NULL,
  operation_key VARCHAR(64) NOT NULL,
  scope_key VARCHAR(128) NOT NULL,
  tenant_allowed TINYINT(1) NOT NULL DEFAULT 0,
  admin_allowed TINYINT(1) NOT NULL DEFAULT 0,
  approval_required TINYINT(1) NOT NULL DEFAULT 0,
  capability_class VARCHAR(128) NOT NULL DEFAULT 'read_only',
  environment_class VARCHAR(128) NOT NULL DEFAULT 'all',
  effect_class VARCHAR(64) NOT NULL DEFAULT 'read_only',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  source_revision VARCHAR(128) NOT NULL,
  PRIMARY KEY (resource_key, operation_key),
  KEY idx_platform_resource_scope_scope (scope_key, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_tool_scope_bindings (
  tool_key VARCHAR(191) NOT NULL,
  scope_key VARCHAR(128) NOT NULL,
  required TINYINT(1) NOT NULL DEFAULT 1,
  binding_revision VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  source VARCHAR(255) NOT NULL,
  PRIMARY KEY (tool_key),
  KEY idx_platform_tool_scope_scope (scope_key, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_scope_implications (
  scope_key VARCHAR(128) NOT NULL,
  implies_scope_key VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  source_revision VARCHAR(128) NOT NULL,
  PRIMARY KEY (scope_key, implies_scope_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_scope_catalog_revisions (
  revision_id VARCHAR(128) NOT NULL,
  source_fingerprint CHAR(64) NOT NULL,
  catalog_fingerprint CHAR(64) NOT NULL,
  generated_at DATETIME NOT NULL,
  generated_by VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  evidence_json LONGTEXT NULL,
  PRIMARY KEY (revision_id),
  KEY idx_platform_scope_catalog_status (status, generated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO platform_oauth_scope_registry
  (scope_key, display_name, description, effect_class, risk_class, default_request, incremental_request, status, introduced_by_commit)
VALUES
  ('identity.read','Read identity','Read the active linked identity.','read_only','low',1,0,'active','acbfb1351fdf2fb4932d85fc1a034917d06c574c'),
  ('workspaces.read','Read workspaces','Read active workspaces available to the linked identity.','read_only','low',1,0,'active','acbfb1351fdf2fb4932d85fc1a034917d06c574c'),
  ('brands.read','Read brands','Read brands authorized inside an active workspace.','read_only','low',1,0,'active','acbfb1351fdf2fb4932d85fc1a034917d06c574c'),
  ('permissions.read','Read permissions','Read effective permission projections.','read_only','low',1,0,'active','acbfb1351fdf2fb4932d85fc1a034917d06c574c'),
  ('assets.read','Read assets','Read authorized workspace assets.','read_only','low',0,1,'active','acbfb1351fdf2fb4932d85fc1a034917d06c574c'),
  ('sessions.read','Read sessions','Read bounded session projections.','read_only','low',0,1,'active','acbfb1351fdf2fb4932d85fc1a034917d06c574c'),
  ('executions.read','Read executions','Read authorized execution evidence.','read_only','medium',0,1,'active','acbfb1351fdf2fb4932d85fc1a034917d06c574c'),
  ('approvals.read','Read approvals','Read approval holds.','read_only','low',0,1,'active','acbfb1351fdf2fb4932d85fc1a034917d06c574c'),
  ('approvals.request','Request approvals','Request an approval hold without deciding it.','internal_write','medium',0,1,'active','acbfb1351fdf2fb4932d85fc1a034917d06c574c'),
  ('connections.read','Read connections','Read connection metadata without secrets.','read_only','medium',0,1,'active','acbfb1351fdf2fb4932d85fc1a034917d06c574c'),
  ('github.read','Read GitHub','Read governed GitHub metadata.','read_only','medium',0,1,'active','acbfb1351fdf2fb4932d85fc1a034917d06c574c'),
  ('cloudflare.read','Read Cloudflare','Read governed Cloudflare metadata.','read_only','medium',0,1,'active','acbfb1351fdf2fb4932d85fc1a034917d06c574c'),
  ('hostinger.read','Read Hostinger','Read governed Hostinger metadata.','read_only','medium',0,1,'active','acbfb1351fdf2fb4932d85fc1a034917d06c574c')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name), description=VALUES(description), effect_class=VALUES(effect_class), risk_class=VALUES(risk_class),
  default_request=VALUES(default_request), incremental_request=VALUES(incremental_request), status=VALUES(status), updated_at=CURRENT_TIMESTAMP;

INSERT INTO platform_resource_scope_bindings
  (resource_key, operation_key, scope_key, tenant_allowed, admin_allowed, approval_required, capability_class, environment_class, effect_class, status, source_revision)
VALUES
  ('workspaces','list','workspaces.read',1,1,0,'read_only','all','read_only','active','remote-mcp-scope-catalog-v1'),
  ('brands','list','brands.read',1,1,0,'read_only','all','read_only','active','remote-mcp-scope-catalog-v1')
ON DUPLICATE KEY UPDATE
  scope_key=VALUES(scope_key), tenant_allowed=VALUES(tenant_allowed), admin_allowed=VALUES(admin_allowed), approval_required=VALUES(approval_required),
  capability_class=VALUES(capability_class), environment_class=VALUES(environment_class), effect_class=VALUES(effect_class), status=VALUES(status), source_revision=VALUES(source_revision);

INSERT INTO platform_tool_scope_bindings
  (tool_key, scope_key, required, binding_revision, status, source)
VALUES
  ('list_accessible_workspaces','workspaces.read',1,'remote-mcp-scope-catalog-v1','active','remote-mcp-scope-catalog.generated.json'),
  ('list_accessible_brands','brands.read',1,'remote-mcp-scope-catalog-v1','active','remote-mcp-scope-catalog.generated.json')
ON DUPLICATE KEY UPDATE
  scope_key=VALUES(scope_key), required=VALUES(required), binding_revision=VALUES(binding_revision), status=VALUES(status), source=VALUES(source);

INSERT INTO platform_scope_implications (scope_key, implies_scope_key, status, source_revision)
VALUES
  ('assets.read','permissions.read','active','remote-mcp-scope-catalog-v1'),
  ('approvals.request','approvals.read','active','remote-mcp-scope-catalog-v1')
ON DUPLICATE KEY UPDATE status=VALUES(status), source_revision=VALUES(source_revision);

INSERT INTO platform_scope_catalog_revisions
  (revision_id, source_fingerprint, catalog_fingerprint, generated_at, generated_by, status, evidence_json)
VALUES
  ('remote-mcp-scope-catalog-v1',
   'acbfb1351fdf2fb4932d85fc1a034917d06c574c',
   '7696f62ab97a36bdc8c33c8e2e5f25212a2de0222a5a0351501460d1de5eebaf',
   CURRENT_TIMESTAMP,
   'remote-mcp-scope-catalog-v1',
   'active',
   JSON_OBJECT('source_artifact','remote-mcp-scope-catalog.generated.json','secrets_included',FALSE))
ON DUPLICATE KEY UPDATE
  source_fingerprint=VALUES(source_fingerprint), catalog_fingerprint=VALUES(catalog_fingerprint), generated_at=VALUES(generated_at),
  generated_by=VALUES(generated_by), status=VALUES(status), evidence_json=VALUES(evidence_json);
