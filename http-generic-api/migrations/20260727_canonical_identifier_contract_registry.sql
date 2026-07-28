-- Canonical identifier contract authority and rollout bindings.
-- Additive registry only: no existing identifier columns are altered by this migration.

CREATE TABLE IF NOT EXISTS canonical_identifier_contract_registry (
  contract_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  identifier_name VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  logical_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  transition_sql_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  transition_character_set VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  transition_collation VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  target_sql_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  comparison_mode VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  rollout_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'guardrail_active',
  owner_surface VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'system_bootstrap',
  metadata_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (contract_key),
  UNIQUE KEY uq_canonical_identifier_contract_name (identifier_name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS canonical_identifier_column_binding_registry (
  binding_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  contract_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  table_name VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  column_name VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  rollout_phase VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'guardrail_active',
  lifecycle_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active',
  metadata_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (binding_key),
  UNIQUE KEY uq_canonical_identifier_column (table_name, column_name),
  KEY idx_canonical_identifier_binding_contract (contract_key, lifecycle_status),
  CONSTRAINT fk_canonical_identifier_binding_contract
    FOREIGN KEY (contract_key) REFERENCES canonical_identifier_contract_registry(contract_key)
) ENGINE=InnoDB;

INSERT INTO canonical_identifier_contract_registry
  (contract_key, identifier_name, logical_type, transition_sql_type,
   transition_character_set, transition_collation, target_sql_type,
   comparison_mode, rollout_status, owner_surface, metadata_json)
VALUES
  ('uuid.system_id.v1','system_id','uuid','char(36)','ascii','ascii_bin','binary(16)','binary','guardrail_active','system_bootstrap',JSON_OBJECT('secrets_included',FALSE)),
  ('uuid.tenant_id.v1','tenant_id','uuid','char(36)','ascii','ascii_bin','binary(16)','binary','guardrail_active','system_bootstrap',JSON_OBJECT('secrets_included',FALSE)),
  ('uuid.workspace_id.v1','workspace_id','uuid','char(36)','ascii','ascii_bin','binary(16)','binary','guardrail_active','system_bootstrap',JSON_OBJECT('secrets_included',FALSE)),
  ('uuid.installation_id.v1','installation_id','uuid','char(36)','ascii','ascii_bin','binary(16)','binary','guardrail_active','system_bootstrap',JSON_OBJECT('secrets_included',FALSE)),
  ('uuid.connection_id.v1','connection_id','uuid','char(36)','ascii','ascii_bin','binary(16)','binary','guardrail_active','system_bootstrap',JSON_OBJECT('secrets_included',FALSE)),
  ('uuid.binding_id.v1','binding_id','uuid','char(36)','ascii','ascii_bin','binary(16)','binary','guardrail_active','system_bootstrap',JSON_OBJECT('secrets_included',FALSE)),
  ('uuid.capability_binding_id.v1','capability_binding_id','uuid','char(36)','ascii','ascii_bin','binary(16)','binary','guardrail_active','system_bootstrap',JSON_OBJECT('secrets_included',FALSE))
ON DUPLICATE KEY UPDATE
  logical_type=VALUES(logical_type),
  transition_sql_type=VALUES(transition_sql_type),
  transition_character_set=VALUES(transition_character_set),
  transition_collation=VALUES(transition_collation),
  target_sql_type=VALUES(target_sql_type),
  comparison_mode=VALUES(comparison_mode),
  rollout_status=VALUES(rollout_status),
  owner_surface=VALUES(owner_surface),
  metadata_json=VALUES(metadata_json),
  updated_at=CURRENT_TIMESTAMP;

INSERT INTO canonical_identifier_column_binding_registry
  (binding_key, contract_key, table_name, column_name, rollout_phase, lifecycle_status, metadata_json)
VALUES
  ('connected_systems.system_id','uuid.system_id.v1','connected_systems','system_id','guardrail_active','active',JSON_OBJECT('current_schema','varchar(36)','secrets_included',FALSE)),
  ('repository_authority_bindings.system_id','uuid.system_id.v1','repository_authority_bindings','system_id','guardrail_active','active',JSON_OBJECT('current_schema','varchar(36)','secrets_included',FALSE)),
  ('installations.system_id','uuid.system_id.v1','installations','system_id','guardrail_active','active',JSON_OBJECT('current_schema','varchar(36)','secrets_included',FALSE)),
  ('credential_bindings.system_id','uuid.system_id.v1','credential_bindings','system_id','guardrail_active','active',JSON_OBJECT('current_schema','varchar(36)','secrets_included',FALSE)),
  ('connected_systems.tenant_id','uuid.tenant_id.v1','connected_systems','tenant_id','guardrail_active','active',JSON_OBJECT('current_schema','varchar(36)','secrets_included',FALSE)),
  ('repository_authority_bindings.tenant_id','uuid.tenant_id.v1','repository_authority_bindings','tenant_id','guardrail_active','active',JSON_OBJECT('current_schema','varchar(36)','secrets_included',FALSE)),
  ('installations.tenant_id','uuid.tenant_id.v1','installations','tenant_id','guardrail_active','active',JSON_OBJECT('current_schema','varchar(36)','secrets_included',FALSE)),
  ('credential_bindings.tenant_id','uuid.tenant_id.v1','credential_bindings','tenant_id','guardrail_active','active',JSON_OBJECT('current_schema','varchar(36)','secrets_included',FALSE))
ON DUPLICATE KEY UPDATE
  contract_key=VALUES(contract_key),
  rollout_phase=VALUES(rollout_phase),
  lifecycle_status=VALUES(lifecycle_status),
  metadata_json=VALUES(metadata_json),
  updated_at=CURRENT_TIMESTAMP;
