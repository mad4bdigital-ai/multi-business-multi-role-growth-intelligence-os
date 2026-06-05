-- Sprint 67: Safe additive repair governance policy
-- Converts the platform operating doctrine into registry policy:
-- when a canonical migration or registry contract references a useful missing
-- field, prefer a non-destructive additive repair over omitting the field.
-- Omission is a temporary compatibility fallback only when the additive repair
-- is unsafe or blocked by preflight.

ALTER TABLE `admin_platform_endpoint_tools`
  ADD COLUMN IF NOT EXISTS `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp();

UPDATE `execution_policies`
SET
  `policy_value` = JSON_OBJECT(
    'rule', 'prefer_safe_additive_repair_over_omission',
    'summary', 'When a canonical migration or registry contract references a useful missing schema field, repair by adding the compatible field instead of omitting it, unless preflight risk requires a separate approval path.',
    'preferred_action', 'additive_schema_repair',
    'fallback_action', 'temporary_compatibility_omission_only_when_addition_is_unsafe_or_blocked',
    'examples', JSON_ARRAY('updated_at audit column', 'metadata_json support field', 'readback timestamp field'),
    'required_guards', JSON_ARRAY('preflight_no_destructive_change', 'idempotent_or_column_absence_checked', 'ledger_or_audit_evidence', 'release_readiness_readback'),
    'blocked_when', JSON_ARRAY('destructive_change', 'large_lock_risk_without_window', 'contract_breaking_backfill', 'secret_exposure')
  ),
  `active` = 'true',
  `execution_scope` = 'platform_schema_repair',
  `affects_layer` = 'migrations,registry,release_readiness,admin_tools',
  `blocking` = 'true',
  `notes` = 'Safe useful additive schema repair is preferred over omitting canonical fields. Omission is a temporary fallback only when addition is unsafe or blocked.',
  `updated_at` = current_timestamp()
WHERE `policy_group` = 'platform_repair_governance'
  AND `policy_key` = 'safe_additive_repair_preferred_over_omission';

INSERT INTO `execution_policies`
  (`policy_group`, `policy_key`, `policy_value`, `active`, `execution_scope`, `affects_layer`, `blocking`, `notes`)
SELECT
  'platform_repair_governance',
  'safe_additive_repair_preferred_over_omission',
  JSON_OBJECT(
    'rule', 'prefer_safe_additive_repair_over_omission',
    'summary', 'When a canonical migration or registry contract references a useful missing schema field, repair by adding the compatible field instead of omitting it, unless preflight risk requires a separate approval path.',
    'preferred_action', 'additive_schema_repair',
    'fallback_action', 'temporary_compatibility_omission_only_when_addition_is_unsafe_or_blocked',
    'examples', JSON_ARRAY('updated_at audit column', 'metadata_json support field', 'readback timestamp field'),
    'required_guards', JSON_ARRAY('preflight_no_destructive_change', 'idempotent_or_column_absence_checked', 'ledger_or_audit_evidence', 'release_readiness_readback'),
    'blocked_when', JSON_ARRAY('destructive_change', 'large_lock_risk_without_window', 'contract_breaking_backfill', 'secret_exposure')
  ),
  'true',
  'platform_schema_repair',
  'migrations,registry,release_readiness,admin_tools',
  'true',
  'Safe useful additive schema repair is preferred over omitting canonical fields. Omission is a temporary fallback only when addition is unsafe or blocked.'
WHERE NOT EXISTS (
  SELECT 1
    FROM `execution_policies`
   WHERE `policy_group` = 'platform_repair_governance'
     AND `policy_key` = 'safe_additive_repair_preferred_over_omission'
);

UPDATE `logic_definitions`
SET
  `display_name` = 'Safe Additive Repair Preferred Over Omission',
  `logic_type` = 'audit',
  `body_json` = JSON_OBJECT(
    'doctrine_key', 'safe_additive_repair_preferred_over_omission',
    'rule', 'prefer_safe_additive_repair_over_omission',
    'decision_order', JSON_ARRAY('attempt_safe_additive_schema_repair', 'record_ledger_or_audit_evidence', 'run_release_readiness', 'use_omission_only_as_temporary_fallback_when_addition_is_unsafe_or_blocked'),
    'example_repair', JSON_OBJECT('table', 'admin_platform_endpoint_tools', 'column', 'updated_at', 'type', 'timestamp', 'reason', 'canonical migration referenced updated_at; column is useful for registry auditability'),
    'hard_limits', JSON_ARRAY('no destructive DDL', 'no secret exposure', 'no runtime capability expansion', 'no unreviewed contract-breaking backfill')
  ),
  `source_url` = 'db://execution_policies/platform_repair_governance/safe_additive_repair_preferred_over_omission',
  `package_version` = 'v1',
  `skill_manifest` = JSON_OBJECT('policy_key', 'safe_additive_repair_preferred_over_omission', 'enforced_by', 'admin_gpt_runtime', 'runtime_execution_allowed', false),
  `version` = '1.0',
  `status` = 'active',
  `updated_at` = current_timestamp()
WHERE `logic_key` = 'platform.schema_repair.safe_additive_preferred_over_omission';

INSERT INTO `logic_definitions`
  (`logic_id`, `logic_key`, `display_name`, `logic_type`, `parent_logic_id`, `tenant_id`, `body_json`, `source_url`, `package_version`, `skill_manifest`, `version`, `status`)
SELECT
  UUID(),
  'platform.schema_repair.safe_additive_preferred_over_omission',
  'Safe Additive Repair Preferred Over Omission',
  'audit',
  NULL,
  NULL,
  JSON_OBJECT(
    'doctrine_key', 'safe_additive_repair_preferred_over_omission',
    'rule', 'prefer_safe_additive_repair_over_omission',
    'decision_order', JSON_ARRAY('attempt_safe_additive_schema_repair', 'record_ledger_or_audit_evidence', 'run_release_readiness', 'use_omission_only_as_temporary_fallback_when_addition_is_unsafe_or_blocked'),
    'example_repair', JSON_OBJECT('table', 'admin_platform_endpoint_tools', 'column', 'updated_at', 'type', 'timestamp', 'reason', 'canonical migration referenced updated_at; column is useful for registry auditability'),
    'hard_limits', JSON_ARRAY('no destructive DDL', 'no secret exposure', 'no runtime capability expansion', 'no unreviewed contract-breaking backfill')
  ),
  'db://execution_policies/platform_repair_governance/safe_additive_repair_preferred_over_omission',
  'v1',
  JSON_OBJECT('policy_key', 'safe_additive_repair_preferred_over_omission', 'enforced_by', 'admin_gpt_runtime', 'runtime_execution_allowed', false),
  '1.0',
  'active'
WHERE NOT EXISTS (
  SELECT 1
    FROM `logic_definitions`
   WHERE `logic_key` = 'platform.schema_repair.safe_additive_preferred_over_omission'
);

INSERT INTO `runtime_dispatch_certification_registry`
  (`certification_key`, `surface_key`, `surface_family`, `tool_or_action_key`, `risk_class`, `certification_status`,
   `smoke_strategy`, `dispatch_allowed`, `apply_allowed`, `requires_resource_authority`, `requires_dry_run`,
   `requires_audit_evidence`, `requires_readback`, `notes`)
VALUES
  (
    'schema_repair_safe_additive_preferred_over_omission_v1',
    'safe_additive_schema_repair',
    'platform_repair_governance',
    'admin_control.db',
    'B',
    'active_policy_registered',
    'verify_column_added_or_policy_recorded_then_release_readiness_passes',
    1,
    0,
    1,
    1,
    1,
    1,
    'Prefer adding useful compatible missing fields, such as updated_at, over omitting canonical migration clauses. Apply only after non-destructive preflight and readback evidence.'
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
  `notes` = VALUES(`notes`),
  `updated_at` = current_timestamp();
