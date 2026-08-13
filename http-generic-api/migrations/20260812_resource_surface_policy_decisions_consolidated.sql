-- Consolidated Resource API surface-policy decisions for governance/runtime relations introduced by the 2026-08-12 repair bundle.
-- These relations are internal control/evidence surfaces. This migration does not expose a public Resource API operation.

INSERT INTO platform_resource_surface_policy_registry
  (surface_kind,surface_ref,exposure_class,resource_key,descriptor_requirement,operation_requirement,archive_requirement,version_requirement,rationale,source_policy_key,status)
VALUES
  ('table','runtime_break_glass_incidents','internal_runtime',NULL,'not_applicable','not_applicable','not_applicable','not_applicable','Internal break-glass lifecycle state; mutation remains governed by capability, approval, lease/scope binding, and same-cycle readback.','platform_resource_api_coverage_policy_v1','active'),
  ('table','runtime_break_glass_audit_events','internal_log',NULL,'not_applicable','not_applicable','not_applicable','not_applicable','Internal append-only break-glass transition evidence; no public Resource API descriptor is required.','platform_resource_api_coverage_policy_v1','active'),
  ('table','deployment_attestations','governance_ledger',NULL,'not_applicable','not_applicable','not_applicable','not_applicable','Internal deployment/runtime-integrity attestation ledger; generation and readback remain separately governed.','platform_resource_api_coverage_policy_v1','active'),
  ('table','canonical_resource_registry','internal_registry',NULL,'not_applicable','not_applicable','not_applicable','not_applicable','Internal canonical-resource source-of-truth registry used by activation evidence resolution.','platform_resource_api_coverage_policy_v1','active'),
  ('view','v_canonical_resource_activation_registry','internal_read_model',NULL,'not_applicable','not_applicable','not_applicable','not_applicable','Internal activation-critical canonical-resource read model; no public Resource API descriptor is required.','platform_resource_api_coverage_policy_v1','active'),
  ('view','v_repository_reconciliation_apply_readiness','internal_read_model',NULL,'not_applicable','not_applicable','not_applicable','not_applicable','Internal readiness read model for the governed repository-reconciliation apply surface.','platform_resource_api_coverage_policy_v1','active')
ON DUPLICATE KEY UPDATE
  exposure_class=VALUES(exposure_class),
  resource_key=VALUES(resource_key),
  descriptor_requirement=VALUES(descriptor_requirement),
  operation_requirement=VALUES(operation_requirement),
  archive_requirement=VALUES(archive_requirement),
  version_requirement=VALUES(version_requirement),
  rationale=VALUES(rationale),
  source_policy_key=VALUES(source_policy_key),
  status=VALUES(status),
  updated_at=CURRENT_TIMESTAMP;
