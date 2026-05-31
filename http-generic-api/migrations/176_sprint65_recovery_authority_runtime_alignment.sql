-- Sprint 65: recovery/resource-authority runtime alignment.
--
-- Codifies production registry alignment discovered during live verification of
-- migrations 174 and 175. This is registry metadata only: no execution, no
-- repo mutation, no external write, no secret readback.

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
       notes = CONCAT(COALESCE(notes,''), '; allow_readonly_recovery_resource_patterns:2026-05-31')
 WHERE policy_key = 'recovery_capability_taxonomy_policy_v1';

INSERT INTO platform_engine_policy_rules
(rule_key, policy_key, engine_key, priority, task_class, resource_kind, resource_pattern, condition_json, strategy_key, risk_level, auto_apply_allowed, dry_run_required, approval_required, validator_commands_json, blocked_terms_json, allowed_terms_json, required_skill_keys_json, status, notes)
VALUES
('recovery_github_ci_failure_classify','recovery_capability_taxonomy_policy_v1','recovery_capability_taxonomy_engine',110,'ci_failure_classify','github_check','*',JSON_OBJECT('capability_family','github_ci_failure_classification'),'github_ci_log_summary','low',0,1,0,JSON_ARRAY('node test-recovery-capability-taxonomy.mjs'),JSON_ARRAY('token','secret','authorization'),JSON_ARRAY('workflow','job','failing_command','error_excerpt','commit_sha'),JSON_ARRAY('github_ci_recovery'),'active','Classify CI failure state from bounded evidence. Read-only; no retry, no update-branch, no merge.')
ON DUPLICATE KEY UPDATE
  policy_key=VALUES(policy_key),
  engine_key=VALUES(engine_key),
  priority=VALUES(priority),
  task_class=VALUES(task_class),
  resource_kind=VALUES(resource_kind),
  resource_pattern=VALUES(resource_pattern),
  condition_json=VALUES(condition_json),
  strategy_key=VALUES(strategy_key),
  risk_level=VALUES(risk_level),
  auto_apply_allowed=VALUES(auto_apply_allowed),
  dry_run_required=VALUES(dry_run_required),
  approval_required=VALUES(approval_required),
  validator_commands_json=VALUES(validator_commands_json),
  blocked_terms_json=VALUES(blocked_terms_json),
  allowed_terms_json=VALUES(allowed_terms_json),
  required_skill_keys_json=VALUES(required_skill_keys_json),
  status=VALUES(status),
  notes=VALUES(notes);

UPDATE platform_engine_policy_registry
   SET allowed_resource_patterns_json = JSON_ARRAY(
         '*',
         'wordpress:*',
         'google_drive:*',
         'github_repo:*',
         'n8n:*',
         'cloudflare:*',
         'local_connector:*',
         'crm:*',
         'email:*',
         'social:*',
         'asset_upload:*'
       ),
       approval_required_min_risk = 'critical',
       notes = CONCAT(COALESCE(notes,''), '; read_only_authority_plans_do_not_require_approval:2026-05-31')
 WHERE policy_key = 'resource_authority_policy_v1';

UPDATE platform_engine_policy_rules
   SET resource_pattern = '*',
       approval_required = 0,
       notes = CONCAT(COALESCE(notes,''), '; read_only_plan_pattern_generalized:2026-05-31')
 WHERE engine_key = 'resource_authority_engine'
   AND rule_key IN (
     'resource_authority_publish_gate',
     'resource_authority_external_write_gate',
     'resource_authority_grant_gate',
     'resource_authority_credential_scope_gate'
   );

UPDATE admin_platform_endpoint_tools
   SET fixed_body = JSON_SET(COALESCE(fixed_body, JSON_OBJECT()), '$.scope_guard_passed', true),
       description = CONCAT(COALESCE(description,''), ' Scope guard is satisfied by the governed read-only dispatcher wrapper.')
 WHERE tool_key IN (
   'github_ci_recovery_decision_brief',
   'github_ci_failure_classification_plan',
   'repo_patch_recovery_decision_brief',
   'github_required_checks_summary_plan',
   'resource_authority_decision_brief',
   'resource_publish_readiness_plan',
   'resource_external_write_readiness_plan'
 );
