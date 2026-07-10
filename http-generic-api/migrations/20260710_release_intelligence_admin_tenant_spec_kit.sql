-- Release Intelligence ADMIN/TENANT vertical slice.
-- Safety contract: internal SQL registry only, no provider call, no runtime deploy, no credential payload read, no secret response.

CREATE TABLE IF NOT EXISTS release_operations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id VARCHAR(64) NOT NULL,
  scope_type ENUM('admin','tenant') NOT NULL DEFAULT 'tenant',
  tenant_id VARCHAR(64) NULL,
  workspace_id VARCHAR(64) NULL,
  user_id VARCHAR(64) NULL,
  target_id VARCHAR(128) NULL,
  runtime_family VARCHAR(64) NOT NULL DEFAULT 'unknown',
  operation_type VARCHAR(64) NOT NULL DEFAULT 'runtime_parity_recovery',
  expected_commit_sha CHAR(40) NULL,
  deployed_commit_sha CHAR(40) NULL,
  status VARCHAR(64) NOT NULL DEFAULT 'draft',
  classification VARCHAR(96) NOT NULL DEFAULT 'draft',
  capability_envelope_id VARCHAR(64) NULL,
  approval_hold_id VARCHAR(64) NULL,
  latest_verification_run_id VARCHAR(64) NULL,
  evidence_summary_json JSON NULL,
  created_by VARCHAR(191) NULL,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_release_operations_operation_id (operation_id),
  KEY idx_release_operations_scope_tenant (scope_type, tenant_id, updated_at),
  KEY idx_release_operations_target (target_id, runtime_family),
  KEY idx_release_operations_status (status, classification)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS release_operation_steps (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  step_id VARCHAR(64) NOT NULL,
  operation_id VARCHAR(64) NOT NULL,
  step_key VARCHAR(128) NOT NULL,
  step_status VARCHAR(64) NOT NULL,
  classification VARCHAR(96) NOT NULL,
  detail_json JSON NULL,
  created_by VARCHAR(191) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_release_operation_steps_step_id (step_id),
  KEY idx_release_operation_steps_operation (operation_id, id),
  CONSTRAINT fk_release_operation_steps_operation FOREIGN KEY (operation_id) REFERENCES release_operations (operation_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS release_gate_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  gate_event_id VARCHAR(64) NOT NULL,
  operation_id VARCHAR(64) NOT NULL,
  gate_key VARCHAR(128) NOT NULL,
  action ENUM('open','close','expire','hard_disable','request_open','request_close') NOT NULL,
  ttl_minutes INT UNSIGNED NULL,
  reason VARCHAR(1000) NULL,
  capability_envelope_id VARCHAR(64) NULL,
  verification_run_id VARCHAR(64) NULL,
  status VARCHAR(64) NOT NULL DEFAULT 'recorded',
  readback_status VARCHAR(64) NOT NULL DEFAULT 'pending',
  created_by VARCHAR(191) NULL,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_release_gate_events_event_id (gate_event_id),
  KEY idx_release_gate_events_operation (operation_id, id),
  KEY idx_release_gate_events_gate_status (gate_key, status),
  CONSTRAINT fk_release_gate_events_operation FOREIGN KEY (operation_id) REFERENCES release_operations (operation_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS release_operation_evidence (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  evidence_id VARCHAR(64) NOT NULL,
  operation_id VARCHAR(64) NOT NULL,
  surface_key VARCHAR(128) NOT NULL,
  evidence_type VARCHAR(64) NOT NULL DEFAULT 'inline_preview',
  evidence_sha256 CHAR(64) NOT NULL,
  payload_preview_json JSON NULL,
  payload_ref VARCHAR(512) NULL,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_release_operation_evidence_id (evidence_id),
  KEY idx_release_operation_evidence_operation (operation_id, id),
  CONSTRAINT fk_release_operation_evidence_operation FOREIGN KEY (operation_id) REFERENCES release_operations (operation_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS capability_envelope_templates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  template_key VARCHAR(191) NOT NULL,
  scope_type ENUM('admin','tenant','mixed') NOT NULL DEFAULT 'mixed',
  operation_type VARCHAR(64) NOT NULL,
  runtime_family VARCHAR(64) NOT NULL,
  app_key VARCHAR(128) NOT NULL,
  capability_key VARCHAR(191) NOT NULL,
  operation_intent VARCHAR(128) NOT NULL,
  runtime_surface VARCHAR(191) NOT NULL,
  source_tier_strategy VARCHAR(96) NOT NULL,
  tenant_strategy VARCHAR(96) NOT NULL,
  workspace_strategy VARCHAR(96) NOT NULL,
  approval_required TINYINT(1) NOT NULL DEFAULT 1,
  readback_required TINYINT(1) NOT NULL DEFAULT 1,
  risk_class VARCHAR(64) NOT NULL DEFAULT 'high',
  status VARCHAR(64) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_capability_envelope_templates_key (template_key),
  KEY idx_capability_envelope_templates_lookup (operation_type, runtime_family, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO capability_envelope_templates (template_key, scope_type, operation_type, runtime_family, app_key, capability_key, operation_intent, runtime_surface, source_tier_strategy, tenant_strategy, workspace_strategy, approval_required, readback_required, risk_class, status)
VALUES
  ('hostinger.deploy_release.admin_tenant.v1', 'mixed', 'deploy_release', 'hostinger_ssh', 'hostinger', 'remote_runtime_hostinger_deploy_release', 'deploy', 'remote_runtime_hostinger_deploy_release', 'tenant_managed', 'target_owner', 'target_workspace', 1, 1, 'critical', 'active'),
  ('release.operation.ledger.v1', 'mixed', 'advisory', 'internal_ledger', 'platform_orchestration', 'release_intelligence_operation', 'release_intelligence_operation', 'release_intelligence', 'platform_managed_fallback', 'request_scope', 'request_scope', 0, 1, 'low', 'active')
ON DUPLICATE KEY UPDATE scope_type = VALUES(scope_type), operation_type = VALUES(operation_type), runtime_family = VALUES(runtime_family), app_key = VALUES(app_key), capability_key = VALUES(capability_key), operation_intent = VALUES(operation_intent), runtime_surface = VALUES(runtime_surface), source_tier_strategy = VALUES(source_tier_strategy), tenant_strategy = VALUES(tenant_strategy), workspace_strategy = VALUES(workspace_strategy), approval_required = VALUES(approval_required), readback_required = VALUES(readback_required), risk_class = VALUES(risk_class), status = VALUES(status), updated_at = CURRENT_TIMESTAMP;
