-- 20260729_auth_mad4b_proxy_rollout_surface.sql
-- Purpose: register a bounded deployment surface for the existing auth-mad4b-proxy Worker.
-- Safety: additive/idempotent registry changes only. This migration does not call Cloudflare,
-- upload Worker code, change DNS, modify Worker routes or subdomains, write secrets, or deploy.
-- Runtime apply remains gated by an exact Worker binding, same-cycle dry run, approved single-use
-- capability envelope, typed confirmation, pinned Git HEAD and bundle hash, source/health readback,
-- audit evidence, and automatic deployment-version rollback.
-- secrets_included=false

INSERT INTO platform_resource_authority_requirements
(requirement_key, resource_family, operation_class, display_name, description,
 required_gates_json, authority_sources_json, credential_scope_required,
 active_grant_required, ownership_claim_required, audit_required,
 readback_required, break_glass_allowed, apply_allowed,
 secrets_may_be_returned, status, notes)
VALUES
('auth_mad4b_proxy_deploy_authority_v1',
 'cloudflare_worker',
 'external_write',
 'Auth MAD4B Proxy Worker Deploy Authority',
 'Authority policy for deploying only the existing auth-mad4b-proxy Worker script. DNS, route, custom-domain, subdomain, and secret mutations are forbidden.',
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
     'expected_bundle_hash',
     'expected_git_head',
     'audit_evidence',
     'worker_source_readback',
     'health_readback',
     'automatic_deployment_version_rollback'
   ),
   'forbidden', JSON_ARRAY(
     'dns_write',
     'worker_route_write',
     'custom_domain_binding',
     'workers_dev_subdomain_write',
     'secret_write',
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
 'Apply is limited to one exact Worker script. Source and health readback plus deployment-version rollback are mandatory.')
ON DUPLICATE KEY UPDATE
 display_name=VALUES(display_name), description=VALUES(description),
 required_gates_json=VALUES(required_gates_json), authority_sources_json=VALUES(authority_sources_json),
 credential_scope_required=VALUES(credential_scope_required), active_grant_required=VALUES(active_grant_required),
 ownership_claim_required=VALUES(ownership_claim_required), audit_required=VALUES(audit_required),
 readback_required=VALUES(readback_required), break_glass_allowed=VALUES(break_glass_allowed),
 apply_allowed=VALUES(apply_allowed), secrets_may_be_returned=VALUES(secrets_may_be_returned),
 status=VALUES(status), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;

INSERT INTO resource_authority_route_family_registry
(route_family_key, display_name, route_family, operation_class, risk_class,
 resource_authority_required, authority_requirement_key, dry_run_required,
 audit_required, readback_required, apply_allowed_default, enforcement_status,
 runtime_surface, notes)
VALUES
('auth_mad4b_proxy_deploy_v1',
 'Auth MAD4B Proxy Worker Deploy',
 'cloudflare_worker',
 'external_write',
 'D',
 1,
 'auth_mad4b_proxy_deploy_authority_v1',
 1, 1, 1, 1,
 'execution_gated_supported',
 'auth_mad4b_proxy_deploy',
 'Only the specialized auth_mad4b_proxy_rollout tool may deploy this exact Worker. Generic Cloudflare mutations remain blocked.')
ON DUPLICATE KEY UPDATE
 display_name=VALUES(display_name), route_family=VALUES(route_family), operation_class=VALUES(operation_class),
 risk_class=VALUES(risk_class), resource_authority_required=VALUES(resource_authority_required),
 authority_requirement_key=VALUES(authority_requirement_key), dry_run_required=VALUES(dry_run_required),
 audit_required=VALUES(audit_required), readback_required=VALUES(readback_required),
 apply_allowed_default=VALUES(apply_allowed_default), enforcement_status=VALUES(enforcement_status),
 runtime_surface=VALUES(runtime_surface), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;

