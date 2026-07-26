-- Sprint 65: resource authority registry foundation.
--
-- This migration makes resource authority explicit before any tenant, user,
-- brand, or external-resource write is allowed. It is diagnose/readiness only:
-- no publish executor, no external write, no credential reveal, and no dynamic
-- code execution are introduced here.

CREATE TABLE IF NOT EXISTS platform_resource_authority_requirements (
  requirement_key VARCHAR(191) NOT NULL PRIMARY KEY,
  resource_family VARCHAR(191) NOT NULL,
  operation_class ENUM('draft','publish','external_write','repo_mutation','workflow_activation','config_write','destructive') NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  required_gates_json JSON NOT NULL,
  authority_sources_json JSON NULL,
  credential_scope_required TINYINT(1) NOT NULL DEFAULT 1,
  active_grant_required TINYINT(1) NOT NULL DEFAULT 1,
  ownership_claim_required TINYINT(1) NOT NULL DEFAULT 1,
  audit_required TINYINT(1) NOT NULL DEFAULT 1,
  readback_required TINYINT(1) NOT NULL DEFAULT 1,
  break_glass_allowed TINYINT(1) NOT NULL DEFAULT 0,
  apply_allowed TINYINT(1) NOT NULL DEFAULT 0,
  secrets_may_be_returned TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('planned','active','disabled') NOT NULL DEFAULT 'active',
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_resource_authority_family (resource_family, operation_class, status),
  KEY idx_resource_authority_gates (active_grant_required, readback_required, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO platform_resource_authority_requirements
  (requirement_key, resource_family, operation_class, display_name, description,
   required_gates_json, authority_sources_json, credential_scope_required,
   active_grant_required, ownership_claim_required, audit_required,
   readback_required, break_glass_allowed, apply_allowed,
   secrets_may_be_returned, status, notes)
VALUES
  ('wordpress_post_publish_authority', 'wordpress', 'publish', 'WordPress Post Publish Authority', 'Authority gates required before publishing a WordPress post or page.', '["resource_resolution","ownership_claim","active_grant","scoped_credential","policy_gate","audit_evidence","readback"]', '["cms_sites","cms_site_access_grants","brand_site_bindings","credential_bindings"]', 1, 1, 1, 1, 1, 0, 0, 0, 'active', 'Draft generation is not publish authority. Publish requires active publish-capable grant.'),
  ('wordpress_draft_write_authority', 'wordpress', 'draft', 'WordPress Draft Write Authority', 'Authority gates required before creating a WordPress draft.', '["resource_resolution","active_grant","scoped_credential","policy_gate","audit_evidence","readback"]', '["cms_sites","cms_site_access_grants","credential_bindings"]', 1, 1, 0, 1, 1, 0, 0, 0, 'active', 'Draft is still an external write and needs an active draft-capable grant.'),
  ('google_drive_file_write_authority', 'google_drive', 'external_write', 'Google Drive File Write Authority', 'Authority gates required before writing a user, tenant, or brand Google Drive file.', '["resource_resolution","ownership_claim","active_grant","scoped_credential","policy_gate","audit_evidence","readback"]', '["drive_resource_bindings","user_app_connections","credential_bindings"]', 1, 1, 1, 1, 1, 0, 0, 0, 'active', 'Drive writeback must use scoped credentials and readback confirmation.'),
  ('github_repo_patch_authority', 'github_repo', 'repo_mutation', 'GitHub Repo Patch Authority', 'Authority gates required before applying repo patches or file-content writes.', '["resource_resolution","ownership_claim","active_grant","scoped_credential","policy_gate","scope_guard","validator_gate","audit_evidence","readback"]', '["github_app_installations","admin_platform_endpoint_tools","repo_policy_registry"]', 1, 1, 1, 1, 1, 0, 0, 0, 'active', 'Repo patch apply remains separate from recovery planning and requires validators.'),
  ('n8n_workflow_activation_authority', 'n8n', 'workflow_activation', 'n8n Workflow Activation Authority', 'Authority gates required before activating or mutating n8n workflows.', '["resource_resolution","ownership_claim","active_grant","scoped_credential","policy_gate","audit_evidence","readback"]', '["workflow_runtime_bindings","connected_systems","credential_bindings"]', 1, 1, 1, 1, 1, 0, 0, 0, 'active', 'n8n may not bypass platform auth, registry scope, or readback.'),
  ('cloudflare_dns_write_authority', 'cloudflare', 'external_write', 'Cloudflare DNS Write Authority', 'Authority gates required before Cloudflare DNS mutation.', '["resource_resolution","ownership_claim","active_grant","scoped_credential","policy_gate","audit_evidence","readback"]', '["cloudflare_zones","connected_systems","credential_bindings"]', 1, 1, 1, 1, 1, 1, 0, 0, 'active', 'Break-glass may be allowed only with reason, temporary scope, audit, and readback.'),
  ('local_connector_config_write_authority', 'local_connector', 'config_write', 'Local Connector Config Write Authority', 'Authority gates required before writing local connector configuration.', '["resource_resolution","active_grant","scoped_credential","policy_gate","audit_evidence","readback"]', '["local_connector_user_configs","local_connector_file_access_rules","local_connector_shell_allowlists"]', 1, 1, 0, 1, 1, 1, 0, 0, 'active', 'Local config writes are admin recovery only and must not expose secrets.'),
  ('crm_contact_update_authority', 'crm', 'external_write', 'CRM Contact Update Authority', 'Authority gates required before mutating CRM contact records.', '["resource_resolution","ownership_claim","active_grant","scoped_credential","policy_gate","audit_evidence","readback"]', '["connected_systems","credential_bindings","tenant_integration_policies"]', 1, 1, 1, 1, 1, 0, 0, 0, 'active', 'Tenant/customer data writes require tenant-scoped grant and readback.'),
  ('email_campaign_send_authority', 'email', 'external_write', 'Email Campaign Send Authority', 'Authority gates required before sending email campaigns or messages.', '["resource_resolution","ownership_claim","active_grant","scoped_credential","policy_gate","human_approval","audit_evidence","readback"]', '["connected_systems","credential_bindings","tenant_integration_policies"]', 1, 1, 1, 1, 1, 0, 0, 0, 'active', 'Send is consequential and requires explicit approval before any apply phase.'),
  ('social_post_publish_authority', 'social', 'publish', 'Social Post Publish Authority', 'Authority gates required before publishing social content.', '["resource_resolution","ownership_claim","active_grant","scoped_credential","policy_gate","human_approval","audit_evidence","readback"]', '["connected_systems","credential_bindings","tenant_integration_policies"]', 1, 1, 1, 1, 1, 0, 0, 0, 'active', 'Draft content is not authorization to publish.'),
  ('ai_generated_asset_upload_authority', 'asset_upload', 'external_write', 'AI Generated Asset Upload Authority', 'Authority gates required before uploading AI-generated assets to tenant, brand, or external resources.', '["resource_resolution","ownership_claim","active_grant","scoped_credential","policy_gate","audit_evidence","readback"]', '["json_assets","connected_systems","credential_bindings"]', 1, 1, 1, 1, 1, 0, 0, 0, 'active', 'Generated assets may be stored internally without external publish authority, but external upload requires authority.')
ON DUPLICATE KEY UPDATE
  resource_family = VALUES(resource_family),
  operation_class = VALUES(operation_class),
  display_name = VALUES(display_name),
  description = VALUES(description),
  required_gates_json = VALUES(required_gates_json),
  authority_sources_json = VALUES(authority_sources_json),
  credential_scope_required = VALUES(credential_scope_required),
  active_grant_required = VALUES(active_grant_required),
  ownership_claim_required = VALUES(ownership_claim_required),
  audit_required = VALUES(audit_required),
  readback_required = VALUES(readback_required),
  break_glass_allowed = VALUES(break_glass_allowed),
  apply_allowed = VALUES(apply_allowed),
  secrets_may_be_returned = VALUES(secrets_may_be_returned),
  status = VALUES(status),
  notes = VALUES(notes);

INSERT INTO platform_engine_registry
  (engine_key, display_name, engine_type, runtime_key, supported_task_classes_json,
   capabilities_json, default_policy_key, status, notes)
VALUES
  (
    'resource_authority_engine',
    'Resource Authority Engine',
    'generic',
    'codex_essam_chatgpt_v1',
    '["resource_authority_check","publish_readiness_plan","external_write_readiness_plan","credential_scope_check","grant_readiness_check"]',
    '{"supports_sql_policy":true,"supports_resource_authority":true,"executes_db_stored_code":false,"default_mode":"diagnose_only","apply_supported":false,"secrets_returned":false}',
    'resource_authority_policy_v1',
    'active',
    'Read-only authority readiness engine. It blocks publish/external-write apply until explicit authority gates are satisfied by a later apply phase.'
  )
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  engine_type = VALUES(engine_type),
  runtime_key = VALUES(runtime_key),
  supported_task_classes_json = VALUES(supported_task_classes_json),
  capabilities_json = VALUES(capabilities_json),
  default_policy_key = VALUES(default_policy_key),
  status = VALUES(status),
  notes = VALUES(notes);

INSERT INTO platform_engine_policy_registry
  (policy_key, engine_key, scope_type, scope_id, mode, risk_default,
   approval_required_min_risk, require_scope_guard, require_audit,
   require_validators, max_changes_json, validators_json, blocked_terms_json,
   allowed_resource_patterns_json, blocked_resource_patterns_json, status, notes)
VALUES
  (
    'resource_authority_policy_v1',
    'resource_authority_engine',
    'global',
    NULL,
    'diagnose_only',
    'high',
    'medium',
    1,
    1,
    1,
    '{"max_files_changed":0,"max_rows_mutated":0,"max_external_writes":0,"publish_allowed":false}',
    '["node test-resource-authority-registry.mjs"]',
    '["token","secret","password","authorization","credential","private_key"]',
    '["wordpress:*","google_drive:*","github_repo:*","n8n:*","cloudflare:*","local_connector:*","crm:*","email:*","social:*","asset_upload:*"]',
    '["secret:*","credential_value:*",".env","**/secrets/**"]',
    'active',
    'Diagnose-only resource authority policy. No publish, external write, repo mutation, or secret return.'
  )
ON DUPLICATE KEY UPDATE
  engine_key = VALUES(engine_key),
  scope_type = VALUES(scope_type),
  scope_id = VALUES(scope_id),
  mode = VALUES(mode),
  risk_default = VALUES(risk_default),
  approval_required_min_risk = VALUES(approval_required_min_risk),
  require_scope_guard = VALUES(require_scope_guard),
  require_audit = VALUES(require_audit),
  require_validators = VALUES(require_validators),
  max_changes_json = VALUES(max_changes_json),
  validators_json = VALUES(validators_json),
  blocked_terms_json = VALUES(blocked_terms_json),
  allowed_resource_patterns_json = VALUES(allowed_resource_patterns_json),
  blocked_resource_patterns_json = VALUES(blocked_resource_patterns_json),
  status = VALUES(status),
  notes = VALUES(notes);

INSERT INTO platform_engine_strategy_registry
  (strategy_key, display_name, description, supported_engine_types_json,
   supported_task_classes_json, supported_resource_kinds_json, requires_ast,
   allows_full_resource_rewrite, executes_dynamic_code, required_validators_json,
   risk_level, status, metadata_json)
VALUES
  ('resource_authority_gate_check', 'Resource Authority Gate Check', 'Evaluate required resource authority gates without writing to the target resource.', '["generic"]', '["resource_authority_check","publish_readiness_plan","external_write_readiness_plan"]', '["resource_authority_requirement"]', 0, 0, 0, '["node test-resource-authority-registry.mjs"]', 'high', 'active', '{"apply_supported":false,"secrets_returned":false}'),
  ('resource_grant_readiness_check', 'Resource Grant Readiness Check', 'Check whether active grant evidence is required and present.', '["generic"]', '["grant_readiness_check","publish_readiness_plan","external_write_readiness_plan"]', '["grant_requirement"]', 0, 0, 0, '["node test-resource-authority-registry.mjs"]', 'high', 'active', '{"apply_supported":false,"secrets_returned":false}'),
  ('resource_credential_scope_check', 'Resource Credential Scope Check', 'Check scoped credential readiness without returning secret values.', '["generic"]', '["credential_scope_check","publish_readiness_plan","external_write_readiness_plan"]', '["credential_scope_requirement"]', 0, 0, 0, '["node test-resource-authority-registry.mjs"]', 'high', 'active', '{"apply_supported":false,"secrets_returned":false}')
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  supported_engine_types_json = VALUES(supported_engine_types_json),
  supported_task_classes_json = VALUES(supported_task_classes_json),
  supported_resource_kinds_json = VALUES(supported_resource_kinds_json),
  requires_ast = VALUES(requires_ast),
  allows_full_resource_rewrite = VALUES(allows_full_resource_rewrite),
  executes_dynamic_code = VALUES(executes_dynamic_code),
  required_validators_json = VALUES(required_validators_json),
  risk_level = VALUES(risk_level),
  status = VALUES(status),
  metadata_json = VALUES(metadata_json);

INSERT INTO platform_engine_policy_rules
  (rule_key, policy_key, engine_key, priority, task_class, resource_kind,
   resource_pattern, condition_json, strategy_key, risk_level,
   auto_apply_allowed, dry_run_required, approval_required, validator_commands_json,
   blocked_terms_json, allowed_terms_json, required_skill_keys_json, status, notes)
VALUES
  ('resource_authority_publish_gate', 'resource_authority_policy_v1', 'resource_authority_engine', 100, 'publish_readiness_plan', 'resource_authority_requirement', '*:publish', '{"operation_class":"publish"}', 'resource_authority_gate_check', 'high', 0, 1, 1, '["node test-resource-authority-registry.mjs"]', '["token","secret","authorization","credential_value"]', '["resource_resolution","ownership_claim","active_grant","scoped_credential","policy_gate","audit_evidence","readback"]', '["resource_authority"]', 'active', 'Publish readiness only. Does not publish.'),
  ('resource_authority_external_write_gate', 'resource_authority_policy_v1', 'resource_authority_engine', 100, 'external_write_readiness_plan', 'resource_authority_requirement', '*:external_write', '{"operation_class":"external_write"}', 'resource_authority_gate_check', 'high', 0, 1, 1, '["node test-resource-authority-registry.mjs"]', '["token","secret","authorization","credential_value"]', '["resource_resolution","ownership_claim","active_grant","scoped_credential","policy_gate","audit_evidence","readback"]', '["resource_authority"]', 'active', 'External write readiness only. Does not write.'),
  ('resource_authority_grant_gate', 'resource_authority_policy_v1', 'resource_authority_engine', 90, 'grant_readiness_check', 'grant_requirement', '*:grant', '{"required_gate":"active_grant"}', 'resource_grant_readiness_check', 'high', 0, 1, 1, '["node test-resource-authority-registry.mjs"]', '["token","secret","authorization","credential_value"]', '["active_grant","grant_scope","expires_at","status"]', '["resource_authority"]', 'active', 'Grant readiness only.'),
  ('resource_authority_credential_scope_gate', 'resource_authority_policy_v1', 'resource_authority_engine', 90, 'credential_scope_check', 'credential_scope_requirement', '*:credential', '{"required_gate":"scoped_credential"}', 'resource_credential_scope_check', 'high', 0, 1, 1, '["node test-resource-authority-registry.mjs"]', '["token","secret","authorization","credential_value"]', '["credential_binding","scope","status","no_secret_returned"]', '["resource_authority"]', 'active', 'Credential scope readiness only. Secret values are never returned.')
ON DUPLICATE KEY UPDATE
  policy_key = VALUES(policy_key),
  engine_key = VALUES(engine_key),
  priority = VALUES(priority),
  task_class = VALUES(task_class),
  resource_kind = VALUES(resource_kind),
  resource_pattern = VALUES(resource_pattern),
  condition_json = VALUES(condition_json),
  strategy_key = VALUES(strategy_key),
  risk_level = VALUES(risk_level),
  auto_apply_allowed = VALUES(auto_apply_allowed),
  dry_run_required = VALUES(dry_run_required),
  approval_required = VALUES(approval_required),
  validator_commands_json = VALUES(validator_commands_json),
  blocked_terms_json = VALUES(blocked_terms_json),
  allowed_terms_json = VALUES(allowed_terms_json),
  required_skill_keys_json = VALUES(required_skill_keys_json),
  status = VALUES(status),
  notes = VALUES(notes);

INSERT INTO platform_engine_skill_prompt_registry
  (skill_key, engine_key, display_name, prompt_contract_version, task_classes_json,
   required_tools_json, forbidden_tools_json, validator_commands_json,
   success_criteria_json, fallback_behavior_json, prompt_template, status, notes)
VALUES
  (
    'resource_authority',
    'resource_authority_engine',
    'Resource Authority',
    'v1',
    '["resource_authority_check","publish_readiness_plan","external_write_readiness_plan","credential_scope_check","grant_readiness_check"]',
    '["resource.resolve","resource.claim.check","resource.grant.active_check","credential.scope.check","policy.gate.check","audit.evidence.shape","readback.requirement.check"]',
    '["wordpress.publish","external.write","repo.patch.apply","github.pr.merge","credential_dump","secret_read","token_return"]',
    '["node test-resource-authority-registry.mjs"]',
    '["resource_resolved","grant_status_classified","credential_scope_classified","audit_required","readback_required","no_secret_returned","no_write_performed"]',
    '["if_grant_missing_block_apply","if_credential_missing_create_intake_plan_only","if_readback_missing_block_apply","if_owner_unknown_manual_review"]',
    'Evaluate authority gates before any external write. Never treat generated draft content, admin intent, or model confidence as resource authority.',
    'active',
    'Versioned skill contract for resource authority readiness under the AI Intelligence Runtime governance layer.'
  )
ON DUPLICATE KEY UPDATE
  engine_key = VALUES(engine_key),
  display_name = VALUES(display_name),
  prompt_contract_version = VALUES(prompt_contract_version),
  task_classes_json = VALUES(task_classes_json),
  required_tools_json = VALUES(required_tools_json),
  forbidden_tools_json = VALUES(forbidden_tools_json),
  validator_commands_json = VALUES(validator_commands_json),
  success_criteria_json = VALUES(success_criteria_json),
  fallback_behavior_json = VALUES(fallback_behavior_json),
  prompt_template = VALUES(prompt_template),
  status = VALUES(status),
  notes = VALUES(notes);

INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys,
   input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
  (
    'resource_authority_decision_brief',
    'Resource Authority Decision Brief',
    'Build a read-only decision brief for tenant, user, brand, or external resource authority. Does not publish, write, or return secrets.',
    'POST',
    '/platform/engines/decision-brief',
    NULL,
    '{"type":"object","properties":{"objective":{"type":"string"},"resource":{"type":"object","additionalProperties":true},"trace_id":{"type":"string"}},"additionalProperties":false}',
    '{"engine_key":"resource_authority_engine","task_class":"resource_authority_check","mode":"diagnose_only","resource_kind":"resource_authority_requirement","scope_guard_passed":false,"approval_granted":false}',
    'platform_engine,resource_authority,decision_brief,read_only,no_execution,no_apply,no_external_write,no_secret_read',
    1,
    268
  ),
  (
    'resource_publish_readiness_plan',
    'Resource Publish Readiness Plan',
    'Build a read-only publish readiness plan for CMS, social, email, or asset publish authority. Does not publish.',
    'POST',
    '/platform/engines/task-plan',
    NULL,
    '{"type":"object","properties":{"resource":{"type":"object","additionalProperties":true},"trace_id":{"type":"string"}},"additionalProperties":false}',
    '{"engine_key":"resource_authority_engine","task_class":"publish_readiness_plan","mode":"diagnose_only","resource_kind":"resource_authority_requirement","scope_guard_passed":false,"approval_granted":false,"write_audit":false}',
    'platform_engine,resource_authority,publish_readiness,read_only,no_execution,no_apply,no_publish,no_secret_read',
    1,
    269
  ),
  (
    'resource_external_write_readiness_plan',
    'Resource External Write Readiness Plan',
    'Build a read-only external-write readiness plan for Drive, GitHub, n8n, Cloudflare, local connector, CRM, email, social, or asset upload. Does not write.',
    'POST',
    '/platform/engines/task-plan',
    NULL,
    '{"type":"object","properties":{"resource":{"type":"object","additionalProperties":true},"trace_id":{"type":"string"}},"additionalProperties":false}',
    '{"engine_key":"resource_authority_engine","task_class":"external_write_readiness_plan","mode":"diagnose_only","resource_kind":"resource_authority_requirement","scope_guard_passed":false,"approval_granted":false,"write_audit":false}',
    'platform_engine,resource_authority,external_write_readiness,read_only,no_execution,no_apply,no_external_write,no_secret_read',
    1,
    270
  )
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  http_method = VALUES(http_method),
  http_path = VALUES(http_path),
  path_param_keys = VALUES(path_param_keys),
  input_schema = VALUES(input_schema),
  fixed_body = VALUES(fixed_body),
  tags = VALUES(tags),
  is_enabled = VALUES(is_enabled),
  sort_order = VALUES(sort_order);
