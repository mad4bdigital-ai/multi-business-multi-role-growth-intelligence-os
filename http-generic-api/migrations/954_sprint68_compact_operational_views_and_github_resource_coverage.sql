-- 954_sprint68_compact_operational_views_and_github_resource_coverage.sql
-- Purpose: reduce reliance on volatile response chunks by adding compact SQL-backed
-- operational views, and close the next GitHub resource coverage step without
-- adding new provider calls or changing runtime behavior.

CREATE OR REPLACE VIEW v_release_readiness_compact AS
SELECT
  NOW() AS checked_at,
  (SELECT COUNT(*) FROM governed_migration_ledger WHERE mode = 'apply' AND preflight_status = 'pass' AND secrets_included = 0) AS applied_safe_migrations,
  (SELECT COUNT(*) FROM governed_migration_ledger WHERE preflight_status <> 'pass' OR secrets_included <> 0) AS migration_ledger_issues,
  (SELECT COUNT(*) FROM runtime_dispatch_certification_registry WHERE dispatch_allowed = 1) AS dispatch_certified_surfaces,
  (SELECT COUNT(*) FROM runtime_dispatch_certification_registry WHERE apply_allowed = 1) AS apply_certified_surfaces,
  (SELECT COUNT(*) FROM capability_apply_authorization_policy_registry WHERE status = 'active') AS active_apply_policies,
  (SELECT COUNT(*) FROM platform_resource_recipes WHERE status = 'active') AS active_resource_recipes,
  (SELECT COUNT(*) FROM platform_resource_types WHERE status = 'active') AS active_resource_types,
  (SELECT COUNT(*) FROM platform_resource_adapters WHERE status = 'active') AS active_resource_adapters,
  'compact_operational_readiness_v1' AS compact_schema,
  0 AS secrets_included;

CREATE OR REPLACE VIEW v_migration_status_compact AS
SELECT
  migration_file,
  MAX(applied_at) AS last_applied_at,
  SUBSTRING_INDEX(GROUP_CONCAT(mode ORDER BY applied_at DESC), ',', 1) AS last_mode,
  SUBSTRING_INDEX(GROUP_CONCAT(runner_version ORDER BY applied_at DESC), ',', 1) AS last_runner_version,
  SUBSTRING_INDEX(GROUP_CONCAT(preflight_status ORDER BY applied_at DESC), ',', 1) AS last_preflight_status,
  SUBSTRING_INDEX(GROUP_CONCAT(preflight_risk_count ORDER BY applied_at DESC), ',', 1) AS last_preflight_risk_count,
  SUBSTRING_INDEX(GROUP_CONCAT(secrets_included ORDER BY applied_at DESC), ',', 1) AS last_secrets_included,
  COUNT(*) AS ledger_runs
FROM governed_migration_ledger
GROUP BY migration_file;

CREATE OR REPLACE VIEW v_resource_recipe_certification_compact AS
SELECT
  certification_key,
  surface_key,
  tool_or_action_key,
  certification_status,
  dispatch_allowed,
  apply_allowed,
  requires_dry_run,
  requires_audit_evidence,
  requires_readback,
  last_evidence_ref,
  last_certified_at
FROM runtime_dispatch_certification_registry;

CREATE OR REPLACE VIEW v_resource_recipe_registry_compact AS
SELECT
  rt.resource_type,
  rt.resource_family,
  rt.provider_key,
  rt.status AS resource_status,
  rt.supports_mutation,
  COUNT(DISTINCT pr.recipe_key) AS recipe_count,
  SUM(CASE WHEN pr.status = 'active' THEN 1 ELSE 0 END) AS active_recipe_count,
  SUM(CASE WHEN pr.read_only = 0 THEN 1 ELSE 0 END) AS write_recipe_count,
  COUNT(DISTINCT pa.adapter_key) AS adapter_count,
  SUM(CASE WHEN pa.status = 'active' THEN 1 ELSE 0 END) AS active_adapter_count
FROM platform_resource_types rt
LEFT JOIN platform_resource_recipes pr ON pr.resource_type = rt.resource_type
LEFT JOIN platform_resource_adapters pa ON pa.resource_type = rt.resource_type
GROUP BY rt.resource_type, rt.resource_family, rt.provider_key, rt.status, rt.supports_mutation;

UPDATE platform_resource_types
SET default_inspect_recipe_key = 'github.repo.inspect_summary',
    metadata_json = JSON_SET(CASE WHEN JSON_VALID(metadata_json) THEN metadata_json ELSE JSON_OBJECT() END, '$.sprint_e1_coverage', 'github_repo_inspect_summary'),
    updated_at = CURRENT_TIMESTAMP
WHERE resource_type = 'github_repo'
  AND (default_inspect_recipe_key IS NULL OR default_inspect_recipe_key = '');

