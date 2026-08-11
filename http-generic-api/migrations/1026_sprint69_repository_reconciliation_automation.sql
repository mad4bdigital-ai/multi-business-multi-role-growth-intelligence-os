-- Sprint 69: Repository reconciliation automation, branch leases, and replay-safe orchestration.
-- Additive control-plane schema only. This migration is included for governed review and is not applied by this change.
-- No provider call, repository mutation, force update, PR merge, or credential read is performed here.

CREATE TABLE IF NOT EXISTS `repository_operation_leases` (
  `lease_id` VARCHAR(36) NOT NULL PRIMARY KEY,
  `resource_uri` VARCHAR(512) NOT NULL,
  `repository_owner` VARCHAR(191) NOT NULL,
  `repository_name` VARCHAR(191) NOT NULL,
  `branch_name` VARCHAR(255) NOT NULL,
  `operation_key` VARCHAR(128) NOT NULL,
  `holder_run_id` VARCHAR(64) NOT NULL,
  `holder_actor_type` VARCHAR(32) NOT NULL DEFAULT 'admin',
  `holder_actor_id` VARCHAR(128) NULL,
  `lease_mode` ENUM('exclusive_mutation') NOT NULL DEFAULT 'exclusive_mutation',
  `status` ENUM('active','released','expired','cancelled') NOT NULL DEFAULT 'active',
  `resource_fingerprint` CHAR(64) NOT NULL,
  `active_resource_sha256` CHAR(64) NULL,
  `acquired_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `renewed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` DATETIME NOT NULL,
  `released_at` DATETIME NULL,
  `release_reason` VARCHAR(500) NULL,
  `metadata_json` LONGTEXT NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_repository_operation_active_resource` (`active_resource_sha256`),
  KEY `idx_repository_operation_lease_resource` (`repository_owner`,`repository_name`,`branch_name`,`status`),
  KEY `idx_repository_operation_lease_holder` (`holder_run_id`,`status`),
  KEY `idx_repository_operation_lease_expiry` (`status`,`expires_at`)
);

SET @repo_mutation_idempotency_column_exists := (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema=DATABASE() AND table_name='repository_mutation_runs_v6' AND column_name='idempotency_key'
);
SET @repo_mutation_idempotency_column_sql := IF(
  @repo_mutation_idempotency_column_exists=0,
  'ALTER TABLE `repository_mutation_runs_v6` ADD COLUMN `idempotency_key` CHAR(64) NULL AFTER `approval_hold_id`',
  'SELECT 1'
);
PREPARE repo_mutation_idempotency_column_stmt FROM @repo_mutation_idempotency_column_sql;
EXECUTE repo_mutation_idempotency_column_stmt;
DEALLOCATE PREPARE repo_mutation_idempotency_column_stmt;

SET @repo_mutation_idempotency_index_exists := (
  SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema=DATABASE() AND table_name='repository_mutation_runs_v6'
     AND index_name='uq_repository_mutation_run_idempotency'
);
SET @repo_mutation_idempotency_index_sql := IF(
  @repo_mutation_idempotency_index_exists=0,
  'ALTER TABLE `repository_mutation_runs_v6` ADD UNIQUE KEY `uq_repository_mutation_run_idempotency` (`idempotency_key`)',
  'SELECT 1'
);
PREPARE repo_mutation_idempotency_index_stmt FROM @repo_mutation_idempotency_index_sql;
EXECUTE repo_mutation_idempotency_index_stmt;
DEALLOCATE PREPARE repo_mutation_idempotency_index_stmt;

INSERT INTO `platform_resource_recipes`
  (`recipe_key`,`resource_type`,`operation_key`,`adapter_key`,`risk_class`,`mode`,`read_only`,
   `requires_dry_run`,`requires_capability_envelope`,`requires_typed_confirmation`,
   `requires_same_cycle_readback`,`authority_requirement_key`,`input_schema_json`,
   `output_schema_json`,`policy_json`,`graph_write_policy`,`engine_key`,`status`,`notes`)
