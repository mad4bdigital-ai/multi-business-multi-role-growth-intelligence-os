-- Safety contract: no_provider_call true; no_credential_payload_read true; no_raw_secrets true;
-- no_external_send true; no_external_write true; secrets_included=false.
-- Sprint 69: project real dispatch-binding evidence into capability maturity.
--
-- This migration does not invent or backfill authority evidence. It exposes
-- evidence only when a named tool has an active platform_tool_dispatch_bindings
-- row with a non-empty readback policy. All other authority gaps remain visible.
--
-- Idempotent. View-only. No DELETE/TRUNCATE/DROP and no permission expansion.

CREATE OR REPLACE VIEW `v_platform_capability_authority_evidence` AS
SELECT
  CASE
    WHEN b.scope_class = 'tenant' THEN CONCAT('tenant_tool.', b.tool_key)
    ELSE CONCAT('admin_tool.', b.tool_key)
  END AS capability_key,
  MAX(CONCAT('tool_dispatch_binding:', b.binding_id, ':readback:', b.readback_policy_key)) AS evidence_ref,
  COUNT(*) AS active_binding_count,
  MAX(b.readback_policy_key) AS readback_policy_key,
  MAX(b.updated_at) AS evidence_updated_at
FROM `platform_tool_dispatch_bindings` b
WHERE b.status = 'active'
  AND COALESCE(b.readback_policy_key, '') <> ''
GROUP BY
  CASE
    WHEN b.scope_class = 'tenant' THEN CONCAT('tenant_tool.', b.tool_key)
    ELSE CONCAT('admin_tool.', b.tool_key)
  END;

CREATE OR REPLACE VIEW `v_platform_capabilities_effective_evidence` AS
SELECT
  c.capability_key,
  c.display_name,
  c.capability_family,
  c.source_table,
  c.source_key,
  c.operation_class,
  c.risk_class,
  c.runtime_status,
  c.exposure_scope,
  c.resource_authority_required,
  c.dispatch_allowed,
  c.apply_allowed,
  c.requires_audit_evidence,
  c.requires_readback,
  COALESCE(c.evidence_ref, e.evidence_ref) AS evidence_ref,
  c.notes
FROM `v_platform_capabilities_current` c
LEFT JOIN `v_platform_capability_authority_evidence` e
  ON e.capability_key = c.capability_key;

CREATE OR REPLACE VIEW `v_platform_capability_maturity` AS
SELECT
  c.capability_key,
  c.display_name,
  c.capability_family,
  c.source_table,
  c.source_key,
  c.operation_class,
  c.risk_class,
  c.runtime_status,
  c.exposure_scope,
  c.resource_authority_required,
  c.dispatch_allowed,
  c.apply_allowed,
  CASE
    WHEN c.runtime_status IN ('active','available','read_only_certified','diagnostic_certified','certified') THEN
      LEAST(10,
        2
        + CASE WHEN EXISTS (SELECT 1 FROM `v_platform_exports_current` x WHERE x.capability_key = c.capability_key AND x.export_status = 'active') THEN 2 ELSE 0 END
        + CASE WHEN EXISTS (SELECT 1 FROM `v_platform_bindings_current` b WHERE b.capability_key = c.capability_key AND b.binding_status IN ('active','read_only_certified','diagnostic_certified','certified')) THEN 2 ELSE 0 END
        + CASE WHEN c.dispatch_allowed = 1 THEN 2 ELSE 0 END
        + CASE WHEN c.resource_authority_required = 0 OR c.evidence_ref IS NOT NULL THEN 1 ELSE 0 END
        + CASE WHEN c.requires_audit_evidence = 0 OR c.requires_readback = 1 THEN 1 ELSE 0 END
      )
    ELSE
      LEAST(10,
        1
        + CASE WHEN EXISTS (SELECT 1 FROM `v_platform_exports_current` x WHERE x.capability_key = c.capability_key AND x.export_status = 'active') THEN 1 ELSE 0 END
        + CASE WHEN EXISTS (SELECT 1 FROM `v_platform_bindings_current` b WHERE b.capability_key = c.capability_key) THEN 1 ELSE 0 END
      )
  END AS maturity_score,
  CASE
    WHEN c.runtime_status IN ('read_only_certified','diagnostic_certified','certified') THEN 'certified'
    WHEN c.dispatch_allowed = 1 AND EXISTS (SELECT 1 FROM `v_platform_exports_current` x WHERE x.capability_key = c.capability_key AND x.export_status = 'active') THEN 'exported'
    WHEN c.dispatch_allowed = 1 THEN 'runtime_exists'
    WHEN EXISTS (SELECT 1 FROM `v_platform_bindings_current` b WHERE b.capability_key = c.capability_key) THEN 'policy_or_binding_exists'
    ELSE 'registered'
  END AS maturity_status,
  CONCAT_WS(',',
    CASE WHEN c.dispatch_allowed = 0 THEN 'dispatch_not_allowed' END,
    CASE WHEN c.resource_authority_required = 1 AND c.evidence_ref IS NULL THEN 'authority_evidence_missing' END,
    CASE WHEN NOT EXISTS (SELECT 1 FROM `v_platform_exports_current` x WHERE x.capability_key = c.capability_key AND x.export_status = 'active') THEN 'active_export_missing' END,
    CASE WHEN c.requires_audit_evidence = 1 AND c.requires_readback = 0 THEN 'readback_missing' END
  ) AS gap_flags
FROM `v_platform_capabilities_effective_evidence` c;

CREATE OR REPLACE VIEW `v_platform_capability_gaps` AS
SELECT
  capability_key,
  'dispatch_not_allowed' AS gap_key,
  CASE WHEN risk_class IN ('D','critical') THEN 'high' ELSE 'medium' END AS gap_severity,
  'Capability is registered but dispatch is not currently allowed.' AS gap_description
FROM `v_platform_capabilities_effective_evidence`
WHERE dispatch_allowed = 0
UNION ALL
SELECT
  capability_key,
  'authority_evidence_missing',
  CASE WHEN risk_class IN ('D','critical') THEN 'high' ELSE 'medium' END,
  'Capability requires resource authority evidence before mutation or certification.'
FROM `v_platform_capabilities_effective_evidence`
WHERE resource_authority_required = 1
  AND evidence_ref IS NULL
UNION ALL
SELECT
  c.capability_key,
  'active_export_missing',
  'low',
  'Capability has no active export row in the compatibility export view.'
FROM `v_platform_capabilities_effective_evidence` c
WHERE NOT EXISTS (
  SELECT 1
  FROM `v_platform_exports_current` x
  WHERE x.capability_key = c.capability_key
    AND x.export_status = 'active'
);
