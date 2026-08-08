-- Register a dedicated governed authority for tenant Platform Plugin managed repair.
-- This migration changes registry/readiness metadata only. It does NOT execute a
-- repair, call a provider, create a managed execution run, grant a tenant/user
-- resource permission, read secret payloads, or mutate Production by itself.
-- provider_call_executed=false; external_write_executed=false;
-- managed_repair_executed=false; resource_grant_created=false;
-- credential_payload_read=false; force_push=false; secrets_included=false.

INSERT INTO resource_authority_route_family_registry
  (route_family_key, display_name, route_family, operation_class, risk_class,
   resource_authority_required, authority_requirement_key, dry_run_required,
   audit_required, readback_required, apply_allowed_default, enforcement_status,
   runtime_surface, notes)
VALUES
  ('tenant_platform_plugin_managed_repair',
   'Tenant Platform Plugin governed managed repair',
   'platform_plugin',
   'managed_repair',
   'C',
   1,
   'tenant_platform_plugin_managed_repair_authority',
   1,
   1,
   1,
   1,
   'certified',
   'routes/managedExecutionRoutes.js',
   'Allowlisted internal repair recipes execute only through tenant-managed-execution-v1. The route revalidates capability authority and an operate-or-stronger exact/workspace resource grant, requires managed_handoff approval, idempotency and readback. This row does not grant resource authority or execute a repair.')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),
  route_family=VALUES(route_family),
  operation_class=VALUES(operation_class),
  risk_class=VALUES(risk_class),
  resource_authority_required=1,
  authority_requirement_key=VALUES(authority_requirement_key),
  dry_run_required=1,
  audit_required=1,
  readback_required=1,
  apply_allowed_default=1,
  enforcement_status='certified',
  runtime_surface=VALUES(runtime_surface),
  notes=VALUES(notes),
  updated_at=CURRENT_TIMESTAMP;

CREATE OR REPLACE VIEW v_tenant_platform_plugin_managed_repair_readiness AS
SELECT
  'resource_authority_route_family.tenant_platform_plugin_managed_repair' AS capability_key,
  COUNT(c.capability_key) AS candidate_count,
  MAX(CASE WHEN LOWER(COALESCE(c.runtime_status, '')) = 'certified' THEN 1 ELSE 0 END) AS certified_runtime,
  MAX(CASE WHEN COALESCE(c.dispatch_allowed, 0) = 1 THEN 1 ELSE 0 END) AS dispatch_allowed,
  MAX(CASE WHEN COALESCE(c.apply_allowed, 0) = 1 THEN 1 ELSE 0 END) AS apply_allowed,
  MAX(CASE WHEN COALESCE(c.resource_authority_required, 0) = 1 THEN 1 ELSE 0 END) AS resource_authority_required,
  MAX(CASE WHEN COALESCE(c.requires_audit_evidence, 0) = 1 THEN 1 ELSE 0 END) AS audit_required,
  MAX(CASE WHEN COALESCE(c.requires_readback, 0) = 1 THEN 1 ELSE 0 END) AS readback_required,
  MAX(CASE WHEN NULLIF(TRIM(COALESCE(c.evidence_ref, '')), '') IS NOT NULL THEN 1 ELSE 0 END) AS authority_evidence_declared,
  CASE
    WHEN COUNT(c.capability_key) = 1
     AND MAX(CASE WHEN LOWER(COALESCE(c.runtime_status, '')) = 'certified' THEN 1 ELSE 0 END) = 1
     AND MAX(CASE WHEN COALESCE(c.dispatch_allowed, 0) = 1 THEN 1 ELSE 0 END) = 1
     AND MAX(CASE WHEN COALESCE(c.apply_allowed, 0) = 1 THEN 1 ELSE 0 END) = 1
     AND MAX(CASE WHEN COALESCE(c.resource_authority_required, 0) = 1 THEN 1 ELSE 0 END) = 1
     AND MAX(CASE WHEN COALESCE(c.requires_audit_evidence, 0) = 1 THEN 1 ELSE 0 END) = 1
     AND MAX(CASE WHEN COALESCE(c.requires_readback, 0) = 1 THEN 1 ELSE 0 END) = 1
     AND MAX(CASE WHEN NULLIF(TRIM(COALESCE(c.evidence_ref, '')), '') IS NOT NULL THEN 1 ELSE 0 END) = 1
    THEN 'ready'
    ELSE 'blocked'
  END AS readiness_status,
  'managed_execution_revalidates_resource_grant_before_run_creation' AS caller_authority_requirement,
  0 AS repair_executed,
  0 AS provider_call_executed,
  0 AS external_write_executed,
  0 AS secrets_included
FROM (SELECT 1 AS expected_row) expected
LEFT JOIN v_platform_capabilities_effective_evidence c
  ON c.capability_key = 'resource_authority_route_family.tenant_platform_plugin_managed_repair';

INSERT INTO governed_migration_authorization_registry
  (migration_file, authorization_status, authorization_source, policy_key, risk_tier,
   requires_preflight, requires_confirmation, allow_record_only, allow_apply, notes, metadata_json)
VALUES
  ('1052_tenant_platform_plugin_managed_repair_authority.sql',
   'authorized',
   'migration_seed',
   'governed_migration_runner_authorization_v1',
   'high',
   1,
   1,
   1,
   1,
   'Authorize metadata-only registration of the dedicated Platform Plugin managed-repair authority and readiness view. Applying this migration does not execute any repair; every repair still requires a separate tenant-managed execution run, effective resource grant, managed_handoff approval, idempotency and readback.',
   JSON_OBJECT(
     'scope','tenant_platform_plugin_managed_repair_authority_registration',
     'typed_migration_confirmation_required',TRUE,
     'managed_repair_execution',FALSE,
     'provider_calls',FALSE,
     'external_writes',FALSE,
     'resource_grant_creation',FALSE,
     'credential_payload_read',FALSE,
     'force_push',FALSE,
     'secrets_included',FALSE))
ON DUPLICATE KEY UPDATE
  authorization_status=VALUES(authorization_status),
  authorization_source=VALUES(authorization_source),
  policy_key=VALUES(policy_key),
  risk_tier=VALUES(risk_tier),
  requires_preflight=VALUES(requires_preflight),
  requires_confirmation=VALUES(requires_confirmation),
  allow_record_only=VALUES(allow_record_only),
  allow_apply=VALUES(allow_apply),
  notes=VALUES(notes),
  metadata_json=VALUES(metadata_json),
  updated_at=CURRENT_TIMESTAMP;
