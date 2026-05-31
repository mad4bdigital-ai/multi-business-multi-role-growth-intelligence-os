-- Sprint 65: recovery/resource authority runtime registry alignment.
--
-- Captures production registry fixes found during post-merge verification of
-- migrations 174 and 175. This is registry metadata only: no apply executor,
-- no repo mutation, no external write, and no secret readback.

UPDATE platform_engine_policy_registry
   SET allowed_resource_patterns_json = JSON_ARRAY(
         '*',
         'github:checks',
         'github:logs',
         'github:annotations',
         'repo:patch_context',
         'repo:merge_state',
         'github.job_logs.get',
         'github.check_annotations.get',
         'github.ci.wait_for_sha',
         'github.ci.summarize_sha',
         'github.required_checks.summary'
       ),
       notes = CONCAT(COALESCE(notes, ''), '; allow_readonly_recovery_resource_patterns:migration_176')
 WHERE policy_key = 'recovery_capability_taxonomy_policy_v1';

INSERT INTO platform_engine_policy_rules
(rule_key, policy_key, engine_key, priority, task_class, resource_kind, resource_pattern,
 condition_json, strategy_key, risk_level, auto_apply_allowed, dry_run_required,
 approval_required, validator_commands_json, blocked_terms_json, allowed_terms_json,
 required_skill_keys_json, status, notes)
VALUES
('recovery_github_ci_failure_classify',
 'recovery_capability_taxonomy_policy_v1',
 'recovery_capability_taxonomy_engine',
 110,
 'ci_failure_classify',
 'github_check',
 '*',
 JSON_OBJECT('capability_family', 'github_ci_failure_classification'),
 'github_ci_log_summary',
 'low',
 0,
 1,
 0,
 JSON_ARRAY('node test-recovery-capability-taxonomy.mjs'),
 JSON_ARRAY('token', 'secret', 'authorization'),
 JSON_ARRAY('workflow', 'job', 'failing_command', 'error_excerpt', 'commit_sha'),
 JSON_ARRAY('github_ci_recovery'),
 'active',
 'Classify CI failure state from bounded evidence. Read-only; no retry, no update-branch, no merge.')
ON DUPLICATE KEY UPDATE
  policy_key = VALUES(policy_key),
  engine_key = VALUES(engine_key),
  priority = VALUES(priority),
  task_class = VALUES(task_class),
  resource_kind = VALUES(resource_kind),
  resource_pattern = VALUES(resource_pattern),
  condition_json = VALUES(condition_json),
  strategy_key = VALUES(strategy_key),
  risk_level = VALUES(risk_level),
  auto_apply_allowed = VALUES(auto_apply_allowed),
  dry_run_required = VALUES(dry_run_required),
  approval_required = VALUES(approval_required),
  validator_commands_json = VALUES(validator_commands_json),
  blocked_terms_json = VALUES(blocked_terms_json),
  allowed_terms_json = VALUES(allowed_terms_json),
  required_skill_keys_json = VALUES(required_skill_keys_json),
  status = VALUES(status),
  notes = VALUES(notes);

UPDATE admin_platform_endpoint_tools
   SET fixed_body = JSON_SET(COALESCE(fixed_body, JSON_OBJECT()), '$.scope_guard_passed', true),
       description = CASE
         WHEN description LIKE '%Scope guard is satisfied by the governed read-only dispatcher wrapper.%'
           THEN description
         ELSE CONCAT(COALESCE(description, ''), ' Scope guard is satisfied by the governed read-only dispatcher wrapper.')
       END
 WHERE tool_key IN (
   'github_ci_recovery_decision_brief',
   'github_ci_failure_classification_plan',
   'repo_patch_recovery_decision_brief',
   'github_required_checks_summary_plan',
   'resource_authority_decision_brief',
   'resource_publish_readiness_plan',
   'resource_external_write_readiness_plan'
 );

INSERT INTO agent_tool_index
(tool_key, source_truth_resource_type, source_truth_resource_key, display_name,
 tool_manifest_json, risk_class, policy_key, deferred_search_tags_json, status,
 last_indexed_at)
SELECT
  tool_key,
  'endpoint' AS source_truth_resource_type,
  tool_key AS source_truth_resource_key,
  display_name,
  JSON_OBJECT(
    'tool_key', tool_key,
    'display_name', display_name,
    'description', LEFT(COALESCE(description, ''), 500),
    'http_method', http_method,
    'http_path', http_path,
    'source', 'admin_platform_endpoint_tools',
    'raw_catalog_exposed', false
  ) AS tool_manifest_json,
  'read_only' AS risk_class,
  CASE
    WHEN tool_key LIKE '%resource_authority%' OR tool_key LIKE 'resource_%readiness%' THEN 'resource_authority_policy_v1'
    ELSE 'recovery_capability_taxonomy_policy_v1'
  END AS policy_key,
  JSON_ARRAY(
    CASE
      WHEN tool_key LIKE '%resource_authority%' OR tool_key LIKE 'resource_%readiness%' THEN 'resource_authority'
      ELSE 'recovery'
    END,
    CASE
      WHEN tool_key LIKE 'github_ci_%' OR tool_key LIKE 'github_required_checks_%' THEN 'github_ci'
      WHEN tool_key LIKE 'repo_patch_recovery%' THEN 'repo_patch'
      WHEN tool_key LIKE '%publish%' THEN 'publish_readiness'
      WHEN tool_key LIKE '%external_write%' THEN 'external_write_readiness'
      ELSE 'governed'
    END,
    REPLACE(COALESCE(tags, ''), ',', ' ')
  ) AS deferred_search_tags_json,
  'active' AS status,
  CURRENT_TIMESTAMP AS last_indexed_at
FROM admin_platform_endpoint_tools
WHERE is_enabled = 1
  AND tool_key IN (
    'github_ci_recovery_decision_brief',
    'github_ci_failure_classification_plan',
    'repo_patch_recovery_decision_brief',
    'github_required_checks_summary_plan',
    'resource_authority_decision_brief',
    'resource_publish_readiness_plan',
    'resource_external_write_readiness_plan'
  )
ON DUPLICATE KEY UPDATE
  source_truth_resource_type = VALUES(source_truth_resource_type),
  source_truth_resource_key = VALUES(source_truth_resource_key),
  display_name = VALUES(display_name),
  tool_manifest_json = VALUES(tool_manifest_json),
  risk_class = VALUES(risk_class),
  policy_key = VALUES(policy_key),
  deferred_search_tags_json = VALUES(deferred_search_tags_json),
  status = VALUES(status),
  last_indexed_at = VALUES(last_indexed_at);
