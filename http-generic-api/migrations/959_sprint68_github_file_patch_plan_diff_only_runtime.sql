-- 959_sprint68_github_file_patch_plan_diff_only_runtime.sql
-- Purpose: Sprint F4. Activates github.file.patch_plan as a diff-only synthetic
-- runtime. It does not read file content, call GitHub providers, commit, push,
-- mutate branches, or return secrets.

UPDATE platform_resource_adapters
SET adapter_kind = 'db_adapter',
    status = 'planned',
    supports_plan = 1,
    supports_read = 0,
    supports_write = 0,
    metadata_json = JSON_SET(CASE WHEN JSON_VALID(metadata_json) THEN metadata_json ELSE JSON_OBJECT() END,
      '$.adapter_kind_repair', 'sprint_f4_enum_safe_db_adapter',
      '$.runtime_dispatch_enabled_now', false,
      '$.secrets_included', false),
    updated_at = CURRENT_TIMESTAMP
WHERE adapter_key = 'github.file.content_read.adapter';

UPDATE platform_resource_adapters
SET adapter_kind = 'db_adapter',
    status = 'active',
    supports_plan = 1,
    supports_read = 0,
    supports_write = 0,
    metadata_json = JSON_SET(CASE WHEN JSON_VALID(metadata_json) THEN metadata_json ELSE JSON_OBJECT() END,
      '$.adapter_kind_repair', 'sprint_f4_enum_safe_db_adapter',
      '$.runtime_dispatch_enabled_now', true,
      '$.diff_only', true,
      '$.provider_calls_made', 0,
      '$.write_allowed', false,
      '$.secrets_included', false),
    updated_at = CURRENT_TIMESTAMP
WHERE adapter_key = 'github.file.patch_plan.adapter';

UPDATE platform_resource_recipes
SET status = 'active',
    risk_class = 'diagnostic',
    mode = 'plan',
    read_only = 1,
    requires_dry_run = 1,
    requires_capability_envelope = 0,
    requires_typed_confirmation = 0,
    requires_same_cycle_readback = 0,
    policy_json = JSON_SET(CASE WHEN JSON_VALID(policy_json) THEN policy_json ELSE JSON_OBJECT() END,
      '$.provider_call_allowed', false,
      '$.runtime_dispatch_enabled_now', true,
      '$.write_allowed', false,
      '$.diff_only', true,
      '$.file_content_returned', false,
      '$.commit_allowed', false,
      '$.push_allowed', false,
      '$.branch_mutation_allowed', false,
      '$.secrets_included', false),
    notes = 'Sprint F4 active diff-only GitHub file patch-plan runtime. No provider call, content return, commit, push, or branch mutation.',
    updated_at = CURRENT_TIMESTAMP
WHERE recipe_key = 'github.file.patch_plan';

UPDATE runtime_dispatch_certification_registry
SET certification_status = 'diff_only_runtime_certified',
    smoke_strategy = 'Synthetic runtime returns github_file_patch_plan_ready_v1 with provider_calls_made=0, write_performed=false, file_content_returned=false, secrets_included=false; apply mode is blocked.',
    dispatch_allowed = 1,
    apply_allowed = 0,
    requires_resource_authority = 1,
    requires_dry_run = 1,
    requires_audit_evidence = 1,
    requires_readback = 0,
    last_evidence_ref = 'governed_resource_run:github.file.patch_plan:diff_only_runtime_contract:2026-06-12',
    last_certified_at = CURRENT_TIMESTAMP,
    notes = 'Dispatch allows diff-only patch-plan generation only. GitHub writes remain disabled and require a separate future apply capability.',
    updated_at = CURRENT_TIMESTAMP
WHERE certification_key = 'github_file_patch_plan_v1';

CREATE OR REPLACE VIEW v_github_file_patch_plan_runtime_readiness AS
SELECT
  pr.recipe_key,
  pr.status AS recipe_status,
  pr.risk_class,
  pr.mode,
  pr.read_only,
  pa.adapter_key,
  pa.adapter_kind,
  pa.status AS adapter_status,
  pa.supports_plan,
  pa.supports_read,
  pa.supports_write,
  rc.certification_status,
  rc.dispatch_allowed,
  rc.apply_allowed,
  JSON_UNQUOTE(JSON_EXTRACT(pr.policy_json, '$.diff_only')) AS diff_only,
  JSON_UNQUOTE(JSON_EXTRACT(pr.policy_json, '$.write_allowed')) AS write_allowed,
  JSON_UNQUOTE(JSON_EXTRACT(pr.policy_json, '$.file_content_returned')) AS file_content_returned,
  JSON_UNQUOTE(JSON_EXTRACT(pr.policy_json, '$.secrets_included')) AS policy_secrets_included,
  0 AS secrets_included
FROM platform_resource_recipes pr
JOIN platform_resource_adapters pa ON pa.adapter_key = pr.adapter_key
LEFT JOIN runtime_dispatch_certification_registry rc ON rc.surface_key = pr.recipe_key
WHERE pr.recipe_key = 'github.file.patch_plan';
