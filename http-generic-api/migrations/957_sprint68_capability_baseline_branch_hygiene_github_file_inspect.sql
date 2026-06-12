-- 957_sprint68_capability_baseline_branch_hygiene_github_file_inspect.sql
-- Purpose: Sprint F0/F1 foundation. Adds compact baseline/branch-hygiene views and
-- activates metadata-only github.file.inspect_summary coverage. No provider calls,
-- no file content reads, no writes to GitHub, and no secret payloads.

CREATE OR REPLACE VIEW v_platform_resource_capability_baseline AS
SELECT
  NOW() AS checked_at,
  (SELECT COUNT(*) FROM platform_resource_types WHERE status = 'active') AS active_resource_types,
  (SELECT COUNT(*) FROM platform_resource_adapters WHERE status = 'active') AS active_resource_adapters,
  (SELECT COUNT(*) FROM platform_resource_recipes WHERE status = 'active') AS active_resource_recipes,
  (SELECT COUNT(*) FROM runtime_dispatch_certification_registry WHERE dispatch_allowed = 1) AS dispatch_certified_surfaces,
  (SELECT COUNT(*) FROM runtime_dispatch_certification_registry WHERE apply_allowed = 1) AS apply_certified_surfaces,
  (SELECT COUNT(*) FROM capability_apply_authorization_policy_registry WHERE status = 'active') AS active_apply_policies,
  (SELECT COUNT(*) FROM governed_migration_ledger WHERE mode = 'apply' AND preflight_status = 'pass' AND secrets_included = 0) AS safe_applied_migrations,
  (SELECT COUNT(*) FROM governed_migration_ledger WHERE preflight_status <> 'pass' OR secrets_included <> 0) AS migration_ledger_issues,
  (SELECT MAX(applied_at) FROM governed_migration_ledger WHERE mode = 'apply' AND preflight_status = 'pass' AND secrets_included = 0) AS latest_safe_migration_at,
  'platform_resource_capability_baseline.v1' AS baseline_schema,
  0 AS secrets_included;

CREATE OR REPLACE VIEW v_repo_branch_hygiene_compact AS
SELECT
  COALESCE(rs.source_repo_full_name, src.full_name) AS repo_full_name,
  COALESCE(src.default_branch, 'main') AS default_branch,
  COUNT(DISTINCT rs.branch_name) AS snapshot_branch_count,
  COUNT(DISTINCT rs.snapshot_id) AS snapshot_count,
  MAX(COALESCE(rs.fetched_at, rs.created_at)) AS latest_snapshot_at,
  SUM(CASE WHEN rs.snapshot_status = 'failed' THEN 1 ELSE 0 END) AS failed_snapshot_count,
  SUM(CASE WHEN rs.snapshot_status = 'blocked' THEN 1 ELSE 0 END) AS blocked_snapshot_count,
  CASE
    WHEN MAX(COALESCE(rs.fetched_at, rs.created_at)) IS NULL THEN 'no_snapshot'
    WHEN MAX(COALESCE(rs.fetched_at, rs.created_at)) < (NOW() - INTERVAL 30 DAY) THEN 'stale_snapshot'
    WHEN SUM(CASE WHEN rs.snapshot_status IN ('failed','blocked') THEN 1 ELSE 0 END) > 0 THEN 'has_snapshot_issues'
    ELSE 'current'
  END AS hygiene_status,
  'snapshot_backed_branch_hygiene.v1' AS hygiene_schema,
  0 AS secrets_included
FROM repo_source_registry src
LEFT JOIN repo_snapshots rs ON rs.repo_source_id = src.repo_source_id OR rs.source_repo_full_name = src.full_name
GROUP BY COALESCE(rs.source_repo_full_name, src.full_name), COALESCE(src.default_branch, 'main');

UPDATE platform_resource_types
SET status = 'active',
    default_inspect_recipe_key = 'github.file.inspect_summary',
    metadata_json = JSON_SET(CASE WHEN JSON_VALID(metadata_json) THEN metadata_json ELSE JSON_OBJECT() END,
      '$.sprint_f1_coverage', 'github_file_inspect_summary_metadata_only',
      '$.file_content_default', 'blocked',
      '$.write_default', 'blocked'),
    updated_at = CURRENT_TIMESTAMP
WHERE resource_type = 'github_file';

INSERT INTO platform_resource_adapters (
  adapter_key, resource_type, provider_key, adapter_kind, installed_tool_key,
  identity_resolver_key, metadata_normalizer_key, content_policy,
  supports_plan, supports_read, supports_write, status, metadata_json
)
VALUES (
  'github.file.inspect.adapter', 'github_file', 'github_api_mcp', 'installed_tool', 'repo_inspect',
  'github_file_ref_v1', 'github_file_metadata_summary_v1', 'metadata_only_no_content',
  1, 1, 0, 'active',
  JSON_OBJECT('source','sprint_f1_github_file_inspect','file_content_returned',false,'write_allowed',false,'secrets_included',false)
)
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
VALUES (
  'github.file.inspect_summary', 'github_file', 'inspect_summary', 'github.file.inspect.adapter', 'diagnostic', 'inspect',
  1, 1, 0, 0, 0,
  JSON_OBJECT('type','object','required',JSON_ARRAY('path'),'properties',JSON_OBJECT('repo',JSON_OBJECT('type','string'),'branch',JSON_OBJECT('type','string'),'path',JSON_OBJECT('type','string'))),
  JSON_OBJECT('type','object','properties',JSON_OBJECT('ok',JSON_OBJECT('type','boolean'),'classification',JSON_OBJECT('type','string'),'file_metadata',JSON_OBJECT('type','object'))),
  JSON_OBJECT('provider_call_allowed',false,'credential_payload_read_allowed',false,'file_content_read_allowed',false,'file_content_returned',false,'write_allowed',false,'secrets_included',false),
  'none', 'resource_authority_engine', 'active',
  'Sprint F1 metadata-only GitHub file inspect coverage. File content reads and all writes remain blocked pending separate gated capability.'
)
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
