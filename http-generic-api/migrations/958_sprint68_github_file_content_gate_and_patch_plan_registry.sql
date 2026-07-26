-- 958_sprint68_github_file_content_gate_and_patch_plan_registry.sql
-- Purpose: Sprint F2/F3 foundation. Registers GitHub file content-read and
-- patch-plan governance contracts without enabling content return or repository
-- writes. Runtime dispatch remains blocked pending implementation and smoke.

INSERT INTO execution_policies (
  policy_group, policy_key, policy_value, active, execution_scope, affects_layer, blocking, notes
)
VALUES (
  'GitHub File Resource Governance',
  'github_file_content_read_gate_policy_v1',
  JSON_OBJECT(
    'rule','github_file_content_read_requires_explicit_gate',
    'content_read_default_allowed',false,
    'requires_capability_envelope',true,
    'requires_typed_confirmation',true,
    'requires_secret_scan_before_return',true,
    'requires_path_allowlist',true,
    'blocked_path_globs',JSON_ARRAY('.env','*.pem','*.key','credentials/*','secrets/*','.github/secrets/*'),
    'max_file_size_bytes',200000,
    'raw_secret_response_allowed',false,
    'write_allowed',false,
    'provider_call_allowed_after_runtime_implementation',true,
    'runtime_dispatch_enabled_now',false,
    'secrets_included',false
  ),
  'TRUE',
  'github_file|content_read|after_review',
  'platform_resource_recipes|platform_resource_adapters|runtime_dispatch_certification_registry',
  'TRUE',
  'Defines the policy gate for future GitHub file content reads. Does not enable dispatch; content reads remain blocked until runtime implementation, secret scan, and smoke certification are complete.'
)
ON DUPLICATE KEY UPDATE
  policy_value = VALUES(policy_value),
  active = VALUES(active),
  execution_scope = VALUES(execution_scope),
  affects_layer = VALUES(affects_layer),
  blocking = VALUES(blocking),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO platform_resource_adapters (
  adapter_key, resource_type, provider_key, adapter_kind, installed_tool_key,
  identity_resolver_key, metadata_normalizer_key, content_policy,
  supports_plan, supports_read, supports_write, status, metadata_json
)
VALUES
  ('github.file.content_read.adapter', 'github_file', 'github_api_mcp', 'planned_runtime_adapter', NULL,
   'github_file_ref_v1', 'github_file_content_read_summary_v1', 'gated_content_after_secret_scan', 1, 0, 0, 'planned',
   JSON_OBJECT('source','sprint_f2_github_file_content_gate','content_read_dispatch_enabled',false,'secret_scan_required',true,'secrets_included',false)),
  ('github.file.patch_plan.adapter', 'github_file', 'github_api_mcp', 'planned_runtime_adapter', NULL,
   'github_file_ref_v1', 'github_file_patch_plan_summary_v1', 'diff_metadata_only', 1, 0, 0, 'planned',
   JSON_OBJECT('source','sprint_f3_github_file_patch_plan','write_dispatch_enabled',false,'diff_only',true,'secrets_included',false))
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
  ('github.file.read_content_after_review', 'github_file', 'read_content_after_review', 'github.file.content_read.adapter', 'read_only', 'inspect',
   1, 1, 1, 1, 1,
   JSON_OBJECT('type','object','required',JSON_ARRAY('path','typed_confirmation'),'properties',JSON_OBJECT('repo',JSON_OBJECT('type','string'),'branch',JSON_OBJECT('type','string'),'path',JSON_OBJECT('type','string'),'capability_envelope_id',JSON_OBJECT('type','string'),'typed_confirmation',JSON_OBJECT('type','string'))),
   JSON_OBJECT('type','object','properties',JSON_OBJECT('ok',JSON_OBJECT('type','boolean'),'classification',JSON_OBJECT('type','string'),'content_returned',JSON_OBJECT('type','boolean'),'redaction_status',JSON_OBJECT('type','string'))),
   JSON_OBJECT('provider_call_allowed',false,'runtime_dispatch_enabled_now',false,'credential_payload_read_allowed',false,'file_content_read_allowed_after_gate',true,'file_content_returned_now',false,'secret_scan_required',true,'blocked_path_globs',JSON_ARRAY('.env','*.pem','*.key','credentials/*','secrets/*'),'secrets_included',false),
   'none', 'resource_authority_engine', 'planned',
   'Sprint F2 gated GitHub file content-read contract. Planned only; dispatch/content return blocked pending runtime implementation and smoke certification.'),
  ('github.file.patch_plan', 'github_file', 'patch_plan', 'github.file.patch_plan.adapter', 'diagnostic', 'plan',
   1, 1, 0, 0, 0,
   JSON_OBJECT('type','object','required',JSON_ARRAY('path'),'properties',JSON_OBJECT('repo',JSON_OBJECT('type','string'),'branch',JSON_OBJECT('type','string'),'path',JSON_OBJECT('type','string'),'patch_intent',JSON_OBJECT('type','string'))),
   JSON_OBJECT('type','object','properties',JSON_OBJECT('ok',JSON_OBJECT('type','boolean'),'classification',JSON_OBJECT('type','string'),'diff_summary',JSON_OBJECT('type','object'),'write_performed',JSON_OBJECT('type','boolean'))),
   JSON_OBJECT('provider_call_allowed',false,'runtime_dispatch_enabled_now',false,'write_allowed',false,'diff_only',true,'secrets_included',false),
   'none', 'resource_authority_engine', 'planned',
   'Sprint F3 GitHub file patch-plan contract. Planned only; no commit, push, branch mutation, or provider write enabled.')
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

