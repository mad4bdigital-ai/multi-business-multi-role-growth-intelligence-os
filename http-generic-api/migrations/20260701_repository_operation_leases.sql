-- Repository operation lease foundation.
-- Additive internal coordination state only; no provider call or Git mutation is performed by this migration.
-- no_provider_call
-- no_external_write
-- no_protected_branch_write
-- secrets_included=false

CREATE TABLE IF NOT EXISTS `repository_operation_leases` (
  `lease_id` VARCHAR(36) NOT NULL,
  `repository_owner` VARCHAR(100) NOT NULL,
  `repository_name` VARCHAR(100) NOT NULL,
  `branch_name` VARCHAR(255) NOT NULL,
  `resource_key` VARCHAR(512) NOT NULL,
  `operation_key` VARCHAR(128) NOT NULL,
  `operation_fingerprint` CHAR(64) NOT NULL,
  `resource_fingerprint` CHAR(64) NOT NULL,
  `holder_run_id` VARCHAR(64) NOT NULL,
  `holder_actor_type` VARCHAR(64) NOT NULL,
  `holder_actor_id` VARCHAR(64) NULL,
  `lease_mode` ENUM('exclusive_mutation') NOT NULL DEFAULT 'exclusive_mutation',
  `status` ENUM('active','released','expired') NOT NULL DEFAULT 'active',
  `active_resource_key` VARCHAR(512)
    GENERATED ALWAYS AS (CASE WHEN `status`='active' THEN `resource_key` ELSE NULL END) STORED,
  `acquired_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `renewed_at` DATETIME NULL,
  `expires_at` DATETIME NOT NULL,
  `released_at` DATETIME NULL,
  `release_reason` VARCHAR(500) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`lease_id`),
  UNIQUE KEY `uq_repository_operation_leases_active_resource` (`active_resource_key`),
  KEY `idx_repository_operation_leases_holder` (`holder_run_id`,`status`,`expires_at`),
  KEY `idx_repository_operation_leases_resource` (`repository_owner`,`repository_name`,`branch_name`,`status`),
  KEY `idx_repository_operation_leases_expiry` (`status`,`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `execution_policies`
  (`policy_group`,`policy_key`,`policy_value`,`active`,`execution_scope`,`affects_layer`,`blocking`,`notes`)
SELECT
  'Repository Mutation Governance',
  'repository_operation_lease_foundation_v1',
  JSON_OBJECT(
    'rule','exclusive_branch_mutation_lease',
    'resource_table','repository_operation_leases',
    'lease_mode','exclusive_mutation',
    'protected_branches_blocked',JSON_ARRAY('main','master','production','prod','staging','release'),
    'acquire_before_provider_write',true,
    'renew_during_long_running_operation',true,
    'release_after_readback_or_terminal_failure',true,
    'expired_lease_reclaim_allowed',true,
    'unknown_provider_outcome_requires_readback_before_release',true,
    'runtime_enforcement_phase','foundation_not_yet_wired',
    'secrets_included',false
  ),
  'TRUE',
  'repository_maintenance|repository_mutation|repository_reconciliation',
  'repositoryOperationLeaseService|repository_operation_leases|repository_mutation_runs_v6',
  'FALSE',
  'Foundation policy only. Mutation tools remain unchanged until a separately reviewed wiring change requires lease ownership before provider writes.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group`='Repository Mutation Governance'
     AND `policy_key`='repository_operation_lease_foundation_v1'
);

INSERT INTO `platform_closure_threads`
  (`thread_key`,`state`,`required_evidence_json`,`observed_evidence_json`,`blocker_json`,`next_action`,`owner_engine_key`)
VALUES
  (
    'repository_operation_lease_enforcement',
    'validating',
    JSON_ARRAY(
      'migration_schema_readback',
      'lease_service_unit_tests',
      'mutation_tool_lease_wiring',
      'docs_agent_lease_guard',
      'same_cycle_repository_smoke'
    ),
    JSON_ARRAY('repository_operation_lease_foundation_v1'),
    JSON_ARRAY('mutation_tools_not_yet_wired'),
    'Wire repository mutation tools and Docs Agent to assert the same active branch lease in a separate bounded change.',
    'repo_conflict_resolution_engine'
  )
ON DUPLICATE KEY UPDATE
  state=VALUES(state),
  required_evidence_json=VALUES(required_evidence_json),
  observed_evidence_json=VALUES(observed_evidence_json),
  blocker_json=VALUES(blocker_json),
  next_action=VALUES(next_action),
  owner_engine_key=VALUES(owner_engine_key),
  updated_at=CURRENT_TIMESTAMP;
