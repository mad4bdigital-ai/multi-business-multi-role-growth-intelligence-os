-- Sprint 69: Repository Automation Control Plane
-- Additive, idempotent orchestration ledgers, admin tools, runtime policy, and schedule contract.
-- The control plane coordinates existing governed tools; it does not create provider credentials,
-- bypass inner tool approvals, allow force pushes, or execute freeform mutation SQL.

CREATE TABLE IF NOT EXISTS `repository_automation_runs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `run_id` CHAR(36) NOT NULL,
  `automation_key` VARCHAR(64) NOT NULL,
  `mode` VARCHAR(32) NOT NULL DEFAULT 'dry_run',
  `status` VARCHAR(32) NOT NULL DEFAULT 'planned',
  `stage` VARCHAR(96) NULL,
  `owner` VARCHAR(191) NOT NULL,
  `repo` VARCHAR(191) NOT NULL,
  `default_branch` VARCHAR(191) NOT NULL DEFAULT 'main',
  `pull_number` INT UNSIGNED NULL,
  `branch_name` VARCHAR(255) NULL,
  `migration_file` VARCHAR(255) NULL,
  `idempotency_key` VARCHAR(191) NOT NULL,
  `input_sha256` CHAR(64) NOT NULL,
  `plan_sha256` CHAR(64) NOT NULL,
  `plan_json` LONGTEXT NOT NULL,
  `summary_json` LONGTEXT NULL,
  `error_json` LONGTEXT NULL,
  `capability_envelope_id` VARCHAR(64) NULL,
  `started_at` TIMESTAMP(6) NULL,
  `completed_at` TIMESTAMP(6) NULL,
  `created_at` TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_repository_automation_run_id` (`run_id`),
  UNIQUE KEY `uq_repository_automation_idempotency` (`automation_key`,`idempotency_key`),
  KEY `idx_repository_automation_status` (`status`,`updated_at`),
  KEY `idx_repository_automation_repo` (`owner`,`repo`,`created_at`),
  KEY `idx_repository_automation_pr` (`pull_number`,`created_at`),
  KEY `idx_repository_automation_migration` (`migration_file`,`created_at`),
  CONSTRAINT `chk_repository_automation_runs_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `repository_automation_step_runs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `step_run_id` CHAR(36) NOT NULL,
  `run_id` CHAR(36) NOT NULL,
  `step_key` VARCHAR(96) NOT NULL,
  `step_order` INT UNSIGNED NOT NULL,
  `capability_key` VARCHAR(128) NULL,
  `tool_key` VARCHAR(191) NULL,
  `mutation_required` TINYINT(1) NOT NULL DEFAULT 0,
  `status` VARCHAR(32) NOT NULL DEFAULT 'planned',
  `attempt_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `request_sha256` CHAR(64) NOT NULL,
  `output_json` LONGTEXT NULL,
  `error_json` LONGTEXT NULL,
  `started_at` TIMESTAMP(6) NULL,
  `completed_at` TIMESTAMP(6) NULL,
  `created_at` TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_repository_automation_step_run_id` (`step_run_id`),
  UNIQUE KEY `uq_repository_automation_run_step` (`run_id`,`step_key`),
  KEY `idx_repository_automation_step_status` (`status`,`updated_at`),
  CONSTRAINT `chk_repository_automation_steps_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `repository_automation_receipts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `receipt_id` CHAR(36) NOT NULL,
  `run_id` CHAR(36) NOT NULL,
  `step_key` VARCHAR(96) NOT NULL,
  `operation_key` VARCHAR(191) NOT NULL,
  `idempotency_key` VARCHAR(191) NOT NULL,
  `request_sha256` CHAR(64) NOT NULL,
  `dispatch_status` VARCHAR(32) NOT NULL,
  `provider_status` INT NULL,
  `provider_receipt_json` LONGTEXT NULL,
  `readback_json` LONGTEXT NULL,
  `recovered_from_transport` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_repository_automation_receipt_id` (`receipt_id`),
  UNIQUE KEY `uq_repository_automation_receipt_request` (`run_id`,`step_key`,`request_sha256`),
  KEY `idx_repository_automation_receipt_status` (`dispatch_status`,`updated_at`),
  CONSTRAINT `chk_repository_automation_receipts_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `execution_policies`
  (`policy_group`,`policy_key`,`policy_value`,`active`,`execution_scope`,`affects_layer`,`blocking`,`notes`)
