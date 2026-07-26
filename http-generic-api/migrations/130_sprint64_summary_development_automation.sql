-- Sprint 64: Summary-driven development automation foundation
--
-- Converts session-summary and summary-comparison evidence into governed
-- development signals and pending tasks. This migration intentionally does
-- not execute code, invoke coding agents, or mutate repositories.
--
-- Idempotent. No DELETE/TRUNCATE/DROP.

CREATE TABLE IF NOT EXISTS dev_agent_runtime_registry (
  runtime_key VARCHAR(191) NOT NULL PRIMARY KEY,
  display_name VARCHAR(255) NOT NULL,
  runtime_type ENUM('model_provider','local_coding_agent','browser_agent','workflow_agent') NOT NULL DEFAULT 'model_provider',
  provider_key VARCHAR(191) NOT NULL,
  execution_surface ENUM('platform_model','local_device','cloud_api','workflow_runtime') NOT NULL DEFAULT 'platform_model',
  device_id VARCHAR(191) NULL,
  endpoint_url VARCHAR(500) NULL,
  command_hint VARCHAR(500) NULL,
  supported_use_cases_json JSON NULL,
  capabilities_json JSON NULL,
  policy_json JSON NULL,
  status ENUM('planned','available','active','degraded','disabled') NOT NULL DEFAULT 'planned',
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_dev_agent_runtime_registry_status (status, runtime_type, provider_key),
  KEY idx_dev_agent_runtime_registry_device (device_id, execution_surface)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS summary_development_signals (
  signal_id VARCHAR(36) NOT NULL PRIMARY KEY,
  signal_key VARCHAR(191) NOT NULL UNIQUE,
  tenant_id VARCHAR(64) NULL,
  user_id VARCHAR(64) NULL,
  source_surface ENUM('session_summary','summary_comparison','manual','activation_context') NOT NULL DEFAULT 'session_summary',
  source_ref VARCHAR(191) NULL,
  source_summary_id VARCHAR(64) NULL,
  source_comparison_id VARCHAR(64) NULL,
  signal_type ENUM('feature_request','blocker','integration_need','quality_gap','runtime_gap','browser_need','automation_need','security_need','documentation_need') NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  evidence_text TEXT NULL,
  recommended_runtime_key VARCHAR(191) NULL,
  recommended_action ENUM('create_pending_task','create_proposal','run_local_agent_dry_run','human_review','ignore') NOT NULL DEFAULT 'human_review',
  priority ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  status ENUM('new','triaged','accepted','rejected','converted','blocked','deferred') NOT NULL DEFAULT 'new',
  policy_json JSON NULL,
  metadata_json JSON NULL,
  created_by VARCHAR(191) NULL,
  triaged_by VARCHAR(191) NULL,
  triaged_at DATETIME NULL,
  converted_task_id VARCHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_summary_development_signals_status (status, priority, signal_type, created_at),
  KEY idx_summary_development_signals_source (source_surface, source_ref),
  KEY idx_summary_development_signals_runtime (recommended_runtime_key),
  KEY idx_summary_development_signals_scope (tenant_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS summary_development_automation_runs (
  run_id VARCHAR(36) NOT NULL PRIMARY KEY,
  run_key VARCHAR(191) NOT NULL UNIQUE,
  mode ENUM('extract_signals','triage_signals','agent_dry_run','convert_tasks') NOT NULL DEFAULT 'extract_signals',
  tenant_id VARCHAR(64) NULL,
  requested_by VARCHAR(191) NULL,
  runtime_key VARCHAR(191) NULL,
  source_filter_json JSON NULL,
  policy_json JSON NULL,
  status ENUM('queued','running','completed','failed','blocked') NOT NULL DEFAULT 'queued',
  scanned_count INT NOT NULL DEFAULT 0,
  signals_created INT NOT NULL DEFAULT 0,
  signals_updated INT NOT NULL DEFAULT 0,
  tasks_created INT NOT NULL DEFAULT 0,
  error_json JSON NULL,
  result_json JSON NULL,
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_summary_development_runs_status (status, mode, created_at),
  KEY idx_summary_development_runs_runtime (runtime_key, status),
  KEY idx_summary_development_runs_tenant (tenant_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO dev_agent_runtime_registry
  (runtime_key, display_name, runtime_type, provider_key, execution_surface, device_id, endpoint_url,
   command_hint, supported_use_cases_json, capabilities_json, policy_json, status, notes)
VALUES
  (
    'platform_gemini_dev_agent_v1',
    'Platform Gemini Development Agent',
    'model_provider',
    'gemini',
    'platform_model',
    NULL,
    NULL,
    NULL,
    '["signal_triage","proposal_generation","quality_review","planning"]',
    '["reasoning","summarization","proposal_generation","classification"]',
    '{"can_execute_code":false,"can_mutate_repo":false,"requires_human_approval_for_tasks":true,"secrets_included":false}',
    'available',
    'Uses existing platform model provider resolution. Planning and triage only; no direct code execution.'
  ),
  (
    'platform_openrouter_dev_agent_v1',
    'Platform OpenRouter Development Agent',
    'model_provider',
    'openrouter',
    'platform_model',
    NULL,
    NULL,
    NULL,
    '["signal_triage","proposal_generation","quality_review","planning"]',
    '["reasoning","summarization","proposal_generation","model_fallback"]',
    '{"can_execute_code":false,"can_mutate_repo":false,"requires_human_approval_for_tasks":true,"secrets_included":false}',
    'available',
    'Uses existing OpenRouter model credentials when selected by runtime settings. Planning and triage only.'
  ),
  (
    'openclaude_essam_local_v1',
    'OpenClaude Local Coding Agent on Essam',
    'local_coding_agent',
    'openclaude',
    'local_device',
    'essam-pc',
    NULL,
    'openclaude',
    '["agent_dry_run","repo_analysis","patch_plan","local_coding_experiment"]',
    '["coding_agent_cli","provider_profiles","mcp","local_or_cloud_models","terminal_workflow"]',
    '{"can_execute_code":true,"can_mutate_repo":false,"default_mode":"dry_run","requires_human_approval_for_write":true,"requires_branch_policy":true,"secrets_included":false}',
    'planned',
    'Planned local coding-agent runtime. Must be installed and validated on Essam before activation. Use only through governed dry-run first.'
  )
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  runtime_type = VALUES(runtime_type),
  provider_key = VALUES(provider_key),
  execution_surface = VALUES(execution_surface),
  device_id = VALUES(device_id),
  endpoint_url = VALUES(endpoint_url),
  command_hint = VALUES(command_hint),
  supported_use_cases_json = VALUES(supported_use_cases_json),
  capabilities_json = VALUES(capabilities_json),
  policy_json = VALUES(policy_json),
  status = VALUES(status),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;
