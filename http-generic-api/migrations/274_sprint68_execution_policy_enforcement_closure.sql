-- Sprint 68: Execution Policy Enforcement Closure
-- Adds target-rule evidence for repository publish/provider-gate policies and
-- documents the runtime evaluators that enforce them. Additive/idempotent only.
-- No destructive SQL, no secrets, no provider dispatch, and no external send.

INSERT INTO `platform_engine_policy_registry` (
  `policy_key`, `engine_key`, `scope_type`, `scope_id`, `mode`, `risk_default`,
  `approval_required_min_risk`, `require_scope_guard`, `require_audit`, `require_validators`,
  `max_changes_json`, `validators_json`, `blocked_terms_json`,
  `allowed_resource_patterns_json`, `blocked_resource_patterns_json`, `status`, `notes`
)
VALUES
  ('repo_publish_priority_ladder_v1','governed_repository_intelligence_engine','global',NULL,'blocking','medium','medium',1,1,1,
   JSON_OBJECT('max_files',10,'max_branches',1), JSON_ARRAY('evaluateRepositoryPublishPreflight','evaluateRepoPatchApplyPreflight'), JSON_ARRAY('raw_token','direct_main_push'), JSON_ARRAY('repo_publish','repo_patch_apply','github_pr_create'), JSON_ARRAY('main','production','prod'), 'active', 'Repository publishing must follow the governed priority ladder before mutation.'),
  ('repo_patch_apply_context_requirement_v1','governed_repository_intelligence_engine','global',NULL,'blocking','high','medium',1,1,1,
   JSON_OBJECT('requires_context',JSON_ARRAY('tenant_id','user_id','workspace_id','workspace_key')), JSON_ARRAY('requireRepoPatchCapabilityEnvelope','resolveCapabilityExecutionEnvelope'), JSON_ARRAY('missing_user_id','missing_workspace'), JSON_ARRAY('repo_patch_apply','capability_resolution_envelope_create'), JSON_ARRAY('expired_envelope','blocked_envelope'), 'active', 'Repository patch apply requires platform admin workspace context and a valid capability envelope.'),
  ('repo_capability_envelope_freshness_v1','governed_repository_intelligence_engine','global',NULL,'blocking','high','medium',1,1,1,
   JSON_OBJECT('requires_ready_for_dispatch',true,'requires_not_expired',true), JSON_ARRAY('resolveCapabilityExecutionEnvelope','markCapabilityEnvelopeReferenced'), JSON_ARRAY('expired_envelope','blocked_envelope'), JSON_ARRAY('repo_patch_apply','repo_mutation'), JSON_ARRAY('stale_envelope'), 'active', 'Repository mutation must not reuse expired or blocked envelopes.'),
  ('non_interactive_git_publish_auth_guard_v1','governed_repository_intelligence_engine','global',NULL,'blocking','medium','medium',1,1,1,
   JSON_OBJECT('required_env',JSON_OBJECT('GIT_TERMINAL_PROMPT','0')), JSON_ARRAY('publish_failure_diagnosis_evidence'), JSON_ARRAY('interactive_prompt','raw_token'), JSON_ARRAY('connectorPs','git_push'), JSON_ARRAY('interactive_git_push'), 'active', 'Local git publish must be non-interactive and fail fast to patch bundle fallback.'),
  ('publish_failure_diagnosis_evidence_v1','governed_repository_intelligence_engine','global',NULL,'blocking','medium','medium',1,1,1,
   JSON_OBJECT('required_evidence',JSON_ARRAY('local_branch_status','head_sha','origin_main_sha','failure_classification')), JSON_ARRAY('publish_failure_diagnosis_evidence'), JSON_ARRAY('unclassified_retry'), JSON_ARRAY('repo_publish','publish_recovery'), JSON_ARRAY('retry_without_evidence'), 'active', 'Publish retries require root-cause evidence before another mutation attempt.'),
  ('repo_branch_freshness_before_pr_v1','governed_repository_intelligence_engine','global',NULL,'blocking','high','medium',1,1,1,
   JSON_OBJECT('requires_compare',true,'requires_behind_by_zero',true,'requires_existing_pr_check',true), JSON_ARRAY('evaluateRepositoryPublishPreflight','admin_branch_reconcile'), JSON_ARRAY('behind_branch','diverged_branch'), JSON_ARRAY('github_pr_create','pull_request_create'), JSON_ARRAY('pr_create_without_reconcile'), 'active', 'PR creation requires branch freshness/readback evidence.'),
  ('github_pr_create_rest_fallback_v1','governed_repository_intelligence_engine','global',NULL,'blocking','medium','medium',1,1,1,
   JSON_OBJECT('requires_head',true,'requires_title',true,'gh_missing_not_blocker',true), JSON_ARRAY('evaluateRepositoryPublishPreflight','executeGitHubRestFallbackCore'), JSON_ARRAY('missing_head','missing_title','secret_marker'), JSON_ARRAY('github_pr_create','github_rest_fallback'), JSON_ARRAY('raw_secret_body'), 'active', 'GitHub REST fallback may create PRs only after publish preflight passes.'),
  ('external_provider_gate_registry_resolver_policy_v1','support_ticket_lifecycle_orchestrator','global',NULL,'blocking','high','medium',1,1,1,
   JSON_OBJECT('requires_registry_source','external_delivery_provider_adapter_contract_registry','no_external_send',true), JSON_ARRAY('evaluateSupportTicketExternalProviderGatePreflight','resolveSupportTicketExternalProviderAdapterContract'), JSON_ARRAY('provider_dispatch_enabled','secrets_included','external_send_performed'), JSON_ARRAY('support_ticket_external_delivery','provider_gate'), JSON_ARRAY('provider_send_enabled'), 'active', 'Support ticket external provider gate must enforce execution policy before planning or recording attempts.')
