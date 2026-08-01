-- Spec 012 integrated Governed Policy & Operational Attention phase.
-- Additive schema design for T018/T019/T024B/T029A/T029B/T029C.
-- IMPORTANT: this migration is intentionally NOT inserted into
-- governed_migration_authorization_registry by this PR. It is not authorized
-- for record/apply and T026 remains open until governed preflight, explicit
-- authorization, apply, ledger readback, and schema readback are completed.
-- No provider call, external send, credential read, deployment, or secret data.

CREATE TABLE IF NOT EXISTS `governed_policy_questionnaire_definitions` (
  `definition_id` CHAR(36) NOT NULL,
  `questionnaire_key` VARCHAR(191) NOT NULL,
  `questionnaire_version` VARCHAR(64) NOT NULL,
  `domain_key` VARCHAR(191) NOT NULL,
  `purpose_key` VARCHAR(191) NOT NULL,
  `status` VARCHAR(32) NOT NULL,
  `definition_json` LONGTEXT NOT NULL,
  `definition_sha256` CHAR(64) NOT NULL,
  `effective_at` DATETIME(6) NOT NULL,
  `expires_at` DATETIME(6) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`definition_id`),
  UNIQUE KEY `uq_gp_questionnaire_version` (`questionnaire_key`,`questionnaire_version`),
  KEY `idx_gp_questionnaire_effective` (`domain_key`,`purpose_key`,`status`,`effective_at`,`expires_at`),
  CONSTRAINT `chk_gp_questionnaire_definition_json` CHECK (JSON_VALID(`definition_json`)),
  CONSTRAINT `chk_gp_questionnaire_definition_sha` CHECK (`definition_sha256` REGEXP '^[a-f0-9]{64}$'),
  CONSTRAINT `chk_gp_questionnaire_definition_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `governed_policy_sessions` (
  `session_id` VARCHAR(191) NOT NULL,
  `tenant_id` VARCHAR(191) NOT NULL,
  `user_id` VARCHAR(191) NOT NULL,
  `questionnaire_key` VARCHAR(191) NOT NULL,
  `questionnaire_version` VARCHAR(64) NOT NULL,
  `definition_sha256` CHAR(64) NOT NULL,
  `domain_key` VARCHAR(191) NOT NULL,
  `purpose_key` VARCHAR(191) NOT NULL,
  `interaction_mode` VARCHAR(32) NOT NULL,
  `actor_roles_json` LONGTEXT NOT NULL,
  `context_snapshot_json` LONGTEXT NOT NULL,
  `status` VARCHAR(32) NOT NULL,
  `revision` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `session_binding_sha256` CHAR(64) NOT NULL,
  `created_at` DATETIME(6) NOT NULL,
  `expires_at` DATETIME(6) NOT NULL,
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`session_id`),
  KEY `idx_gp_session_scope` (`tenant_id`,`user_id`,`status`,`expires_at`),
  KEY `idx_gp_session_definition` (`questionnaire_key`,`questionnaire_version`),
  CONSTRAINT `fk_gp_session_definition` FOREIGN KEY (`questionnaire_key`,`questionnaire_version`)
    REFERENCES `governed_policy_questionnaire_definitions` (`questionnaire_key`,`questionnaire_version`)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `chk_gp_session_roles_json` CHECK (JSON_VALID(`actor_roles_json`)),
  CONSTRAINT `chk_gp_session_context_json` CHECK (JSON_VALID(`context_snapshot_json`)),
  CONSTRAINT `chk_gp_session_binding_sha` CHECK (`session_binding_sha256` REGEXP '^[a-f0-9]{64}$'),
  CONSTRAINT `chk_gp_session_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `governed_policy_answers` (
  `answer_set_id` CHAR(36) NOT NULL,
  `session_id` VARCHAR(191) NOT NULL,
  `session_revision` BIGINT UNSIGNED NOT NULL,
  `normalized_answers_json` LONGTEXT NOT NULL,
  `visible_question_keys_json` LONGTEXT NOT NULL,
  `normalized_answers_sha256` CHAR(64) NOT NULL,
  `source` VARCHAR(32) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`answer_set_id`),
  UNIQUE KEY `uq_gp_answers_revision` (`session_id`,`session_revision`),
  KEY `idx_gp_answers_hash` (`normalized_answers_sha256`),
  CONSTRAINT `fk_gp_answers_session` FOREIGN KEY (`session_id`)
    REFERENCES `governed_policy_sessions` (`session_id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `chk_gp_answers_json` CHECK (JSON_VALID(`normalized_answers_json`)),
  CONSTRAINT `chk_gp_answers_visible_json` CHECK (JSON_VALID(`visible_question_keys_json`)),
  CONSTRAINT `chk_gp_answers_sha` CHECK (`normalized_answers_sha256` REGEXP '^[a-f0-9]{64}$'),
  CONSTRAINT `chk_gp_answers_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `governed_policy_compilations` (
  `compilation_id` VARCHAR(191) NOT NULL,
  `session_id` VARCHAR(191) NOT NULL,
  `policy_type` VARCHAR(191) NOT NULL,
  `proposed_version` VARCHAR(64) NOT NULL,
  `normalized_input_sha256` CHAR(64) NOT NULL,
  `compiled_policy_json` LONGTEXT NOT NULL,
  `compiled_policy_sha256` CHAR(64) NOT NULL,
  `safety_validation_json` LONGTEXT NOT NULL,
  `safety_bounds_key` VARCHAR(191) NOT NULL,
  `safety_bounds_version` VARCHAR(64) NOT NULL,
  `safety_bounds_sha256` CHAR(64) NOT NULL,
  `risk_tier` VARCHAR(32) NOT NULL,
  `required_approval_class` VARCHAR(191) NOT NULL,
  `typed_confirmation_required` TINYINT(1) NOT NULL DEFAULT 0,
  `impact_preview_json` LONGTEXT NOT NULL,
  `provenance_json` LONGTEXT NOT NULL,
  `compilation_sha256` CHAR(64) NOT NULL,
  `status` VARCHAR(32) NOT NULL,
  `created_at` DATETIME(6) NOT NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`compilation_id`),
  KEY `idx_gp_compilation_session` (`session_id`,`created_at`),
  KEY `idx_gp_compilation_policy` (`policy_type`,`proposed_version`,`status`),
  CONSTRAINT `fk_gp_compilation_session` FOREIGN KEY (`session_id`)
    REFERENCES `governed_policy_sessions` (`session_id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `chk_gp_compilation_policy_json` CHECK (JSON_VALID(`compiled_policy_json`)),
  CONSTRAINT `chk_gp_compilation_safety_json` CHECK (JSON_VALID(`safety_validation_json`)),
  CONSTRAINT `chk_gp_compilation_impact_json` CHECK (JSON_VALID(`impact_preview_json`)),
  CONSTRAINT `chk_gp_compilation_provenance_json` CHECK (JSON_VALID(`provenance_json`)),
  CONSTRAINT `chk_gp_compilation_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `governed_policy_proposals` (
  `proposal_id` VARCHAR(191) NOT NULL,
  `compilation_id` VARCHAR(191) NOT NULL,
  `tenant_id` VARCHAR(191) NOT NULL,
  `policy_type` VARCHAR(191) NOT NULL,
  `proposed_version` VARCHAR(64) NOT NULL,
  `resource_uri` VARCHAR(2048) NOT NULL,
  `resource_uri_sha256` CHAR(64) NOT NULL,
  `status` VARCHAR(32) NOT NULL,
  `risk_tier` VARCHAR(32) NOT NULL,
  `required_approval_class` VARCHAR(191) NOT NULL,
  `typed_confirmation_required` TINYINT(1) NOT NULL DEFAULT 0,
  `proposal_hash_sha256` CHAR(64) NOT NULL,
  `created_by` VARCHAR(191) NOT NULL,
  `idempotency_key` VARCHAR(191) NOT NULL,
  `answers_evidence_json` LONGTEXT NOT NULL,
  `created_at` DATETIME(6) NOT NULL,
  `updated_at` DATETIME(6) NOT NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`proposal_id`),
  UNIQUE KEY `uq_gp_proposal_idempotency` (`tenant_id`,`idempotency_key`),
  UNIQUE KEY `uq_gp_proposal_version_resource` (`tenant_id`,`policy_type`,`proposed_version`,`resource_uri_sha256`),
  KEY `idx_gp_proposal_status` (`tenant_id`,`policy_type`,`status`,`updated_at`),
  CONSTRAINT `fk_gp_proposal_compilation` FOREIGN KEY (`compilation_id`)
    REFERENCES `governed_policy_compilations` (`compilation_id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `chk_gp_proposal_answers_json` CHECK (JSON_VALID(`answers_evidence_json`)),
  CONSTRAINT `chk_gp_proposal_resource_sha` CHECK (`resource_uri_sha256` REGEXP '^[a-f0-9]{64}$'),
  CONSTRAINT `chk_gp_proposal_hash` CHECK (`proposal_hash_sha256` REGEXP '^[a-f0-9]{64}$'),
  CONSTRAINT `chk_gp_proposal_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `governed_policy_approvals` (
  `approval_id` VARCHAR(191) NOT NULL,
  `proposal_id` VARCHAR(191) NOT NULL,
  `tenant_id` VARCHAR(191) NOT NULL,
  `resource_uri` VARCHAR(2048) NOT NULL,
  `resource_uri_sha256` CHAR(64) NOT NULL,
  `proposal_hash_sha256` CHAR(64) NOT NULL,
  `approval_class` VARCHAR(191) NOT NULL,
  `decision` VARCHAR(32) NOT NULL,
  `approved_by` VARCHAR(191) NOT NULL,
  `typed_confirmation_hash` CHAR(64) NULL,
  `idempotency_key` VARCHAR(191) NOT NULL,
  `created_at` DATETIME(6) NOT NULL,
  `expires_at` DATETIME(6) NOT NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`approval_id`),
  UNIQUE KEY `uq_gp_approval_idempotency` (`proposal_id`,`idempotency_key`),
  KEY `idx_gp_approval_active` (`proposal_id`,`decision`,`expires_at`),
  CONSTRAINT `fk_gp_approval_proposal` FOREIGN KEY (`proposal_id`)
    REFERENCES `governed_policy_proposals` (`proposal_id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `chk_gp_approval_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `governed_policy_versions` (
  `policy_version_id` CHAR(36) NOT NULL,
  `tenant_id` VARCHAR(191) NOT NULL,
  `policy_key` VARCHAR(191) NOT NULL,
  `policy_version` VARCHAR(64) NOT NULL,
  `resource_uri` VARCHAR(2048) NOT NULL,
  `resource_uri_sha256` CHAR(64) NOT NULL,
  `policy_sha256` CHAR(64) NOT NULL,
  `policy_json` LONGTEXT NOT NULL,
  `proposal_id` VARCHAR(191) NOT NULL,
  `status` VARCHAR(32) NOT NULL,
  `effective_at` DATETIME(6) NOT NULL,
  `activated_at` DATETIME(6) NULL,
  `superseded_at` DATETIME(6) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`policy_version_id`),
  UNIQUE KEY `uq_gp_policy_version` (`tenant_id`,`policy_key`,`policy_version`,`resource_uri_sha256`),
  KEY `idx_gp_policy_active` (`tenant_id`,`policy_key`,`resource_uri_sha256`,`status`,`activated_at`),
  CONSTRAINT `fk_gp_policy_proposal` FOREIGN KEY (`proposal_id`)
    REFERENCES `governed_policy_proposals` (`proposal_id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `chk_gp_policy_json` CHECK (JSON_VALID(`policy_json`)),
  CONSTRAINT `chk_gp_policy_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `governed_policy_invalidation_outbox` (
  `event_id` CHAR(36) NOT NULL,
  `event_type` VARCHAR(191) NOT NULL,
  `tenant_id` VARCHAR(191) NOT NULL,
  `policy_key` VARCHAR(191) NOT NULL,
  `policy_version` VARCHAR(64) NOT NULL,
  `resource_uri` VARCHAR(2048) NOT NULL,
  `resource_uri_sha256` CHAR(64) NOT NULL,
  `policy_sha256` CHAR(64) NOT NULL,
  `critical` TINYINT(1) NOT NULL DEFAULT 1,
  `delivery_status` VARCHAR(32) NOT NULL,
  `payload_json` LONGTEXT NOT NULL,
  `evidence_sha256` CHAR(64) NULL,
  `error_code` VARCHAR(191) NULL,
  `error_message` VARCHAR(1000) NULL,
  `created_at` DATETIME(6) NOT NULL,
  `updated_at` DATETIME(6) NOT NULL,
  `delivered_at` DATETIME(6) NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`event_id`),
  KEY `idx_gp_invalidation_delivery` (`delivery_status`,`critical`,`created_at`),
  KEY `idx_gp_invalidation_policy` (`tenant_id`,`policy_key`,`policy_version`,`resource_uri_sha256`),
  CONSTRAINT `chk_gp_invalidation_payload_json` CHECK (JSON_VALID(`payload_json`)),
  CONSTRAINT `chk_gp_invalidation_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `governed_policy_rollbacks` (
  `rollback_id` CHAR(36) NOT NULL,
  `tenant_id` VARCHAR(191) NOT NULL,
  `policy_key` VARCHAR(191) NOT NULL,
  `active_version` VARCHAR(64) NOT NULL,
  `target_version` VARCHAR(64) NOT NULL,
  `resource_uri` VARCHAR(2048) NOT NULL,
  `resource_uri_sha256` CHAR(64) NOT NULL,
  `approved_proposal_id` VARCHAR(191) NOT NULL,
  `proposal_hash_sha256` CHAR(64) NOT NULL,
  `invalidation_event_id` CHAR(36) NOT NULL,
  `status` VARCHAR(32) NOT NULL,
  `idempotency_key` VARCHAR(191) NOT NULL,
  `created_at` DATETIME(6) NOT NULL,
  `updated_at` DATETIME(6) NOT NULL,
  `activated_at` DATETIME(6) NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`rollback_id`),
  UNIQUE KEY `uq_gp_rollback_idempotency` (`tenant_id`,`idempotency_key`),
  KEY `idx_gp_rollback_policy` (`tenant_id`,`policy_key`,`resource_uri_sha256`,`created_at`),
  CONSTRAINT `fk_gp_rollback_proposal` FOREIGN KEY (`approved_proposal_id`)
    REFERENCES `governed_policy_proposals` (`proposal_id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `chk_gp_rollback_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `governed_policy_activations` (
  `activation_id` CHAR(36) NOT NULL,
  `proposal_id` VARCHAR(191) NOT NULL,
  `tenant_id` VARCHAR(191) NOT NULL,
  `policy_key` VARCHAR(191) NOT NULL,
  `policy_version` VARCHAR(64) NOT NULL,
  `resource_uri` VARCHAR(2048) NOT NULL,
  `resource_uri_sha256` CHAR(64) NOT NULL,
  `proposal_hash_sha256` CHAR(64) NOT NULL,
  `policy_sha256` CHAR(64) NOT NULL,
  `invalidation_event_id` CHAR(36) NOT NULL,
  `status` VARCHAR(32) NOT NULL,
  `idempotency_key` VARCHAR(191) NOT NULL,
  `rollback_id` CHAR(36) NULL,
  `invalidation_evidence_sha256` CHAR(64) NULL,
  `failure_code` VARCHAR(191) NULL,
  `failure_message` VARCHAR(1000) NULL,
  `created_at` DATETIME(6) NOT NULL,
  `updated_at` DATETIME(6) NOT NULL,
  `activated_at` DATETIME(6) NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`activation_id`),
  UNIQUE KEY `uq_gp_activation_idempotency` (`tenant_id`,`idempotency_key`),
  KEY `idx_gp_activation_policy` (`tenant_id`,`policy_key`,`policy_version`,`resource_uri_sha256`,`status`),
  CONSTRAINT `fk_gp_activation_proposal` FOREIGN KEY (`proposal_id`)
    REFERENCES `governed_policy_proposals` (`proposal_id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `fk_gp_activation_invalidation` FOREIGN KEY (`invalidation_event_id`)
    REFERENCES `governed_policy_invalidation_outbox` (`event_id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `fk_gp_activation_rollback` FOREIGN KEY (`rollback_id`)
    REFERENCES `governed_policy_rollbacks` (`rollback_id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `chk_gp_activation_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