VALUES (
  'repo.pr.reconcile_and_finalize','github_pull_request','reconcile_and_finalize',
  'github.pull_request.reconciliation.orchestrator','mutation','apply',0,1,1,1,1,
  'github_repo_merge_authority',
  JSON_OBJECT('type','object','required',JSON_ARRAY('owner','repo','branch','pull_number','expected_base_sha','expected_branch_sha'),'additionalProperties',TRUE),
  JSON_OBJECT('type','object','required',JSON_ARRAY('ok','status','plan_id','secrets_included'),'additionalProperties',TRUE),
  JSON_OBJECT(
    'status','planned','branch_lease_required',TRUE,'branch_lease_table','repository_operation_leases',
    'mutation_plan_table','repository_mutation_plans_v6','mutation_run_table','repository_mutation_runs_v6',
    'idempotency_source','deterministic_plan_item_sha256','force_push_allowed',FALSE,
    'protected_branch_direct_write_allowed',FALSE,'provider_write_requires_action_specific_capability_envelope',TRUE,
    'approval_hold_required',TRUE,'typed_confirmation_required',TRUE,
    'unknown_provider_outcome_requires_readback',TRUE,'same_cycle_ref_tree_ancestry_readback_required',TRUE,
    'engine_owned_control_steps',TRUE,'provider_dispatch_installed_tool_only',TRUE,
    'engine_internal_resolution_builder','repositoryDetachedResolutionBuilder',
    'required_checks',JSON_ARRAY('Syntax Check','Architecture Drift Detection','Execution Resolver Gate','Unit & Integration Tests'),
    'migration_apply_allowed',FALSE,'automatic_activation_allowed',FALSE,'secrets_included',FALSE
  ),
  'summary_node','repository_reconciliation_orchestrator','planned',
  'Plan-bound reconciliation orchestration. Engine owns lease/evidence and detached/merge composition steps; recipe remains planned until authority wiring, CI, positive smoke, and separate activation approval certify mutation.'
)
ON DUPLICATE KEY UPDATE
  `policy_json`=VALUES(`policy_json`),`input_schema_json`=VALUES(`input_schema_json`),
  `output_schema_json`=VALUES(`output_schema_json`),`status`='planned',`notes`=VALUES(`notes`),`updated_at`=CURRENT_TIMESTAMP;

INSERT INTO `platform_resource_recipe_steps`
  (`recipe_key`,`step_order`,`step_key`,`step_kind`,`parent_action_key`,`tool_key`,`source_table`,
   `body_template_json`,`response_projection_json`,`required`,`on_error_policy`,`status`)
VALUES
  ('repo.pr.reconcile_and_finalize',10,'acquire_branch_lease','classify',NULL,NULL,'repository_operation_leases',
    JSON_OBJECT('lease_mode','exclusive_mutation','ttl_seconds',900),NULL,1,'fail','active'),
  ('repo.pr.reconcile_and_finalize',20,'reconcile_branch','installed_tool_call','acquire_branch_lease','admin_branch_reconcile',NULL,
    JSON_OBJECT('mode','dry_run'),
    JSON_OBJECT('base_ref_sha','evidence.base_ref_sha','branch_ref_sha','evidence.branch_ref_sha','changed_files','classification.changed_files'),
    1,'fail','active'),
  ('repo.pr.reconcile_and_finalize',30,'build_resolution_commit','engine_internal','reconcile_branch','github_detached_resolution_commit_create',NULL,
    JSON_OBJECT(
      'engine_key','repositoryDetachedResolutionBuilder',
      'requires_exact_changed_file_blob_map',TRUE,
      'force_push_allowed',FALSE,
      'ref_update_allowed',FALSE
    ),
    JSON_OBJECT('resolution_commit_sha','resolution.commit_sha','resolution_tree_sha','resolution.tree_sha'),
    1,'fail','active'),
  ('repo.pr.reconcile_and_finalize',40,'create_merge_commit','engine_internal','build_resolution_commit','github_branch_merge_commit_create',NULL,
    JSON_OBJECT(
      'engine_key','adminBranchReconciliationAdapter',
      'resolution_commit_source_step','build_resolution_commit',
      'resolution_commit_source_path','resolution.commit_sha',
      'force_push_allowed',FALSE
    ),
    JSON_OBJECT('merge_commit_sha','commit.sha','branch_sha','update.branch_sha'),
    1,'fail','active'),
  ('repo.pr.reconcile_and_finalize',50,'verify_branch','installed_tool_call','create_merge_commit','admin_branch_reconcile',NULL,
    JSON_OBJECT('mode','dry_run'),
    JSON_OBJECT('classification','classification.classification','behind_by','classification.behind_by','branch_ref_sha','evidence.branch_ref_sha'),
    1,'fail','active'),
  ('repo.pr.reconcile_and_finalize',60,'evaluate_ci','installed_tool_call','verify_branch','github_pr_ci_gate',NULL,
    NULL,NULL,1,'fail','active'),
  ('repo.pr.reconcile_and_finalize',70,'finalize_pr','installed_tool_call','evaluate_ci','github_pr_finalize',NULL,
    NULL,NULL,1,'fail','active'),
  ('repo.pr.reconcile_and_finalize',80,'release_branch_lease','classify','finalize_pr',NULL,'repository_operation_leases',
    JSON_OBJECT('release_reason','reconciliation_completed'),NULL,1,'classify_degraded','active'),
  ('repo.pr.reconcile_and_finalize',90,'emit_evidence','emit_evidence','release_branch_lease',NULL,'execution_log',
    NULL,NULL,1,'classify_degraded','active')
