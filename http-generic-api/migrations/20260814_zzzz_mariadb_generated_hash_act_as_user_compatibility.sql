-- MariaDB 11.4 compatibility bridge for immutable migration 20260815.
-- SHA2() is not permitted in a STORED generated column (ERROR 1901).
-- Materialize the same 32-byte idempotency tuple hash and maintain it with
-- DDL-defined BEFORE INSERT/UPDATE triggers. No DML or provider/runtime action.

CREATE TABLE IF NOT EXISTS act_as_user_sessions (
  session_id VARCHAR(191) NOT NULL,
  tenant_id VARCHAR(191) NOT NULL,
  actor_principal_id VARCHAR(191) NOT NULL,
  target_user_id VARCHAR(191) NOT NULL,
  actor_role VARCHAR(64) NOT NULL,
  target_role VARCHAR(64) NOT NULL,
  delegation_id VARCHAR(191) NOT NULL,
  requested_tool VARCHAR(191) NOT NULL,
  requested_operation VARCHAR(64) NOT NULL,
  effective_capabilities_json JSON NOT NULL,
  idempotency_key VARCHAR(191) NOT NULL,
  request_hash CHAR(64) NULL,
  role_policy_version VARCHAR(191) NOT NULL,
  catalog_version VARCHAR(191) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  issued_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  revoked_reason VARCHAR(255) NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  environment VARCHAR(32) NOT NULL DEFAULT 'staging',
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  last_readback_id VARCHAR(191) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  idempotency_tuple_hash BINARY(32) NOT NULL,
  PRIMARY KEY (session_id),
  UNIQUE KEY uq_act_as_user_idempotency (idempotency_tuple_hash),
  KEY idx_act_as_user_session_status (environment, tenant_id, status, expires_at),
  KEY idx_act_as_user_target (environment, tenant_id, target_user_id, status),
  CONSTRAINT ck_act_as_user_session_no_secrets CHECK (secrets_included = 0),
  CONSTRAINT ck_act_as_user_session_distinct_subjects CHECK (actor_principal_id <> target_user_id),
  CONSTRAINT ck_act_as_user_session_valid_window CHECK (expires_at > issued_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE TRIGGER trg_act_as_user_sessions_idempotency_tuple_hash_bi
BEFORE INSERT ON act_as_user_sessions
FOR EACH ROW
SET NEW.idempotency_tuple_hash = UNHEX(SHA2(CONCAT(
  'act-as-user-idempotency-v1:',
  NEW.environment, CHAR(0), NEW.tenant_id, CHAR(0), NEW.actor_principal_id, CHAR(0),
  NEW.target_user_id, CHAR(0), NEW.requested_operation, CHAR(0), NEW.requested_tool, CHAR(0),
  NEW.idempotency_key
), 256));

CREATE OR REPLACE TRIGGER trg_act_as_user_sessions_idempotency_tuple_hash_bu
BEFORE UPDATE ON act_as_user_sessions
FOR EACH ROW
SET NEW.idempotency_tuple_hash = UNHEX(SHA2(CONCAT(
  'act-as-user-idempotency-v1:',
  NEW.environment, CHAR(0), NEW.tenant_id, CHAR(0), NEW.actor_principal_id, CHAR(0),
  NEW.target_user_id, CHAR(0), NEW.requested_operation, CHAR(0), NEW.requested_tool, CHAR(0),
  NEW.idempotency_key
), 256));