VALUES (
  'Repository Automation Governance',
  'repository_automation_control_plane_v1',
  JSON_OBJECT(
    'dry_run_default', TRUE,
    'outer_capability_envelope_required_for_apply', TRUE,
    'inner_tool_authority_preserved', TRUE,
    'auto_approval_forbidden', TRUE,
    'auto_confirmation_forbidden', TRUE,
    'readback_before_retry', TRUE,
    'max_transport_attempts', 2,
    'mutation_receipt_required', TRUE,
    'same_cycle_readback_required', TRUE,
    'force_push_allowed', FALSE,
    'direct_provider_credentials_allowed', FALSE,
    'freeform_mutation_sql_allowed', FALSE,
    'chunk_continuation_must_be_exhausted', TRUE,
    'scheduled_hygiene_mutation_allowed', FALSE,
    'secrets_included', FALSE
  ),
  'TRUE',
  'gpt_tools_call|repository_automation_run|repository_automation_plan|repository_automation_status|repository_automation_hygiene_scan|repo_automation',
  'repositoryAutomationControlPlane|repositoryAutomationRoutes|gptToolsRoutes|governed_migration_execute|github_pr_finalize|github_superseded_branch_cleanup',
  'TRUE',
  'Fail-closed policy for the compound repository automation control plane. Apply coordinates existing governed tools but never weakens their action-specific approvals, confirmations, SHA pins, ledgers, or readbacks.'
)
ON DUPLICATE KEY UPDATE
  `policy_value`=VALUES(`policy_value`),
  `active`=VALUES(`active`),
  `execution_scope`=VALUES(`execution_scope`),
  `affects_layer`=VALUES(`affects_layer`),
  `blocking`=VALUES(`blocking`),
  `notes`=VALUES(`notes`),
  `updated_at`=CURRENT_TIMESTAMP;

INSERT INTO `platform_runtime_config` (`config_key`,`config_json`,`status`,`note`)
VALUES (
  'repository_automation_hygiene_schedule_v1',
  JSON_OBJECT(
    'enabled', FALSE,
    'execution_surface', 'governed_admin_job_or_n8n',
    'daily', JSON_ARRAY(
      'expired_temporary_overrides',
      'merged_pr_branches',
      'stale_draft_prs',
      'missing_ci_checks',
      'production_main_sha_mismatch',
      'authorized_unapplied_migrations'
    ),
    'weekly', JSON_ARRAY(
      'sql_cache_health_trend',
      'migration_ledger_reconciliation',
      'historical_specs_under_active_paths',
      'open_pr_dependency_graph'
    ),
    'mutation_allowed', FALSE,
    'provider_writes_allowed', FALSE,
    'credential_payload_read_allowed', FALSE,
    'requires_runtime_certification_before_enable', TRUE,
    'secrets_included', FALSE
  ),
  'active',
  'Read-only hygiene cadence contract. Remains disabled until a governed Admin job or n8n runner is separately certified.'
)
ON DUPLICATE KEY UPDATE
  `config_json`=VALUES(`config_json`),
  `status`=VALUES(`status`),
  `note`=VALUES(`note`),
  `updated_at`=CURRENT_TIMESTAMP;

INSERT INTO `admin_platform_endpoint_tools`
  (`tool_key`,`display_name`,`description`,`http_method`,`http_path`,`path_param_keys`,`input_schema`,`fixed_body`,`tags`,`is_enabled`,`sort_order`,`created_at`,`updated_at`)
