-- Sprint 65: database table lifecycle governance foundation.
--
-- Companion registry for data_migration_inventory. This does not drop/archive
-- tables. It records owner engine, lifecycle status, retention policy, growth
-- policy, and linking evidence for live database tables.

CREATE TABLE IF NOT EXISTS database_table_lifecycle_registry (
  table_name VARCHAR(191) NOT NULL PRIMARY KEY,
  table_family VARCHAR(128) NOT NULL DEFAULT 'uncategorized',
  owner_engine_key VARCHAR(191) NULL,
  owner_workflow_key VARCHAR(191) NULL,
  owner_action_key VARCHAR(191) NULL,
  owner_runtime_key VARCHAR(191) NULL,
  authority_model ENUM('canonical','derived','mirror','legacy','transitional') NOT NULL DEFAULT 'canonical',
  usage_status ENUM('runtime_canonical','runtime_derived','runtime_registry','runtime_log','runtime_unclassified','audit_log','session_log','telemetry_log','backup_snapshot','repair_snapshot','planned_placeholder','deprecated','archive_candidate','manual_review') NOT NULL DEFAULT 'manual_review',
  write_strategy ENUM('platform_primary','legacy_primary','dual_write','read_only','platform_only') NOT NULL DEFAULT 'platform_primary',
  retention_class VARCHAR(128) NOT NULL DEFAULT 'requires_policy',
  retention_days INT NULL,
  archive_strategy VARCHAR(191) NOT NULL DEFAULT 'manual_review',
  cleanup_strategy VARCHAR(191) NOT NULL DEFAULT 'none',
  growth_policy VARCHAR(191) NOT NULL DEFAULT 'standard_monitoring',
  approx_rows BIGINT NULL,
  size_mb DECIMAL(12,3) NULL,
  last_observed_write_at DATETIME NULL,
  last_runtime_read_at DATETIME NULL,
  last_runtime_write_at DATETIME NULL,
  linked_by_code TINYINT(1) NOT NULL DEFAULT 0,
  linked_by_policy TINYINT(1) NOT NULL DEFAULT 0,
  linked_by_foreign_key TINYINT(1) NOT NULL DEFAULT 0,
  risk_level ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  status ENUM('active','review','archived','disabled') NOT NULL DEFAULT 'review',
  notes TEXT NULL,
  last_checked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_database_table_lifecycle_family (table_family, usage_status),
  KEY idx_database_table_lifecycle_owner (owner_engine_key, status),
  KEY idx_database_table_lifecycle_risk (risk_level, usage_status),
  KEY idx_database_table_lifecycle_retention (retention_class, retention_days)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO platform_engine_registry
  (engine_key, display_name, engine_type, runtime_key, supported_task_classes_json,
   capabilities_json, default_policy_key, status, notes)
VALUES
  (
    'database_table_lifecycle_engine',
    'Database Table Lifecycle Engine',
    'runtime_readiness',
    NULL,
    '["table_lifecycle_census","table_lifecycle_decision_brief","table_lifecycle_register_plan"]',
    '{"supports_sql_policy":true,"executes_db_stored_code":false,"drops_tables":false,"default_mode":"dry_run"}',
    'database_table_lifecycle_policy_v1',
    'active',
    'Classifies live database tables, ownership, retention, archive candidacy, and registry gaps. Does not drop/archive tables.'
  ),
  (
    'session_memory_lifecycle_engine',
    'Session Memory Lifecycle Engine',
    'runtime_readiness',
    NULL,
    '["session_log_retention_plan","session_summary_archive_plan"]',
    '{"supports_sql_policy":true,"executes_db_stored_code":false,"default_mode":"dry_run"}',
    'database_table_lifecycle_policy_v1',
    'planned',
    'Owner for session_events, gpt_session_turns, and related hot session memory logs.'
  ),
  (
    'observability_lifecycle_engine',
    'Observability Lifecycle Engine',
    'runtime_readiness',
    NULL,
    '["audit_retention_plan","telemetry_retention_plan","execution_log_archive_plan"]',
    '{"supports_sql_policy":true,"executes_db_stored_code":false,"default_mode":"dry_run"}',
    'database_table_lifecycle_policy_v1',
    'planned',
    'Owner for audit_log, execution_log, telemetry_spans, and related operational evidence retention.'
  ),
  (
    'repair_archive_engine',
    'Repair Archive Engine',
    'runtime_readiness',
    NULL,
    '["repair_snapshot_review","backup_snapshot_retention_plan"]',
    '{"supports_sql_policy":true,"executes_db_stored_code":false,"drops_tables":false,"default_mode":"dry_run"}',
    'database_table_lifecycle_policy_v1',
    'planned',
    'Owner for repair_backup, rb, collation_backup, and zz_collation_backup snapshot tables.'
  ),
  (
    'platform_graph_memory_lifecycle_engine',
    'Platform Graph Memory Lifecycle Engine',
    'runtime_readiness',
    NULL,
    '["graph_compaction_plan","artifact_store_compaction_plan","json_asset_dedupe_plan"]',
    '{"supports_sql_policy":true,"executes_db_stored_code":false,"drops_tables":false,"default_mode":"dry_run"}',
    'database_table_lifecycle_policy_v1',
    'planned',
    'Owner for json_assets, platform_graph_nodes, and platform_graph_edges retention and compaction planning.'
  ),
  (
    'commercial_lifecycle_engine',
    'Commercial Lifecycle Engine',
    'runtime_readiness',
    NULL,
    '["commercial_record_lifecycle_plan","entitlement_retention_plan","usage_meter_retention_plan"]',
    '{"supports_sql_policy":true,"executes_db_stored_code":false,"drops_tables":false,"default_mode":"dry_run"}',
    'database_table_lifecycle_policy_v1',
    'planned',
    'Owner for commercial, credit, usage, subscription, and entitlement table lifecycle review.'
  )
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  engine_type = VALUES(engine_type),
  runtime_key = VALUES(runtime_key),
  supported_task_classes_json = VALUES(supported_task_classes_json),
  capabilities_json = VALUES(capabilities_json),
  default_policy_key = VALUES(default_policy_key),
  status = VALUES(status),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO platform_engine_policy_registry
  (policy_key, engine_key, scope_type, scope_id, mode, risk_default, approval_required_min_risk,
   require_scope_guard, require_audit, require_validators, validators_json,
   allowed_resource_patterns_json, blocked_resource_patterns_json, status, notes)
VALUES
  (
    'database_table_lifecycle_policy_v1',
    'database_table_lifecycle_engine',
    'global',
    NULL,
    'dry_run',
    'medium',
    'high',
    1,
    1,
    1,
    '["node test-platform-engine-orchestration.mjs"]',
    '["database:*","table:*"]',
    '["drop:*","truncate:*","delete:*"]',
    'active',
    'Database lifecycle governance is classification and planning only. DROP/TRUNCATE/DELETE are explicitly outside this policy.'
  )
ON DUPLICATE KEY UPDATE
  engine_key = VALUES(engine_key),
  mode = VALUES(mode),
  risk_default = VALUES(risk_default),
  approval_required_min_risk = VALUES(approval_required_min_risk),
  require_scope_guard = VALUES(require_scope_guard),
  require_audit = VALUES(require_audit),
  require_validators = VALUES(require_validators),
  validators_json = VALUES(validators_json),
  allowed_resource_patterns_json = VALUES(allowed_resource_patterns_json),
  blocked_resource_patterns_json = VALUES(blocked_resource_patterns_json),
  status = VALUES(status),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO platform_engine_strategy_registry
  (strategy_key, display_name, description, supported_task_classes_json, supported_resource_kinds_json,
   requires_ast, allows_full_resource_rewrite, executes_dynamic_code, required_validators_json,
   risk_level, status, metadata_json)
VALUES
  (
    'database_table_lifecycle_census',
    'Database Table Lifecycle Census',
    'Read information_schema and companion registry state to classify tables by owner, retention, archive candidacy, and risk. Does not mutate or drop tables.',
    '["table_lifecycle_census","table_lifecycle_decision_brief"]',
    '["database","table"]',
    0,
    0,
    0,
    '["node test-platform-engine-orchestration.mjs"]',
    'medium',
    'active',
    '{"implementation":"backend_allowlist","no_drop":true,"no_archive_execution":true}'
  )
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  supported_task_classes_json = VALUES(supported_task_classes_json),
  supported_resource_kinds_json = VALUES(supported_resource_kinds_json),
  requires_ast = VALUES(requires_ast),
  allows_full_resource_rewrite = VALUES(allows_full_resource_rewrite),
  executes_dynamic_code = VALUES(executes_dynamic_code),
  required_validators_json = VALUES(required_validators_json),
  risk_level = VALUES(risk_level),
  status = VALUES(status),
  metadata_json = VALUES(metadata_json),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO platform_engine_policy_rules
  (rule_key, policy_key, engine_key, priority, task_class, resource_kind, resource_pattern,
   strategy_key, risk_level, auto_apply_allowed, dry_run_required, approval_required,
   validator_commands_json, required_skill_keys_json, status, notes)
VALUES
  (
    'database_table_lifecycle_census_rule',
    'database_table_lifecycle_policy_v1',
    'database_table_lifecycle_engine',
    100,
    'table_lifecycle_decision_brief',
    'database',
    'database:*',
    'database_table_lifecycle_census',
    'medium',
    0,
    1,
    0,
    '["node test-platform-engine-orchestration.mjs"]',
    '["database_table_lifecycle"]',
    'active',
    'Build database lifecycle decision brief from census evidence. Apply/archive/drop remains unavailable.'
  )
ON DUPLICATE KEY UPDATE
  policy_key = VALUES(policy_key),
  engine_key = VALUES(engine_key),
  priority = VALUES(priority),
  task_class = VALUES(task_class),
  resource_kind = VALUES(resource_kind),
  resource_pattern = VALUES(resource_pattern),
  strategy_key = VALUES(strategy_key),
  risk_level = VALUES(risk_level),
  auto_apply_allowed = VALUES(auto_apply_allowed),
  dry_run_required = VALUES(dry_run_required),
  approval_required = VALUES(approval_required),
  validator_commands_json = VALUES(validator_commands_json),
  required_skill_keys_json = VALUES(required_skill_keys_json),
  status = VALUES(status),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO platform_engine_skill_prompt_registry
  (skill_key, engine_key, display_name, prompt_contract_version, task_classes_json,
   required_tools_json, forbidden_tools_json, validator_commands_json, success_criteria_json,
   fallback_behavior_json, prompt_template, status, notes)
VALUES
  (
    'database_table_lifecycle',
    'database_table_lifecycle_engine',
    'Database Table Lifecycle Skill Contract',
    'v1',
    '["table_lifecycle_census","table_lifecycle_decision_brief","table_lifecycle_register_plan"]',
    '["information_schema_census","data_migration_inventory_read","lifecycle_registry_read"]',
    '["DROP TABLE","TRUNCATE TABLE","DELETE FROM","archive_execute_without_approval"]',
    '["node test-platform-engine-orchestration.mjs"]',
    '["all_tables_classified","owner_or_review_status_assigned","retention_policy_recommended","no_drop_executed"]',
    '{"unknown_table":"manual_review","backup_snapshot":"retention_review","empty_unlinked":"owner_or_archive_candidate_review"}',
    'Classify live database tables using information_schema and data_migration_inventory. Do not delete, archive, truncate, or mutate tables. Recommend lifecycle metadata, owner engines, retention policy, and review gates only.',
    'active',
    'Skill contract for database table lifecycle governance under the policy-driven engine layer.'
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
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO intelligence_engines
  (engine_key, display_name, engine_type, runtime_key, compatibility_platform_engine_key,
   lifecycle_stage, supported_task_classes_json, capabilities_json, default_policy_key,
   default_skill_key, default_eval_suite_key, runtime_surface_policy_json,
   observability_policy_json, status, notes)
VALUES
  (
    'database_table_lifecycle_engine',
    'Database Table Lifecycle Engine',
    'memory_lifecycle',
    NULL,
    'database_table_lifecycle_engine',
    'operate',
    '["table_lifecycle_census","table_lifecycle_decision_brief","table_lifecycle_register_plan"]',
    '{"model_never_executes_tools":true,"executes_db_stored_code":false,"drops_tables":false,"archive_execution_available":false,"default_mode":"dry_run"}',
    'database_table_lifecycle_policy_v1',
    'database_table_lifecycle',
    'database_table_lifecycle_eval_v1',
    '{"surface":"database_metadata","drop_truncate_delete_forbidden":true,"registry_write_separate":true}',
    '{"events":["decision.started","table.lifecycle.classified","table.lifecycle.register_plan.created","memory.writeback.completed"]}',
    'active',
    'Classifies every live table as a governed resource and prepares lifecycle registry plans without mutating data.'
  ),
  (
    'session_memory_lifecycle_engine',
    'Session Memory Lifecycle Engine',
    'memory_lifecycle',
    NULL,
    'session_memory_lifecycle_engine',
    'govern',
    '["session_log_retention_plan","session_summary_archive_plan"]',
    '{"model_never_executes_tools":true,"executes_db_stored_code":false,"drops_tables":false,"default_mode":"dry_run"}',
    'database_table_lifecycle_policy_v1',
    'database_table_lifecycle',
    'session_memory_lifecycle_eval_v1',
    '{"surface":"database_metadata","hot_log_retention_required":true}',
    '{"events":["table.lifecycle.classified","retention.plan.created"]}',
    'planned',
    'Lifecycle owner for session_events, gpt_session_turns, and related session memory logs.'
  ),
  (
    'observability_lifecycle_engine',
    'Observability Lifecycle Engine',
    'memory_lifecycle',
    NULL,
    'observability_lifecycle_engine',
    'govern',
    '["audit_retention_plan","telemetry_retention_plan","execution_log_archive_plan"]',
    '{"model_never_executes_tools":true,"executes_db_stored_code":false,"drops_tables":false,"default_mode":"dry_run"}',
    'database_table_lifecycle_policy_v1',
    'database_table_lifecycle',
    'observability_lifecycle_eval_v1',
    '{"surface":"database_metadata","audit_retention_required":true}',
    '{"events":["table.lifecycle.classified","retention.plan.created","readback.validated"]}',
    'planned',
    'Lifecycle owner for audit_log, execution_log, telemetry_spans, and related operational evidence.'
  )
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  engine_type = VALUES(engine_type),
  runtime_key = VALUES(runtime_key),
  compatibility_platform_engine_key = VALUES(compatibility_platform_engine_key),
  lifecycle_stage = VALUES(lifecycle_stage),
  supported_task_classes_json = VALUES(supported_task_classes_json),
  capabilities_json = VALUES(capabilities_json),
  default_policy_key = VALUES(default_policy_key),
  default_skill_key = VALUES(default_skill_key),
  default_eval_suite_key = VALUES(default_eval_suite_key),
  runtime_surface_policy_json = VALUES(runtime_surface_policy_json),
  observability_policy_json = VALUES(observability_policy_json),
  status = VALUES(status),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO intelligence_policies
  (policy_key, engine_key, scope_type, scope_id, mode, risk_default,
   approval_required_min_risk, deterministic_hard_gates_json, model_decision_role,
   require_scope_guard, require_audit, require_validators, require_readback,
   require_eval_suite, validators_json, allowed_resource_patterns_json,
   blocked_resource_patterns_json, status, notes)
VALUES
  (
    'database_table_lifecycle_policy_v1',
    'database_table_lifecycle_engine',
    'table',
    NULL,
    'dry_run',
    'admin_registry_write',
    'destructive',
    '{"forbidden_operations":["DROP TABLE","TRUNCATE TABLE","DELETE FROM","archive_execute_without_approval"],"registry_write_requires_separate_apply":true,"table_lifecycle_required_for_new_tables":true}',
    'scoring_assist',
    1,
    1,
    1,
    1,
    1,
    '["node test-platform-engine-orchestration.mjs"]',
    '["database:*","table:*"]',
    '["drop:*","truncate:*","delete:*"]',
    'active',
    'Database table lifecycle policy is metadata classification and planning only. Destructive operations remain out of scope.'
  )
ON DUPLICATE KEY UPDATE
  engine_key = VALUES(engine_key),
  scope_type = VALUES(scope_type),
  scope_id = VALUES(scope_id),
  mode = VALUES(mode),
  risk_default = VALUES(risk_default),
  approval_required_min_risk = VALUES(approval_required_min_risk),
  deterministic_hard_gates_json = VALUES(deterministic_hard_gates_json),
  model_decision_role = VALUES(model_decision_role),
  require_scope_guard = VALUES(require_scope_guard),
  require_audit = VALUES(require_audit),
  require_validators = VALUES(require_validators),
  require_readback = VALUES(require_readback),
  require_eval_suite = VALUES(require_eval_suite),
  validators_json = VALUES(validators_json),
  allowed_resource_patterns_json = VALUES(allowed_resource_patterns_json),
  blocked_resource_patterns_json = VALUES(blocked_resource_patterns_json),
  status = VALUES(status),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO skill_manifests
  (skill_key, engine_key, display_name, skill_version, prompt_contract_version,
   policy_key, eval_suite_key, tool_policy_json, task_classes_json, required_tools_json,
   forbidden_tools_json, validator_commands_json, success_criteria_json,
   fallback_behavior_json, prompt_template, status, notes)
VALUES
  (
    'database_table_lifecycle',
    'database_table_lifecycle_engine',
    'Database Table Lifecycle Skill Manifest',
    'v1',
    'v1',
    'database_table_lifecycle_policy_v1',
    'database_table_lifecycle_eval_v1',
    '{"deferred_tool_search":true,"allowed_tool_classes":["information_schema_read","registry_read","dry_run_plan","validator"],"forbidden_tool_classes":["drop_table","truncate_table","delete_rows","archive_execute"]}',
    '["table_lifecycle_census","table_lifecycle_decision_brief","table_lifecycle_register_plan"]',
    '["information_schema_census","data_migration_inventory_read","lifecycle_registry_read"]',
    '["DROP TABLE","TRUNCATE TABLE","DELETE FROM","archive_execute_without_approval"]',
    '["node test-platform-engine-orchestration.mjs"]',
    '["all_tables_classified","owner_or_review_status_assigned","retention_policy_recommended","no_drop_executed","registry_plan_is_dry_run"]',
    '{"unknown_table":"manual_review","backup_snapshot":"retention_review","empty_unlinked":"owner_or_archive_candidate_review"}',
    'Classify live database tables as governed resources. Recommend lifecycle metadata, owner engines, retention policy, and review gates only. Do not delete, archive, truncate, or mutate tables.',
    'active',
    'Versioned skill contract for Database Table Lifecycle Governance under the AI Intelligence Runtime & Governance Layer.'
  )
ON DUPLICATE KEY UPDATE
  engine_key = VALUES(engine_key),
  display_name = VALUES(display_name),
  skill_version = VALUES(skill_version),
  prompt_contract_version = VALUES(prompt_contract_version),
  policy_key = VALUES(policy_key),
  eval_suite_key = VALUES(eval_suite_key),
  tool_policy_json = VALUES(tool_policy_json),
  task_classes_json = VALUES(task_classes_json),
  required_tools_json = VALUES(required_tools_json),
  forbidden_tools_json = VALUES(forbidden_tools_json),
  validator_commands_json = VALUES(validator_commands_json),
  success_criteria_json = VALUES(success_criteria_json),
  fallback_behavior_json = VALUES(fallback_behavior_json),
  prompt_template = VALUES(prompt_template),
  status = VALUES(status),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;
