-- 20260627_activation_gateway_rollout_surface.sql
-- Purpose: register a bounded, workers.dev-only Activation Gateway dark-deploy surface.
-- Safety: additive/idempotent registry changes only. This migration does not call Cloudflare,
-- upload Worker code, write secrets, create workers.dev subdomains, change DNS, bind a custom
-- domain, or execute a deployment. Runtime apply remains gated by exact resource binding,
-- approved capability envelope, typed confirmation, signed attestation, feature flag,
-- same-cycle readback, and automatic rollback.
-- secrets_included=false

INSERT INTO platform_resource_authority_requirements
(requirement_key, resource_family, operation_class, display_name, description,
 required_gates_json, authority_sources_json, credential_scope_required,
 active_grant_required, ownership_claim_required, audit_required,
 readback_required, break_glass_allowed, apply_allowed,
 secrets_may_be_returned, status, notes)
VALUES
('activation_gateway_dark_deploy_authority_v1',
 'cloudflare_worker',
 'external_write',
 'Activation Gateway Dark Deploy Authority',
 'Authority policy for deploying only the mad4b-activation-gateway Worker to workers.dev. DNS and custom-domain binding are explicitly forbidden.',
 JSON_OBJECT(
   'required', JSON_ARRAY(
     'workspace_resource_grant',
     'exact_worker_resource_binding',
     'dispatch_certification_allowed',
     'same_cycle_dry_run',
     'capability_envelope_ready_for_dispatch',
     'single_use_envelope_claim',
     'execution_nonce',
     'typed_confirmation',
     'signed_deployment_attestation',
     'expected_policy_hash',
     'expected_source_commit',
     'feature_flag',
     'audit_evidence',
     'workers_dev_health_readback',
     'workers_dev_ready_readback',
     'rollback_target_or_delete_new_script'
   ),
   'forbidden', JSON_ARRAY(
     'dns_write',
     'custom_domain_binding',
     'inline_secret',
     'secret_return',
     'freeform_cloudflare_path',
     'unbounded_provider_output'
   )
 ),
 JSON_OBJECT(
   'sources', JSON_ARRAY(
     'platform_resource_authority_bindings',
     'workspace_resource_grants',
     'runtime_dispatch_certification_registry',
     'capability_resolution_envelope_ledger',
     'capability_apply_authorization_policy_registry'
   )
 ),
 0, 1, 0, 1, 1, 0, 1, 0, 'active',
 'Apply is limited to the exact Cloudflare account and Worker script resource binding. workers.dev smoke and rollback are mandatory before success.')
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
('activation_gateway_dark_deploy_v1',
 'Activation Gateway workers.dev Dark Deploy',
 'cloudflare_worker',
 'external_write',
 'D',
 1,
 'activation_gateway_dark_deploy_authority_v1',
 1, 1, 1, 1,
 'execution_gated_supported',
 'activation_gateway_dark_deploy',
 'Only the specialized Activation Gateway rollout tool may use this route family. Generic Cloudflare and DNS writes remain baseline-blocked.')
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
('activation_gateway_dark_deploy_apply_policy_v1',
 'cloudflare',
 'admin_cloudflare_v1',
 'activation_gateway.dark_deploy',
 'activation_gateway_dark_deploy',
 'active',
 1, 0, 1,
 1, 1, 1, 1, 1, 1, 1,
 JSON_ARRAY('platform_managed_fallback'),
 JSON_OBJECT(
   'account_id', 'dd1024b934e907723484568d97c7c74c',
   'script_name', 'mad4b-activation-gateway',
   'resource_binding_id', '8be421f5-49d3-4bda-a0f6-3cf8a04ee227',
   'runtime_surface', 'activation_gateway_dark_deploy',
   'feature_flag', 'ACTIVATION_GATEWAY_DARK_DEPLOY_ENABLED',
   'workers_dev_only', TRUE,
   'dns_write_allowed', FALSE,
   'custom_domain_binding_allowed', FALSE,
   'inline_secret_allowed', FALSE,
   'secret_return_allowed', FALSE,
   'signed_attestation_required', TRUE,
   'expected_policy_hash_required', TRUE,
   'expected_source_commit_required', TRUE,
   'automatic_rollback_required', TRUE,
   'single_use_envelope_required', TRUE,
   'execution_nonce_required', TRUE,
   'secrets_included', FALSE
 ),
 'Apply policy for the bounded Activation Gateway workers.dev dark deploy. The generic admin_cloudflare surface is not certified by this row.')
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
('activation_gateway_dark_deploy_v1',
 'activation_gateway_dark_deploy',
 'cloudflare_worker',
 'activation_gateway_dark_deploy',
 'D',
 'bounded_dark_deploy_contract_certified',
 'same_cycle_inventory_then_signed_attestation_then_worker_upload_then_secret_write_then_workers_dev_health_ready_readback_with_automatic_rollback',
 1, 1, 1, 1, 1, 1,
 'test-activation-gateway-rollout-tool.mjs;test-activation-gateway-rollout-surface.mjs;test-activation-gateway.mjs',
 CURRENT_TIMESTAMP,
 DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 30 DAY),
 'Certification applies only to activation_gateway_dark_deploy. Generic admin_cloudflare and Cloudflare DNS writes remain uncertified and blocked.')
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
('8be421f5-49d3-4bda-a0f6-3cf8a04ee227',
 '00000000-0000-0000-0000-000000000000',
 NULL,
 NULL,
 'cloudflare_worker',
 'cloudflare://accounts/dd1024b934e907723484568d97c7c74c/workers/scripts/mad4b-activation-gateway',
 JSON_OBJECT(
   'provider', 'cloudflare',
   'account_id', 'dd1024b934e907723484568d97c7c74c',
   'script_name', 'mad4b-activation-gateway',
   'workers_dev_only', TRUE,
   'dns_write_allowed', FALSE,
   'custom_domain_binding_allowed', FALSE,
   'secrets_included', FALSE
 ),
 'activation_gateway_dark_deploy',
 'admin',
 JSON_ARRAY('dry_run','dark_deploy'),
 'migration_seed',
 NULL,
 NULL,
 NULL,
 'active',
 'Platform-admin authority for one exact Worker script. Runtime still requires workspace grant, approved capability envelope, typed confirmation, signed attestation, feature flag, readback, and rollback.',
 'system:migration:20260627_activation_gateway_rollout_surface')
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

INSERT INTO app_integration_tool_bindings
(binding_id, app_key, tool_key, tool_surface, binding_role,
 credential_source, exposure_scope, status, notes)
VALUES
('bind_tool_activation_gateway_rollout_plan',
 'cloudflare',
 'activation_gateway_rollout_plan',
 'virtual_tool',
 'read_only',
 'platform_managed',
 'admin',
 'active',
 'Read-only Activation Gateway rollout plan. No external write, DNS, custom domain, or secret return.'),
('bind_tool_activation_gateway_dark_deploy',
 'cloudflare',
 'activation_gateway_dark_deploy',
 'virtual_tool',
 'state_changing',
 'platform_managed',
 'admin',
 'active',
 'Governed workers.dev-only dark deploy with exact resource binding, approved envelope, signed attestation, typed confirmation, readback, and rollback.')
ON DUPLICATE KEY UPDATE
 app_key=VALUES(app_key),
 tool_key=VALUES(tool_key),
 tool_surface=VALUES(tool_surface),
 binding_role=VALUES(binding_role),
 credential_source=VALUES(credential_source),
 exposure_scope=VALUES(exposure_scope),
 status=VALUES(status),
 notes=VALUES(notes),
 updated_at=CURRENT_TIMESTAMP;