INSERT INTO capability_apply_authorization_policy_registry
(policy_key, app_key, capability_key, operation_intent, runtime_surface, status,
 allow_external_write, allow_credential_binding, allow_no_credential_binding,
 requires_ready_for_dispatch, requires_dispatch_allowed, requires_zero_blocking_gaps,
 requires_audit_evidence, requires_readback, requires_typed_confirmation,
 requires_same_cycle_dry_run, allowed_source_tiers_json, policy_json, notes)
VALUES
('auth_mad4b_proxy_deploy_apply_policy_v1',
 'cloudflare',
 'admin_cloudflare_v1',
 'auth_mad4b_proxy.deploy',
 'auth_mad4b_proxy_deploy',
 'active',
 1, 0, 1,
 1, 1, 1, 1, 1, 1, 1,
 JSON_ARRAY('platform_managed_fallback'),
 JSON_OBJECT(
   'account_id', 'dd1024b934e907723484568d97c7c74c',
   'script_name', 'auth-mad4b-proxy',
   'resource_binding_id', '177b60cd-427e-4564-abf3-0ff70791a03c',
   'runtime_surface', 'auth_mad4b_proxy_deploy',
   'dns_write_allowed', FALSE,
   'worker_route_write_allowed', FALSE,
   'custom_domain_binding_allowed', FALSE,
   'subdomain_write_allowed', FALSE,
   'secret_write_allowed', FALSE,
   'inline_secret_allowed', FALSE,
   'secret_return_allowed', FALSE,
   'expected_bundle_hash_required', TRUE,
   'expected_git_head_required', TRUE,
   'worker_source_readback_required', TRUE,
   'health_readback_required', TRUE,
   'automatic_rollback_required', TRUE,
   'single_use_envelope_required', TRUE,
   'execution_nonce_required', TRUE,
   'secrets_included', FALSE
 ),
 'Apply policy for the exact auth-mad4b-proxy Worker deployment. Generic admin_cloudflare is not certified by this row.')
ON DUPLICATE KEY UPDATE
 app_key=VALUES(app_key), capability_key=VALUES(capability_key), operation_intent=VALUES(operation_intent),
 runtime_surface=VALUES(runtime_surface), status=VALUES(status), allow_external_write=VALUES(allow_external_write),
 allow_credential_binding=VALUES(allow_credential_binding), allow_no_credential_binding=VALUES(allow_no_credential_binding),
 requires_ready_for_dispatch=VALUES(requires_ready_for_dispatch), requires_dispatch_allowed=VALUES(requires_dispatch_allowed),
 requires_zero_blocking_gaps=VALUES(requires_zero_blocking_gaps), requires_audit_evidence=VALUES(requires_audit_evidence),
 requires_readback=VALUES(requires_readback), requires_typed_confirmation=VALUES(requires_typed_confirmation),
 requires_same_cycle_dry_run=VALUES(requires_same_cycle_dry_run), allowed_source_tiers_json=VALUES(allowed_source_tiers_json),
 policy_json=VALUES(policy_json), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;

INSERT INTO runtime_dispatch_certification_registry
(certification_key, surface_key, surface_family, tool_or_action_key, risk_class,
 certification_status, smoke_strategy, dispatch_allowed, apply_allowed,
 requires_resource_authority, requires_dry_run, requires_audit_evidence,
 requires_readback, last_evidence_ref, last_certified_at, expires_at, notes)
VALUES
('auth_mad4b_proxy_deploy_v1',
 'auth_mad4b_proxy_deploy',
 'cloudflare_worker',
 'auth_mad4b_proxy_rollout',
 'D',
 'bounded_worker_deploy_contract_certified',
 'same_cycle_inventory_then_exact_git_and_bundle_pin_then_multipart_upload_then_source_and_health_readback_with_automatic_deployment_version_rollback',
 1, 1, 1, 1, 1, 1,
 'test-auth-mad4b-proxy-rollout-tool.mjs;test-auth-mad4b-proxy-rollout-surface.mjs;test-auth-mad4b-proxy-edge.mjs',
 CURRENT_TIMESTAMP,
 DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 30 DAY),
 'Certification applies only to auth_mad4b_proxy_rollout for the exact auth-mad4b-proxy Worker. DNS, route, subdomain, secret, and generic Cloudflare writes remain uncertified.')
