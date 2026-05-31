-- Sprint 65: recovery capability taxonomy foundation.
--
-- This migration is registry-first and read-only. It adds declarative recovery
-- capability metadata, CI failure classifications, and admin planning tools
-- that route through existing platform engine diagnose/plan surfaces.
-- It does not add apply execution, repo mutation, secret readback, or dynamic
-- code execution.

CREATE TABLE IF NOT EXISTS platform_recovery_failure_taxonomy (
  failure_key VARCHAR(191) NOT NULL PRIMARY KEY,
  family VARCHAR(191) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  severity ENUM('info','warning','error','critical') NOT NULL DEFAULT 'error',
  default_recovery_action VARCHAR(191) NOT NULL DEFAULT 'diagnose_only',
  evidence_required_json JSON NULL,
  recommended_capabilities_json JSON NULL,
  safe_retry_allowed TINYINT(1) NOT NULL DEFAULT 0,
  apply_allowed TINYINT(1) NOT NULL DEFAULT 0,
  secrets_may_be_returned TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('planned','active','disabled') NOT NULL DEFAULT 'active',
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_platform_recovery_failure_family (family, status),
  KEY idx_platform_recovery_failure_severity (severity, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO platform_recovery_failure_taxonomy
  (failure_key, family, display_name, description, severity, default_recovery_action,
   evidence_required_json, recommended_capabilities_json, safe_retry_allowed,
   apply_allowed, secrets_may_be_returned, status, notes)
VALUES
  ('pending', 'github_ci', 'Pending Check', 'A required or relevant check has not completed yet.', 'info', 'wait_for_sha',
   '["commit_sha","workflow_or_check_name","started_at_or_queued_at"]',
   '["github.ci.wait_for_sha","github.ci.summarize_sha"]', 1, 0, 0, 'active',
   'Waiting is allowed. No mutation is implied.'),
  ('failed_with_logs', 'github_ci', 'Failed With Logs', 'A check failed and actionable logs or annotations are available.', 'error', 'summarize_failure',
   '["commit_sha","workflow","job","failing_command","error_excerpt"]',
   '["github.job_logs.get","github.check_annotations.get","github.ci.summarize_sha"]', 0, 0, 0, 'active',
   'Return the first actionable failure block only.'),
  ('cancelled_by_newer_run', 'github_ci', 'Cancelled By Newer Run', 'A run was cancelled because a newer commit or workflow run superseded it.', 'warning', 'resolve_latest_sha',
   '["cancelled_run_id","latest_head_sha","pr_number"]',
   '["github.ci.wait_for_sha","github.required_checks.summary"]', 1, 0, 0, 'active',
   'Retry only against the latest head SHA.'),
  ('skipped_by_path_filter', 'github_ci', 'Skipped By Path Filter', 'A workflow or check was skipped by path or event filters.', 'warning', 'required_check_summary',
   '["workflow","path_filter","required_check_state"]',
   '["github.required_checks.summary"]', 0, 0, 0, 'active',
   'Do not treat skipped checks as passed until branch protection requirements are resolved.'),
  ('guard_failed', 'github_ci', 'Guard Failed', 'A repository guard or policy check failed.', 'error', 'classify_guard_failure',
   '["guard_name","failing_file_or_rule","error_excerpt"]',
   '["github.job_logs.get","github.check_annotations.get","repo.patch.error.classify"]', 0, 0, 0, 'active',
   'Guard repairs require a new plan and validator evidence.'),
  ('schema_contract_failed', 'github_ci', 'Schema Contract Failed', 'OpenAPI, schema, or generated split contract validation failed.', 'error', 'schema_contract_replan',
   '["schema_file","operation_id_or_alias","validator_output"]',
   '["github.job_logs.get","repo.patch.context_recover","repo.patch.error.classify"]', 0, 0, 0, 'active',
   'Canonical OpenAPI remains http-generic-api/openapi.yaml.'),
  ('unit_test_failed', 'github_ci', 'Unit Test Failed', 'A targeted or full unit test failed.', 'error', 'targeted_test_repair',
   '["test_command","test_file","error_excerpt"]',
   '["github.job_logs.get","repo.patch.context_recover","repo.patch.error.classify"]', 0, 0, 0, 'active',
   'Prefer exact failing branch tests over adjacent behavior checks.'),
  ('stale_run', 'github_ci', 'Stale Run', 'A run belongs to an old commit or old PR head.', 'warning', 'resolve_latest_sha',
   '["observed_sha","latest_head_sha","pr_number"]',
   '["github.ci.wait_for_sha","github.required_checks.summary"]', 1, 0, 0, 'active',
   'Never merge based on stale run evidence.')
ON DUPLICATE KEY UPDATE
  family = VALUES(family),
  display_name = VALUES(display_name),
  description = VALUES(description),
  severity = VALUES(severity),
  default_recovery_action = VALUES(default_recovery_action),
  evidence_required_json = VALUES(evidence_required_json),
  recommended_capabilities_json = VALUES(recommended_capabilities_json),
  safe_retry_allowed = VALUES(safe_retry_allowed),
  apply_allowed = VALUES(apply_allowed),
  secrets_may_be_returned = VALUES(secrets_may_be_returned),
  status = VALUES(status),
  notes = VALUES(notes);

INSERT INTO platform_engine_registry
  (engine_key, display_name, engine_type, runtime_key, supported_task_classes_json,
   capabilities_json, default_policy_key, status, notes)
VALUES
  (
    'recovery_capability_taxonomy_engine',
    'Recovery Capability Taxonomy Engine',
    'generic',
    'codex_essam_chatgpt_v1',
    '["ci_failure_classify","ci_summary_plan","repo_patch_recovery_plan","required_checks_summary_plan","merge_idempotency_plan"]',
    '{"supports_sql_policy":true,"supports_failure_taxonomy":true,"supports_resource_authority":false,"executes_db_stored_code":false,"default_mode":"diagnose_only","apply_supported":false,"secrets_returned":false}',
    'recovery_capability_taxonomy_policy_v1',
    'active',
    'Read-only recovery taxonomy and capability planning engine. Apply execution is explicitly out of scope.'
  )
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  engine_type = VALUES(engine_type),
  runtime_key = VALUES(runtime_key),
  supported_task_classes_json = VALUES(supported_task_classes_json),
  capabilities_json = VALUES(capabilities_json),
  default_policy_key = VALUES(default_policy_key),
  status = VALUES(status),
  notes = VALUES(notes);

INSERT INTO platform_engine_policy_registry
  (policy_key, engine_key, scope_type, scope_id, mode, risk_default,
   approval_required_min_risk, require_scope_guard, require_audit,
   require_validators, max_changes_json, validators_json, blocked_terms_json,
   allowed_resource_patterns_json, blocked_resource_patterns_json, status, notes)
VALUES
  (
    'recovery_capability_taxonomy_policy_v1',
    'recovery_capability_taxonomy_engine',
    'global',
    NULL,
    'diagnose_only',
    'medium',
    'high',
    1,
    1,
    1,
    '{"max_files_changed":0,"max_rows_mutated":0,"max_external_writes":0}',
    '["node test-recovery-capability-taxonomy.mjs"]',
    '["token","secret","password","authorization","credential","private_key"]',
    '["github:checks","github:logs","github:annotations","repo:patch_context","repo:merge_state"]',
    '[".env","**/secrets/**","credential:*","secret:*"]',
    'active',
    'Read-only recovery classification policy. No apply, no repo mutation, no secret readback.'
  )
ON DUPLICATE KEY UPDATE
  engine_key = VALUES(engine_key),
  scope_type = VALUES(scope_type),
  scope_id = VALUES(scope_id),
  mode = VALUES(mode),
  risk_default = VALUES(risk_default),
  approval_required_min_risk = VALUES(approval_required_min_risk),
  require_scope_guard = VALUES(require_scope_guard),
  require_audit = VALUES(require_audit),
  require_validators = VALUES(require_validators),
  max_changes_json = VALUES(max_changes_json),
  validators_json = VALUES(validators_json),
  blocked_terms_json = VALUES(blocked_terms_json),
  allowed_resource_patterns_json = VALUES(allowed_resource_patterns_json),
  blocked_resource_patterns_json = VALUES(blocked_resource_patterns_json),
  status = VALUES(status),
  notes = VALUES(notes);

INSERT INTO platform_engine_strategy_registry
  (strategy_key, display_name, description, supported_engine_types_json,
   supported_task_classes_json, supported_resource_kinds_json, requires_ast,
   allows_full_resource_rewrite, executes_dynamic_code, required_validators_json,
   risk_level, status, metadata_json)
VALUES
  ('github_ci_log_summary', 'GitHub CI Log Summary', 'Summarize bounded GitHub CI logs into the first actionable failure block.', '["generic"]', '["ci_summary_plan","ci_failure_classify"]', '["github_check","github_workflow_run"]', 0, 0, 0, '["node test-recovery-capability-taxonomy.mjs"]', 'low', 'active', '{"secrets_returned":false,"apply_supported":false}'),
  ('github_check_annotations_summary', 'GitHub Check Annotation Summary', 'Summarize bounded GitHub check annotations without exposing secrets.', '["generic"]', '["ci_summary_plan","ci_failure_classify"]', '["github_check","github_annotation"]', 0, 0, 0, '["node test-recovery-capability-taxonomy.mjs"]', 'low', 'active', '{"secrets_returned":false,"apply_supported":false}'),
  ('github_ci_wait_for_sha', 'GitHub CI Wait For SHA', 'Plan polling for a specific commit SHA and classify pending, stale, failed, skipped, or passed state.', '["generic"]', '["ci_summary_plan","required_checks_summary_plan"]', '["github_commit_sha","github_pr"]', 0, 0, 0, '["node test-recovery-capability-taxonomy.mjs"]', 'low', 'active', '{"secrets_returned":false,"apply_supported":false}'),
  ('github_required_checks_summary', 'GitHub Required Checks Summary', 'Plan a required-check summary for a PR or commit without performing merge.', '["generic"]', '["required_checks_summary_plan","merge_idempotency_plan"]', '["github_pr","github_commit_sha"]', 0, 0, 0, '["node test-recovery-capability-taxonomy.mjs"]', 'low', 'active', '{"secrets_returned":false,"apply_supported":false}'),
  ('repo_patch_error_classify', 'Repo Patch Error Classify', 'Classify repo patch failures such as no-match, stale branch, missing ref, or context drift.', '["generic"]', '["repo_patch_recovery_plan"]', '["repo_patch_error","repo_file_context"]', 0, 0, 0, '["node test-recovery-capability-taxonomy.mjs"]', 'medium', 'active', '{"secrets_returned":false,"apply_supported":false}'),
  ('repo_patch_context_recover', 'Repo Patch Context Recover', 'Plan a read-current-file and re-plan recovery after patch context drift.', '["generic"]', '["repo_patch_recovery_plan"]', '["repo_file_context"]', 0, 0, 0, '["node test-recovery-capability-taxonomy.mjs"]', 'medium', 'active', '{"secrets_returned":false,"apply_supported":false}'),
  ('github_pr_merge_idempotency_check', 'GitHub PR Merge Idempotency Check', 'Plan an idempotent PR merge-state check before any merge attempt.', '["generic"]', '["merge_idempotency_plan"]', '["github_pr"]', 0, 0, 0, '["node test-recovery-capability-taxonomy.mjs"]', 'medium', 'active', '{"secrets_returned":false,"apply_supported":false}')
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  supported_engine_types_json = VALUES(supported_engine_types_json),
  supported_task_classes_json = VALUES(supported_task_classes_json),
  supported_resource_kinds_json = VALUES(supported_resource_kinds_json),
  requires_ast = VALUES(requires_ast),
  allows_full_resource_rewrite = VALUES(allows_full_resource_rewrite),
  executes_dynamic_code = VALUES(executes_dynamic_code),
  required_validators_json = VALUES(required_validators_json),
  risk_level = VALUES(risk_level),
  status = VALUES(status),
  metadata_json = VALUES(metadata_json);

INSERT INTO platform_engine_policy_rules
  (rule_key, policy_key, engine_key, priority, task_class, resource_kind,
   resource_pattern, condition_json, strategy_key, risk_level,
   auto_apply_allowed, dry_run_required, approval_required, validator_commands_json,
   blocked_terms_json, allowed_terms_json, required_skill_keys_json, status, notes)
VALUES
  ('recovery_github_job_logs_get', 'recovery_capability_taxonomy_policy_v1', 'recovery_capability_taxonomy_engine', 100, 'ci_summary_plan', 'github_check', 'github.job_logs.get', '{"capability_key":"github.job_logs.get"}', 'github_ci_log_summary', 'low', 0, 1, 0, '["node test-recovery-capability-taxonomy.mjs"]', '["token","secret","authorization"]', '["workflow","job","failing_command","error_excerpt"]', '["github_ci_recovery"]', 'active', 'Read bounded GitHub job logs and return first actionable failure block only.'),
  ('recovery_github_check_annotations_get', 'recovery_capability_taxonomy_policy_v1', 'recovery_capability_taxonomy_engine', 100, 'ci_summary_plan', 'github_annotation', 'github.check_annotations.get', '{"capability_key":"github.check_annotations.get"}', 'github_check_annotations_summary', 'low', 0, 1, 0, '["node test-recovery-capability-taxonomy.mjs"]', '["token","secret","authorization"]', '["annotation_path","annotation_level","message_excerpt"]', '["github_ci_recovery"]', 'active', 'Read bounded check annotations without secret readback.'),
  ('recovery_github_ci_wait_for_sha', 'recovery_capability_taxonomy_policy_v1', 'recovery_capability_taxonomy_engine', 90, 'ci_summary_plan', 'github_commit_sha', 'github.ci.wait_for_sha', '{"capability_key":"github.ci.wait_for_sha"}', 'github_ci_wait_for_sha', 'low', 0, 1, 0, '["node test-recovery-capability-taxonomy.mjs"]', '["token","secret","authorization"]', '["commit_sha","status","poll_timeout"]', '["github_ci_recovery"]', 'active', 'Wait/poll plan only. No mutation.'),
  ('recovery_github_ci_summarize_sha', 'recovery_capability_taxonomy_policy_v1', 'recovery_capability_taxonomy_engine', 90, 'ci_summary_plan', 'github_commit_sha', 'github.ci.summarize_sha', '{"capability_key":"github.ci.summarize_sha"}', 'github_required_checks_summary', 'low', 0, 1, 0, '["node test-recovery-capability-taxonomy.mjs"]', '["token","secret","authorization"]', '["commit_sha","required_checks","summary"]', '["github_ci_recovery"]', 'active', 'Summarize CI state for a SHA without approving merge.'),
  ('recovery_github_required_checks_summary', 'recovery_capability_taxonomy_policy_v1', 'recovery_capability_taxonomy_engine', 90, 'required_checks_summary_plan', 'github_pr', 'github.required_checks.summary', '{"capability_key":"github.required_checks.summary"}', 'github_required_checks_summary', 'low', 0, 1, 0, '["node test-recovery-capability-taxonomy.mjs"]', '["token","secret","authorization"]', '["pr_number","required_checks","merge_blockers"]', '["github_ci_recovery"]', 'active', 'Required-check summary only.'),
  ('recovery_repo_patch_error_classify', 'recovery_capability_taxonomy_policy_v1', 'recovery_capability_taxonomy_engine', 80, 'repo_patch_recovery_plan', 'repo_patch_error', 'repo.patch.error.classify', '{"capability_key":"repo.patch.error.classify"}', 'repo_patch_error_classify', 'medium', 0, 1, 0, '["node test-recovery-capability-taxonomy.mjs"]', '["token","secret","authorization"]', '["error_code","patch_context","recommended_next_action"]', '["repo_recovery"]', 'active', 'Classify repo patch errors; does not retry or write.'),
  ('recovery_repo_patch_context_recover', 'recovery_capability_taxonomy_policy_v1', 'recovery_capability_taxonomy_engine', 80, 'repo_patch_recovery_plan', 'repo_file_context', 'repo.patch.context_recover', '{"capability_key":"repo.patch.context_recover"}', 'repo_patch_context_recover', 'medium', 0, 1, 0, '["node test-recovery-capability-taxonomy.mjs"]', '["token","secret","authorization"]', '["current_file_sha","context_excerpt","replan_required"]', '["repo_recovery"]', 'active', 'Read-current-file and re-plan only.'),
  ('recovery_repo_patch_no_match_diagnose', 'recovery_capability_taxonomy_policy_v1', 'recovery_capability_taxonomy_engine', 80, 'repo_patch_recovery_plan', 'repo_patch_error', 'repo.patch.no_match.diagnose', '{"capability_key":"repo.patch.no_match.diagnose"}', 'repo_patch_error_classify', 'medium', 0, 1, 0, '["node test-recovery-capability-taxonomy.mjs"]', '["token","secret","authorization"]', '["no_match_reason","current_file_sha","replan_required"]', '["repo_recovery"]', 'active', 'Diagnose no-match patch failures without applying a retry.'),
  ('recovery_github_pr_merge_idempotent', 'recovery_capability_taxonomy_policy_v1', 'recovery_capability_taxonomy_engine', 70, 'merge_idempotency_plan', 'github_pr', 'github.pr.merge_idempotent', '{"capability_key":"github.pr.merge_idempotent"}', 'github_pr_merge_idempotency_check', 'medium', 0, 1, 1, '["node test-recovery-capability-taxonomy.mjs"]', '["token","secret","authorization"]', '["pr_number","head_sha","merge_state","already_merged"]', '["github_ci_recovery","repo_recovery"]', 'active', 'Idempotency check only. Actual merge remains a separate guarded action.')
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

INSERT INTO platform_engine_skill_prompt_registry
  (skill_key, engine_key, display_name, prompt_contract_version, task_classes_json,
   required_tools_json, forbidden_tools_json, validator_commands_json,
   success_criteria_json, fallback_behavior_json, prompt_template, status, notes)
VALUES
  (
    'github_ci_recovery',
    'recovery_capability_taxonomy_engine',
    'GitHub CI Recovery',
    'v1',
    '["ci_failure_classify","ci_summary_plan","required_checks_summary_plan"]',
    '["github.job_logs.get","github.check_annotations.get","github.ci.wait_for_sha","github.ci.summarize_sha","github.required_checks.summary"]',
    '["git push","github.pr.merge","secret_read","credential_dump","repo.patch.apply"]',
    '["node test-recovery-capability-taxonomy.mjs"]',
    '["first_actionable_failure_block","required_check_state_classified","no_secrets_returned","no_mutation_performed"]',
    '["if_logs_missing_return_evidence_gap","if_stale_sha_resolve_latest_sha","if_required_checks_unknown_block_merge"]',
    'Classify CI state from bounded evidence. Do not mutate repositories, merge PRs, expose secrets, or infer success from stale runs.',
    'active',
    'Versioned skill contract for read-only GitHub CI recovery under the AI Intelligence Runtime governance layer.'
  ),
  (
    'repo_recovery',
    'recovery_capability_taxonomy_engine',
    'Repository Patch Recovery',
    'v1',
    '["repo_patch_recovery_plan","merge_idempotency_plan"]',
    '["repo.patch.error.classify","repo.patch.context_recover","repo.patch.no_match.diagnose","github.pr.merge_idempotent"]',
    '["git push","force_update","secret_read","repo.patch.apply","github.pr.merge"]',
    '["node test-recovery-capability-taxonomy.mjs"]',
    '["patch_failure_classified","current_context_required_before_retry","merge_idempotency_reported","no_mutation_performed"]',
    '["if_patch_no_match_read_current_file_before_retry","if_pr_missing_check_merged_state","if_branch_deleted_and_pr_merged_return_already_merged"]',
    'Build repo recovery plans from evidence. Do not apply patches or merge; return blockers and required next evidence.',
    'active',
    'Versioned skill contract for repo recovery planning under the AI Intelligence Runtime governance layer.'
  )
ON DUPLICATE KEY UPDATE
  engine_key = VALUES(engine_key),
  display_name = VALUES(display_name),
  prompt_contract_version = VALUES(prompt_contract_version),
  task_classes_json = VALUES(task_classes_json),
  required_tools_json = VALUES(required_tools_json),
  forbidden_tools_json = VALUES(forbidden_tools_json),
  validator_commands_json = VALUES(validator_commands_json),
  success_criteria_json = VALUES(success_criteria_json),
  fallback_behavior_json = VALUES(fallback_behavior_json),
  prompt_template = VALUES(prompt_template),
  status = VALUES(status),
  notes = VALUES(notes);

INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys,
   input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
  (
    'github_ci_recovery_decision_brief',
    'GitHub CI Recovery Decision Brief',
    'Build a read-only decision brief for GitHub CI recovery using the recovery capability taxonomy. Does not fetch secrets, mutate repos, update branches, or merge PRs.',
    'POST',
    '/platform/engines/decision-brief',
    NULL,
    '{"type":"object","properties":{"objective":{"type":"string"},"resource":{"type":"object","additionalProperties":true},"trace_id":{"type":"string"}},"additionalProperties":false}',
    '{"engine_key":"recovery_capability_taxonomy_engine","task_class":"ci_summary_plan","mode":"diagnose_only","resource_kind":"github_check","scope_guard_passed":false,"approval_granted":false}',
    'platform_engine,recovery,github_ci,decision_brief,read_only,no_execution,no_apply,no_secret_read',
    1,
    264
  ),
  (
    'github_ci_failure_classification_plan',
    'GitHub CI Failure Classification Plan',
    'Classify CI failure state from bounded evidence using platform_recovery_failure_taxonomy. Read-only; no retry, no update-branch, no merge.',
    'POST',
    '/platform/engines/task-plan',
    NULL,
    '{"type":"object","properties":{"resource":{"type":"object","additionalProperties":true},"trace_id":{"type":"string"}},"additionalProperties":false}',
    '{"engine_key":"recovery_capability_taxonomy_engine","task_class":"ci_failure_classify","mode":"diagnose_only","resource_kind":"github_check","scope_guard_passed":false,"approval_granted":false,"write_audit":false}',
    'platform_engine,recovery,github_ci,failure_taxonomy,read_only,no_execution,no_apply,no_secret_read',
    1,
    265
  ),
  (
    'repo_patch_recovery_decision_brief',
    'Repo Patch Recovery Decision Brief',
    'Build a read-only repo patch recovery brief for no-match, stale branch, missing ref, or context drift. Does not apply patches or push.',
    'POST',
    '/platform/engines/decision-brief',
    NULL,
    '{"type":"object","properties":{"objective":{"type":"string"},"resource":{"type":"object","additionalProperties":true},"trace_id":{"type":"string"}},"additionalProperties":false}',
    '{"engine_key":"recovery_capability_taxonomy_engine","task_class":"repo_patch_recovery_plan","mode":"diagnose_only","resource_kind":"repo_patch_error","scope_guard_passed":false,"approval_granted":false}',
    'platform_engine,recovery,repo_patch,decision_brief,read_only,no_execution,no_apply,no_repo_mutation,no_secret_read',
    1,
    266
  ),
  (
    'github_required_checks_summary_plan',
    'GitHub Required Checks Summary Plan',
    'Build a read-only required-check summary plan for a PR or commit SHA. Does not approve, update, or merge.',
    'POST',
    '/platform/engines/task-plan',
    NULL,
    '{"type":"object","properties":{"resource":{"type":"object","additionalProperties":true},"trace_id":{"type":"string"}},"additionalProperties":false}',
    '{"engine_key":"recovery_capability_taxonomy_engine","task_class":"required_checks_summary_plan","mode":"diagnose_only","resource_kind":"github_pr","scope_guard_passed":false,"approval_granted":false,"write_audit":false}',
    'platform_engine,recovery,github_ci,required_checks,read_only,no_execution,no_apply,no_merge,no_secret_read',
    1,
    267
  )
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  http_method = VALUES(http_method),
  http_path = VALUES(http_path),
  path_param_keys = VALUES(path_param_keys),
  input_schema = VALUES(input_schema),
  fixed_body = VALUES(fixed_body),
  tags = VALUES(tags),
  is_enabled = VALUES(is_enabled),
  sort_order = VALUES(sort_order);