UPDATE platform_resource_types
SET default_inspect_recipe_key = 'github.branch.inspect_summary',
    metadata_json = JSON_SET(COALESCE(CAST(metadata_json AS JSON), JSON_OBJECT()), '$.sprint_e1_coverage', 'github_branch_inspect_summary'),
    updated_at = CURRENT_TIMESTAMP
WHERE resource_type = 'github_branch'
  AND (default_inspect_recipe_key IS NULL OR default_inspect_recipe_key = '');

INSERT INTO platform_resource_adapters (
  adapter_key, resource_type, provider_key, adapter_kind, installed_tool_key,
  identity_resolver_key, metadata_normalizer_key, content_policy,
  supports_plan, supports_read, supports_write, status, metadata_json
)
VALUES
  ('github.repo.inspect.adapter', 'github_repo', 'github_api_mcp', 'installed_tool', 'repo_inspect',
   'github_repo_ref_v1', 'github_repo_summary_v1', 'metadata_only', 1, 1, 0, 'active',
   JSON_OBJECT('source','sprint_e1_github_resource_coverage','secrets_included',false)),
  ('github.branch.inspect.adapter', 'github_branch', 'github_api_mcp', 'installed_tool', 'admin_branch_reconcile',
   'github_branch_ref_v1', 'github_branch_summary_v1', 'metadata_only', 1, 1, 0, 'active',
   JSON_OBJECT('source','sprint_e1_github_resource_coverage','secrets_included',false))
ON DUPLICATE KEY UPDATE
  provider_key = VALUES(provider_key),
  adapter_kind = VALUES(adapter_kind),
  installed_tool_key = VALUES(installed_tool_key),
  identity_resolver_key = VALUES(identity_resolver_key),
  metadata_normalizer_key = VALUES(metadata_normalizer_key),
  content_policy = VALUES(content_policy),
  supports_plan = VALUES(supports_plan),
  supports_read = VALUES(supports_read),
  supports_write = VALUES(supports_write),
  status = VALUES(status),
  metadata_json = VALUES(metadata_json),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO platform_resource_recipes (
  recipe_key, resource_type, operation_key, adapter_key, risk_class, mode,
  read_only, requires_dry_run, requires_capability_envelope, requires_typed_confirmation,
  requires_same_cycle_readback, input_schema_json, output_schema_json, policy_json,
  graph_write_policy, engine_key, status, notes
)
VALUES
  ('github.repo.inspect_summary', 'github_repo', 'inspect_summary', 'github.repo.inspect.adapter', 'diagnostic', 'inspect',
   1, 1, 0, 0, 0,
   JSON_OBJECT('type','object','properties',JSON_OBJECT('repo',JSON_OBJECT('type','string'),'branch',JSON_OBJECT('type','string'))),
   JSON_OBJECT('type','object','properties',JSON_OBJECT('ok',JSON_OBJECT('type','boolean'),'classification',JSON_OBJECT('type','string'))),
   JSON_OBJECT('provider_call_allowed',false,'credential_payload_read_allowed',false,'file_content_read_allowed',false,'secrets_included',false),
   'none', 'resource_authority_engine', 'active',
   'Sprint E1 GitHub repo inspection coverage; no new provider behavior, uses existing governed repo inspection surface.'),
  ('github.branch.inspect_summary', 'github_branch', 'inspect_summary', 'github.branch.inspect.adapter', 'diagnostic', 'inspect',
   1, 1, 0, 0, 0,
   JSON_OBJECT('type','object','properties',JSON_OBJECT('branch',JSON_OBJECT('type','string'),'base_branch',JSON_OBJECT('type','string'))),
   JSON_OBJECT('type','object','properties',JSON_OBJECT('ok',JSON_OBJECT('type','boolean'),'classification',JSON_OBJECT('type','string'))),
   JSON_OBJECT('provider_call_allowed',false,'credential_payload_read_allowed',false,'file_content_read_allowed',false,'secrets_included',false),
   'none', 'resource_authority_engine', 'active',
   'Sprint E1 GitHub branch inspection coverage; read-only diagnostic coverage around existing branch reconcile adapter.')
ON DUPLICATE KEY UPDATE
  adapter_key = VALUES(adapter_key),
  risk_class = VALUES(risk_class),
  mode = VALUES(mode),
  read_only = VALUES(read_only),
  requires_dry_run = VALUES(requires_dry_run),
  requires_capability_envelope = VALUES(requires_capability_envelope),
  requires_typed_confirmation = VALUES(requires_typed_confirmation),
  requires_same_cycle_readback = VALUES(requires_same_cycle_readback),
  input_schema_json = VALUES(input_schema_json),
  output_schema_json = VALUES(output_schema_json),
  policy_json = VALUES(policy_json),
  graph_write_policy = VALUES(graph_write_policy),
  engine_key = VALUES(engine_key),
  status = VALUES(status),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;
