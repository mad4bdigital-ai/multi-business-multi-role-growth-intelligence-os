-- Sprint 65: admin tools for policy-driven engine orchestration diagnostics.
--
-- These tools expose registry listing, dry-run task planning, and run history.
-- They do not expose apply. Engine apply must be added separately behind
-- approval, validator, and scope gates.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`,
  `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
  (
    'platform_engine_list',
    'Platform Engine List',
    'List policy-driven platform engines. Read-only and never executes engine tasks.',
    'GET',
    '/platform/engines',
    NULL,
    '{"type":"object","properties":{"status":{"type":"string"},"engine_type":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":250}},"additionalProperties":false}',
    NULL,
    'platform_engine,registry,read_only,no_execution',
    1,
    251
  ),
  (
    'platform_engine_task_plan',
    'Platform Engine Task Plan',
    'Create a governed policy-driven engine task plan from SQL registry policy, rules, strategies, and skill prompt contracts. Dry-run planning only; does not apply changes or execute dynamic code.',
    'POST',
    '/platform/engines/task-plan',
    NULL,
    '{"type":"object","required":["engine_key","task_class"],"properties":{"engine_key":{"type":"string"},"task_class":{"type":"string"},"mode":{"type":"string","enum":["diagnose_only","dry_run","apply_allowed"],"default":"dry_run"},"resource_key":{"type":"string"},"resource_kind":{"type":"string"},"resource":{"type":"object","additionalProperties":true},"scope_id":{"type":"string"},"scope_guard_passed":{"type":"boolean","default":false},"approval_granted":{"type":"boolean","default":false},"write_audit":{"type":"boolean","default":false},"actor_id":{"type":"string"},"tenant_id":{"type":"string"},"trace_id":{"type":"string"}},"additionalProperties":false}',
    NULL,
    'platform_engine,policy,task_plan,dry_run,no_apply,no_dynamic_code,approval_gate,scope_guard,audited',
    1,
    252
  ),
  (
    'platform_engine_resolve_intent',
    'Platform Engine Resolve Intent',
    'Resolve a user objective and optional resource into a candidate engine, task class, skill contract, and resource classification. Read-only; does not plan, apply, or execute.',
    'POST',
    '/platform/engines/resolve-intent',
    NULL,
    '{"type":"object","properties":{"objective":{"type":"string"},"prompt":{"type":"string"},"goal":{"type":"string"},"engine_key":{"type":"string"},"task_class":{"type":"string"},"resource_key":{"type":"string"},"resource_kind":{"type":"string"},"resource":{"type":"object","additionalProperties":true}},"additionalProperties":false}',
    NULL,
    'platform_engine,intent_resolution,decision_support,read_only,no_execution,no_apply',
    1,
    253
  ),
  (
    'platform_engine_decision_brief',
    'Platform Engine Decision Brief',
    'Build a read-only decision brief that combines intent resolution, capability readiness, policy-driven task planning, feedback-aware recommendation, and apply-readiness envelope. Does not apply changes or execute strategies.',
    'POST',
    '/platform/engines/decision-brief',
    NULL,
    '{"type":"object","properties":{"objective":{"type":"string"},"prompt":{"type":"string"},"goal":{"type":"string"},"engine_key":{"type":"string"},"task_class":{"type":"string"},"mode":{"type":"string","enum":["diagnose_only","dry_run","apply_allowed"],"default":"dry_run"},"resource_key":{"type":"string"},"resource_kind":{"type":"string"},"resource":{"type":"object","additionalProperties":true},"scope_id":{"type":"string"},"scope_guard_passed":{"type":"boolean","default":false},"approval_granted":{"type":"boolean","default":false},"actor_id":{"type":"string"},"tenant_id":{"type":"string"},"trace_id":{"type":"string"}},"additionalProperties":false}',
    NULL,
    'platform_engine,decision_brief,intelligence_layer,read_only,no_execution,no_apply,scope_guard,approval_gate,validator_gate',
    1,
    254
  ),
  (
    'database_table_lifecycle_decision_brief',
    'Database Table Lifecycle Decision Brief',
    'Build a read-only lifecycle decision brief for live database tables using information_schema, data_migration_inventory, and lifecycle registry classification rules. Does not drop, archive, truncate, or mutate tables.',
    'POST',
    '/platform/engines/database-table-lifecycle/decision-brief',
    NULL,
    '{"type":"object","properties":{"limit":{"type":"integer","minimum":1,"maximum":1000,"default":250}},"additionalProperties":false}',
    NULL,
    'platform_engine,database_lifecycle,information_schema,census,decision_brief,read_only,no_drop,no_archive_execution,no_mutation',
    1,
    255
  ),
  (
    'database_table_lifecycle_register_plan',
    'Database Table Lifecycle Register Plan',
    'Build a dry-run upsert plan for database_table_lifecycle_registry from live table census classifications. Does not write registry rows, drop tables, archive tables, truncate, or mutate data.',
    'POST',
    '/platform/engines/database-table-lifecycle/register-plan',
    NULL,
    '{"type":"object","properties":{"limit":{"type":"integer","minimum":1,"maximum":1000,"default":250}},"additionalProperties":false}',
    NULL,
    'platform_engine,database_lifecycle,register_plan,dry_run,no_write,no_drop,no_archive_execution,no_mutation',
    1,
    256
  ),
  (
    'platform_engine_capability_check',
    'Platform Engine Capability Check',
    'Check whether a policy-driven engine has the required active policy, rules, strategies, skill prompt contracts, and validators for a task class. Readiness diagnostic only; does not plan, apply, or execute.',
    'POST',
    '/platform/engines/capability-check',
    NULL,
    '{"type":"object","required":["engine_key"],"properties":{"engine_key":{"type":"string"},"task_class":{"type":"string"}},"additionalProperties":false}',
    NULL,
    'platform_engine,capability_check,readiness,read_only,no_execution,no_apply',
    1,
    257
  ),
  (
    'platform_engine_run_history',
    'Platform Engine Run History',
    'List policy-driven engine planning/audit runs. Read-only.',
    'GET',
    '/platform/engines/runs',
    NULL,
    '{"type":"object","properties":{"engine_key":{"type":"string"},"task_class":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":250}},"additionalProperties":false}',
    NULL,
    'platform_engine,run_history,read_only,audited',
    1,
    258
  ),
  (
    'platform_engine_feedback_summary',
    'Platform Engine Feedback Summary',
    'Summarize recent policy-driven engine run outcomes so task planning can account for prior apply and validator failures. Read-only; does not plan, apply, or execute.',
    'GET',
    '/platform/engines/feedback-summary',
    NULL,
    '{"type":"object","properties":{"engine_key":{"type":"string"},"task_class":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":250}},"additionalProperties":false}',
    NULL,
    'platform_engine,feedback,outcome_history,read_only,no_execution,no_apply',
    1,
    259
  ),
  (
    'platform_engine_execution_envelope',
    'Platform Engine Execution Envelope',
    'Build an apply-readiness envelope for a policy-driven engine task. This only reports required controls, validators, approval status, and blockers; it does not apply changes or execute engine strategies.',
    'POST',
    '/platform/engines/execution-envelope',
    NULL,
    '{"type":"object","required":["engine_key","task_class"],"properties":{"engine_key":{"type":"string"},"task_class":{"type":"string"},"mode":{"type":"string","enum":["apply_allowed"],"default":"apply_allowed"},"resource_key":{"type":"string"},"resource_kind":{"type":"string"},"resource":{"type":"object","additionalProperties":true},"scope_id":{"type":"string"},"scope_guard_passed":{"type":"boolean","default":false},"approval_granted":{"type":"boolean","default":false},"actor_id":{"type":"string"},"tenant_id":{"type":"string"},"trace_id":{"type":"string"}},"additionalProperties":false}',
    NULL,
    'platform_engine,execution_envelope,apply_readiness,no_execution,no_apply,no_repo_mutation,approval_gate,scope_guard,validator_gate',
    1,
    260
  ),
  (
    'ai_model_run_plan',
    'AI Model Run Plan',
    'Build a canonical governed model-run dry-run envelope. Does not call a model, expose raw thinking, expose a raw tool catalog, or execute tools.',
    'POST',
    '/ai/model-runs',
    NULL,
    '{"type":"object","properties":{"provider_key":{"type":"string"},"model_key":{"type":"string"},"mode":{"type":"string","enum":["dry_run"],"default":"dry_run"},"messages":{"type":"array","items":{"type":"object","additionalProperties":true}},"requested_tools":{"type":"array","items":{"type":"string"}}},"additionalProperties":false}',
    NULL,
    'ai_intelligence,model_runtime,dry_run,no_model_call,no_tool_execution,no_raw_thinking',
    1,
    261
  ),
  (
    'ai_model_run_events',
    'AI Model Run Events',
    'Read canonical model-run event envelope. Dry-run/readback surface only; does not stream provider events or execute tools.',
    'GET',
    '/ai/model-runs/:id/events',
    '["id"]',
    '{"type":"object","required":["id"],"properties":{"id":{"type":"string"}},"additionalProperties":false}',
    NULL,
    'ai_intelligence,event_bus,read_only,no_model_call,no_tool_execution',
    1,
    262
  ),
  (
    'ai_tool_search',
    'AI Tool Search',
    'Search the derived governed tool index. Returns bounded tool summaries only; source-of-truth remains actions, endpoints, workflows, and connected systems.',
    'POST',
    '/ai/tool-search',
    NULL,
    '{"type":"object","properties":{"query":{"type":"string"},"tags":{"type":"array","items":{"type":"string"}},"risk_class":{"type":"string","enum":["read_only","workspace_write","brand_external_write","tenant_external_write","admin_registry_write","provider_privileged","local_device","destructive","credential_touching","deployment_affecting"]},"limit":{"type":"integer","minimum":1,"maximum":100,"default":25}},"additionalProperties":false}',
    NULL,
    'ai_intelligence,tool_search,deferred_tools,read_only,no_raw_catalog,no_tool_execution',
    1,
    263
  )
ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `description` = VALUES(`description`),
  `http_method` = VALUES(`http_method`),
  `http_path` = VALUES(`http_path`),
  `path_param_keys` = VALUES(`path_param_keys`),
  `input_schema` = VALUES(`input_schema`),
  `fixed_body` = VALUES(`fixed_body`),
  `tags` = VALUES(`tags`),
  `is_enabled` = VALUES(`is_enabled`),
  `sort_order` = VALUES(`sort_order`);
