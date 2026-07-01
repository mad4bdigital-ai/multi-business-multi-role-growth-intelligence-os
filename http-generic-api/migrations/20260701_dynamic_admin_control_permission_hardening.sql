-- 2026-07-01: Dynamic admin_control permission hardening follow-up.
-- Additive policy reconciliation only; the previously merged 1025 migration remains immutable.
-- no_provider_call
-- no_credential_payload_read
-- no_raw_secrets
-- no_external_send
-- no_external_write
-- secrets_included=false

INSERT INTO execution_policies
  (policy_key, policy_group, policy_value, active, execution_scope, affects_layer, blocking, notes)
VALUES
  ('dynamic_admin_control_resource_authority_v1', 'Admin Control Governance', JSON_OBJECT(
    'rule','admin_control requires an active operation-scoped binding; read-only operations require view or stronger, while mutations require edit, operate, manage, admin, or owner on both the binding and any required owner grant.',
    'authority_sources',JSON_ARRAY('platform_resource_authority_bindings','workspace_resource_grants','connected_systems','installations'),
    'provider_or_connection_type_allowlist_required',FALSE,
    'allowed_mode_source','allowed_modes_json',
    'minimum_read_permission','view',
    'minimum_mutation_permissions',JSON_ARRAY('edit','operate','manage','admin','owner'),
    'unknown_permission_behavior','deny',
    'tenant_identity_source','signed_jwt_only',
    'secrets_included',FALSE
  ), 'TRUE', 'gpt_tools_call|tool_dispatch|admin_control', 'governedExecutionPreflight|dynamicResourceAuthority|gptToolsRoutes', 'TRUE', 'Permission thresholds are enforced independently on the resource binding and required owner grant. This migration performs no provider calls or external writes.')
ON DUPLICATE KEY UPDATE
  policy_value=VALUES(policy_value), active=VALUES(active), execution_scope=VALUES(execution_scope), affects_layer=VALUES(affects_layer), blocking=VALUES(blocking), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;
