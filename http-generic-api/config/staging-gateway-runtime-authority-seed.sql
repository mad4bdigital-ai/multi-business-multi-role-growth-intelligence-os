-- staging-gateway-runtime-authority-seed.sql
-- Local Staging Runtime DB only.
-- Restores the Runtime-owned authority requirement and route metadata used by the
-- profile-bound Staging Activation Gateway after schema-only database recovery.
-- No provider, DNS, custom-domain, Production, Hostinger, or secret-value mutation. Managed credential/config metadata only.

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
     'workspace_resource_grant_or_exact_platform_resource_authority',
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
     'capability_apply_authorization_policy_registry',
     'credential_bindings',
     'platform_secrets',
     'platform_runtime_config'
   )
 ),
 0, 0, 0, 1, 1, 0, 1, 0, 'active',
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


INSERT INTO connected_systems
(system_id, tenant_id, system_key, display_name, provider_family, provider_domain,
 connector_family, auth_type, service_mode, self_serve_capable, assisted_capable,
 managed_capable, status, config_json)
VALUES
('84310000-0000-4000-8000-000000000001',
 '00000000-0000-0000-0000-000000000000',
 'cloudflare_staging_activation_gateway_managed',
 'Cloudflare Staging Activation Gateway (Managed)',
 'cloudflare',
 'api.cloudflare.com',
 'cloudflare_api',
 'bearer_token',
 'managed',
 0, 0, 1, 'pending',
 JSON_OBJECT(
   'environment','staging',
   'resource_binding_id','5a2b04f8-bb99-4f65-a924-0f55d3080376',
   'account_id','dd1024b934e907723484568d97c7c74c',
   'script_name','mad4b-activation-gateway-staging',
   'target_key','staging_activation_gateway_cloudflare',
   'credential_role','cloudflare_api_token',
   'secret_storage','platform_db_encrypted',
   'secrets_included',FALSE
 ))
ON DUPLICATE KEY UPDATE
 display_name=VALUES(display_name),
 provider_family=VALUES(provider_family),
 provider_domain=VALUES(provider_domain),
 connector_family=VALUES(connector_family),
 auth_type=VALUES(auth_type),
 service_mode=VALUES(service_mode),
 managed_capable=VALUES(managed_capable),
 config_json=VALUES(config_json),
 updated_at=CURRENT_TIMESTAMP;

INSERT INTO platform_secrets
(secret_key, secret_type, storage_backend, secret_ref, value_sha256, value_ciphertext,
 metadata_json, status, created_by)
VALUES
('staging_cloudflare_activation_gateway_api_token',
 'bearer_token',
 'db_encrypted',
 NULL,
 NULL,
 '',
 JSON_OBJECT(
   'provisioning_status','pending_secret_value',
   'environment','staging',
   'provider_family','cloudflare',
   'target_key','staging_activation_gateway_cloudflare',
   'credential_role','cloudflare_api_token',
   'required_for','activation_gateway_dark_deploy',
   'secrets_included',FALSE
 ),
 'active',
 'system:staging-recovery:gateway-runtime-authority-seed')
ON DUPLICATE KEY UPDATE
 secret_type=VALUES(secret_type),
 storage_backend='db_encrypted',
 metadata_json=JSON_SET(
   COALESCE(metadata_json, JSON_OBJECT()),
   '$.environment','staging',
   '$.provider_family','cloudflare',
   '$.target_key','staging_activation_gateway_cloudflare',
   '$.credential_role','cloudflare_api_token',
   '$.required_for','activation_gateway_dark_deploy',
   '$.secrets_included',FALSE
 ),
 status='active',
 updated_at=CURRENT_TIMESTAMP;

INSERT INTO secret_references
(ref_id, tenant_id, owner_type, owner_id, system_id, action_key, provider_family,
 connector_family, credential_type, scope_json, consent_status, validation_status,
 status, secret_key, store_type, env_var_name, vault_path, description)
VALUES
('84310000-0000-4000-8000-000000000002',
 '00000000-0000-0000-0000-000000000000',
 'platform',
 'platform_admin',
 '84310000-0000-4000-8000-000000000001',
 'activation_gateway_dark_deploy',
 'cloudflare',
 'cloudflare_api',
 'bearer_token',
 JSON_OBJECT('environment','staging','target_key','staging_activation_gateway_cloudflare','secrets_included',FALSE),
 'not_required',
 'pending_secret_value',
 'active',
 'staging_cloudflare_activation_gateway_api_token',
 'db_encrypted',
 NULL,
 NULL,
 'Managed DB-encrypted Cloudflare token reference for the Staging Activation Gateway only.')
ON DUPLICATE KEY UPDATE
 owner_type=VALUES(owner_type),
 owner_id=VALUES(owner_id),
 system_id=VALUES(system_id),
 action_key=VALUES(action_key),
 provider_family=VALUES(provider_family),
 connector_family=VALUES(connector_family),
 credential_type=VALUES(credential_type),
 scope_json=VALUES(scope_json),
 consent_status=VALUES(consent_status),
 status='active',
 store_type='db_encrypted',
 env_var_name=NULL,
 vault_path=NULL,
 description=VALUES(description);

INSERT INTO credential_bindings
(binding_id, tenant_id, owner_type, owner_id, system_id, action_key, target_key,
 credential_role, credential_ref, provider_family, connector_family,
 resolution_priority, status, created_by)
VALUES
('84310000-0000-4000-8000-000000000003',
 '00000000-0000-0000-0000-000000000000',
 'platform',
 'platform_admin',
 '84310000-0000-4000-8000-000000000001',
 'activation_gateway_dark_deploy',
 'staging_activation_gateway_cloudflare',
 'cloudflare_api_token',
 'platform_secret:staging_cloudflare_activation_gateway_api_token',
 'cloudflare',
 'cloudflare_api',
 10,
 'active',
 'system:staging-recovery:gateway-runtime-authority-seed')
ON DUPLICATE KEY UPDATE
 tenant_id=VALUES(tenant_id),
 owner_type=VALUES(owner_type),
 owner_id=VALUES(owner_id),
 system_id=VALUES(system_id),
 action_key=VALUES(action_key),
 target_key=VALUES(target_key),
 credential_role=VALUES(credential_role),
 credential_ref=VALUES(credential_ref),
 provider_family=VALUES(provider_family),
 connector_family=VALUES(connector_family),
 resolution_priority=VALUES(resolution_priority),
 status='active',
 created_by=VALUES(created_by),
 updated_at=CURRENT_TIMESTAMP;

INSERT INTO platform_runtime_config
(config_key, config_json, status, note)
VALUES
('staging_activation_gateway_apply',
 JSON_OBJECT(
   'enabled',TRUE,
   'environment','staging',
   'authority_model','server_governed_managed',
   'credential_target_key','staging_activation_gateway_cloudflare',
   'credential_role','cloudflare_api_token',
   'resource_binding_id','5a2b04f8-bb99-4f65-a924-0f55d3080376',
   'secrets_included',FALSE
 ),
 'active',
 'Staging-only managed feature gate. This enables the adapter path but never bypasses credential, certification, envelope, typed confirmation, nonce, audit, readback, or rollback gates.')
ON DUPLICATE KEY UPDATE
 config_json=VALUES(config_json),
 status=VALUES(status),
 note=VALUES(note),
 updated_at=CURRENT_TIMESTAMP;
