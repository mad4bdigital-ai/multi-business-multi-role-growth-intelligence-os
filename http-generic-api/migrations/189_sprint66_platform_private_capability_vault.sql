-- Sprint 66: Platform Private Capability Vault foundation.
--
-- Adds governed registries for private mirrors, sanitized packages,
-- diff-aware reinstalls, scoped variants, and Google Workspace source
-- resolution decisions. This migration is declarative and idempotent.
-- It does not execute source assets, mutate tenant installs, or run live reads.
--
-- Idempotent. No DELETE/TRUNCATE/DROP.


CREATE TABLE IF NOT EXISTS repo_source_registry (
  repo_source_id VARCHAR(36) NOT NULL PRIMARY KEY,
  owner VARCHAR(191) NOT NULL,
  repo VARCHAR(191) NOT NULL,
  full_name VARCHAR(255) NOT NULL UNIQUE,
  html_url VARCHAR(500) NULL,
  is_fork TINYINT(1) NOT NULL DEFAULT 0,
  parent_full_name VARCHAR(255) NULL,
  source_full_name VARCHAR(255) NULL,
  default_branch VARCHAR(191) NULL,
  pinned_commit_sha VARCHAR(64) NULL,
  license_spdx VARCHAR(64) NULL,
  primary_language VARCHAR(128) NULL,
  description TEXT NULL,
  parent_stars INT NULL,
  parent_forks INT NULL,
  repo_size_kb BIGINT NULL,
  source_status ENUM('discovered','indexed','mirrored','blocked','archived') NOT NULL DEFAULT 'discovered',
  risk_class ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_repo_source_status (source_status, risk_class),
  KEY idx_repo_source_parent (parent_full_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS repo_ingestion_jobs (
  job_id VARCHAR(36) NOT NULL PRIMARY KEY,
  repo_source_id VARCHAR(36) NULL,
  source_repo_full_name VARCHAR(255) NOT NULL,
  requested_by VARCHAR(191) NULL,
  request_scope_type ENUM('platform','tenant','brand','user') NOT NULL DEFAULT 'platform',
  request_scope_id VARCHAR(191) NULL,
  ingestion_mode ENUM('preview','index','import','certify','install') NOT NULL DEFAULT 'preview',
  status ENUM('planned','running','succeeded','failed','blocked') NOT NULL DEFAULT 'planned',
  result_json JSON NULL,
  error_code VARCHAR(191) NULL,
  error_message TEXT NULL,
  execution_log_id VARCHAR(64) NULL,
  started_at DATETIME NULL,
  finished_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_repo_ingestion_scope (request_scope_type, request_scope_id, created_at),
  KEY idx_repo_ingestion_status (status, ingestion_mode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS repo_snapshots (
  snapshot_id VARCHAR(36) NOT NULL PRIMARY KEY,
  repo_source_id VARCHAR(36) NULL,
  source_repo_full_name VARCHAR(255) NOT NULL,
  commit_sha VARCHAR(64) NOT NULL,
  tree_sha VARCHAR(128) NULL,
  branch_name VARCHAR(191) NULL,
  snapshot_status ENUM('planned','fetched','classified','failed','blocked') NOT NULL DEFAULT 'planned',
  fetched_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_repo_snapshot_commit (source_repo_full_name, commit_sha),
  KEY idx_repo_snapshots_status (snapshot_status, fetched_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS repo_snapshot_files (
  snapshot_file_id VARCHAR(36) NOT NULL PRIMARY KEY,
  snapshot_id VARCHAR(36) NOT NULL,
  path VARCHAR(500) NOT NULL,
  blob_sha VARCHAR(128) NULL,
  size_bytes BIGINT NULL,
  file_role VARCHAR(80) NULL,
  raw_content_hash VARCHAR(128) NULL,
  normalized_content_hash VARCHAR(128) NULL,
  risk_flags_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_repo_snapshot_file_path (snapshot_id, path),
  KEY idx_repo_snapshot_files_role (file_role),
  KEY idx_repo_snapshot_files_hash (normalized_content_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS repo_candidate_assets (
  candidate_id VARCHAR(36) NOT NULL PRIMARY KEY,
  repo_source_id VARCHAR(36) NULL,
  snapshot_file_id VARCHAR(36) NULL,
  candidate_type ENUM('skill','tool','connector','workflow','knowledge','eval','runtime','catalog','unknown') NOT NULL DEFAULT 'unknown',
  candidate_key VARCHAR(191) NULL,
  display_name VARCHAR(255) NULL,
  summary TEXT NULL,
  normalized_manifest_json JSON NULL,
  confidence_score DECIMAL(6,5) NULL,
  risk_class ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  status ENUM('candidate','accepted','rejected','blocked','promoted') NOT NULL DEFAULT 'candidate',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_repo_candidates_type (candidate_type, status, risk_class),
  KEY idx_repo_candidates_key (candidate_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS repo_skill_candidates (
  skill_candidate_id VARCHAR(36) NOT NULL PRIMARY KEY,
  repo_source_id VARCHAR(36) NULL,
  snapshot_file_id VARCHAR(36) NULL,
  skill_key_suggested VARCHAR(191) NOT NULL,
  skill_family VARCHAR(191) NULL,
  skill_type VARCHAR(80) NULL,
  source_path VARCHAR(500) NOT NULL,
  references_json JSON NULL,
  evals_json JSON NULL,
  required_tools_json JSON NULL,
  forbidden_tools_json JSON NULL,
  policy_json JSON NULL,
  prompt_template MEDIUMTEXT NULL,
  import_status ENUM('candidate','import_allowed','requires_recognition_review','blocked','imported') NOT NULL DEFAULT 'candidate',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_repo_skill_candidates_key (skill_key_suggested, import_status),
  KEY idx_repo_skill_candidates_repo (repo_source_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS repo_capability_candidates (
  capability_candidate_id VARCHAR(36) NOT NULL PRIMARY KEY,
  repo_source_id VARCHAR(36) NULL,
  candidate_type ENUM('tool','adapter','runtime','connector','engine','workflow','unknown') NOT NULL DEFAULT 'unknown',
  capability_key_suggested VARCHAR(191) NULL,
  runtime_language VARCHAR(128) NULL,
  install_method_detected VARCHAR(191) NULL,
  requires_code_execution TINYINT(1) NOT NULL DEFAULT 0,
  requires_network TINYINT(1) NOT NULL DEFAULT 0,
  requires_credentials TINYINT(1) NOT NULL DEFAULT 0,
  requires_filesystem TINYINT(1) NOT NULL DEFAULT 0,
  requires_shell TINYINT(1) NOT NULL DEFAULT 0,
  risk_class ENUM('low','medium','high','critical') NOT NULL DEFAULT 'high',
  sandbox_status ENUM('not_required','required','passed','failed','blocked') NOT NULL DEFAULT 'required',
  certification_status ENUM('not_required','required','certified','failed','blocked') NOT NULL DEFAULT 'required',
  status ENUM('candidate','sandbox_only','accepted','rejected','blocked','promoted') NOT NULL DEFAULT 'candidate',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_repo_capability_candidates_status (status, risk_class, certification_status),
  KEY idx_repo_capability_candidates_key (capability_key_suggested)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS repo_install_requests (
  install_request_id VARCHAR(36) NOT NULL PRIMARY KEY,
  tenant_id VARCHAR(64) NULL,
  brand_key VARCHAR(191) NULL,
  user_id VARCHAR(191) NULL,
  repo_source_id VARCHAR(36) NULL,
  package_id VARCHAR(36) NULL,
  candidate_id VARCHAR(36) NULL,
  requested_install_mode ENUM('auto','index_only','private_skill_import','knowledge_asset_import','tool_candidate_private','runtime_candidate_sandbox','restricted_quarantine') NOT NULL DEFAULT 'auto',
  resolved_install_mode VARCHAR(80) NULL,
  status ENUM('planned','approved','applied','denied','blocked','cancelled') NOT NULL DEFAULT 'planned',
  approval_required TINYINT(1) NOT NULL DEFAULT 1,
  approved_by VARCHAR(191) NULL,
  approved_at DATETIME NULL,
  execution_log_id VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_repo_install_requests_scope (tenant_id, brand_key, user_id, created_at),
  KEY idx_repo_install_requests_status (status, approval_required)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS repo_certification_runs (
  certification_run_id VARCHAR(36) NOT NULL PRIMARY KEY,
  repo_source_id VARCHAR(36) NULL,
  package_id VARCHAR(36) NULL,
  candidate_id VARCHAR(36) NULL,
  certification_type ENUM('manifest','eval','security','sandbox','license','supply_chain','provider') NOT NULL,
  status ENUM('planned','running','passed','failed','blocked') NOT NULL DEFAULT 'planned',
  score DECIMAL(7,4) NULL,
  findings_json JSON NULL,
  blocked_reasons_json JSON NULL,
  execution_log_id VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_repo_certification_status (status, certification_type),
  KEY idx_repo_certification_candidate (package_id, candidate_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS platform_private_repo_mirrors (
  mirror_id VARCHAR(36) NOT NULL PRIMARY KEY,
  source_repo_full_name VARCHAR(255) NOT NULL,
  platform_repo_full_name VARCHAR(255) NULL,
  storage_ref VARCHAR(500) NULL,
  source_commit_sha VARCHAR(64) NOT NULL,
  mirror_commit_sha VARCHAR(64) NULL,
  license_spdx VARCHAR(64) NULL,
  mirror_status ENUM('planned','mirrored','failed','archived') NOT NULL DEFAULT 'planned',
  risk_class ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  immutable_raw_mirror TINYINT(1) NOT NULL DEFAULT 1,
  executed_by_runtime TINYINT(1) NOT NULL DEFAULT 0,
  evidence_manifest_json JSON NULL,
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_ppcv_mirrors_source (source_repo_full_name, source_commit_sha),
  KEY idx_ppcv_mirrors_status (mirror_status, risk_class)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_private_packages (
  package_id VARCHAR(36) NOT NULL PRIMARY KEY,
  package_key VARCHAR(191) NOT NULL UNIQUE,
  package_type ENUM('skill_pack','knowledge_pack','tool_candidate','runtime_candidate') NOT NULL DEFAULT 'skill_pack',
  source_mirror_id VARCHAR(36) NULL,
  source_commit_sha VARCHAR(64) NULL,
  normalized_manifest_json JSON NULL,
  safe_asset_manifest_json JSON NULL,
  blocked_asset_manifest_json JSON NULL,
  version VARCHAR(64) NOT NULL DEFAULT 'v1',
  risk_class ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  status ENUM('planned','active','disabled','archived') NOT NULL DEFAULT 'planned',
  certification_status ENUM('not_required','requires_recognition_review','certification_ready','certified','blocked') NOT NULL DEFAULT 'requires_recognition_review',
  requires_code_execution TINYINT(1) NOT NULL DEFAULT 0,
  secrets_required TINYINT(1) NOT NULL DEFAULT 0,
  auto_install_allowed TINYINT(1) NOT NULL DEFAULT 0,
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_ppcv_packages_source (source_mirror_id, source_commit_sha),
  KEY idx_ppcv_packages_type_status (package_type, status, certification_status),
  KEY idx_ppcv_packages_risk (risk_class, auto_install_allowed)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_private_package_assets (
  asset_id VARCHAR(36) NOT NULL PRIMARY KEY,
  package_id VARCHAR(36) NOT NULL,
  source_path VARCHAR(500) NOT NULL,
  normalized_path VARCHAR(500) NOT NULL,
  asset_type ENUM('skill','reference','eval','manifest','documentation','license','security','manifest_candidate','blocked_runtime_asset','blocked_script','blocked_workflow','unknown') NOT NULL DEFAULT 'unknown',
  blob_sha VARCHAR(128) NULL,
  normalized_hash VARCHAR(128) NULL,
  semantic_fingerprint VARCHAR(128) NULL,
  size_bytes BIGINT NULL,
  risk_flags_json JSON NULL,
  import_status ENUM('import_allowed','requires_recognition_review','blocked_evidence_only') NOT NULL DEFAULT 'requires_recognition_review',
  runtime_import_allowed TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ppcv_asset_package_path (package_id, normalized_path),
  KEY idx_ppcv_assets_status (import_status, runtime_import_allowed),
  KEY idx_ppcv_assets_hash (normalized_hash, semantic_fingerprint)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_package_versions (
  package_version_id VARCHAR(36) NOT NULL PRIMARY KEY,
  package_id VARCHAR(36) NOT NULL,
  version VARCHAR(64) NOT NULL,
  source_commit_sha VARCHAR(64) NULL,
  tree_sha VARCHAR(128) NULL,
  normalized_manifest_hash VARCHAR(128) NULL,
  asset_manifest_hash VARCHAR(128) NULL,
  certification_status ENUM('not_required','requires_recognition_review','certification_ready','certified','blocked') NOT NULL DEFAULT 'requires_recognition_review',
  status ENUM('planned','active','superseded','disabled','archived') NOT NULL DEFAULT 'planned',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ppcv_package_version (package_id, version),
  KEY idx_ppcv_package_versions_status (status, certification_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS repo_install_diff_runs (
  diff_run_id VARCHAR(36) NOT NULL PRIMARY KEY,
  package_key VARCHAR(191) NOT NULL,
  tenant_id VARCHAR(64) NULL,
  current_version VARCHAR(64) NULL,
  incoming_version VARCHAR(64) NULL,
  decision ENUM('no_op','metadata_refresh_only','new_assets_available','safe_patch_available','breaking_upgrade_available','duplicate_detected','conflict_detected','blocked_by_policy','requires_recognition_review','requires_certification') NOT NULL DEFAULT 'requires_recognition_review',
  plan_json JSON NULL,
  tenant_overrides_preserved TINYINT(1) NOT NULL DEFAULT 1,
  will_duplicate_install TINYINT(1) NOT NULL DEFAULT 0,
  dry_run TINYINT(1) NOT NULL DEFAULT 1,
  actor_id VARCHAR(191) NULL,
  trace_id VARCHAR(191) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ppcv_diff_runs_package (package_key, created_at),
  KEY idx_ppcv_diff_runs_tenant (tenant_id, created_at),
  KEY idx_ppcv_diff_runs_decision (decision)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS repo_install_diff_items (
  diff_item_id VARCHAR(36) NOT NULL PRIMARY KEY,
  diff_run_id VARCHAR(36) NOT NULL,
  source_path VARCHAR(500) NOT NULL,
  asset_type VARCHAR(64) NULL,
  previous_hash VARCHAR(128) NULL,
  incoming_hash VARCHAR(128) NULL,
  decision ENUM('no_op','metadata_refresh_only','new_assets_available','safe_patch_available','breaking_upgrade_available','duplicate_detected','conflict_detected','blocked_by_policy','requires_recognition_review','requires_certification') NOT NULL DEFAULT 'requires_recognition_review',
  preserves_tenant_overrides TINYINT(1) NOT NULL DEFAULT 1,
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ppcv_diff_items_run (diff_run_id),
  KEY idx_ppcv_diff_items_decision (decision)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS asset_equivalence_groups (
  equivalence_group_id VARCHAR(36) NOT NULL PRIMARY KEY,
  canonical_asset_key VARCHAR(191) NOT NULL,
  asset_type VARCHAR(64) NOT NULL,
  normalized_hash VARCHAR(128) NULL,
  semantic_fingerprint VARCHAR(128) NULL,
  task_class VARCHAR(191) NULL,
  risk_profile_json JSON NULL,
  status ENUM('planned','active','disabled','archived') NOT NULL DEFAULT 'planned',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_ppcv_equivalence_canonical (canonical_asset_key, asset_type),
  KEY idx_ppcv_equivalence_hash (normalized_hash, semantic_fingerprint)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS asset_equivalence_members (
  member_id VARCHAR(36) NOT NULL PRIMARY KEY,
  equivalence_group_id VARCHAR(36) NOT NULL,
  package_id VARCHAR(36) NOT NULL,
  asset_id VARCHAR(36) NOT NULL,
  similarity_score DECIMAL(6,5) NULL,
  membership_status ENUM('candidate','confirmed','rejected') NOT NULL DEFAULT 'candidate',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ppcv_equivalence_members_group (equivalence_group_id, membership_status),
  KEY idx_ppcv_equivalence_members_asset (package_id, asset_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tenant_package_installs (
  install_id VARCHAR(36) NOT NULL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  package_id VARCHAR(36) NOT NULL,
  package_version_id VARCHAR(36) NULL,
  enabled_scopes_json JSON NULL,
  brand_bindings_json JSON NULL,
  agent_grants_json JSON NULL,
  policy_overrides_json JSON NULL,
  install_status ENUM('planned','active','disabled','removed','blocked') NOT NULL DEFAULT 'planned',
  approval_status ENUM('not_required','required','granted','denied') NOT NULL DEFAULT 'not_required',
  disabled_assets_json JSON NULL,
  thresholds_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ppcv_tenant_install (tenant_id, package_id),
  KEY idx_ppcv_tenant_installs_status (install_status, approval_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_package_variants (
  variant_id VARCHAR(36) NOT NULL PRIMARY KEY,
  package_id VARCHAR(36) NOT NULL,
  base_package_version_id VARCHAR(36) NOT NULL,
  scope_type ENUM('platform','tenant','brand','business_type','user') NOT NULL,
  scope_id VARCHAR(191) NOT NULL,
  variant_key VARCHAR(191) NOT NULL,
  display_name VARCHAR(255) NULL,
  variant_status ENUM('draft','active','disabled','archived') NOT NULL DEFAULT 'draft',
  created_by VARCHAR(191) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ppcv_variant_scope (package_id, scope_type, scope_id, variant_key),
  KEY idx_ppcv_variants_status (variant_status, scope_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_package_variant_patches (
  patch_id VARCHAR(36) NOT NULL PRIMARY KEY,
  variant_id VARCHAR(36) NOT NULL,
  target_asset_type ENUM('skill','reference','eval','policy','prompt','tool_binding','permission_change','runtime_change') NOT NULL,
  target_asset_key VARCHAR(191) NOT NULL,
  patch_type ENUM('override','append','remove','disable','reorder','policy_change') NOT NULL,
  patch_json JSON NOT NULL,
  risk_class ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  approval_status ENUM('not_required','required','granted','denied') NOT NULL DEFAULT 'not_required',
  certification_status ENUM('not_required','light_eval_required','required','certified','blocked') NOT NULL DEFAULT 'not_required',
  created_by VARCHAR(191) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ppcv_variant_patches_variant (variant_id),
  KEY idx_ppcv_variant_patches_gate (risk_class, approval_status, certification_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_package_variant_assets (
  variant_asset_id VARCHAR(36) NOT NULL PRIMARY KEY,
  variant_id VARCHAR(36) NOT NULL,
  asset_type ENUM('skill','reference','eval','template','policy') NOT NULL,
  asset_key VARCHAR(191) NOT NULL,
  content_json JSON NOT NULL,
  content_hash VARCHAR(128) NOT NULL,
  source ENUM('user_created','gpt_generated','imported','edited') NOT NULL DEFAULT 'user_created',
  status ENUM('draft','active','disabled','archived') NOT NULL DEFAULT 'draft',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ppcv_variant_asset (variant_id, asset_type, asset_key),
  KEY idx_ppcv_variant_assets_status (status, source)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_variant_edit_sessions (
  edit_session_id VARCHAR(36) NOT NULL PRIMARY KEY,
  tenant_id VARCHAR(64) NULL,
  brand_key VARCHAR(191) NULL,
  user_id VARCHAR(191) NULL,
  package_id VARCHAR(36) NOT NULL,
  variant_id VARCHAR(36) NULL,
  edit_source ENUM('direct_user_request','gpt_suggestion','task_context') NOT NULL,
  status ENUM('proposed','accepted','rejected','applied') NOT NULL DEFAULT 'proposed',
  proposal_json JSON NULL,
  diff_summary_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_ppcv_edit_sessions_scope (tenant_id, brand_key, user_id, created_at),
  KEY idx_ppcv_edit_sessions_status (status, edit_source)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_variant_merge_runs (
  merge_run_id VARCHAR(36) NOT NULL PRIMARY KEY,
  variant_id VARCHAR(36) NOT NULL,
  old_base_version_id VARCHAR(36) NOT NULL,
  new_base_version_id VARCHAR(36) NOT NULL,
  merge_status ENUM('planned','auto_merged','conflicts','blocked','applied') NOT NULL DEFAULT 'planned',
  auto_merged_count INT NOT NULL DEFAULT 0,
  conflict_count INT NOT NULL DEFAULT 0,
  blocked_count INT NOT NULL DEFAULT 0,
  merge_plan_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ppcv_variant_merge_variant (variant_id, created_at),
  KEY idx_ppcv_variant_merge_status (merge_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_capability_source_resolutions (
  resolution_id VARCHAR(36) NOT NULL PRIMARY KEY,
  source_type ENUM('google_workspace_file','github_repo','private_repo_mirror','manual_upload') NOT NULL,
  source_ref VARCHAR(500) NOT NULL,
  detected_product VARCHAR(64) NULL,
  mime_type VARCHAR(255) NULL,
  read_strategy VARCHAR(191) NULL,
  fallback_strategy VARCHAR(191) NULL,
  supports_all_drives TINYINT(1) NOT NULL DEFAULT 1,
  web_url_fetch_allowed TINYINT(1) NOT NULL DEFAULT 0,
  resolution_json JSON NULL,
  status ENUM('planned','resolved','blocked','failed') NOT NULL DEFAULT 'planned',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ppcv_source_resolutions_source (source_type, source_ref),
  KEY idx_ppcv_source_resolutions_status (status, detected_product)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO platform_engine_registry
  (engine_key, display_name, engine_type, runtime_key, supported_task_classes_json, capabilities_json, default_policy_key, status, notes)
VALUES
  (
    'platform_private_capability_vault_engine',
    'Platform Private Capability Vault Engine',
    'runtime_readiness',
    'platform_private_capability_vault_v1',
    '["mirror_plan","package_plan","reinstall_diff_plan","variant_plan","runtime_resolve","google_file_read_resolve"]',
    '{"raw_mirror_never_executed":true,"blocked_assets_evidence_only":true,"reinstall_idempotent":true,"variant_layers_policy_narrow_only":true,"google_supports_all_drives_default":true}',
    'platform_private_capability_vault_policy_v1',
    'active',
    'Governed intake and runtime-resolution layer for private capability sources, packages, variants, and source adapters.'
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
  (policy_key, engine_key, scope_type, mode, risk_default, approval_required_min_risk,
   require_scope_guard, require_audit, require_validators, validators_json,
   blocked_resource_patterns_json, status, notes)
VALUES
  (
    'platform_private_capability_vault_policy_v1',
    'platform_private_capability_vault_engine',
    'global',
    'dry_run',
    'medium',
    'high',
    1,
    1,
    1,
    '["node test-platform-private-capability-vault.mjs"]',
    '["hooks/**","scripts/**",".github/workflows/**",".mcp.json","Dockerfile","docker-compose.*","**/*.exe","**/*.sh"]',
    'active',
    'Private capability intake is dry-run first. Raw mirrors are never executed, blocked assets remain evidence only, and tenant variants cannot expand upper policy.'
  )
ON DUPLICATE KEY UPDATE
  engine_key = VALUES(engine_key),
  scope_type = VALUES(scope_type),
  mode = VALUES(mode),
  risk_default = VALUES(risk_default),
  approval_required_min_risk = VALUES(approval_required_min_risk),
  require_scope_guard = VALUES(require_scope_guard),
  require_audit = VALUES(require_audit),
  require_validators = VALUES(require_validators),
  validators_json = VALUES(validators_json),
  blocked_resource_patterns_json = VALUES(blocked_resource_patterns_json),
  status = VALUES(status),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
  (
    'platform_capability_vault_package_plan',
    'Platform Capability Vault Package Plan',
    'Build a dry-run sanitization plan for private capability source assets. It classifies safe runtime assets and blocked evidence-only assets without installing or executing anything.',
    'POST',
    '/platform/capability-vault/package-plan',
    '[]',
    '{"type":"object","additionalProperties":true,"required":["package_key","files"],"properties":{"package_key":{"type":"string"},"package_type":{"type":"string","enum":["skill_pack","knowledge_pack","tool_candidate","runtime_candidate"],"default":"skill_pack"},"source_mirror_id":{"type":"string"},"source_commit_sha":{"type":"string"},"license_spdx":{"type":"string"},"files":{"type":"array","items":{"type":"object","additionalProperties":true}}}}',
    NULL,
    'admin,capability-vault,package-plan,dry_run,no_execution,no_install,no_secret_read',
    1,
    4320
  ),
  (
    'platform_capability_vault_reinstall_diff_plan',
    'Platform Capability Vault Reinstall Diff Plan',
    'Build an idempotent reinstall/upgrade plan that preserves tenant overrides, brand bindings, agent grants, disabled skills, thresholds, and approval states.',
    'POST',
    '/platform/capability-vault/reinstall-diff-plan',
    '[]',
    '{"type":"object","additionalProperties":true,"required":["package_key"],"properties":{"package_key":{"type":"string"},"tenant_id":{"type":"string"},"current_version":{"type":"string"},"incoming_version":{"type":"string"},"existing_assets":{"type":"array","items":{"type":"object","additionalProperties":true}},"incoming_assets":{"type":"array","items":{"type":"object","additionalProperties":true}}}}',
    NULL,
    'admin,capability-vault,reinstall,diff,dry_run,no_duplicate_install,preserve_overrides',
    1,
    4321
  ),
  (
    'platform_capability_vault_google_file_read_resolve',
    'Platform Capability Vault Google File Read Resolve',
    'Resolve a Google Workspace file URL or fileId into a bounded governed read strategy. This does not fetch web URLs, execute reads, or return file content.',
    'POST',
    '/platform/capability-vault/google-file-read/resolve',
    '[]',
    '{"type":"object","additionalProperties":true,"properties":{"url":{"type":"string"},"file_id":{"type":"string"},"metadata":{"type":"object","additionalProperties":true},"mime_type":{"type":"string"},"title":{"type":"string"},"drive_jsonl_id":{"type":"string"},"session_jsonl_candidate":{"type":"boolean"}}}',
    NULL,
    'admin,capability-vault,google-drive,resolve,dry_run,supportsAllDrives,no_web_fetch,no_secret_read',
    1,
    4322
  )
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  http_method = VALUES(http_method),
  http_path = VALUES(http_path),
  path_param_keys = VALUES(path_param_keys),
  input_schema = VALUES(input_schema),
  fixed_body = VALUES(fixed_body),
  tags = VALUES(tags),
  is_enabled = VALUES(is_enabled),
  sort_order = VALUES(sort_order);



INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
  (
    'platform_capability_vault_package_list',
    'Platform Capability Vault Package List',
    'List private capability vault packages. Read-only registry surface; no install, provider read, or execution.',
    'GET',
    '/platform/capability-vault/packages',
    '[]',
    '{"type":"object","additionalProperties":true,"properties":{"status":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":250}}}',
    NULL,
    'admin,capability-vault,packages,read_only,no_execution',
    1,
    4317
  ),
  (
    'platform_capability_vault_repo_ingestion_plan',
    'Platform Capability Vault Repo Ingestion Plan',
    'Build a dry-run repo ingestion plan: classify a pinned repo snapshot into catalog, knowledge, skill, tool, runtime, restricted, or quarantine lanes.',
    'POST',
    '/platform/capability-vault/repo-ingestion-plan',
    '[]',
    '{"type":"object","additionalProperties":true,"required":["source_repo_full_name","source_commit_sha","files"],"properties":{"source_repo_full_name":{"type":"string"},"source_commit_sha":{"type":"string"},"parent_repo_full_name":{"type":"string"},"license_spdx":{"type":"string"},"description":{"type":"string"},"files":{"type":"array","items":{"type":"object","additionalProperties":true}}}}',
    NULL,
    'admin,capability-vault,repo-ingestion,dry_run,classify,no_execution,no_install',
    1,
    4318
  ),
  (
    'platform_capability_vault_mirror_plan',
    'Platform Capability Vault Mirror Plan',
    'Build a dry-run immutable private repo mirror plan. The raw mirror is evidence only and is never executed.',
    'POST',
    '/platform/capability-vault/mirror-plan',
    '[]',
    '{"type":"object","additionalProperties":true,"required":["source_repo_full_name","source_commit_sha"],"properties":{"source_repo_full_name":{"type":"string"},"source_commit_sha":{"type":"string"},"mirror_id":{"type":"string"}}}',
    NULL,
    'admin,capability-vault,mirror,dry_run,evidence_only,no_execution',
    1,
    4319
  ),
  (
    'platform_capability_vault_variant_plan',
    'Platform Capability Vault Variant Plan',
    'Plan scoped package variant patches for tenant, brand, business type, user, or platform variants. Lower layers cannot expand upper policy.',
    'POST',
    '/platform/capability-vault/variant-plan',
    '[]',
    '{"type":"object","additionalProperties":true,"required":["package_id","variant_key","scope_type","scope_id","patches"],"properties":{"package_id":{"type":"string"},"base_package_version_id":{"type":"string"},"scope_type":{"type":"string"},"scope_id":{"type":"string"},"variant_key":{"type":"string"},"patches":{"type":"array","items":{"type":"object","additionalProperties":true}}}}',
    NULL,
    'admin,capability-vault,variant,patch,dry_run,approval_gate',
    1,
    4323
  ),
  (
    'platform_capability_vault_install_request_plan',
    'Platform Capability Vault Install Request Plan',
    'Plan tenant, brand, or user installation from an already sanitized package. It does not write installs or grants.',
    'POST',
    '/platform/capability-vault/install-request-plan',
    '[]',
    '{"type":"object","additionalProperties":true,"required":["package_key"],"properties":{"package_key":{"type":"string"},"tenant_id":{"type":"string"},"brand_key":{"type":"string"},"user_id":{"type":"string"},"scope_type":{"type":"string"},"requested_install_mode":{"type":"string"},"package_plan":{"type":"object","additionalProperties":true}}}',
    NULL,
    'admin,capability-vault,install-request,dry_run,no_write,no_grant_reset',
    1,
    4324
  ),
  (
    'platform_capability_vault_variant_merge_plan',
    'Platform Capability Vault Variant Merge Plan',
    'Plan a three-way merge of tenant, brand, user, or task-context variant patches onto a newer package base version.',
    'POST',
    '/platform/capability-vault/variant-merge-plan',
    '[]',
    '{"type":"object","additionalProperties":true,"required":["variant_id","old_base_version_id","new_base_version_id"],"properties":{"variant_id":{"type":"string"},"old_base_version_id":{"type":"string"},"new_base_version_id":{"type":"string"},"variant_patches":{"type":"array","items":{"type":"object","additionalProperties":true}},"changed_base_assets":{"type":"array","items":{"type":"object","additionalProperties":true}}}}',
    NULL,
    'admin,capability-vault,variant-merge,dry_run,three_way_merge,preserve_patches',
    1,
    4325
  ),
  (
    'platform_capability_vault_runtime_resolve',
    'Platform Capability Vault Runtime Resolve',
    'Resolve effective package base, variants, and task overlay into a dispatch-readiness decision. It does not execute.',
    'POST',
    '/platform/capability-vault/runtime-resolve',
    '[]',
    '{"type":"object","additionalProperties":true,"required":["package_key","base_version"],"properties":{"package_key":{"type":"string"},"base_version":{"type":"string"},"variants":{"type":"array","items":{"type":"object","additionalProperties":true}},"task_overlay":{"type":"object","additionalProperties":true}}}',
    NULL,
    'admin,capability-vault,runtime-resolve,dry_run,no_execution,dispatch_gate',
    1,
    4326
  )
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  http_method = VALUES(http_method),
  http_path = VALUES(http_path),
  path_param_keys = VALUES(path_param_keys),
  input_schema = VALUES(input_schema),
  fixed_body = VALUES(fixed_body),
  tags = VALUES(tags),
  is_enabled = VALUES(is_enabled),
  sort_order = VALUES(sort_order);