ON DUPLICATE KEY UPDATE
 surface_key=VALUES(surface_key), surface_family=VALUES(surface_family), tool_or_action_key=VALUES(tool_or_action_key),
 risk_class=VALUES(risk_class), certification_status=VALUES(certification_status), smoke_strategy=VALUES(smoke_strategy),
 dispatch_allowed=VALUES(dispatch_allowed), apply_allowed=VALUES(apply_allowed),
 requires_resource_authority=VALUES(requires_resource_authority), requires_dry_run=VALUES(requires_dry_run),
 requires_audit_evidence=VALUES(requires_audit_evidence), requires_readback=VALUES(requires_readback),
 last_evidence_ref=VALUES(last_evidence_ref), last_certified_at=VALUES(last_certified_at),
 expires_at=VALUES(expires_at), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;

INSERT INTO platform_resource_authority_bindings
(binding_id, tenant_id, workspace_id, user_id, resource_type, resource_uri,
 resource_ref_json, recipe_key, permission_level, allowed_modes_json,
 authority_source, source_system_id, source_installation_id, expires_at,
 status, notes, created_by)
VALUES
('177b60cd-427e-4564-abf3-0ff70791a03c',
 '00000000-0000-0000-0000-000000000000',
 NULL, NULL,
 'cloudflare_worker',
 'cloudflare://accounts/dd1024b934e907723484568d97c7c74c/workers/scripts/auth-mad4b-proxy',
 JSON_OBJECT(
   'provider', 'cloudflare',
   'account_id', 'dd1024b934e907723484568d97c7c74c',
   'script_name', 'auth-mad4b-proxy',
   'dns_write_allowed', FALSE,
   'worker_route_write_allowed', FALSE,
   'custom_domain_binding_allowed', FALSE,
   'subdomain_write_allowed', FALSE,
   'secret_write_allowed', FALSE,
   'secrets_included', FALSE
 ),
 'auth_mad4b_proxy_deploy',
 'admin',
 JSON_ARRAY('dry_run','deploy'),
 'migration_seed',
 NULL, NULL, NULL,
 'active',
 'Platform-admin authority for one exact Worker script. Runtime still requires workspace membership, approved single-use envelope, typed confirmation, exact Git and bundle pins, source/health readback, and rollback.',
 'system:migration:20260729_auth_mad4b_proxy_rollout_surface')
ON DUPLICATE KEY UPDATE
 tenant_id=VALUES(tenant_id), workspace_id=VALUES(workspace_id), user_id=VALUES(user_id),
 resource_type=VALUES(resource_type), resource_uri=VALUES(resource_uri), resource_ref_json=VALUES(resource_ref_json),
 recipe_key=VALUES(recipe_key), permission_level=VALUES(permission_level), allowed_modes_json=VALUES(allowed_modes_json),
 authority_source=VALUES(authority_source), expires_at=VALUES(expires_at), status=VALUES(status),
 notes=VALUES(notes), created_by=VALUES(created_by), updated_at=CURRENT_TIMESTAMP;

INSERT INTO app_integration_tool_bindings
(binding_id, app_key, tool_key, tool_surface, binding_role,
 credential_source, exposure_scope, status, notes)
VALUES
('bind_tool_auth_mad4b_proxy_rollout',
 'cloudflare',
 'auth_mad4b_proxy_rollout',
 'virtual_tool',
 'state_changing',
 'platform_managed',
 'admin',
 'active',
 'Governed exact-Worker dry-run/apply tool with multipart upload, source and health readback, single-use envelope, and automatic deployment-version rollback.')
ON DUPLICATE KEY UPDATE
 app_key=VALUES(app_key), tool_key=VALUES(tool_key), tool_surface=VALUES(tool_surface),
 binding_role=VALUES(binding_role), credential_source=VALUES(credential_source),
 exposure_scope=VALUES(exposure_scope), status=VALUES(status), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;
