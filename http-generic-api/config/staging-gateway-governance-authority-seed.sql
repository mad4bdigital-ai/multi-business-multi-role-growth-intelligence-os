-- staging-gateway-governance-authority-seed.sql
-- Local Staging Governance DB only.
-- Restores the Governance-owned apply policy and exact Worker authority binding after
-- schema-only database recovery while forcing dispatch certification back to pending.
-- No provider, grant, DNS, custom-domain, Production, Hostinger, or secret mutation.

INSERT INTO capability_apply_authorization_policy_registry
(policy_key, app_key, capability_key, operation_intent, runtime_surface, status,
 allow_external_write, allow_credential_binding, allow_no_credential_binding,
 requires_ready_for_dispatch, requires_dispatch_allowed, requires_zero_blocking_gaps,
 requires_audit_evidence, requires_readback, requires_typed_confirmation,
 requires_same_cycle_dry_run, allowed_source_tiers_json, policy_json, notes)
VALUES
('staging_activation_gateway_apply_policy_v1',
 'cloudflare',
 'admin_cloudflare_v1',
 'activation_gateway.staging_apply',
 'activation_gateway_dark_deploy',
 'active',
 1, 0, 1,
 1, 1, 1, 1, 1, 1, 1,
 JSON_ARRAY('platform_managed_fallback'),
 JSON_OBJECT(
   'environment', 'staging',
   'profile_key', 'activation_gateway_staging',
   'resource_binding_id', '5a2b04f8-bb99-4f65-a924-0f55d3080376',
   'script_name', 'mad4b-activation-gateway-staging',
   'policy_key', 'activation_gateway_staging',
   'expected_policy_hash', 'dd5f152c4a226d07c75cf33dae3ab3a0cbf6e9913b623724429a96b2d4f96a96',
   'public_host', 'activation-dev.mad4b.com',
   'runtime_surface', 'activation_gateway_dark_deploy',
   'feature_flag', 'STAGING_ACTIVATION_GATEWAY_APPLY_ENABLED',
   'server_resolved_target_required', TRUE,
   'caller_target_override_allowed', FALSE,
   'public_trust_bundle_required', TRUE,
   'dns_write_allowed', FALSE,
   'custom_domain_binding_allowed', FALSE,
   'provider_credentials_from_caller_allowed', FALSE,
   'provider_secret_return_allowed', FALSE,
   'production_mutation_allowed', FALSE,
   'automatic_rollback_required', TRUE,
   'single_use_envelope_required', TRUE,
   'execution_nonce_required', TRUE,
   'secrets_included', FALSE
 ),
 'Apply policy for the exact Staging Activation Gateway Worker. Account and script are read from the profile-owned authority binding; caller values are assertions only.')
ON DUPLICATE KEY UPDATE
 app_key=VALUES(app_key),
 capability_key=VALUES(capability_key),
 operation_intent=VALUES(operation_intent),
 runtime_surface=VALUES(runtime_surface),
 status=VALUES(status),
 allow_external_write=VALUES(allow_external_write),
 allow_credential_binding=VALUES(allow_credential_binding),
 allow_no_credential_binding=VALUES(allow_no_credential_binding),
 requires_ready_for_dispatch=VALUES(requires_ready_for_dispatch),
 requires_dispatch_allowed=VALUES(requires_dispatch_allowed),
 requires_zero_blocking_gaps=VALUES(requires_zero_blocking_gaps),
 requires_audit_evidence=VALUES(requires_audit_evidence),
 requires_readback=VALUES(requires_readback),
 requires_typed_confirmation=VALUES(requires_typed_confirmation),
 requires_same_cycle_dry_run=VALUES(requires_same_cycle_dry_run),
 allowed_source_tiers_json=VALUES(allowed_source_tiers_json),
 policy_json=VALUES(policy_json),
 notes=VALUES(notes),
 updated_at=CURRENT_TIMESTAMP;