VALUES
  (
    'repository_automation_plan',
    'Repository Automation Plan',
    'Build a deterministic no-secret plan for PR delivery, migration release, closeout, branch cleanup, Spec lifecycle, hygiene, or the full repository workstream. No mutation or provider write.',
    'POST',
    '/admin/repository-automation/plan',
    NULL,
    '{"type":"object","properties":{"automation_key":{"type":"string","enum":["pr_delivery","migration_release","post_merge_closeout","branch_cleanup","spec_lifecycle","hygiene_scan","full_workstream"],"default":"full_workstream"},"owner":{"type":"string"},"repo":{"type":"string"},"default_branch":{"type":"string","default":"main"},"pull_number":{"type":"integer","minimum":1},"branch":{"type":"string"},"migration":{"type":"string"},"expected_checksum_sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"},"expected_statement_count":{"type":"integer","minimum":1},"changed_files":{"type":"array","items":{"type":"string"},"maxItems":500},"spec_intent":{"type":"string"},"historical":{"type":"boolean"},"step_args":{"type":"object","additionalProperties":{"type":"object"}}},"additionalProperties":true}',
    NULL,
    'admin,repository,automation,planning,read_only,no_mutation,no_provider_write,no_secrets',
    1,1450,NOW(),CURRENT_TIMESTAMP
  ),
  (
    'repository_automation_run',
    'Repository Automation Run',
    'Run or resume one deterministic repository automation plan. Dry-run is default. Apply requires a ready platform_orchestration envelope and preserves every inner tool approval, typed confirmation, SHA pin, ledger, and readback contract.',
    'POST',
    '/admin/repository-automation/run',
    NULL,
    '{"type":"object","required":["automation_key"],"properties":{"automation_key":{"type":"string","enum":["pr_delivery","migration_release","post_merge_closeout","branch_cleanup","spec_lifecycle","hygiene_scan","full_workstream"]},"mode":{"type":"string","enum":["dry_run","apply"],"default":"dry_run"},"capability_envelope_id":{"type":"string","maxLength":64},"idempotency_key":{"type":"string","maxLength":191},"owner":{"type":"string"},"repo":{"type":"string"},"default_branch":{"type":"string","default":"main"},"pull_number":{"type":"integer","minimum":1},"branch":{"type":"string"},"migration":{"type":"string"},"expected_checksum_sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"},"expected_statement_count":{"type":"integer","minimum":1},"changed_files":{"type":"array","items":{"type":"string"},"maxItems":500},"spec_intent":{"type":"string"},"historical":{"type":"boolean"},"required_checks":{"type":"array","items":{"type":"string"},"maxItems":20},"superseding_commits":{"type":"array","items":{"type":"string","pattern":"^[a-f0-9]{40}$"},"maxItems":50},"step_args":{"type":"object","additionalProperties":{"type":"object"}},"lookback_hours":{"type":"integer","minimum":1,"maximum":168}},"additionalProperties":true}',
    NULL,
    'admin,repository,automation,state_changing,capability_envelope,typed_confirmation,dry_run_default_true,same_cycle_readback,idempotency,compound_operation,readback,no_secrets',
    1,1451,NOW(),CURRENT_TIMESTAMP
  ),
  (
    'repository_automation_status',
    'Repository Automation Status',
    'Read one repository automation run, step timeline, bounded receipts, and readback evidence. Read-only and no-secret.',
    'POST',
    '/admin/repository-automation/status',
    NULL,
    '{"type":"object","required":["run_id"],"properties":{"run_id":{"type":"string","maxLength":64}},"additionalProperties":false}',
    NULL,
    'admin,repository,automation,status,read_only,no_mutation,no_provider_write,no_secrets',
    1,1452,NOW(),CURRENT_TIMESTAMP
  ),
  (
    'repository_automation_hygiene_scan',
    'Repository Automation Hygiene Scan',
    'Read-only scan for expired envelopes and temporary overrides, authorized unapplied migrations, stale automation runs, merged branches, stale draft PRs, and production/main parity.',
    'POST',
    '/admin/repository-automation/hygiene-scan',
    NULL,
    '{"type":"object","properties":{"owner":{"type":"string"},"repo":{"type":"string"},"default_branch":{"type":"string","default":"main"},"include_github":{"type":"boolean","default":true},"stale_hours":{"type":"integer","minimum":1,"maximum":720,"default":24},"stale_draft_days":{"type":"integer","minimum":1,"maximum":365,"default":7}},"additionalProperties":false}',
    NULL,
    'admin,repository,automation,hygiene,diagnostics,read_only,no_mutation,no_external_write,no_secrets',
    1,1453,NOW(),CURRENT_TIMESTAMP
  )
ON DUPLICATE KEY UPDATE
  `display_name`=VALUES(`display_name`),
  `description`=VALUES(`description`),
  `http_method`=VALUES(`http_method`),
  `http_path`=VALUES(`http_path`),
  `path_param_keys`=VALUES(`path_param_keys`),
  `input_schema`=VALUES(`input_schema`),
  `fixed_body`=VALUES(`fixed_body`),
  `tags`=VALUES(`tags`),
  `is_enabled`=1,
  `sort_order`=VALUES(`sort_order`),
  `updated_at`=CURRENT_TIMESTAMP;
