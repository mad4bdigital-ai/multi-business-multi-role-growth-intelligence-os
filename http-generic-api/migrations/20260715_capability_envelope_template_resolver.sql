-- Capability Envelope Template Resolver.
-- Additive internal registry only. No provider calls, credential reads, or target execution.

CREATE TABLE IF NOT EXISTS capability_envelope_templates (
  template_id CHAR(36) NOT NULL,
  template_key VARCHAR(191) NOT NULL,
  template_version INT UNSIGNED NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  app_key VARCHAR(128) NOT NULL,
  capability_key VARCHAR(191) NOT NULL,
  operation_intent VARCHAR(128) NOT NULL,
  runtime_surface VARCHAR(191) NOT NULL,
  requested_source_tier VARCHAR(96) NULL,
  required_context_json JSON NOT NULL,
  allowed_context_json JSON NOT NULL,
  defaults_json JSON NOT NULL,
  max_ttl_minutes INT UNSIGNED NOT NULL DEFAULT 120,
  template_hash CHAR(64) NOT NULL,
  status ENUM('active','disabled','superseded') NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (template_id),
  UNIQUE KEY uq_capability_envelope_template_version (template_key, template_version),
  KEY idx_capability_envelope_template_status (status, template_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS capability_envelope_template_resolutions (
  resolution_id CHAR(36) NOT NULL,
  template_id CHAR(36) NOT NULL,
  template_key VARCHAR(191) NOT NULL,
  template_version INT UNSIGNED NOT NULL,
  template_hash CHAR(64) NOT NULL,
  resolution_hash CHAR(64) NOT NULL,
  request_context_json JSON NOT NULL,
  resolved_request_json JSON NOT NULL,
  dry_run_json JSON NOT NULL,
  envelope_id VARCHAR(36) NULL,
  resolution_status ENUM('created','blocked','failed') NOT NULL,
  requested_by VARCHAR(191) NOT NULL,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (resolution_id),
  UNIQUE KEY uq_capability_envelope_resolution_hash (resolution_hash),
  KEY idx_capability_envelope_resolution_template (template_key, template_version, created_at),
  KEY idx_capability_envelope_resolution_envelope (envelope_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO capability_envelope_templates
  (template_id, template_key, template_version, display_name, description,
   app_key, capability_key, operation_intent, runtime_surface, requested_source_tier,
   required_context_json, allowed_context_json, defaults_json, max_ttl_minutes,
   template_hash, status)
VALUES
  (UUID(), 'github_repo_patch_apply_v1', 1, 'GitHub Repository Patch Apply', 'Template for governed repository patch envelopes.',
   'github', 'repo_patch_apply', 'repo_patch_apply', 'repo_patch_batch_apply', 'platform_managed_fallback',
   JSON_ARRAY('tenant_id','user_id','workspace_id'),
   JSON_ARRAY('tenant_id','user_id','workspace_id','workspace_key','workspace_type','user_role','plan_id','plan_item_id','resource_uri','recipe_key','expected_commit_sha'),
   JSON_OBJECT('ttl_minutes',120,'context',JSON_OBJECT()), 180,
   SHA2('github_repo_patch_apply_v1|1|github|repo_patch_apply|repo_patch_apply|repo_patch_batch_apply|platform_managed_fallback|required:tenant_id,user_id,workspace_id|allowed:tenant_id,user_id,workspace_id,workspace_key,workspace_type,user_role,plan_id,plan_item_id,resource_uri,recipe_key,expected_commit_sha|default_ttl:120|max_ttl:180',256), 'active'),
  (UUID(), 'github_pr_finalize_v1', 1, 'GitHub Pull Request Finalize', 'Template for CI-gated pull request finalization envelopes.',
   'github', 'github_pr_finalize', 'github_pr_finalize', 'github_pr_finalize', 'platform_managed_fallback',
   JSON_ARRAY('tenant_id','user_id','workspace_id'),
   JSON_ARRAY('tenant_id','user_id','workspace_id','workspace_key','workspace_type','user_role','resource_uri','expected_commit_sha'),
   JSON_OBJECT('ttl_minutes',60,'context',JSON_OBJECT()), 120,
   SHA2('github_pr_finalize_v1|1|github|github_pr_finalize|github_pr_finalize|github_pr_finalize|platform_managed_fallback|required:tenant_id,user_id,workspace_id|allowed:tenant_id,user_id,workspace_id,workspace_key,workspace_type,user_role,resource_uri,expected_commit_sha|default_ttl:60|max_ttl:120',256), 'active'),
  (UUID(), 'github_superseded_branch_cleanup_v1', 1, 'GitHub Superseded Branch Cleanup', 'Template for evidence-bound cleanup of superseded branches.',
   'github', 'github_superseded_branch_cleanup', 'github_superseded_branch_cleanup', 'github_superseded_branch_cleanup', 'platform_managed_fallback',
   JSON_ARRAY('tenant_id','user_id','workspace_id'),
   JSON_ARRAY('tenant_id','user_id','workspace_id','workspace_key','workspace_type','user_role','resource_uri'),
   JSON_OBJECT('ttl_minutes',60,'context',JSON_OBJECT()), 120,
   SHA2('github_superseded_branch_cleanup_v1|1|github|github_superseded_branch_cleanup',256), 'active'),
  (UUID(), 'governed_migration_execute_v1', 1, 'Governed Migration Execute', 'Template for checksum-bound internal migration execution envelopes.',
   'platform_orchestration', 'governed_migration_execute', 'governed_migration_execute', 'auth_host', 'platform_managed_fallback',
   JSON_ARRAY('tenant_id','user_id','workspace_id'),
   JSON_ARRAY('tenant_id','user_id','workspace_id','workspace_key','workspace_type','user_role','plan_id','plan_item_id','resource_uri','recipe_key','expected_commit_sha'),
   JSON_OBJECT('ttl_minutes',60,'context',JSON_OBJECT()), 120,
   SHA2('governed_migration_execute_v1|1|platform_orchestration|governed_migration_execute|auth_host',256), 'active'),
  (UUID(), 'hostinger_release_deploy_v1', 1, 'Hostinger Release Deploy', 'Template for target- and commit-bound Hostinger release deployment envelopes.',
   'hostinger', 'remote_runtime_hostinger_deploy_release', 'remote_runtime_hostinger_deploy_release', 'remote_runtime_hostinger_deploy_release', 'tenant_managed',
   JSON_ARRAY('tenant_id','user_id','workspace_id','expected_commit_sha'),
   JSON_ARRAY('tenant_id','user_id','workspace_id','workspace_key','workspace_type','user_role','resource_uri','recipe_key','expected_commit_sha'),
   JSON_OBJECT('ttl_minutes',30,'context',JSON_OBJECT()), 60,
   SHA2('hostinger_release_deploy_v1|1|hostinger|remote_runtime_hostinger_deploy_release',256), 'active')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name), description=VALUES(description), app_key=VALUES(app_key),
  capability_key=VALUES(capability_key), operation_intent=VALUES(operation_intent),
  runtime_surface=VALUES(runtime_surface), requested_source_tier=VALUES(requested_source_tier),
  required_context_json=VALUES(required_context_json), allowed_context_json=VALUES(allowed_context_json),
  defaults_json=VALUES(defaults_json), max_ttl_minutes=VALUES(max_ttl_minutes),
  template_hash=VALUES(template_hash), status=VALUES(status), updated_at=CURRENT_TIMESTAMP(3);

INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
  ('capability_envelope_template_list','List Capability Envelope Templates','List active versioned capability envelope templates.','GET','/admin/capability-envelope-templates',JSON_ARRAY(),JSON_OBJECT('type','object','properties',JSON_OBJECT('limit',JSON_OBJECT('type','integer','minimum',1,'maximum',100),'cursor',JSON_OBJECT('type','string')),'additionalProperties',false),NULL,'capability_resolution,template,read_only,no_provider_call,no_secrets',1,6740),
  ('capability_envelope_template_get','Get Capability Envelope Template','Read one active capability envelope template.','GET','/admin/capability-envelope-templates/{templateKey}',JSON_ARRAY('templateKey'),JSON_OBJECT('type','object','required',JSON_ARRAY('templateKey'),'properties',JSON_OBJECT('templateKey',JSON_OBJECT('type','string')),'additionalProperties',false),NULL,'capability_resolution,template,read_only,no_provider_call,no_secrets',1,6741),
  ('capability_envelope_template_resolve','Resolve Capability Envelope Template','Preview a template against current authority, binding, source-tier, and dry-run evidence without creating an envelope.','POST','/admin/capability-envelope-templates/{templateKey}/resolve',JSON_ARRAY('templateKey'),JSON_OBJECT('type','object','required',JSON_ARRAY('templateKey','context'),'properties',JSON_OBJECT('templateKey',JSON_OBJECT('type','string'),'context',JSON_OBJECT('type','object'),'ttl_minutes',JSON_OBJECT('type','integer','minimum',5,'maximum',1440),'expected_template_hash',JSON_OBJECT('type','string','pattern','^[0-9a-f]{64}$'),'explain',JSON_OBJECT('type','boolean')),'additionalProperties',false),NULL,'capability_resolution,template,dry_run,read_only,no_execution,no_provider_call,no_secrets',1,6742),
  ('capability_envelope_template_create','Create Capability Envelope From Template','Resolve a versioned template and create one immutable capability envelope with same-cycle resolution readback.','POST','/admin/capability-envelope-templates/{templateKey}/envelopes',JSON_ARRAY('templateKey'),JSON_OBJECT('type','object','required',JSON_ARRAY('templateKey','context'),'properties',JSON_OBJECT('templateKey',JSON_OBJECT('type','string'),'context',JSON_OBJECT('type','object'),'ttl_minutes',JSON_OBJECT('type','integer','minimum',5,'maximum',1440),'expected_template_hash',JSON_OBJECT('type','string','pattern','^[0-9a-f]{64}$'),'explain',JSON_OBJECT('type','boolean')),'additionalProperties',false),NULL,'capability_resolution,template,state_changing,internal_registry,same_cycle_readback,no_provider_call,no_external_write,no_secrets',1,6743)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name), description=VALUES(description), http_method=VALUES(http_method),
  http_path=VALUES(http_path), path_param_keys=VALUES(path_param_keys), input_schema=VALUES(input_schema),
  fixed_body=VALUES(fixed_body), tags=VALUES(tags), is_enabled=VALUES(is_enabled), sort_order=VALUES(sort_order);

INSERT INTO execution_policies
  (policy_group, policy_key, policy_value, active, execution_scope, affects_layer, blocking, notes)
VALUES
  ('Capability Resolution Governance','capability_envelope_template_resolver_policy_v1',
   JSON_OBJECT('rule','resolve_versioned_templates_before_envelope_creation','enforcement_mode','blocking','unknown_context_rejected',true,'template_hash_pin_supported',true,'preview_has_no_mutation',true,'creation_uses_existing_dry_run_and_ledger',true,'same_cycle_readback_required',true,'provider_calls_forbidden',true,'external_writes_forbidden',true,'secrets_included',false),
   'TRUE','capability_envelope_template_resolve|capability_envelope_template_create|gpt_tools_call|tool_dispatch',
   'capabilityEnvelopeTemplateResolver|capabilityEnvelopeTemplateRoutes|capability_resolution_envelope_ledger|capability_envelope_template_resolutions',
   'TRUE','Templates standardize capability envelope requests but never bypass authority, approval, quota, certification, or readback gates.')
ON DUPLICATE KEY UPDATE policy_value=VALUES(policy_value), active=VALUES(active), execution_scope=VALUES(execution_scope), affects_layer=VALUES(affects_layer), blocking=VALUES(blocking), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;