ON DUPLICATE KEY UPDATE
  `engine_key` = VALUES(`engine_key`),
  `mode` = VALUES(`mode`),
  `risk_default` = VALUES(`risk_default`),
  `approval_required_min_risk` = VALUES(`approval_required_min_risk`),
  `require_scope_guard` = VALUES(`require_scope_guard`),
  `require_audit` = VALUES(`require_audit`),
  `require_validators` = VALUES(`require_validators`),
  `max_changes_json` = VALUES(`max_changes_json`),
  `validators_json` = VALUES(`validators_json`),
  `blocked_terms_json` = VALUES(`blocked_terms_json`),
  `allowed_resource_patterns_json` = VALUES(`allowed_resource_patterns_json`),
  `blocked_resource_patterns_json` = VALUES(`blocked_resource_patterns_json`),
  `status` = VALUES(`status`),
  `notes` = VALUES(`notes`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `platform_engine_policy_rules` (
  `rule_key`, `policy_key`, `engine_key`, `priority`, `task_class`, `resource_kind`,
  `resource_pattern`, `condition_json`, `strategy_key`, `risk_level`, `auto_apply_allowed`,
  `dry_run_required`, `approval_required`, `validator_commands_json`, `blocked_terms_json`,
  `allowed_terms_json`, `required_skill_keys_json`, `status`, `notes`
)
VALUES
  ('repo_publish_priority_ladder_target_rule_v1','repo_publish_priority_ladder_v1','governed_repository_intelligence_engine',910,'repo_publish','repository','repo_publish',JSON_OBJECT('execution_policy_group','Repository Publish Governance','execution_policy_key','repo_publish_priority_ladder_v1'),'repository_publish_preflight','medium',0,1,1,JSON_ARRAY('evaluateRepositoryPublishPreflight'),JSON_ARRAY('direct_main_push','raw_token'),JSON_ARRAY('P0_governed_repo_patch_apply','P1_authenticated_github_cli','P2_non_interactive_git_credentials','P3_patch_bundle_handoff'),JSON_ARRAY('repo_patch_apply'), 'active','Mirror target rule for repository publish priority ladder.'),
  ('repo_patch_apply_context_target_rule_v1','repo_patch_apply_context_requirement_v1','governed_repository_intelligence_engine',920,'repo_patch_apply','repository','repo_patch_apply',JSON_OBJECT('execution_policy_group','Repository Publish Governance','execution_policy_key','repo_patch_apply_context_requirement_v1'),'repo_patch_capability_envelope_preflight','high',0,1,1,JSON_ARRAY('requireRepoPatchCapabilityEnvelope'),JSON_ARRAY('user_id_missing','workspace_context_missing'),JSON_ARRAY('platform_admin','platform_repo_governance_zero'),JSON_ARRAY('repo_patch_apply'), 'active','Mirror target rule for repo_patch_apply context requirement.'),
  ('repo_capability_envelope_freshness_target_rule_v1','repo_capability_envelope_freshness_v1','governed_repository_intelligence_engine',930,'repo_mutation','repository','repo_mutation',JSON_OBJECT('execution_policy_group','Repository Publish Governance','execution_policy_key','repo_capability_envelope_freshness_v1'),'capability_envelope_freshness_preflight','high',0,1,1,JSON_ARRAY('resolveCapabilityExecutionEnvelope'),JSON_ARRAY('expired_envelope','blocked_envelope'),JSON_ARRAY('ready_for_dispatch'),JSON_ARRAY('repo_patch_apply'), 'active','Mirror target rule for repository capability envelope freshness.'),
  ('non_interactive_git_publish_auth_target_rule_v1','non_interactive_git_publish_auth_guard_v1','governed_repository_intelligence_engine',880,'git_push','repository','connectorPs',JSON_OBJECT('execution_policy_group','Repository Publish Governance','execution_policy_key','non_interactive_git_publish_auth_guard_v1'),'non_interactive_git_publish_guard','medium',0,1,0,JSON_ARRAY('GIT_TERMINAL_PROMPT=0'),JSON_ARRAY('interactive_prompt','raw_token'),JSON_ARRAY('publish_blocked_non_interactive_auth_missing'),JSON_ARRAY('connector_diagnostics'), 'active','Mirror target rule for non-interactive git publish auth guard.'),
  ('publish_failure_diagnosis_evidence_target_rule_v1','publish_failure_diagnosis_evidence_v1','governed_repository_intelligence_engine',870,'publish_recovery','repository','repo_publish',JSON_OBJECT('execution_policy_group','Repository Publish Governance','execution_policy_key','publish_failure_diagnosis_evidence_v1'),'publish_failure_diagnosis_preflight','medium',0,1,0,JSON_ARRAY('local_branch_status','head_sha','origin_main_sha','failure_classification'),JSON_ARRAY('retry_without_evidence'),JSON_ARRAY('patch_bundle_created'),JSON_ARRAY('repo_publish'), 'active','Mirror target rule for publish failure diagnosis evidence.'),
  ('repo_branch_freshness_before_pr_target_rule_v1','repo_branch_freshness_before_pr_v1','governed_repository_intelligence_engine',940,'pull_request_create','repository','github_pr_create',JSON_OBJECT('execution_policy_group','Repository Publish Governance','execution_policy_key','repo_branch_freshness_before_pr_v1'),'repository_publish_preflight','high',0,1,1,JSON_ARRAY('evaluateRepositoryPublishPreflight','admin_branch_reconcile'),JSON_ARRAY('behind_branch','diverged_branch','existing_pr'),JSON_ARRAY('behind_by_zero','mergeable_clean'),JSON_ARRAY('github_pr_create'), 'active','Mirror target rule for PR branch freshness before creation.'),
  ('github_pr_create_rest_fallback_target_rule_v1','github_pr_create_rest_fallback_v1','governed_repository_intelligence_engine',900,'github_pr_create','repository','github_rest_fallback',JSON_OBJECT('execution_policy_group','Repository Publish Governance','execution_policy_key','github_pr_create_rest_fallback_v1'),'github_pr_create_rest_fallback_preflight','medium',0,1,0,JSON_ARRAY('evaluateRepositoryPublishPreflight'),JSON_ARRAY('secret_marker','missing_head','missing_title'),JSON_ARRAY('gh_missing_not_blocker'),JSON_ARRAY('github_rest_fallback'), 'active','Mirror target rule for GitHub PR create REST fallback.'),
  ('external_provider_gate_registry_resolver_target_rule_v1','external_provider_gate_registry_resolver_policy_v1','support_ticket_lifecycle_orchestrator',950,'provider_gate','support_ticket_external_delivery','support_ticket_external_delivery',JSON_OBJECT('execution_policy_group','Support Ticket External Delivery Governance','execution_policy_key','external_provider_gate_registry_resolver_policy_v1'),'support_ticket_provider_gate_preflight','high',0,1,1,JSON_ARRAY('evaluateSupportTicketExternalProviderGatePreflight'),JSON_ARRAY('provider_dispatch_enabled','secrets_included','external_send_performed'),JSON_ARRAY('dry_run','record_only','provider_send_blocked'),JSON_ARRAY('support_ticket_external_delivery'), 'active','Mirror target rule for support ticket external provider gate policy enforcement.')
ON DUPLICATE KEY UPDATE
  `policy_key` = VALUES(`policy_key`),
  `engine_key` = VALUES(`engine_key`),
  `priority` = VALUES(`priority`),
  `task_class` = VALUES(`task_class`),
  `resource_kind` = VALUES(`resource_kind`),
  `resource_pattern` = VALUES(`resource_pattern`),
  `condition_json` = VALUES(`condition_json`),
  `strategy_key` = VALUES(`strategy_key`),
  `risk_level` = VALUES(`risk_level`),
  `auto_apply_allowed` = VALUES(`auto_apply_allowed`),
  `dry_run_required` = VALUES(`dry_run_required`),
  `approval_required` = VALUES(`approval_required`),
  `validator_commands_json` = VALUES(`validator_commands_json`),
  `blocked_terms_json` = VALUES(`blocked_terms_json`),
  `allowed_terms_json` = VALUES(`allowed_terms_json`),
  `required_skill_keys_json` = VALUES(`required_skill_keys_json`),
  `status` = VALUES(`status`),
  `notes` = VALUES(`notes`),
  `updated_at` = CURRENT_TIMESTAMP;