INSERT INTO platform_resource_authority_bindings
(binding_id, tenant_id, workspace_id, user_id, resource_type, resource_uri,
 resource_ref_json, recipe_key, permission_level, allowed_modes_json,
 authority_source, source_system_id, source_installation_id, expires_at,
 status, notes, created_by)
VALUES
('5a2b04f8-bb99-4f65-a924-0f55d3080376',
 '00000000-0000-0000-0000-000000000000',
 NULL,
 NULL,
 'cloudflare_worker',
 'cloudflare://accounts/dd1024b934e907723484568d97c7c74c/workers/scripts/mad4b-activation-gateway-staging',
 JSON_OBJECT(
   'provider', 'cloudflare',
   'account_id', 'dd1024b934e907723484568d97c7c74c',
   'script_name', 'mad4b-activation-gateway-staging',
   'profile_key', 'activation_gateway_staging',
   'workers_dev_only', TRUE,
   'dns_write_allowed', FALSE,
   'custom_domain_binding_allowed', FALSE,
   'secrets_included', FALSE
 ),
 'staging_activation_gateway_apply',
 'admin',
 JSON_ARRAY('dry_run','staging_apply'),
 'migration_seed',
 NULL,
 NULL,
 NULL,
 'active',
 'Exact Staging Worker authority. Runtime apply also requires profile identity, capability envelope, dispatch certification, typed confirmation, exact SHA/policy, public readback, audit, and rollback.',
 'system:staging-recovery:gateway-governance-authority-seed')
ON DUPLICATE KEY UPDATE
 tenant_id=VALUES(tenant_id),
 workspace_id=VALUES(workspace_id),
 user_id=VALUES(user_id),
 resource_type=VALUES(resource_type),
 resource_uri=VALUES(resource_uri),
 resource_ref_json=VALUES(resource_ref_json),
 recipe_key=VALUES(recipe_key),
 permission_level=VALUES(permission_level),
 allowed_modes_json=VALUES(allowed_modes_json),
 authority_source=VALUES(authority_source),
 expires_at=VALUES(expires_at),
 status=VALUES(status),
 notes=VALUES(notes),
 created_by=VALUES(created_by),
 updated_at=CURRENT_TIMESTAMP;

INSERT INTO runtime_dispatch_certification_registry
(certification_key, surface_key, surface_family, tool_or_action_key, risk_class,
 certification_status, smoke_strategy, dispatch_allowed, apply_allowed,
 requires_resource_authority, requires_dry_run, requires_audit_evidence,
 requires_readback, last_evidence_ref, last_certified_at, expires_at, notes)
VALUES
('staging_activation_gateway_apply_v1',
 'activation_gateway_dark_deploy',
 'cloudflare_worker',
 'activation_gateway_dark_deploy',
 'D',
 'pending',
 'independent_same_cycle_staging_gateway_transaction_certification',
 0, 0, 1, 1, 1, 1,
 NULL, NULL, NULL,
 'Local Staging recovery seed restores authority metadata only. Independent same-cycle certification is required before provider apply.')
ON DUPLICATE KEY UPDATE
 surface_key=VALUES(surface_key),
 surface_family=VALUES(surface_family),
 tool_or_action_key=VALUES(tool_or_action_key),
 risk_class=VALUES(risk_class),
 certification_status='pending',
 smoke_strategy=VALUES(smoke_strategy),
 dispatch_allowed=0,
 apply_allowed=0,
 requires_resource_authority=VALUES(requires_resource_authority),
 requires_dry_run=VALUES(requires_dry_run),
 requires_audit_evidence=VALUES(requires_audit_evidence),
 requires_readback=VALUES(requires_readback),
 last_evidence_ref=NULL,
 last_certified_at=NULL,
 expires_at=NULL,
 notes=VALUES(notes),
 updated_at=CURRENT_TIMESTAMP;
