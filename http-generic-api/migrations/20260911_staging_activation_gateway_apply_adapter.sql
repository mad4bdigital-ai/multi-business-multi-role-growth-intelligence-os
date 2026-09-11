-- 20260911_staging_activation_gateway_apply_adapter.sql
-- Purpose: seed the exact server-side authority binding and dispatch policy used by the
-- profile-bound Staging Activation Gateway apply adapter.
-- Safety: additive/idempotent registry changes only. This migration does not call Cloudflare,
-- upload Worker code, write Worker secrets, mutate DNS, install local trust, deploy Production,
-- or perform any provider operation. secrets_included=false

INSERT INTO platform_resource_authority_requirements
(requirement_key, resource_family, operation_class, display_name, description,
 required_gates_json, authority_sources_json, credential_scope_required,
 active_grant_required, ownership_claim_required, audit_required,
 readback_required, break_glass_allowed, apply_allowed,
 secrets_may_be_returned, status, notes)
VALUES
('staging_activation_gateway_apply_authority_v1',
 'cloudflare_worker',
 'external_write',
 'Staging Activation Gateway Apply Authority',
 'Authority policy for the profile-owned mad4b-activation-gateway-staging Worker only. Provider target resolution is server-side; DNS and custom-domain mutation are forbidden.',
 JSON_OBJECT(
   'required', JSON_ARRAY(
     'workspace_resource_grant',
     'exact_profile_resource_binding',
     'dispatch_certification_allowed',
     'capability_envelope_ready_for_dispatch',
     'single_use_envelope_claim',
     'execution_nonce',
     'typed_confirmation',
     'exact_source_commit',
     'exact_staging_policy_hash',
     'staging_feature_flag',
     'audit_evidence',
     'public_health_exact_sha_readback',
     'public_ready_exact_sha_readback',
     'public_recovery_trust_bundle_readback',
     'automatic_rollback'
   ),
   'forbidden', JSON_ARRAY(
     'caller_selected_provider_target',
     'caller_selected_resource_binding',
     'caller_selected_policy_path',
     'caller_provider_credentials',
     'dns_write',
     'custom_domain_binding',
     'provider_secret_return',
     'production_mutation',
     'database_mutation_from_apply'
   )
 ),
 JSON_OBJECT(
   'sources', JSON_ARRAY(
     'environment_convergence_registry',
     'platform_resource_authority_bindings',
     'workspace_resource_grants',
     'runtime_dispatch_certification_registry',
     'capability_resolution_envelope_ledger',
     'capability_apply_authorization_policy_registry'
   )
 ),
 0, 1, 0, 1, 1, 0, 1, 0, 'active',
 'The adapter resolves one exact Staging Worker binding from the environment profile and publishes only non-secret trust evidence after same-cycle public readback.')
ON DUPLICATE KEY UPDATE
 display_name=VALUES(display_name),
 description=VALUES(description),
 required_gates_json=VALUES(required_gates_json),
 authority_sources_json=VALUES(authority_sources_json),
 credential_scope_required=VALUES(credential_scope_required),
 active_grant_required=VALUES(active_grant_required),
 ownership_claim_required=VALUES(ownership_claim_required),
 audit_required=VALUES(audit_required),
 readback_required=VALUES(readback_required),
 break_glass_allowed=VALUES(break_glass_allowed),
 apply_allowed=VALUES(apply_allowed),
 secrets_may_be_returned=VALUES(secrets_may_be_returned),
 status=VALUES(status),
 notes=VALUES(notes),
 updated_at=CURRENT_TIMESTAMP;

INSERT INTO resource_authority_route_family_registry
(route_family_key, display_name, route_family, operation_class, risk_class,
 resource_authority_required, authority_requirement_key, dry_run_required,
 audit_required, readback_required, apply_allowed_default, enforcement_status,
 runtime_surface, notes)
VALUES
('staging_activation_gateway_apply_v1',
 'Profile-bound Staging Activation Gateway Apply',
 'cloudflare_worker',
 'external_write',
 'D',
 1,
 'staging_activation_gateway_apply_authority_v1',
 1, 1, 1, 1,
 'execution_gated_supported',
 'activation_gateway_dark_deploy',
 'Uses the existing governed Activation Gateway rollout family but resolves the Staging target only from environment_convergence_registry.')
ON DUPLICATE KEY UPDATE
 display_name=VALUES(display_name),
 route_family=VALUES(route_family),
 operation_class=VALUES(operation_class),
 risk_class=VALUES(risk_class),
 resource_authority_required=VALUES(resource_authority_required),
 authority_requirement_key=VALUES(authority_requirement_key),
 dry_run_required=VALUES(dry_run_required),
 audit_required=VALUES(audit_required),
 readback_required=VALUES(readback_required),
 apply_allowed_default=VALUES(apply_allowed_default),
 enforcement_status=VALUES(enforcement_status),
 runtime_surface=VALUES(runtime_surface),
 notes=VALUES(notes),
 updated_at=CURRENT_TIMESTAMP;

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
   'expected_policy_hash', 'c6468e051b8456d4d3ffc6478cdb98f7048b69c8ca6742f4dca27e1eb4023f32',
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
 'profile_bound_staging_apply_contract_certified',
 'server_resolve_profile_binding_then_exact_sha_bundle_then_worker_upload_then_bound_secrets_then_public_health_ready_trust_readback_with_automatic_rollback',
 1, 1, 1, 1, 1, 1,
 'test-staging-activation-gateway-apply-adapter.mjs;test-staging-smart-gateway-convergence-contract.mjs',
 CURRENT_TIMESTAMP,
 DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 30 DAY),
 'Certification is Staging-only and does not certify generic Cloudflare, DNS, Production, or caller-selected provider operations.')
ON DUPLICATE KEY UPDATE
 surface_key=VALUES(surface_key),
 surface_family=VALUES(surface_family),
 tool_or_action_key=VALUES(tool_or_action_key),
 risk_class=VALUES(risk_class),
 certification_status=VALUES(certification_status),
 smoke_strategy=VALUES(smoke_strategy),
 dispatch_allowed=VALUES(dispatch_allowed),
 apply_allowed=VALUES(apply_allowed),
 requires_resource_authority=VALUES(requires_resource_authority),
 requires_dry_run=VALUES(requires_dry_run),
 requires_audit_evidence=VALUES(requires_audit_evidence),
 requires_readback=VALUES(requires_readback),
 last_evidence_ref=VALUES(last_evidence_ref),
 last_certified_at=VALUES(last_certified_at),
 expires_at=VALUES(expires_at),
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
 'system:migration:20260911_staging_activation_gateway_apply_adapter')
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
