-- Spec 009: Tenant Self-Healing Resolution Layer registry schema.
-- Additive/idempotent schema and seed data only.
-- Safety: no_provider_call=true; no_credential_payload_read=true; no_raw_secrets=true;
-- no_external_send=true; no_external_write=true; no_runtime_dispatch=true; secrets_included=false.

CREATE TABLE IF NOT EXISTS `tenant_resolution_playbooks` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `playbook_key` VARCHAR(191) NOT NULL,
  `root_family` VARCHAR(128) NOT NULL,
  `display_name` VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `tenant_visible` TINYINT(1) NOT NULL DEFAULT 1,
  `required_capability_key` VARCHAR(191) NULL,
  `risk_level` ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  `diagnostic_tool_key` VARCHAR(191) NULL,
  `decision_tool_key` VARCHAR(191) NULL,
  `apply_tool_key` VARCHAR(191) NULL,
  `readback_tool_key` VARCHAR(191) NULL,
  `approval_required` TINYINT(1) NOT NULL DEFAULT 0,
  `readback_required` TINYINT(1) NOT NULL DEFAULT 1,
  `status` ENUM('draft','active','disabled','retired') NOT NULL DEFAULT 'active',
  `policy_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tenant_resolution_playbooks_key` (`playbook_key`),
  KEY `idx_tenant_resolution_playbooks_family_status` (`root_family`, `status`),
  KEY `idx_tenant_resolution_playbooks_tenant_visible` (`tenant_visible`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tenant_resolution_cases` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `case_id` CHAR(36) NOT NULL,
  `tenant_id` VARCHAR(64) NOT NULL,
  `workspace_id` VARCHAR(64) NULL,
  `resource_ref` VARCHAR(512) NULL,
  `root_family` VARCHAR(128) NOT NULL,
  `playbook_key` VARCHAR(191) NOT NULL,
  `status` ENUM('detected','diagnosing','needs_connection','needs_approval','ready_to_apply','applying','verifying','resolved','deferred_by_policy','escalated','blocked_missing_authority','cancelled') NOT NULL DEFAULT 'detected',
  `severity` ENUM('info','low','medium','high','critical') NOT NULL DEFAULT 'medium',
  `root_fingerprint_sha256` CHAR(64) NOT NULL,
  `active_case_key` VARCHAR(191) NULL,
  `source_alert_keys_json` JSON NULL,
  `source_refs_json` JSON NULL,
  `impact_summary` TEXT NULL,
  `current_step_key` VARCHAR(191) NULL,
  `owner_user_id` VARCHAR(64) NULL,
  `last_diagnostic_json` JSON NULL,
  `last_preflight_json` JSON NULL,
  `approval_hold_id` VARCHAR(64) NULL,
  `capability_envelope_id` VARCHAR(64) NULL,
  `readback_status` ENUM('not_run','passed','failed','blocked','indeterminate') NOT NULL DEFAULT 'not_run',
  `readback_ref` VARCHAR(512) NULL,
  `escalation_ref` VARCHAR(512) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `closed_at` DATETIME NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tenant_resolution_cases_case_id` (`case_id`),
  UNIQUE KEY `uq_tenant_resolution_cases_active_case_key` (`active_case_key`),
  KEY `idx_tenant_resolution_cases_tenant_workspace` (`tenant_id`, `workspace_id`, `status`),
  KEY `idx_tenant_resolution_cases_family_status` (`root_family`, `status`, `updated_at`),
  KEY `idx_tenant_resolution_cases_playbook` (`playbook_key`, `status`),
  KEY `idx_tenant_resolution_cases_fingerprint` (`root_fingerprint_sha256`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tenant_resolution_case_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_id` CHAR(36) NOT NULL,
  `case_id` CHAR(36) NOT NULL,
  `event_type` VARCHAR(128) NOT NULL,
  `actor_type` VARCHAR(64) NULL,
  `actor_id` VARCHAR(64) NULL,
  `from_status` VARCHAR(64) NULL,
  `to_status` VARCHAR(64) NULL,
  `evidence_ref` VARCHAR(512) NULL,
  `event_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tenant_resolution_case_events_event_id` (`event_id`),
  KEY `idx_tenant_resolution_case_events_case_created` (`case_id`, `created_at`),
  KEY `idx_tenant_resolution_case_events_type_created` (`event_type`, `created_at`),
  CONSTRAINT `fk_tenant_resolution_case_events_case`
    FOREIGN KEY (`case_id`) REFERENCES `tenant_resolution_cases` (`case_id`)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tenant_resolution_readbacks` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `readback_id` CHAR(36) NOT NULL,
  `case_id` CHAR(36) NOT NULL,
  `playbook_key` VARCHAR(191) NOT NULL,
  `expected_state_json` JSON NULL,
  `observed_state_json` JSON NULL,
  `decision` ENUM('resolved','still_active','deferred','escalated','blocked','failed','indeterminate') NOT NULL DEFAULT 'indeterminate',
  `blocking_reasons_json` JSON NULL,
  `source_alerts_remaining_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tenant_resolution_readbacks_readback_id` (`readback_id`),
  KEY `idx_tenant_resolution_readbacks_case_created` (`case_id`, `created_at`),
  KEY `idx_tenant_resolution_readbacks_playbook_decision` (`playbook_key`, `decision`),
  CONSTRAINT `fk_tenant_resolution_readbacks_case`
    FOREIGN KEY (`case_id`) REFERENCES `tenant_resolution_cases` (`case_id`)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `tenant_resolution_playbooks` (
  `playbook_key`, `root_family`, `display_name`, `description`, `tenant_visible`,
  `required_capability_key`, `risk_level`, `diagnostic_tool_key`, `decision_tool_key`,
  `apply_tool_key`, `readback_tool_key`, `approval_required`, `readback_required`,
  `status`, `policy_json`, `secrets_included`
)
VALUES
  ('wordpress_site_doctor_v1','wordpress_site_health','WordPress / WPML Site Doctor','Diagnostic-only WordPress and WPML readiness playbook. No publish, upload, provider write, or credential payload read is enabled by this seed.',1,'wordpress_site_diagnostic','high','tenant_resolution_diagnose','tenant_resolution_decide',NULL,'tenant_resolution_readback',0,1,'active',JSON_OBJECT('diagnostic_only',true,'provider_write_allowed',false,'credential_payload_read_allowed',false,'requires_resource_binding_for_apply',true),0),
  ('tenant_skill_approval_decision_v1','tenant_skill_approval','Tenant Skill Approval Decision','Tenant-owner decision workflow for approval-required skill grants. Approval decisions are audited and read back before alert closeout.',1,'tenant_skill_approval_decide','high','tenant_resolution_diagnose','tenant_resolution_decide',NULL,'tenant_resolution_readback',1,1,'active',JSON_OBJECT('decision_only',true,'approval_hold_required',true,'provider_write_allowed',false,'closeout_requires_readback',true),0),
  ('task_source_repair_v1','task_source_quality','Task Source Repair','Guided repair for malformed pending task rows. Apply remains gated by capability, approval, idempotency, audit, and readback.',1,'tenant_task_source_repair','medium','tenant_resolution_diagnose','tenant_resolution_decide','tenant_resolution_apply','tenant_resolution_readback',1,1,'active',JSON_OBJECT('internal_registry_only',true,'provider_write_allowed',false,'malformed_row_count_must_reach_zero',true),0),
  ('google_ads_setup_preflight_v1','provider_setup_ads','Google Ads Setup Preflight','Tenant setup or disabled-by-policy decision flow for Ads Governance blockers. No provider call, spend change, or budget mutation is enabled by this seed.',1,'google_ads_setup_preflight','high','tenant_resolution_diagnose','tenant_resolution_decide',NULL,'tenant_resolution_readback',1,1,'active',JSON_OBJECT('provider_call_allowed',false,'spend_change_allowed',false,'disabled_by_policy_allowed',true,'budget_preflight_only',true),0),
  ('connector_health_repair_v1','connector_runtime_readiness','Connector Health Repair','Read-only connector health and guided installation playbook. Local shell, file, service, and device mutation remain blocked until separately certified.',1,'connector_health_repair','high','tenant_resolution_diagnose','tenant_resolution_decide',NULL,'tenant_resolution_readback',1,1,'active',JSON_OBJECT('read_only_first',true,'local_command_dispatch_allowed',false,'installer_handoff_allowed_when_authorized',true,'apply_requires_separate_certification',true),0)
ON DUPLICATE KEY UPDATE
  `root_family` = VALUES(`root_family`),
  `display_name` = VALUES(`display_name`),
  `description` = VALUES(`description`),
  `tenant_visible` = VALUES(`tenant_visible`),
  `required_capability_key` = VALUES(`required_capability_key`),
  `risk_level` = VALUES(`risk_level`),
  `diagnostic_tool_key` = VALUES(`diagnostic_tool_key`),
  `decision_tool_key` = VALUES(`decision_tool_key`),
  `apply_tool_key` = VALUES(`apply_tool_key`),
  `readback_tool_key` = VALUES(`readback_tool_key`),
  `approval_required` = VALUES(`approval_required`),
  `readback_required` = VALUES(`readback_required`),
  `status` = VALUES(`status`),
  `policy_json` = VALUES(`policy_json`),
  `secrets_included` = 0,
  `updated_at` = CURRENT_TIMESTAMP;
