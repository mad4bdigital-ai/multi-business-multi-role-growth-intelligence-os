-- Sprint 67: Google Ads budget preflight capability binding.
-- Scope: registry-only binding for preflight. Does not register Google Ads execution or credentials.

INSERT INTO actions (
  action_key, status, module_binding, connector_family, api_key_mode, api_key_storage_mode,
  runtime_capability_class, runtime_callable, primary_executor, notes,
  action_title, action_class, action_scope, execution_layer, inventory_role,
  request_envelope_required, structured_api_supported, provider_agnostic, admin_only, writeback_scope
) VALUES (
  'google_ads_budget_change_preflight',
  'active',
  'http-generic-api/scripts/google-ads-budget-change-preflight.mjs',
  'google_ads_preflight',
  'none',
  'none',
  'preflight_only',
  '0',
  'admin_cli_dry_run',
  'Preflight-only Google Ads budget change gate. Requires capability envelope and budget/quota authority. No Google Ads provider call, no credential read, no spend mutation, secrets_included=false.',
  'Google Ads Budget Change Preflight',
  'preflight',
  'google_ads_budget_change',
  'admin_cli_dry_run',
  'spend_governance_preflight',
  'true',
  'true',
  'true',
  'true',
  'none'
)
ON DUPLICATE KEY UPDATE
  status = VALUES(status),
  module_binding = VALUES(module_binding),
  connector_family = VALUES(connector_family),
  api_key_mode = VALUES(api_key_mode),
  api_key_storage_mode = VALUES(api_key_storage_mode),
  runtime_capability_class = VALUES(runtime_capability_class),
  runtime_callable = VALUES(runtime_callable),
  primary_executor = VALUES(primary_executor),
  notes = VALUES(notes),
  action_title = VALUES(action_title),
  action_class = VALUES(action_class),
  action_scope = VALUES(action_scope),
  execution_layer = VALUES(execution_layer),
  inventory_role = VALUES(inventory_role),
  request_envelope_required = VALUES(request_envelope_required),
  structured_api_supported = VALUES(structured_api_supported),
  provider_agnostic = VALUES(provider_agnostic),
  admin_only = VALUES(admin_only),
  writeback_scope = VALUES(writeback_scope),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO app_integration_action_bindings (
  binding_id, app_key, action_key, binding_role, credential_source, exposure_default, status, notes
) VALUES (
  'google_ads_budget_change_preflight_binding_v1',
  'google_ads',
  'google_ads_budget_change_preflight',
  'resolver',
  'none',
  'runtime_only',
  'active',
  'Preflight-only binding. Allows Google Ads budget preflight envelopes without a real Google Ads user connection. Real googleads_api remains user_connection based. secrets_included=false.'
)
ON DUPLICATE KEY UPDATE
  action_key = VALUES(action_key),
  binding_role = VALUES(binding_role),
  credential_source = VALUES(credential_source),
  exposure_default = VALUES(exposure_default),
  status = VALUES(status),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO runtime_dispatch_certification_registry (
  certification_key, surface_key, surface_family, tool_or_action_key, risk_class,
  certification_status, smoke_strategy, dispatch_allowed, apply_allowed,
  requires_resource_authority, requires_dry_run, requires_audit_evidence, requires_readback,
  last_evidence_ref, last_certified_at, notes
) VALUES (
  'google_ads_budget_change',
  'google_ads_budget_change_preflight',
  'google_ads_spend_preflight',
  'google_ads_budget_change_preflight',
  'critical',
  'preflight_only_no_provider_call_ci_passed',
  'static_guard_budget_quota_preflight_no_spend_smoke',
  1,
  0,
  1,
  1,
  1,
  1,
  'pr:900:ci_success:migration_238_applied',
  NOW(),
  'Dispatch certification for Google Ads budget preflight envelopes only. No Google Ads provider call, no credential read, no spend mutation, secrets_included=false.'
)
ON DUPLICATE KEY UPDATE
  surface_key = VALUES(surface_key),
  surface_family = VALUES(surface_family),
  tool_or_action_key = VALUES(tool_or_action_key),
  risk_class = VALUES(risk_class),
  certification_status = VALUES(certification_status),
  smoke_strategy = VALUES(smoke_strategy),
  dispatch_allowed = VALUES(dispatch_allowed),
  apply_allowed = VALUES(apply_allowed),
  requires_resource_authority = VALUES(requires_resource_authority),
  requires_dry_run = VALUES(requires_dry_run),
  requires_audit_evidence = VALUES(requires_audit_evidence),
  requires_readback = VALUES(requires_readback),
  last_evidence_ref = VALUES(last_evidence_ref),
  last_certified_at = VALUES(last_certified_at),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO platform_runtime_config
  (config_key, config_json, status, note)
VALUES
  ('google_ads_budget_preflight_binding_policy_v1',
   JSON_OBJECT(
     'policy_key','google_ads_budget_preflight_binding_policy_v1',
     'status','active',
     'app_key','google_ads',
     'preflight_action_key','google_ads_budget_change_preflight',
     'real_provider_action_key','googleads_api',
     'preflight_credential_source','none',
     'real_provider_credential_source','user_connection',
     'preflight_only',true,
     'allows_envelope_without_google_ads_connection',true,
     'allows_provider_execution_without_google_ads_connection',false,
     'requires_budget_quota_authority',true,
     'requires_capability_envelope',true,
     'no_provider_call',true,
     'no_credential_read',true,
     'no_spend_change',true,
     'secrets_included',false
   ),
   'active',
   'Google Ads budget preflight binding policy. Preflight envelopes do not require Google Ads credentials; real Google Ads API execution still requires user_connection.'
  )
ON DUPLICATE KEY UPDATE
  config_json = VALUES(config_json),
  status = VALUES(status),
  note = VALUES(note),
  updated_at = CURRENT_TIMESTAMP;
