-- Phase 2: canonical capability domain and alias registry.
-- Additive only. Existing action/tool registries remain runtime authority until later phases route through this domain.
-- no_provider_call
-- no_credential_payload_read
-- no_raw_secrets
-- no_external_send
-- no_external_write
-- secrets_included_false

CREATE TABLE IF NOT EXISTS canonical_capabilities (
  canonical_capability_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  capability_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  risk_level ENUM('low','medium','high','critical') NOT NULL,
  effect ENUM('read','preview','create','update','delete','execute','admin') NOT NULL,
  state_changing TINYINT(1) NOT NULL DEFAULT 0,
  credential_policy_id VARCHAR(191) NULL,
  device_policy_id VARCHAR(191) NULL,
  approval_policy_id VARCHAR(191) NULL,
  smoke_policy_id VARCHAR(191) NULL,
  status ENUM('active','disabled','deprecated') NOT NULL DEFAULT 'active',
  policy_version VARCHAR(64) NOT NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (canonical_capability_id),
  UNIQUE KEY uq_canonical_capability_key (capability_key),
  KEY idx_canonical_capability_status (status, state_changing)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS capability_aliases (
  alias_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  selector_type ENUM('action_key','tool_key','intent_key','route_key') NOT NULL,
  selector_value VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  canonical_capability_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  surface ENUM('tenant','admin','device','system') NOT NULL,
  surface_restriction_policy_id VARCHAR(191) NULL,
  status ENUM('active','disabled','deprecated') NOT NULL DEFAULT 'active',
  registry_version VARCHAR(64) NOT NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (alias_id),
  UNIQUE KEY uq_capability_alias_surface (selector_type, selector_value, surface),
  KEY idx_capability_alias_capability (canonical_capability_id, status),
  CONSTRAINT fk_capability_alias_canonical
    FOREIGN KEY (canonical_capability_id) REFERENCES canonical_capabilities (canonical_capability_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO canonical_capabilities (
  canonical_capability_id, capability_key, display_name, risk_level, effect, state_changing,
  approval_policy_id, status, policy_version, metadata_json
)
SELECT
  CONCAT('cap_', LEFT(SHA2(LOWER(source.tool_key), 256), 60)),
  LOWER(source.tool_key),
  REPLACE(source.tool_key, '_', ' '),
  IF(source.is_mutation = 1, 'high', 'low'),
  CASE
    WHEN source.is_mutation = 1 THEN 'update'
    WHEN source.is_preview = 1 THEN 'preview'
    ELSE 'read'
  END,
  source.is_mutation,
  IF(source.is_mutation = 1, 'explicit_mutation_policy_required_v1', NULL),
  'active',
  'phase2-v1',
  JSON_OBJECT('backfill_source', 'admin_and_tenant_tool_catalogs', 'secrets_included', FALSE)
FROM (
  SELECT tool_key,
         MAX(tags REGEXP '(^|,)(mutation|state_changing|write|external_write)(,|$)') AS is_mutation,
         MAX(tags REGEXP '(^|,)(preview_only|dry_run|dry_run_default)(,|$)') AS is_preview
    FROM (
      SELECT tool_key, COALESCE(tags, '') AS tags FROM admin_platform_endpoint_tools WHERE is_enabled = 1 AND tool_key IS NOT NULL
      UNION ALL
      SELECT tool_key, COALESCE(tags, '') AS tags FROM tenant_platform_endpoint_tools WHERE is_enabled = 1 AND tool_key IS NOT NULL
    ) catalog
   GROUP BY tool_key
) source
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  metadata_json = VALUES(metadata_json),
  updated_at = CURRENT_TIMESTAMP(6);

INSERT INTO capability_aliases (
  alias_id, selector_type, selector_value, canonical_capability_id, surface, status, registry_version, metadata_json
)
SELECT
  CONCAT('alias_', LEFT(SHA2(CONCAT(source.surface, ':', LOWER(source.tool_key)), 256), 58)),
  'tool_key',
  LOWER(source.tool_key),
  CONCAT('cap_', LEFT(SHA2(LOWER(source.tool_key), 256), 60)),
  source.surface,
  'active',
  'phase2-v1',
  JSON_OBJECT('backfill_source', source.source_table, 'secrets_included', FALSE)
FROM (
  SELECT tool_key, 'admin' AS surface, 'admin_platform_endpoint_tools' AS source_table
    FROM admin_platform_endpoint_tools WHERE is_enabled = 1 AND tool_key IS NOT NULL
  UNION ALL
  SELECT tool_key, 'tenant' AS surface, 'tenant_platform_endpoint_tools' AS source_table
    FROM tenant_platform_endpoint_tools WHERE is_enabled = 1 AND tool_key IS NOT NULL
) source
ON DUPLICATE KEY UPDATE
  canonical_capability_id = VALUES(canonical_capability_id),
  status = 'active',
  registry_version = VALUES(registry_version),
  metadata_json = VALUES(metadata_json),
  updated_at = CURRENT_TIMESTAMP(6);

CREATE OR REPLACE VIEW v_capability_alias_integrity AS
SELECT
  'active_alias_multiple_canonical_targets' AS finding_code,
  selector_type,
  selector_value,
  NULL AS canonical_capability_id,
  COUNT(*) AS affected_rows,
  JSON_OBJECT('canonical_target_count', COUNT(DISTINCT canonical_capability_id), 'secrets_included', FALSE) AS details_json
FROM capability_aliases
WHERE status = 'active'
GROUP BY selector_type, selector_value
HAVING COUNT(DISTINCT canonical_capability_id) > 1
UNION ALL
SELECT
  'orphan_alias' AS finding_code,
  a.selector_type,
  a.selector_value,
  a.canonical_capability_id,
  1 AS affected_rows,
  JSON_OBJECT('surface', a.surface, 'secrets_included', FALSE) AS details_json
FROM capability_aliases a
LEFT JOIN canonical_capabilities c ON c.canonical_capability_id = a.canonical_capability_id
WHERE a.status = 'active' AND c.canonical_capability_id IS NULL
UNION ALL
SELECT
  'incomplete_active_capability' AS finding_code,
  NULL AS selector_type,
  c.capability_key AS selector_value,
  c.canonical_capability_id,
  1 AS affected_rows,
  JSON_OBJECT('state_changing', c.state_changing, 'secrets_included', FALSE) AS details_json
FROM canonical_capabilities c
WHERE c.status = 'active'
  AND (
    c.policy_version IS NULL OR c.policy_version = '' OR
    c.risk_level IS NULL OR c.effect IS NULL OR
    (c.state_changing = 1 AND (c.approval_policy_id IS NULL OR c.approval_policy_id = ''))
  );
