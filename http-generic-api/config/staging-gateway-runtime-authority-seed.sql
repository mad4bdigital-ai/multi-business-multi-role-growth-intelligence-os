-- staging-gateway-runtime-authority-seed.sql
-- Local Staging Runtime DB only.
-- Restores the Runtime-owned authority requirement and route metadata used by the
-- profile-bound Staging Activation Gateway after schema-only database recovery.
-- No provider, grant, DNS, custom-domain, Production, Hostinger, or secret mutation.

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
