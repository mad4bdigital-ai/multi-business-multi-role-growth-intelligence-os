-- Sprint 67: Backfill platform_engine_policy_rules for classified legacy execution_policy mirrors.
-- Additive evidence-only migration. No destructive SQL. Runtime enforcement remains execution_policies.

INSERT INTO platform_engine_policy_registry (
  policy_key, engine_key, scope_type, scope_id, mode, risk_default,
  approval_required_min_risk, require_scope_guard, require_audit, require_validators,
  max_changes_json, validators_json, blocked_terms_json, allowed_resource_patterns_json,
  blocked_resource_patterns_json, status, notes
)
SELECT
  CONCAT('legacy_execution_policy_target_', c.source_policy_id, '_v1') AS policy_key,
  NULL AS engine_key,
  'global' AS scope_type,
  NULL AS scope_id,
  'diagnose_only' AS mode,
  CASE WHEN c.classification = 'migrate_to_platform_policy_rule_blocking' THEN 'high' ELSE 'medium' END AS risk_default,
  'high' AS approval_required_min_risk,
  1 AS require_scope_guard,
  1 AS require_audit,
  0 AS require_validators,
  JSON_OBJECT('source','legacy_execution_policies','source_policy_id',c.source_policy_id) AS max_changes_json,
  JSON_ARRAY() AS validators_json,
  JSON_ARRAY() AS blocked_terms_json,
  JSON_ARRAY('*') AS allowed_resource_patterns_json,
  JSON_ARRAY() AS blocked_resource_patterns_json,
  'active' AS status,
  CONCAT('Evidence-only target policy generated from execution_policies id ', c.source_policy_id, '; enforcement remains execution_policies until resolver cutover approval.') AS notes
FROM policy_logic_mirror_classification c
WHERE c.classification IN ('migrate_to_platform_policy_rule_blocking','migrate_to_platform_policy_rule_advisory')
ON DUPLICATE KEY UPDATE
  mode = VALUES(mode), risk_default = VALUES(risk_default), require_scope_guard = VALUES(require_scope_guard),
  require_audit = VALUES(require_audit), require_validators = VALUES(require_validators), max_changes_json = VALUES(max_changes_json),
  validators_json = VALUES(validators_json), allowed_resource_patterns_json = VALUES(allowed_resource_patterns_json),
  status = VALUES(status), notes = VALUES(notes), updated_at = CURRENT_TIMESTAMP;

INSERT INTO platform_engine_policy_rules (
  rule_key, policy_key, engine_key, priority, task_class, resource_kind, resource_pattern,
  condition_json, strategy_key, risk_level, auto_apply_allowed, dry_run_required,
  approval_required, validator_commands_json, blocked_terms_json, allowed_terms_json,
  required_skill_keys_json, status, notes
)
SELECT
  CONCAT('legacy_execution_policy_rule_', c.source_policy_id, '_v1') AS rule_key,
  CONCAT('legacy_execution_policy_target_', c.source_policy_id, '_v1') AS policy_key,
  NULL AS engine_key,
  CASE WHEN c.classification = 'migrate_to_platform_policy_rule_blocking' THEN 200 ELSE 100 END AS priority,
  COALESCE(NULLIF(SUBSTRING_INDEX(ep.execution_scope, '|', 1), ''), 'execution_policy') AS task_class,
  COALESCE(NULLIF(SUBSTRING_INDEX(ep.affects_layer, '|', 1), ''), 'runtime_policy') AS resource_kind,
  LEFT(COALESCE(NULLIF(ep.execution_scope, ''), '*'), 500) AS resource_pattern,
  JSON_OBJECT('source','legacy_execution_policies','source_policy_id',c.source_policy_id,'execution_policy_group',ep.policy_group,'execution_policy_key',ep.policy_key,'classification',c.classification,'enforcement_source','execution_policies','cutover_enabled',false) AS condition_json,
  'execution_policy_fallback' AS strategy_key,
  CASE WHEN c.classification = 'migrate_to_platform_policy_rule_blocking' THEN 'high' ELSE 'medium' END AS risk_level,
  0 AS auto_apply_allowed,
  1 AS dry_run_required,
  CASE WHEN c.classification = 'migrate_to_platform_policy_rule_blocking' THEN 1 ELSE 0 END AS approval_required,
  JSON_ARRAY() AS validator_commands_json,
  JSON_ARRAY() AS blocked_terms_json,
  JSON_ARRAY() AS allowed_terms_json,
  JSON_ARRAY() AS required_skill_keys_json,
  'active' AS status,
  CONCAT('Evidence-only target rule generated from execution_policies id ', c.source_policy_id, '; runtime enforcement remains execution_policies.') AS notes