INSERT INTO runtime_dispatch_certification_registry (
  certification_key, surface_key, surface_family, tool_or_action_key, risk_class,
  certification_status, smoke_strategy, dispatch_allowed, apply_allowed,
  requires_resource_authority, requires_dry_run, requires_audit_evidence, requires_readback,
  last_evidence_ref, last_certified_at, notes
)
VALUES
  ('github_file_content_read_gated_v1', 'github.file.read_content_after_review', 'resource_recipe_runtime', 'governed_resource_run', 'high',
   'planned_runtime_not_dispatch_enabled',
   'Must implement runtime path, path allowlist, secret scan, typed confirmation, capability envelope, no raw secret response, and same-cycle readback before dispatch_allowed can become 1.',
   0, 0, 1, 1, 1, 1, NULL, NULL,
   'Registered as planned gate only. No file content read is currently dispatch-enabled.'),
  ('github_file_patch_plan_v1', 'github.file.patch_plan', 'resource_recipe_runtime', 'governed_resource_run', 'medium',
   'planned_runtime_not_dispatch_enabled',
   'Must implement diff-only runtime, no commit/no push invariant, and readback before dispatch_allowed can become 1.',
   0, 0, 1, 1, 1, 1, NULL, NULL,
   'Registered as planned patch-plan gate only. No GitHub write is enabled.')
ON DUPLICATE KEY UPDATE
  surface_key = VALUES(surface_key),
  surface_family = VALUES(surface_family),
  tool_or_action_key = VALUES(tool_or_action_key),
  risk_class = VALUES(risk_class),
  certification_status = VALUES(certification_status),
  smoke_strategy = VALUES(smoke_strategy),
  dispatch_allowed = VALUES(dispatch_allowed),
  apply_allowed = VALUES(apply_allowed),
  requires_resource_authority = VALUES(requires_resource_authority),
  requires_dry_run = VALUES(requires_dry_run),
  requires_audit_evidence = VALUES(requires_audit_evidence),
  requires_readback = VALUES(requires_readback),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

CREATE OR REPLACE VIEW v_github_file_operation_readiness_compact AS
SELECT
  pr.recipe_key,
  pr.operation_key,
  pr.status AS recipe_status,
  pr.risk_class,
  pr.mode,
  pr.read_only,
  pr.requires_dry_run,
  pr.requires_capability_envelope,
  pr.requires_typed_confirmation,
  pa.adapter_key,
  pa.status AS adapter_status,
  pa.content_policy,
  pa.supports_read,
  pa.supports_write,
  COALESCE(rc.certification_status, 'not_registered') AS certification_status,
  COALESCE(rc.dispatch_allowed, 0) AS dispatch_allowed,
  COALESCE(rc.apply_allowed, 0) AS apply_allowed,
  JSON_UNQUOTE(JSON_EXTRACT(pr.policy_json, '$.secrets_included')) AS policy_secrets_included,
  0 AS secrets_included
FROM platform_resource_recipes pr
LEFT JOIN platform_resource_adapters pa ON pa.adapter_key = pr.adapter_key
LEFT JOIN runtime_dispatch_certification_registry rc ON rc.surface_key = pr.recipe_key
WHERE pr.resource_type = 'github_file';
