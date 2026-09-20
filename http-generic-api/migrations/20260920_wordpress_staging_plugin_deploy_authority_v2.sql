-- Governed WordPress Staging exact-artifact deployment authority v2.
-- Server resolves the unique ETG Staging Hostinger target from remote_runtime_targets.
-- This migration does NOT create/update targets, credentials, grants, approvals, or Production authority.

INSERT INTO remote_runtime_command_allowlists
(command_id, plugin_key, command_key, display_name, target_kind, command_template, input_schema_json, risk_class, requires_approval, is_consequential, output_policy, status, notes)
VALUES
(UUID(), 'remote_ssh_runtime', 'wordpress_plugin_deploy', 'Deploy reviewed WordPress plugin artifact', 'hosting_account', 'remote_runtime:ssh:wordpress_plugin_deploy',
 JSON_OBJECT(
   'type','object',
   'required',JSON_ARRAY('expected_head_sha'),
   'properties',JSON_OBJECT(
     'expected_head_sha',JSON_OBJECT('type','string','pattern','^[0-9a-f]{40}$'),
     'dry_run',JSON_OBJECT('type','boolean','default',true),
     'approval_reason',JSON_OBJECT('type','string','minLength',20,'maxLength',1000),
     'capability_envelope_id',JSON_OBJECT('type','string','minLength',1,'maxLength',64),
     'timeout_ms',JSON_OBJECT('type','integer','minimum',1000,'maximum',300000)
   ),
   'additionalProperties',false
 ),
 'high', 1, 1, 'bounded_text', 'active',
 'Staging-only WordPress plugin deployment. Source is the successful exact-head General Distribution artifact. Target/path/SSH credentials are resolved server-side. Apply requires exact capability envelope, atomic replacement, exact provenance readback, and rollback on failure.'
)
ON DUPLICATE KEY UPDATE
 display_name=VALUES(display_name),
 target_kind=VALUES(target_kind),
 command_template=VALUES(command_template),
 input_schema_json=VALUES(input_schema_json),
 risk_class=VALUES(risk_class),
 requires_approval=VALUES(requires_approval),
 is_consequential=VALUES(is_consequential),
 output_policy=VALUES(output_policy),
 status=VALUES(status),
 notes=VALUES(notes),
 updated_at=CURRENT_TIMESTAMP;

INSERT INTO admin_platform_endpoint_tools
(tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
('wordpress_staging_plugin_deploy',
 'WordPress Staging Plugin Deploy',
 'Dry-run by default. Resolves the unique registered ETG Staging Hostinger target server-side, verifies the exact reviewed WordPress General Distribution artifact and Site Profile identity, and deploys only after explicit apply authority. Production, Breakglass, caller-selected targets/paths/credentials and File Manager are not accepted.',
 'POST',
 '/platform/remote-runtime/wordpress/staging/deploy-plugin',
 NULL,
 '{"type":"object","required":["expected_head_sha"],"properties":{"expected_head_sha":{"type":"string","pattern":"^[0-9a-f]{40}$"},"dry_run":{"type":"boolean","default":true},"approval_reason":{"type":"string","minLength":20,"maxLength":1000},"capability_envelope_id":{"type":"string","minLength":1,"maxLength":64},"timeout_ms":{"type":"integer","minimum":1000,"maximum":300000}},"additionalProperties":false}',
 NULL,
 'admin,remote-runtime,wordpress,staging,hostinger,artifact,exact_head,server_resolved_target,site_profile_bound,capability_envelope_required,approval_required,state_changing,dry_run_default,no_secrets,no_caller_target,no_caller_path,no_caller_credentials,no_breakglass,no_production',
 1,
 154
)
ON DUPLICATE KEY UPDATE
 display_name=VALUES(display_name),
 description=VALUES(description),
 http_method=VALUES(http_method),
 http_path=VALUES(http_path),
 path_param_keys=VALUES(path_param_keys),
 input_schema=VALUES(input_schema),
 fixed_body=VALUES(fixed_body),
 tags=VALUES(tags),
 is_enabled=VALUES(is_enabled),
 sort_order=VALUES(sort_order),
 updated_at=CURRENT_TIMESTAMP;

INSERT INTO execution_policies
(policy_group, policy_key, policy_value, active, execution_scope, affects_layer, blocking, notes)
VALUES
('wordpress_staging_plugin_deploy_governance','wordpress_staging_plugin_deploy_exact_artifact_guard_v2',
 JSON_OBJECT(
   'contract','mad4b.wordpress-staging-plugin-deploy.v2',
   'handoff_contract','mad4b.wordpress-deployment-handoff.v2',
   'source_repository','mad4bdigital-ai/WordPress',
   'source_workflow','mad4b-control-plane-package.yml',
   'artifact_name_template','mad4b-site-control-plane-general-distribution-kit-{exact_head_sha}',
   'install_manifest_contract','mad4b.site-control-plane.general-distribution-kit.v1',
   'target_environment','staging',
   'target_origin','https://staging.egypttourgates.com',
   'target_site_uuid','d745d81f-6fc4-5c6a-99dd-d953c92137bf',
   'target_resolution','unique_server_side_remote_runtime_target',
   'mcp_adapter_version','0.6.1',
   'dry_run_default',true,
   'requires',JSON_ARRAY(
     'unique_active_validated_hostinger_staging_target',
     'exact_site_uuid_origin_environment_target_identity',
     'target_command_allowlist_wordpress_plugin_deploy',
     'server_owned_root_and_path_allowlist',
     'server_side_ssh_credentials',
     'successful_exact_head_package_run',
     'github_artifact_digest_verification_when_present',
     'install_manifest_and_control_plane_sha256_verification',
     'bundled_mcp_adapter_sha256_verification',
     'build_provenance_manifest_match',
     'live_wordpress_site_profile_preflight_before_first_write',
     'exact_capability_envelope_for_apply',
     'backup_before_atomic_same_filesystem_replace',
     'same_cycle_exact_provenance_and_site_profile_readback',
     'rollback_on_failed_readback',
     'capability_envelope_consume_after_success'
   ),
   'forbidden',JSON_ARRAY(
     'caller selected target',
     'caller supplied app path',
     'caller supplied host',
     'caller supplied ssh credentials',
     'production target',
     'production deployment authority',
     'breakglass',
     'file manager side channel',
     'raw sql side channel',
     'raw shell api surface',
     'merge authorization'
   ),
   'secrets_included',false
 ),
 'true','wordpress_plugin_deploy','remote_runtime_targets,remote_runtime_command_allowlists,admin_platform_endpoint_tools,wordpressStagingPluginDeployExecutor','true',
 'Exact-head ETG Staging-only WordPress deployment authority. The migration creates no target and no credentials; execution remains fail-closed until exactly one separately governed target matches the Site Profile identity and command allowlist.'
)
ON DUPLICATE KEY UPDATE
 policy_value=VALUES(policy_value),
 active=VALUES(active),
 execution_scope=VALUES(execution_scope),
 affects_layer=VALUES(affects_layer),
 blocking=VALUES(blocking),
 notes=VALUES(notes),
 updated_at=CURRENT_TIMESTAMP;
