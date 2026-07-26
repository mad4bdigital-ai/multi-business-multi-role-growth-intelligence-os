-- Sprint 66: Runtime policy reconciliation and policy/logic bridge.
-- Restores missing Sprint 64 execution_policies runtime seeds, adds target
-- platform-engine policy/rule representations, and records policy-to-logic
-- bindings without deleting or disabling any existing feature surface.

CREATE TABLE IF NOT EXISTS `policy_logic_bindings` (
  `binding_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `source_policy_table` VARCHAR(128) NOT NULL DEFAULT 'execution_policies',
  `source_policy_id` BIGINT UNSIGNED NOT NULL,
  `source_policy_group` VARCHAR(255) NULL,
  `source_policy_key` VARCHAR(255) NULL,
  `target_policy_rule_key` VARCHAR(191) NULL,
  `logic_key` VARCHAR(128) NULL,
  `binding_role` VARCHAR(80) NOT NULL DEFAULT 'runtime_policy_target_rule',
  `binding_status` VARCHAR(40) NOT NULL DEFAULT 'active',
  `notes` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`binding_id`),
  UNIQUE KEY `uq_policy_logic_binding` (`source_policy_table`, `source_policy_id`, `binding_role`),
  KEY `idx_policy_logic_binding_source` (`source_policy_group`, `source_policy_key`, `binding_status`),
  KEY `idx_policy_logic_binding_rule` (`target_policy_rule_key`, `binding_status`),
  KEY `idx_policy_logic_binding_logic` (`logic_key`, `binding_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `execution_policies`
  (`policy_group`, `policy_key`, `policy_value`, `active`, `execution_scope`, `affects_layer`, `blocking`, `notes`, `created_at`, `updated_at`)
VALUES
('Repository Mutation Governance','Stale Duplicate Branch Merge Guard',JSON_OBJECT('enforcement_mode','blocking','require_compare_main_branch',true,'block_unmerged_branch_delete',true,'block_risky_file_statuses',true,'risky_file_statuses','removed','require_mergeability_check',true,'block_stale_branch_patch',true,'require_stale_branch_reason',true,'reason','Prevent stale duplicate or unreviewed branches from being merged, deleted, or patched without runtime policy evidence.'),'TRUE','repo_mutation|github_pr_merge|branch_delete|repo_patch_apply|gpt_tools_call|tool_dispatch','adminCliRoutes|github_rest_fallback|gptToolsRoutes|repo_patch_apply','TRUE','Runtime preflight policy for GitHub/repo mutation safety. Blocks protected branch delete, unmerged branch delete, non-mergeable PRs, risky removed-file merges, and stale existing-branch patching without an explicit reason.',NOW(),NOW()),
('External App Action Governance','External App Action Preflight Visibility',JSON_OBJECT('enforcement_mode','advisory','require_preflight_visibility',true,'require_secret_free_evidence',true,'require_adapter_specific_evaluator_for_blocking',true,'reason','External app actions must pass through governedExecutionPreflight before adapter execution. Blocking app-specific policies require a dedicated evaluator.'),'TRUE','app_action|external_app_action|n8n|cloudflare|hostinger|google_drive|wordpress_rest|github','appAdapters|appAdapters/index.js|n8n|cloudflare|hostinger|google_drive|wordpress_rest|github','FALSE','Advisory visibility policy for appAdapters/index.js. Restores execution_policies participation without breaking existing app actions.',NOW(),NOW()),
('External App Action Governance','n8n Workflow Execution Guard',JSON_OBJECT('enforcement_mode','blocking','guarded_app_key','n8n','guarded_action_key','execute_workflow','allow_read_actions',true,'allow_trigger_webhook',true,'require_explicit_execution_reason',true,'min_reason_chars',10,'reason','n8n execute_workflow can create side effects and must include an explicit execution reason before adapter execution.'),'TRUE','app_action|external_app_action|n8n|execute_workflow','appAdapters|appAdapters/index.js|n8n','TRUE','Blocking app-specific runtime policy. governedExecutionPreflight blocks n8n execute_workflow unless explicit execution approval and reason are supplied.',NOW(),NOW()),
('Connector Dispatch Governance','Connector Dispatch Preflight Visibility',JSON_OBJECT('enforcement_mode','advisory','require_preflight_visibility',true,'require_secret_free_evidence',true,'require_policy_specific_evaluator_for_blocking',true,'reason','Connector dispatch must pass through governedExecutionPreflight before workflow_runs are created or execution_plans are marked executing.'),'TRUE','connector_dispatch|workflow_dispatch|wordpress|mcp_connector|content_workflow','connectorExecutor|connectorExecutor.js|wordpress|mcp_connector|content_workflow','FALSE','Advisory visibility policy for connectorExecutor.js. Restores preflight evidence before WordPress, MCP, or content workflow dispatch without changing existing execution behavior.',NOW(),NOW()),
('Agent Loop Governance','Agent Loop Preflight Visibility',JSON_OBJECT('enforcement_mode','advisory','require_preflight_visibility',true,'require_secret_free_evidence',true,'require_policy_specific_evaluator_for_blocking',true,'reason','Agent loop execution must pass through governedExecutionPreflight before model/tool or rule-based engine execution.'),'TRUE','agent_loop|model_tool_loop|logic_execution|standard|advanced|rule_based','agentLoopRunner|agentLoopRunner.js|standard|advanced|rule_based','FALSE','Advisory visibility policy for agentLoopRunner.js. Restores execution_policies participation before model/tool loops and rule-based engine dispatch.',NOW(),NOW()),
('Agent Loop Governance','Brand Writing Requires Brand Core',JSON_OBJECT('enforcement_mode','blocking','require_brand_core_for_writing_like_intents',true,'writing_like_patterns','write|content|seo|publish|strategy','reason','Brand writing, SEO, publishing, and strategy workflows require Brand Core evidence before model/tool execution.'),'TRUE','agent_loop|model_tool_loop|logic_execution|standard|advanced|rule_based|content|seo|strategy|write|publish','agentLoopRunner|agentLoopRunner.js|brand_core|content_workflow','TRUE','Blocking agent-loop policy. governedExecutionPreflight blocks writing-like workflows when Brand Core evidence is absent from the governed context.',NOW(),NOW())
ON DUPLICATE KEY UPDATE `policy_value`=VALUES(`policy_value`),`active`=VALUES(`active`),`execution_scope`=VALUES(`execution_scope`),`affects_layer`=VALUES(`affects_layer`),`blocking`=VALUES(`blocking`),`notes`=VALUES(`notes`),`updated_at`=NOW();

INSERT INTO `platform_engine_policy_registry`
  (`policy_key`, `engine_key`, `scope_type`, `scope_id`, `mode`, `risk_default`, `approval_required_min_risk`, `require_scope_guard`, `require_audit`, `require_validators`, `validators_json`, `status`, `notes`)
VALUES
  ('runtime_repo_mutation_policy_v1', NULL, 'global', NULL, 'dry_run', 'high', 'medium', 1, 1, 1, JSON_ARRAY('github_compare_readback', 'branch_protection_check'), 'active', 'Target policy representation for repository mutation runtime preflight.'),
  ('runtime_app_action_policy_v1', NULL, 'global', NULL, 'diagnose_only', 'medium', 'high', 1, 1, 0, JSON_ARRAY(), 'active', 'Target policy representation for external app action preflight visibility.'),
  ('runtime_n8n_workflow_execution_policy_v1', NULL, 'global', NULL, 'dry_run', 'high', 'medium', 1, 1, 1, JSON_ARRAY('n8n_reason_presence_check'), 'active', 'Target policy representation for n8n execute_workflow side-effect guard.'),
  ('runtime_connector_dispatch_policy_v1', NULL, 'global', NULL, 'diagnose_only', 'medium', 'high', 1, 1, 0, JSON_ARRAY(), 'active', 'Target policy representation for connector dispatch preflight visibility.'),
  ('runtime_agent_loop_policy_v1', NULL, 'global', NULL, 'diagnose_only', 'medium', 'high', 1, 1, 0, JSON_ARRAY(), 'active', 'Target policy representation for agent-loop preflight visibility.'),
  ('runtime_brand_core_policy_v1', NULL, 'global', NULL, 'dry_run', 'high', 'medium', 1, 1, 1, JSON_ARRAY('brand_core_surface_authority', 'brand_core_evidence_presence'), 'active', 'Target policy representation for Brand Core writing-like workflow guard.')
ON DUPLICATE KEY UPDATE `mode`=VALUES(`mode`),`risk_default`=VALUES(`risk_default`),`approval_required_min_risk`=VALUES(`approval_required_min_risk`),`require_scope_guard`=VALUES(`require_scope_guard`),`require_audit`=VALUES(`require_audit`),`require_validators`=VALUES(`require_validators`),`validators_json`=VALUES(`validators_json`),`status`=VALUES(`status`),`notes`=VALUES(`notes`),`updated_at`=NOW();

INSERT INTO `platform_engine_policy_rules`
  (`rule_key`, `policy_key`, `engine_key`, `priority`, `task_class`, `resource_kind`, `resource_pattern`, `condition_json`, `strategy_key`, `risk_level`, `auto_apply_allowed`, `dry_run_required`, `approval_required`, `validator_commands_json`, `status`, `notes`)
VALUES
  ('runtime_repo_mutation_guard', 'runtime_repo_mutation_policy_v1', NULL, 1000, 'repo_mutation', 'repository', '*', JSON_OBJECT('execution_policy_group','Repository Mutation Governance','execution_policy_key','Stale Duplicate Branch Merge Guard','requires_compatibility_row',true), 'manual_only', 'high', 0, 1, 1, JSON_ARRAY('github_compare_readback','branch_protection_check'), 'active', 'Target rule for repo mutation preflight; execution_policies remains current runtime source during transition.'),
  ('runtime_app_action_preflight_visibility', 'runtime_app_action_policy_v1', NULL, 900, 'external_app_action', 'app_action', '*', JSON_OBJECT('execution_policy_group','External App Action Governance','execution_policy_key','External App Action Preflight Visibility','advisory_visibility',true), 'diagnose_only', 'medium', 0, 1, 0, JSON_ARRAY(), 'active', 'Target advisory rule for external app action preflight visibility.'),
  ('runtime_n8n_execute_workflow_guard', 'runtime_n8n_workflow_execution_policy_v1', NULL, 1000, 'external_app_action', 'n8n_execute_workflow', 'n8n.execute_workflow', JSON_OBJECT('execution_policy_group','External App Action Governance','execution_policy_key','n8n Workflow Execution Guard','requires_execution_reason',true,'min_reason_chars',10), 'manual_only', 'high', 0, 1, 1, JSON_ARRAY('n8n_reason_presence_check'), 'active', 'Target blocking rule for n8n execute_workflow side-effect guard.'),
  ('runtime_connector_dispatch_preflight_visibility', 'runtime_connector_dispatch_policy_v1', NULL, 900, 'connector_dispatch', 'connector', '*', JSON_OBJECT('execution_policy_group','Connector Dispatch Governance','execution_policy_key','Connector Dispatch Preflight Visibility','advisory_visibility',true), 'diagnose_only', 'medium', 0, 1, 0, JSON_ARRAY(), 'active', 'Target advisory rule for connector dispatch preflight visibility.'),
  ('runtime_agent_loop_preflight_visibility', 'runtime_agent_loop_policy_v1', NULL, 900, 'agent_loop', 'logic_execution', '*', JSON_OBJECT('execution_policy_group','Agent Loop Governance','execution_policy_key','Agent Loop Preflight Visibility','advisory_visibility',true), 'diagnose_only', 'medium', 0, 1, 0, JSON_ARRAY(), 'active', 'Target advisory rule for agent-loop preflight visibility.'),
  ('runtime_brand_writing_requires_brand_core', 'runtime_brand_core_policy_v1', NULL, 1000, 'agent_loop', 'brand_writing_context', 'write|content|seo|publish|strategy', JSON_OBJECT('execution_policy_group','Agent Loop Governance','execution_policy_key','Brand Writing Requires Brand Core','requires_brand_core',true), 'manual_only', 'high', 0, 1, 1, JSON_ARRAY('brand_core_surface_authority','brand_core_evidence_presence'), 'active', 'Target blocking rule for writing-like workflows that require Brand Core evidence.')
ON DUPLICATE KEY UPDATE `policy_key`=VALUES(`policy_key`),`priority`=VALUES(`priority`),`task_class`=VALUES(`task_class`),`resource_kind`=VALUES(`resource_kind`),`resource_pattern`=VALUES(`resource_pattern`),`condition_json`=VALUES(`condition_json`),`strategy_key`=VALUES(`strategy_key`),`risk_level`=VALUES(`risk_level`),`auto_apply_allowed`=VALUES(`auto_apply_allowed`),`dry_run_required`=VALUES(`dry_run_required`),`approval_required`=VALUES(`approval_required`),`validator_commands_json`=VALUES(`validator_commands_json`),`status`=VALUES(`status`),`notes`=VALUES(`notes`),`updated_at`=NOW();

INSERT INTO `policy_logic_bindings` (`source_policy_table`,`source_policy_id`,`source_policy_group`,`source_policy_key`,`target_policy_rule_key`,`logic_key`,`binding_role`,`binding_status`,`notes`)
SELECT 'execution_policies', ep.id, ep.policy_group, ep.policy_key,
  CASE
    WHEN ep.policy_group='Repository Mutation Governance' AND ep.policy_key='Stale Duplicate Branch Merge Guard' THEN 'runtime_repo_mutation_guard'
    WHEN ep.policy_group='External App Action Governance' AND ep.policy_key='External App Action Preflight Visibility' THEN 'runtime_app_action_preflight_visibility'
    WHEN ep.policy_group='External App Action Governance' AND ep.policy_key='n8n Workflow Execution Guard' THEN 'runtime_n8n_execute_workflow_guard'
    WHEN ep.policy_group='Connector Dispatch Governance' AND ep.policy_key='Connector Dispatch Preflight Visibility' THEN 'runtime_connector_dispatch_preflight_visibility'
    WHEN ep.policy_group='Agent Loop Governance' AND ep.policy_key='Agent Loop Preflight Visibility' THEN 'runtime_agent_loop_preflight_visibility'
    WHEN ep.policy_group='Agent Loop Governance' AND ep.policy_key='Brand Writing Requires Brand Core' THEN 'runtime_brand_writing_requires_brand_core'
    ELSE NULL END,
  NULL,'runtime_policy_target_rule','active','Current execution_policies row is bound to its target platform_engine_policy_rules representation. Runtime still reads execution_policies during transition.'
FROM `execution_policies` ep
WHERE (ep.policy_group='Repository Mutation Governance' AND ep.policy_key='Stale Duplicate Branch Merge Guard') OR (ep.policy_group='External App Action Governance' AND ep.policy_key IN ('External App Action Preflight Visibility','n8n Workflow Execution Guard')) OR (ep.policy_group='Connector Dispatch Governance' AND ep.policy_key='Connector Dispatch Preflight Visibility') OR (ep.policy_group='Agent Loop Governance' AND ep.policy_key IN ('Agent Loop Preflight Visibility','Brand Writing Requires Brand Core'))
ON DUPLICATE KEY UPDATE `source_policy_group`=VALUES(`source_policy_group`),`source_policy_key`=VALUES(`source_policy_key`),`target_policy_rule_key`=VALUES(`target_policy_rule_key`),`logic_key`=VALUES(`logic_key`),`binding_status`=VALUES(`binding_status`),`notes`=VALUES(`notes`),`updated_at`=NOW();

INSERT INTO `policy_logic_bindings` (`source_policy_table`,`source_policy_id`,`source_policy_group`,`source_policy_key`,`target_policy_rule_key`,`logic_key`,`binding_role`,`binding_status`,`notes`)
SELECT 'execution_policies', ep.id, ep.policy_group, ep.policy_key, NULL, ld.logic_key, 'legacy_policy_logic_mirror', 'active', 'Historical exact mirror from execution_policies to logic_definitions. Not an enforcement source; retained for traceability during policy/logic separation.'
FROM `execution_policies` ep
JOIN `logic_definitions` ld ON CAST(JSON_UNQUOTE(JSON_EXTRACT(ld.body_json, '$.legacy_id')) AS UNSIGNED)=ep.id AND JSON_UNQUOTE(JSON_EXTRACT(ld.body_json, '$.source'))='legacy_execution_policies'
ON DUPLICATE KEY UPDATE `source_policy_group`=VALUES(`source_policy_group`),`source_policy_key`=VALUES(`source_policy_key`),`logic_key`=VALUES(`logic_key`),`binding_status`=VALUES(`binding_status`),`notes`=VALUES(`notes`),`updated_at`=NOW();

INSERT INTO `data_migration_inventory` (`entity_class`,`table_name`,`authority_model`,`read_priority`,`write_strategy`,`migration_status`,`notes`,`last_checked_at`)
VALUES
  ('execution_policy','execution_policies','transitional',1,'platform_primary','in_progress','Current runtime preflight authority. Target policy model is platform_engine_policy_registry/platform_engine_policy_rules; new policies must not be mirrored into logic_definitions.',NOW()),
  ('policy_logic_binding','policy_logic_bindings','canonical',1,'platform_primary','complete','Traceability bridge between execution_policies, target platform_engine_policy_rules, and legacy logic_definitions mirrors. No enforcement logic lives here.',NOW())
ON DUPLICATE KEY UPDATE `authority_model`=VALUES(`authority_model`),`read_priority`=VALUES(`read_priority`),`write_strategy`=VALUES(`write_strategy`),`migration_status`=VALUES(`migration_status`),`notes`=VALUES(`notes`),`last_checked_at`=NOW();

UPDATE `registry_surfaces_catalog`
   SET `active_status`='active',`authority_status`='authoritative',`required_for_execution`='TRUE',`backend_type`='sql',`backend_adapter`='governance_validation_engine.execution_policies',`authority_model`='sql_runtime_authority',`updated_at`=NOW()
 WHERE `surface_id`='surface.execution_policy_registry_sheet';