FROM policy_logic_mirror_classification c
JOIN execution_policies ep ON ep.id = c.source_policy_id
WHERE c.classification IN ('migrate_to_platform_policy_rule_blocking','migrate_to_platform_policy_rule_advisory')
ON DUPLICATE KEY UPDATE
  policy_key = VALUES(policy_key), priority = VALUES(priority), task_class = VALUES(task_class), resource_kind = VALUES(resource_kind),
  resource_pattern = VALUES(resource_pattern), condition_json = VALUES(condition_json), strategy_key = VALUES(strategy_key), risk_level = VALUES(risk_level),
  auto_apply_allowed = VALUES(auto_apply_allowed), dry_run_required = VALUES(dry_run_required), approval_required = VALUES(approval_required),
  validator_commands_json = VALUES(validator_commands_json), status = VALUES(status), notes = VALUES(notes), updated_at = CURRENT_TIMESTAMP;

INSERT INTO policy_logic_bindings (
  source_policy_table, source_policy_id, source_policy_group, source_policy_key,
  target_policy_rule_key, logic_key, binding_role, binding_status, notes
)
SELECT 'execution_policies', c.source_policy_id, ep.policy_group, ep.policy_key, CONCAT('legacy_execution_policy_rule_', c.source_policy_id, '_v1'), c.logic_key, 'runtime_policy_target_rule', 'active', 'Generated by Sprint 67 target-rule backfill; evidence-only until resolver cutover approval.'
FROM policy_logic_mirror_classification c
JOIN execution_policies ep ON ep.id = c.source_policy_id
WHERE c.classification IN ('migrate_to_platform_policy_rule_blocking','migrate_to_platform_policy_rule_advisory')
  AND NOT EXISTS (
    SELECT 1 FROM policy_logic_bindings b
     WHERE b.source_policy_table = 'execution_policies'
       AND b.source_policy_id = c.source_policy_id
       AND b.target_policy_rule_key = CONCAT('legacy_execution_policy_rule_', c.source_policy_id, '_v1')
       AND b.binding_role = 'runtime_policy_target_rule'
  );

INSERT INTO execution_policies (policy_group, policy_key, policy_value, active, execution_scope, affects_layer, blocking, notes)
SELECT 'Connector Dispatch Governance', 'WordPress Apply Requires Explicit Reason',
  JSON_OBJECT('enforcement_mode','advisory','blocking',false,'requires_explicit_reason',true,'min_reason_chars',10,'rollout','advisory_only','cutover_enabled',false),
  'TRUE', 'connector_dispatch|workflow_dispatch|wordpress|wordpress_apply', 'connectorExecutor|connectorExecutor.js|wordpress', 'FALSE',
  'Advisory-only WordPress apply reason guard. Not blocking until explicit rollout approval.'
WHERE NOT EXISTS (
  SELECT 1 FROM execution_policies
   WHERE policy_group = 'Connector Dispatch Governance'
     AND policy_key = 'WordPress Apply Requires Explicit Reason'
);

INSERT INTO platform_engine_policy_registry (
  policy_key, engine_key, scope_type, scope_id, mode, risk_default, approval_required_min_risk,
  require_scope_guard, require_audit, require_validators, max_changes_json, validators_json,
  blocked_terms_json, allowed_resource_patterns_json, blocked_resource_patterns_json, status, notes
)
VALUES (
  'runtime_wordpress_apply_reason_policy_v1', NULL, 'global', NULL, 'diagnose_only', 'medium', 'high', 1, 1, 0,
  JSON_OBJECT('source','execution_policies','policy_group','Connector Dispatch Governance','policy_key','WordPress Apply Requires Explicit Reason'),
  JSON_ARRAY(), JSON_ARRAY(), JSON_ARRAY('wordpress.apply'), JSON_ARRAY(), 'active',
  'Advisory-only target policy for WordPress apply reason guard; no blocking cutover.'
)
ON DUPLICATE KEY UPDATE
  mode = VALUES(mode), risk_default = VALUES(risk_default), require_scope_guard = VALUES(require_scope_guard),
  require_audit = VALUES(require_audit), require_validators = VALUES(require_validators), status = VALUES(status),
  notes = VALUES(notes), updated_at = CURRENT_TIMESTAMP;

