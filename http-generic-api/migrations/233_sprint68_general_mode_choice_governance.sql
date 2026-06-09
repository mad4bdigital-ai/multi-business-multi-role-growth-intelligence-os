-- Sprint 68: General mode-choice governance.
-- Ensures GPT/admin/tenant agents ask the user to choose among valid execution modes/scopes before mode-bearing execution.
-- No secrets, deploy, restart, provider dispatch, or external execution are enabled.

INSERT INTO execution_policies
(policy_group, policy_key, policy_value, active, execution_scope, affects_layer, blocking, notes)
VALUES
('Mode Choice Governance','general_mode_choice_before_execution',
 JSON_OBJECT(
   'rule','agents_must_offer_user_choice_for_multiple_valid_modes_before_execution',
   'applies_to',JSON_ARRAY('mode','*_mode','*_modes','runner_mode','execution_mode','activation_mode','integration_modes','credential_scope','auth_mode','transport_mode','dispatch_mode','sync_mode','deploy_mode','reconciliation_mode','approval_mode','future_registry_or_openapi_scope_mode_fields'),
   'requires',JSON_ARRAY('enumerate_valid_modes','include_recommended_default_when_available','include_risk_and_side_effect_class','include_expected_evidence','capture_explicit_user_selection','preserve_selected_mode_in_audit'),
   'proceed_without_prompt_only_when',JSON_ARRAY('current_user_request_explicitly_selected_mode','registry_policy_exposes_exactly_one_valid_mode','higher_priority_policy_mandates_exactly_one_safe_mode','read_only_diagnostic_has_no_mode_selector'),
   'forbidden',JSON_ARRAY('silent_first_enum_default','silent_mode_switch_after_failure','treat_auto_as_higher_risk_consent','collapse_integration_modes_into_single_activation_mode','infer_credential_scope_from_convenience'),
   'audit_fields',JSON_ARRAY('mode_choice_required','mode_choices_presented','selected_mode','selection_source','mode_default_used','mode_fallback_requires_user_choice','secrets_included')
 ),
 'true','all_governed_execution|admin_gpt|tenant_gpt|connectors|remote_runtime|plugins|reconciliation','prompt_router,module_loader,system_bootstrap,execution_policies,docs/mode-choice-governance.md','true',
 'Generalized user-choice guard for all executable modes/scopes. Extends runner_mode choice behavior to any scope/mode field before execution.'
)
ON DUPLICATE KEY UPDATE
 policy_value=VALUES(policy_value), active=VALUES(active), execution_scope=VALUES(execution_scope), affects_layer=VALUES(affects_layer), blocking=VALUES(blocking), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;

INSERT INTO platform_engine_policy_registry
(policy_key, engine_key, scope_type, scope_id, mode, risk_default, approval_required_min_risk, require_scope_guard, require_audit, require_validators, validators_json, status, notes)
VALUES
('general_mode_choice_before_execution', NULL, 'global', '*', 'blocking_guard', 'medium', 'medium', 1, 1, 0, JSON_ARRAY(), 'active', 'Agents must ask users to select among valid execution modes/scopes before mode-bearing execution unless the current request or policy has already selected one. No secrets.')
ON DUPLICATE KEY UPDATE
 engine_key=VALUES(engine_key), scope_type=VALUES(scope_type), scope_id=VALUES(scope_id), mode=VALUES(mode), risk_default=VALUES(risk_default), approval_required_min_risk=VALUES(approval_required_min_risk), require_scope_guard=VALUES(require_scope_guard), require_audit=VALUES(require_audit), require_validators=VALUES(require_validators), validators_json=VALUES(validators_json), status=VALUES(status), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;

INSERT INTO platform_engine_policy_rules
(rule_key, policy_key, engine_key, priority, task_class, resource_kind, resource_pattern, condition_json, strategy_key, risk_level, auto_apply_allowed, dry_run_required, approval_required, validator_commands_json, blocked_terms_json, allowed_terms_json, required_skill_keys_json, status, notes)
VALUES
('general_mode_choice_before_execution_rule','general_mode_choice_before_execution', NULL, 50, 'governed_execution', 'mode_selector', '*', JSON_OBJECT('when','multiple_valid_modes_or_scope_selectors_exist','requires','user_visible_mode_choice_before_execution'), 'mode_choice_user_prompt_plan', 'medium', 0, 1, 1, JSON_ARRAY(), JSON_ARRAY('silent_first_enum_default','silent_mode_switch_after_failure'), JSON_ARRAY('selected_mode','mode_choices_presented','selection_source','secrets_included=false'), JSON_ARRAY(), 'active', 'Require a user-visible choice before executing when multiple valid mode/scope options exist.')
ON DUPLICATE KEY UPDATE
 policy_key=VALUES(policy_key), engine_key=VALUES(engine_key), priority=VALUES(priority), task_class=VALUES(task_class), resource_kind=VALUES(resource_kind), resource_pattern=VALUES(resource_pattern), condition_json=VALUES(condition_json), strategy_key=VALUES(strategy_key), risk_level=VALUES(risk_level), auto_apply_allowed=VALUES(auto_apply_allowed), dry_run_required=VALUES(dry_run_required), approval_required=VALUES(approval_required), validator_commands_json=VALUES(validator_commands_json), blocked_terms_json=VALUES(blocked_terms_json), allowed_terms_json=VALUES(allowed_terms_json), required_skill_keys_json=VALUES(required_skill_keys_json), status=VALUES(status), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;

INSERT INTO readiness_checks
(check_id, tenant_id, check_key, check_status, detail)
VALUES
(UUID(), 'e989a841-fce0-4ced-be76-463e8202a066', 'general-mode-choice-governance-v1', 'pending',
 'Mode-bearing governed execution must present valid modes/scopes to the user and preserve explicit selected_mode evidence before execution.')
ON DUPLICATE KEY UPDATE
 check_status=VALUES(check_status),
 detail=VALUES(detail),
 checked_at=CURRENT_TIMESTAMP;
