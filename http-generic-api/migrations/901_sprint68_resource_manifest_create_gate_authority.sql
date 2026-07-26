-- 901_sprint68_resource_manifest_create_gate_authority.sql
-- Purpose: seed the minimum governed authority required for the Resource Recipe
-- manifest.create_after_review positive smoke. This does not execute Drive writes,
-- does not create files, and does not store credential values.

INSERT INTO `credential_bindings` (
  `binding_id`,
  `tenant_id`,
  `owner_type`,
  `owner_id`,
  `action_key`,
  `target_key`,
  `credential_role`,
  `credential_ref`,
  `provider_family`,
  `connector_family`,
  `resolution_priority`,
  `status`,
  `created_by`
)
VALUES (
  '8a6cb94e-6db5-4c3a-9b5f-90168f000001',
  '00000000-0000-0000-0000-000000000000',
  'platform',
  'growth_intelligence_platform',
  'google_drive_api',
  'google_drive',
  'platform_oauth2_runtime',
  'platform_managed:google_drive_api_oauth2',
  'google_drive',
  'google_drive_api',
  250,
  'active',
  'migration_901_resource_manifest_create_gate_authority'
)
ON DUPLICATE KEY UPDATE
  `owner_type` = VALUES(`owner_type`),
  `owner_id` = VALUES(`owner_id`),
  `action_key` = VALUES(`action_key`),
  `target_key` = VALUES(`target_key`),
  `credential_role` = VALUES(`credential_role`),
  `credential_ref` = VALUES(`credential_ref`),
  `provider_family` = VALUES(`provider_family`),
  `connector_family` = VALUES(`connector_family`),
  `resolution_priority` = VALUES(`resolution_priority`),
  `status` = VALUES(`status`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `runtime_dispatch_certification_registry` (
  `certification_key`,
  `surface_key`,
  `surface_family`,
  `tool_or_action_key`,
  `risk_class`,
  `certification_status`,
  `smoke_strategy`,
  `dispatch_allowed`,
  `apply_allowed`,
  `requires_resource_authority`,
  `requires_dry_run`,
  `requires_audit_evidence`,
  `requires_readback`,
  `last_evidence_ref`,
  `last_certified_at`,
  `notes`
)
VALUES (
  'resource_manifest_create',
  'governed_resource_run',
  'resource_recipe_runtime',
  'governed_resource_run',
  'high',
  'manifest_create_gate_negative_smoke_passed_positive_apply_pending',
  'Negative smoke must prove apply is blocked without typed confirmation and blocked without capability envelope; positive smoke must use a dedicated smoke folder, exact typed confirmation, capability envelope apply authorization, Drive uploadNewFile, and same-cycle getFileMetadata readback. No graph write, no file-content read, no secrets.',
  1,
  0,
  1,
  1,
  1,
  1,
  'governed_resource_run:manifest_create_gate_negative_smoke:2026-06-10',
  CURRENT_TIMESTAMP,
  'Allows Dynamic Capability Resolution to issue approved envelopes for the guarded Resource Recipe manifest create gate only. It does not bypass the runtime typed-confirmation/envelope/readback gates.'
)
ON DUPLICATE KEY UPDATE
  `surface_key` = VALUES(`surface_key`),
  `surface_family` = VALUES(`surface_family`),
  `tool_or_action_key` = VALUES(`tool_or_action_key`),
  `risk_class` = VALUES(`risk_class`),
  `certification_status` = VALUES(`certification_status`),
  `smoke_strategy` = VALUES(`smoke_strategy`),
  `dispatch_allowed` = VALUES(`dispatch_allowed`),
  `apply_allowed` = VALUES(`apply_allowed`),
  `requires_resource_authority` = VALUES(`requires_resource_authority`),
  `requires_dry_run` = VALUES(`requires_dry_run`),
  `requires_audit_evidence` = VALUES(`requires_audit_evidence`),
  `requires_readback` = VALUES(`requires_readback`),
  `last_evidence_ref` = VALUES(`last_evidence_ref`),
  `last_certified_at` = VALUES(`last_certified_at`),
  `notes` = VALUES(`notes`),
  `updated_at` = CURRENT_TIMESTAMP;
