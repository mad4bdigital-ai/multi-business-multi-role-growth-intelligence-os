-- Repository Conflict Intelligence dynamic toolkit.
-- Safety contract: registry and policy foundation only; no provider mutation, no merge execution, no secret response.

CREATE TABLE IF NOT EXISTS repo_conflict_path_policies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  policy_key VARCHAR(191) NOT NULL,
  path_pattern VARCHAR(512) NOT NULL,
  path_class VARCHAR(96) NOT NULL,
  default_strategy VARCHAR(128) NOT NULL,
  risk_class VARCHAR(64) NOT NULL DEFAULT 'medium',
  auto_resolve TINYINT(1) NOT NULL DEFAULT 0,
  requires_test TINYINT(1) NOT NULL DEFAULT 1,
  scope_type ENUM('admin','tenant','mixed') NOT NULL DEFAULT 'mixed',
  status VARCHAR(64) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_repo_conflict_path_policies_key (policy_key),
  KEY idx_repo_conflict_path_policies_lookup (path_class, status, auto_resolve)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS repo_conflict_resolution_plans (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  plan_id VARCHAR(64) NOT NULL,
  scope_type ENUM('admin','tenant') NOT NULL DEFAULT 'admin',
  tenant_id VARCHAR(64) NULL,
  repository VARCHAR(256) NULL,
  base_branch VARCHAR(128) NULL,
  head_branch VARCHAR(256) NULL,
  classification VARCHAR(128) NOT NULL,
  recommended_path VARCHAR(128) NOT NULL,
  plan_json JSON NULL,
  created_by VARCHAR(191) NULL,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_repo_conflict_resolution_plans_plan_id (plan_id),
  KEY idx_repo_conflict_resolution_plans_scope (scope_type, tenant_id, created_at),
  KEY idx_repo_conflict_resolution_plans_classification (classification, recommended_path)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO repo_conflict_path_policies (policy_key, path_pattern, path_class, default_strategy, risk_class, auto_resolve, requires_test, scope_type, status)
VALUES
  ('generated.auto_docs_agent.v1', 'docs/auto-docs-agent/**', 'generated_artifact', 'drop_generated_artifacts', 'low', 1, 0, 'mixed', 'active'),
  ('generated.work_maps.v1', 'docs/work-maps/**', 'generated_artifact', 'keep_main_for_generated', 'low', 1, 0, 'mixed', 'active'),
  ('route.index.semantic_mount.v1', 'http-generic-api/routes/index.js', 'route_mount', 'semantic_merge', 'medium', 1, 1, 'admin', 'active'),
  ('routes.new_file.v1', 'http-generic-api/routes/*.js', 'api_route', 'keep_branch_new_file', 'medium', 1, 1, 'mixed', 'active'),
  ('service.new_file.v1', 'http-generic-api/*Service.js', 'application_service', 'keep_branch_new_file', 'medium', 1, 1, 'mixed', 'active'),
  ('migration.additive.v1', 'http-generic-api/migrations/*.sql', 'database_migration', 'append_additive_migration', 'medium', 1, 1, 'admin', 'active'),
  ('test_manifest.unique_append.v1', 'http-generic-api/scripts/test-manifest.mjs', 'test_manifest', 'append_unique_test_manifest_entry', 'low', 1, 1, 'admin', 'active'),
  ('spec_kit.keep_branch.v1', 'docs/spec-kits/**', 'spec_kit', 'keep_branch_new_file', 'low', 1, 0, 'mixed', 'active'),
  ('dependency_lockfile.manual.v1', 'package-lock.json', 'dependency_lockfile', 'manual_required', 'high', 0, 1, 'mixed', 'active'),
  ('auth.manual.v1', '**/auth/**', 'security_sensitive', 'manual_required', 'critical', 0, 1, 'admin', 'active'),
  ('security.manual.v1', '**/security/**', 'security_sensitive', 'manual_required', 'critical', 0, 1, 'admin', 'active')
ON DUPLICATE KEY UPDATE path_pattern = VALUES(path_pattern), path_class = VALUES(path_class), default_strategy = VALUES(default_strategy), risk_class = VALUES(risk_class), auto_resolve = VALUES(auto_resolve), requires_test = VALUES(requires_test), scope_type = VALUES(scope_type), status = VALUES(status), updated_at = CURRENT_TIMESTAMP;

INSERT INTO admin_platform_endpoint_tools (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
  ('repo_conflict_intelligence_analyze', 'Analyze Repository Conflict', 'Classify repository or PR conflict files into dynamic path-policy strategies. Read-only and no secrets.', 'POST', '/admin/repo-conflict-intelligence/analyze', JSON_ARRAY(), JSON_OBJECT('type','object','properties',JSON_OBJECT('base',JSON_OBJECT('type','string'),'head',JSON_OBJECT('type','string'),'compare',JSON_OBJECT('type','object'),'files',JSON_OBJECT('type','array'),'commits',JSON_OBJECT('type','array')),'additionalProperties',true), NULL, 'repo_conflict_intelligence,admin,read_only,no_secrets,dynamic_policy', 1, 6650),
  ('repo_conflict_intelligence_plan', 'Plan Repository Conflict Resolution', 'Build a dynamic typed resolution plan for a dirty PR or branch conflict. Does not mutate Git.', 'POST', '/admin/repo-conflict-intelligence/plan', JSON_ARRAY(), JSON_OBJECT('type','object','properties',JSON_OBJECT('analysis',JSON_OBJECT('type','object'),'files',JSON_OBJECT('type','array'),'commits',JSON_OBJECT('type','array')),'additionalProperties',true), NULL, 'repo_conflict_intelligence,admin,planner,no_provider_call,no_secrets', 1, 6651),
  ('repo_conflict_intelligence_semantic_preview', 'Preview Semantic Conflict Patch', 'Preview idempotent semantic operations such as import insertion, route mount insertion, and unique line append.', 'POST', '/admin/repo-conflict-intelligence/semantic-preview', JSON_ARRAY(), JSON_OBJECT('type','object','required',JSON_ARRAY('operations'),'properties',JSON_OBJECT('operations',JSON_OBJECT('type','array'),'max_preview_chars',JSON_OBJECT('type','integer')),'additionalProperties',false), NULL, 'repo_conflict_intelligence,admin,semantic_patch,preview_only,no_secrets', 1, 6652)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), description = VALUES(description), http_method = VALUES(http_method), http_path = VALUES(http_path), path_param_keys = VALUES(path_param_keys), input_schema = VALUES(input_schema), fixed_body = VALUES(fixed_body), tags = VALUES(tags), is_enabled = VALUES(is_enabled), sort_order = VALUES(sort_order);

INSERT INTO tenant_platform_endpoint_tools (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
  ('tenant_repo_conflict_intelligence_analyze', 'Analyze Tenant-Visible Repository Conflict', 'Return a tenant-safe conflict summary from provided file metadata. No cross-tenant evidence or secrets.', 'POST', '/me/repo-conflict-intelligence/analyze', JSON_ARRAY(), JSON_OBJECT('type','object','properties',JSON_OBJECT('base',JSON_OBJECT('type','string'),'head',JSON_OBJECT('type','string'),'files',JSON_OBJECT('type','array')),'additionalProperties',true), NULL, 'repo_conflict_intelligence,tenant,read_only,no_secrets,tenant_scope', 1, 6650),
  ('tenant_repo_conflict_intelligence_plan', 'Plan Tenant Conflict Resolution Request', 'Return a tenant-safe plan that requests admin resolution instead of executing repository mutation.', 'POST', '/me/repo-conflict-intelligence/plan', JSON_ARRAY(), JSON_OBJECT('type','object','properties',JSON_OBJECT('analysis',JSON_OBJECT('type','object'),'files',JSON_OBJECT('type','array')),'additionalProperties',true), NULL, 'repo_conflict_intelligence,tenant,planner,request_only,no_secrets', 1, 6651)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), description = VALUES(description), http_method = VALUES(http_method), http_path = VALUES(http_path), path_param_keys = VALUES(path_param_keys), input_schema = VALUES(input_schema), fixed_body = VALUES(fixed_body), tags = VALUES(tags), is_enabled = VALUES(is_enabled), sort_order = VALUES(sort_order);