INSERT INTO platform_engine_policy_rules (
  rule_key, policy_key, engine_key, priority, task_class, resource_kind, resource_pattern,
  condition_json, strategy_key, risk_level, auto_apply_allowed, dry_run_required,
  approval_required, validator_commands_json, blocked_terms_json, allowed_terms_json,
  required_skill_keys_json, status, notes
)
VALUES (
  'runtime_wordpress_apply_requires_reason_advisory', 'runtime_wordpress_apply_reason_policy_v1', NULL, 100,
  'connector_dispatch', 'wordpress_apply', 'wordpress.apply',
  JSON_OBJECT('source','execution_policies','execution_policy_group','Connector Dispatch Governance','execution_policy_key','WordPress Apply Requires Explicit Reason','requires_explicit_reason',true,'min_reason_chars',10,'enforcement_mode','advisory','cutover_enabled',false),
  'execution_policy_fallback', 'medium', 0, 1, 0, JSON_ARRAY('wordpress_reason_presence_check'), JSON_ARRAY(), JSON_ARRAY(), JSON_ARRAY(), 'active',
  'Advisory-only target rule. Connector preflight remains non-blocking until explicit rollout approval.'
)
ON DUPLICATE KEY UPDATE
  condition_json = VALUES(condition_json), strategy_key = VALUES(strategy_key), risk_level = VALUES(risk_level),
  auto_apply_allowed = VALUES(auto_apply_allowed), dry_run_required = VALUES(dry_run_required), approval_required = VALUES(approval_required),
  validator_commands_json = VALUES(validator_commands_json), status = VALUES(status), notes = VALUES(notes), updated_at = CURRENT_TIMESTAMP;

INSERT INTO policy_logic_bindings (
  source_policy_table, source_policy_id, source_policy_group, source_policy_key,
  target_policy_rule_key, logic_key, binding_role, binding_status, notes
)
SELECT 'execution_policies', ep.id, ep.policy_group, ep.policy_key, 'runtime_wordpress_apply_requires_reason_advisory', NULL, 'runtime_policy_target_rule', 'active', 'Advisory-only WordPress target rule binding; no blocking cutover.'
FROM execution_policies ep
WHERE ep.policy_group = 'Connector Dispatch Governance'
  AND ep.policy_key = 'WordPress Apply Requires Explicit Reason'
  AND NOT EXISTS (
    SELECT 1 FROM policy_logic_bindings b
     WHERE b.source_policy_table = 'execution_policies'
       AND b.source_policy_id = ep.id
       AND b.target_policy_rule_key = 'runtime_wordpress_apply_requires_reason_advisory'
       AND b.binding_role = 'runtime_policy_target_rule'
  );

INSERT INTO policy_logic_mirror_classification (
  source_policy_id, policy_group, policy_key, logic_key, logic_type,
  policy_active, policy_blocking, has_target_rule_binding,
  classification, recommended_target, notes
)
SELECT ep.id, ep.policy_group, ep.policy_key, c.logic_key, c.logic_type, ep.active, ep.blocking, 1,
  'runtime_target_rule_backed', COALESCE(b.target_policy_rule_key, CONCAT('legacy_execution_policy_rule_', ep.id, '_v1')),
  'Target rule evidence is present; execution_policies remains enforcement source until cutover approval.'
FROM execution_policies ep
LEFT JOIN policy_logic_mirror_classification c ON c.source_policy_id = ep.id
LEFT JOIN policy_logic_bindings b
  ON b.source_policy_table = 'execution_policies'
 AND b.source_policy_id = ep.id
 AND b.binding_role = 'runtime_policy_target_rule'
 AND b.binding_status = 'active'
WHERE b.target_policy_rule_key IS NOT NULL
ON DUPLICATE KEY UPDATE
  policy_group = VALUES(policy_group), policy_key = VALUES(policy_key), policy_active = VALUES(policy_active),
  policy_blocking = VALUES(policy_blocking), has_target_rule_binding = VALUES(has_target_rule_binding),
  classification = VALUES(classification), recommended_target = VALUES(recommended_target), notes = VALUES(notes), updated_at = CURRENT_TIMESTAMP;
