-- Sprint 67: Safe additive repair governance
-- Codifies the rule that safe additive schema repairs are preferred over
-- silently omitting registry updates when a missing column is required by the
-- same migration. This is a governance seed and an idempotent safety repair.

ALTER TABLE `admin_platform_endpoint_tools`
  ADD COLUMN IF NOT EXISTS `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp();

UPDATE execution_policies
SET policy_value = JSON_OBJECT(
    'rule','safe_additive_repair_preferred_over_omission',
    'scope','platform_schema_repair',
    'safe_additive_operations',JSON_ARRAY('idempotent nullable column add','idempotent timestamp audit column add','idempotent registry guard table creation','idempotent diagnostic view replacement'),
    'forbidden_shortcuts',JSON_ARRAY('omit registry update because a required column is missing','claim readiness after skipping intended mutation','mark recovered without same-cycle readback'),
    'requirements',JSON_ARRAY('preflight existing schema','apply only additive repair','perform same-cycle readback','record ledger/audit evidence')
  ),
  active='true',
  execution_scope='platform_schema_repair',
  affects_layer='migrations,registry,release_readiness,admin_tools',
  blocking='true',
  notes='When a live schema gap blocks a registry update and the fix is additive/non-destructive, repair the schema idempotently and continue; do not omit the intended update.',
  updated_at=CURRENT_TIMESTAMP
WHERE policy_group='platform_repair_governance'
  AND policy_key='safe_additive_repair_preferred_over_omission';

INSERT INTO execution_policies
(policy_group, policy_key, policy_value, active, execution_scope, affects_layer, blocking, notes)
SELECT 'platform_repair_governance', 'safe_additive_repair_preferred_over_omission',
  JSON_OBJECT(
    'rule','safe_additive_repair_preferred_over_omission',
    'scope','platform_schema_repair',
    'safe_additive_operations',JSON_ARRAY('idempotent nullable column add','idempotent timestamp audit column add','idempotent registry guard table creation','idempotent diagnostic view replacement'),
    'forbidden_shortcuts',JSON_ARRAY('omit registry update because a required column is missing','claim readiness after skipping intended mutation','mark recovered without same-cycle readback'),
    'requirements',JSON_ARRAY('preflight existing schema','apply only additive repair','perform same-cycle readback','record ledger/audit evidence')
  ),
  'true',
  'platform_schema_repair',
  'migrations,registry,release_readiness,admin_tools',
  'true',
  'When a live schema gap blocks a registry update and the fix is additive/non-destructive, repair the schema idempotently and continue; do not omit the intended update.'
WHERE NOT EXISTS (
  SELECT 1 FROM execution_policies
  WHERE policy_group='platform_repair_governance'
    AND policy_key='safe_additive_repair_preferred_over_omission'
);

UPDATE logic_definitions
SET display_name='Safe Additive Repair Preferred Over Omission',
    logic_type='audit',
    body_json=JSON_OBJECT(
      'policy_key','platform_repair_governance.safe_additive_repair_preferred_over_omission',
      'decision_order',JSON_ARRAY('detect_schema_gap','classify_additive_or_destructive','apply_safe_additive_repair','perform_readback','continue_intended_registry_update','record_audit'),
      'blocked_patterns',JSON_ARRAY('skip mutation silently','defer safe additive repair without task','claim recovered without validation'),
      'runtime_execution_allowed',false
    ),
    source_url='db://execution_policies/platform_repair_governance/safe_additive_repair_preferred_over_omission',
    package_version='v1',
    skill_manifest=JSON_OBJECT('policy_key','safe_additive_repair_preferred_over_omission','runtime_execution_allowed',false,'schema_repair_guard',true),
    version='1.0',
    status='active',
    updated_at=CURRENT_TIMESTAMP
WHERE logic_key='platform.schema_repair.safe_additive_preferred_over_omission';

INSERT INTO logic_definitions
(logic_id, logic_key, display_name, logic_type, parent_logic_id, tenant_id, body_json, source_url, package_version, skill_manifest, version, status)
SELECT UUID(), 'platform.schema_repair.safe_additive_preferred_over_omission', 'Safe Additive Repair Preferred Over Omission', 'audit', NULL, NULL,
  JSON_OBJECT(
    'policy_key','platform_repair_governance.safe_additive_repair_preferred_over_omission',
    'decision_order',JSON_ARRAY('detect_schema_gap','classify_additive_or_destructive','apply_safe_additive_repair','perform_readback','continue_intended_registry_update','record_audit'),
    'blocked_patterns',JSON_ARRAY('skip mutation silently','defer safe additive repair without task','claim recovered without validation'),
    'runtime_execution_allowed',false
  ),
  'db://execution_policies/platform_repair_governance/safe_additive_repair_preferred_over_omission',
  'v1',
  JSON_OBJECT('policy_key','safe_additive_repair_preferred_over_omission','runtime_execution_allowed',false,'schema_repair_guard',true),
  '1.0',
  'active'
WHERE NOT EXISTS (
  SELECT 1 FROM logic_definitions
  WHERE logic_key='platform.schema_repair.safe_additive_preferred_over_omission'
);

INSERT INTO runtime_dispatch_certification_registry
  (certification_key, surface_key, surface_family, tool_or_action_key, risk_class, certification_status,
   smoke_strategy, dispatch_allowed, apply_allowed, requires_resource_authority, requires_dry_run,
   requires_audit_evidence, requires_readback, notes)
VALUES
  ('schema_repair_safe_additive_preferred_over_omission_v1', 'schema_repair_governance', 'platform_repair_governance', 'admin_control.db', 'B', 'active_policy_registered',
   'preflight_schema_gap_then_apply_only_additive_repair_and_read_back',
   1, 0, 1, 1, 1, 1,
   'Policy registration for safe additive schema repair. Dispatch is allowed for dry-run/readback; apply still requires governed admin DB mutation path and same-cycle evidence.')
ON DUPLICATE KEY UPDATE
  surface_key=VALUES(surface_key), surface_family=VALUES(surface_family), tool_or_action_key=VALUES(tool_or_action_key),
  risk_class=VALUES(risk_class), certification_status=VALUES(certification_status), smoke_strategy=VALUES(smoke_strategy),
  dispatch_allowed=VALUES(dispatch_allowed), apply_allowed=VALUES(apply_allowed), requires_resource_authority=VALUES(requires_resource_authority),
  requires_dry_run=VALUES(requires_dry_run), requires_audit_evidence=VALUES(requires_audit_evidence), requires_readback=VALUES(requires_readback),
  notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;
