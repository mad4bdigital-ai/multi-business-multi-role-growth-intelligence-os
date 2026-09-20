-- Replayable canonical WordPress Staging deployment authority.
-- Runtime data only; creates no target, credential, approval, or execution rows.

INSERT INTO remote_runtime_command_allowlists
(command_id, plugin_key, command_key, display_name, target_kind, command_template, input_schema_json, risk_class, requires_approval, is_consequential, output_policy, status, notes)
VALUES
(
 UUID(),
 'remote_ssh_runtime',
 'wordpress_staging_plugin_deploy',
 'Deploy reviewed WordPress Staging plugin artifact',
 'hosting_account',
 'remote_runtime:ssh:wordpress_staging_plugin_deploy',
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
 'Staging-only WordPress plugin deploy v2. Source artifact is resolved from the successful exact-head WordPress Control Plane package run; target, path, and SSH credentials are server-owned and uniquely resolved. Apply requires an exact capability envelope plus same-cycle exact build provenance readback.'
)
ON DUPLICATE KEY UPDATE
 display_name=VALUES(display_name), target_kind=VALUES(target_kind), command_template=VALUES(command_template),
 input_schema_json=VALUES(input_schema_json), risk_class=VALUES(risk_class), requires_approval=VALUES(requires_approval),
 is_consequential=VALUES(is_consequential), output_policy=VALUES(output_policy), status=VALUES(status),
 notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;

INSERT INTO admin_platform_endpoint_tools
(tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
(
 'wordpress_staging_plugin_deploy',
 'WordPress Staging Plugin Deploy',
 'Dry-run by default. Deploys only the reviewed exact-head MAD4B WordPress General Distribution artifact to the unique server-resolved ETG Staging Hostinger target. Production, Breakglass, caller-selected target/artifact/path/SSH mode/credentials, Raw SQL, and File Manager are not accepted.',
 'POST',
 '/platform/remote-runtime/wordpress/staging/deploy-plugin',
 NULL,
 '{"type":"object","required":["expected_head_sha"],"properties":{"expected_head_sha":{"type":"string","pattern":"^[0-9a-f]{40}$"},"dry_run":{"type":"boolean","default":true},"approval_reason":{"type":"string","minLength":20,"maxLength":1000},"capability_envelope_id":{"type":"string","minLength":1,"maxLength":64},"timeout_ms":{"type":"integer","minimum":1000,"maximum":300000}},"additionalProperties":false}',
 NULL,
 'admin,remote-runtime,wordpress,staging,hostinger,artifact,exact_head,handoff_v2,server_resolved_target,capability_envelope_required,approval_required,state_changing,dry_run_default,no_secrets,no_breakglass,no_raw_sql,no_production',
 1, 154
)
ON DUPLICATE KEY UPDATE
 display_name=VALUES(display_name), description=VALUES(description), http_method=VALUES(http_method), http_path=VALUES(http_path),
 path_param_keys=VALUES(path_param_keys), input_schema=VALUES(input_schema), fixed_body=VALUES(fixed_body), tags=VALUES(tags),
 is_enabled=VALUES(is_enabled), sort_order=VALUES(sort_order), updated_at=CURRENT_TIMESTAMP;

INSERT INTO execution_policies
(policy_group, policy_key, policy_value, active, execution_scope, affects_layer, blocking, notes)
VALUES
(
 'wordpress_staging_plugin_deploy_governance',
 'wordpress_staging_plugin_deploy_exact_artifact_guard',
 JSON_OBJECT(
   'contract','mad4b.wordpress-staging-plugin-deploy.v2',
   'handoff_contract','mad4b.wordpress-deployment-handoff.v2',
   'source_repository','mad4bdigital-ai/WordPress',
   'source_workflow','mad4b-control-plane-package.yml',
   'target_environment','staging',
   'target_origin','https://staging.egypttourgates.com',
   'target_site_uuid','d745d81f-6fc4-5c6a-99dd-d953c92137bf',
   'target_resolution','server_owned_unique_exact_staging_target',
   'caller_target_selection_allowed',false,
   'caller_artifact_selection_allowed',false,
   'mcp_adapter_version','0.6.1',
   'dry_run_default',true,
   'requires',JSON_ARRAY(
     'active_validated_explicit_staging_target','target_command_allowlist','server_owned_root_and_path_allowlist',
     'server_side_ssh_credentials','successful_exact_head_package_run','artifact_outer_digest_verification',
     'general_distribution_manifest_and_sha256_verification','handoff_v2_verification',
     'live_wordpress_staging_preflight_before_first_write','exact_capability_envelope_for_apply',
     'maintenance_mode_same_filesystem_rename_swap','same_cycle_exact_provenance_readback',
     'rollback_on_failed_readback','capability_envelope_consume_after_success'
   ),
   'forbidden',JSON_ARRAY(
     'production target','production deployment authority','breakglass','caller supplied target','caller supplied artifact',
     'caller supplied app path','caller supplied host','caller supplied ssh credentials','file manager side channel',
     'raw shell surface','raw sql side channel','merge authorization'
   ),
   'secrets_included',false
 ),
 'true',
 'wordpress_staging_plugin_deploy',
 'remote_runtime_targets,remote_runtime_command_allowlists,admin_platform_endpoint_tools,wordpressStagingPluginDeployExecutor',
 'true',
 'Exact-head Staging-only WordPress deployment authority v2. No target or credentials are created. Execution resolves one exact active and validated ETG Staging target server-side and fails closed on zero or multiple matches.'
)
ON DUPLICATE KEY UPDATE
 policy_value=VALUES(policy_value), active=VALUES(active), execution_scope=VALUES(execution_scope),
 affects_layer=VALUES(affects_layer), blocking=VALUES(blocking), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;
