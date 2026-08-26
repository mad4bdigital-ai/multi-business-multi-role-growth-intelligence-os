-- MariaDB 11.4 compatibility bridge for the historical act-as-user session table.
-- The historical migration remains immutable. This bridge is DDL-only and runs first.
-- The full idempotency tuple is preserved in a deterministic SHA-256 generated digest;
-- the unique index is then 32 bytes instead of 4204 utf8mb4 bytes.

CREATE TABLE IF NOT EXISTS `act_as_user_sessions` (
  `session_id` varchar(191) NOT NULL,
  `tenant_id` varchar(191) NOT NULL,
  `actor_principal_id` varchar(191) NOT NULL,
  `target_user_id` varchar(191) NOT NULL,
  `actor_role` varchar(64) NOT NULL,
  `target_role` varchar(64) NOT NULL,
  `delegation_id` varchar(191) NOT NULL,
  `requested_tool` varchar(191) NOT NULL,
  `requested_operation` varchar(64) NOT NULL,
  `effective_capabilities_json` json NOT NULL,
  `idempotency_key` varchar(191) NOT NULL,
  `request_hash` char(64) NULL,
  `role_policy_version` varchar(191) NOT NULL,
  `catalog_version` varchar(191) NOT NULL,
  `status` varchar(32) NOT NULL DEFAULT 'active',
  `issued_at` datetime(3) NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  `revoked_at` datetime(3) NULL,
  `revoked_reason` varchar(255) NULL,
  `version` bigint unsigned NOT NULL DEFAULT 1,
  `environment` varchar(32) NOT NULL DEFAULT 'staging',
  `secrets_included` tinyint(1) NOT NULL DEFAULT 0,
  `last_readback_id` varchar(191) NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `idempotency_tuple_hash` binary(32) GENERATED ALWAYS AS (
    UNHEX(SHA2(CONCAT(
      'act-as-user-idempotency-v1:',
      `environment`, CHAR(0), `tenant_id`, CHAR(0), `actor_principal_id`, CHAR(0),
      `target_user_id`, CHAR(0), `requested_operation`, CHAR(0), `requested_tool`, CHAR(0),
      `idempotency_key`
    ), 256))
  ) STORED,
  PRIMARY KEY (`session_id`),
  UNIQUE KEY `uq_act_as_user_idempotency` (`idempotency_tuple_hash`),
  KEY `idx_act_as_user_session_status` (`environment`, `tenant_id`, `status`, `expires_at`),
  KEY `idx_act_as_user_target` (`environment`, `tenant_id`, `target_user_id`, `status`),
  CONSTRAINT `ck_act_as_user_session_no_secrets` CHECK (`secrets_included` = 0),
  CONSTRAINT `ck_act_as_user_session_distinct_subjects` CHECK (`actor_principal_id` <> `target_user_id`),
  CONSTRAINT `ck_act_as_user_session_valid_window` CHECK (`expires_at` > `issued_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