ON DUPLICATE KEY UPDATE
  `step_kind`=VALUES(`step_kind`),`parent_action_key`=VALUES(`parent_action_key`),`tool_key`=VALUES(`tool_key`),
  `source_table`=VALUES(`source_table`),`body_template_json`=VALUES(`body_template_json`),
  `response_projection_json`=VALUES(`response_projection_json`),`required`=VALUES(`required`),
  `on_error_policy`=VALUES(`on_error_policy`),`status`='active',`updated_at`=CURRENT_TIMESTAMP;

INSERT INTO `execution_policies`
  (`policy_group`,`policy_key`,`policy_value`,`active`,`execution_scope`,`affects_layer`,`blocking`,`notes`)
VALUES (
  'Repository Mutation Governance','repository_reconciliation_automation_v1',
  JSON_OBJECT(
    'rule','repository_reconciliation_requires_plan_bound_lease_idempotency_and_same_cycle_readback',
    'orchestrator','repositoryReconciliationOrchestrator','lease_service','repositoryOperationLeaseService',
    'lease_table','repository_operation_leases','recipe_key','repo.pr.reconcile_and_finalize','recipe_status','planned',
    'replay_guard',JSON_ARRAY('plan_id_plan_item_id','idempotency_key'),
    'engine_owned_steps',JSON_ARRAY('acquire_branch_lease','build_resolution_commit','create_merge_commit','release_branch_lease','emit_evidence'),
    'provider_dispatch_rule','installed_tool_call_only',
    'requires',JSON_ARRAY('fresh_base_and_branch_sha','exclusive_branch_lease','capability_envelope','approval_hold','typed_confirmation','exact_resolution_scope','required_ci_checks','same_cycle_readback','audit'),
    'forbidden',JSON_ARRAY('force_push','protected_branch_direct_write','caller_supplied_lease_authority','blind_retry_after_unknown_provider_outcome','migration_apply','automatic_recipe_activation','secret_return'),
    'secrets_included',FALSE
  ),
  'TRUE','repository_reconciliation|repo_mutation|pull_request_merge|branch_update',
  'repositoryReconciliationOrchestrator|repositoryOperationLeaseService|repositoryDetachedResolutionBuilder|repository_mutation_runs_v6|platform_resource_recipes',
  'TRUE','The automation contract remains planned until canonical authority wiring and positive smoke are separately certified.'
)
ON DUPLICATE KEY UPDATE
  `policy_value`=VALUES(`policy_value`),`active`=VALUES(`active`),
  `execution_scope`=VALUES(`execution_scope`),`affects_layer`=VALUES(`affects_layer`),
  `blocking`=VALUES(`blocking`),`notes`=VALUES(`notes`),`updated_at`=CURRENT_TIMESTAMP;
