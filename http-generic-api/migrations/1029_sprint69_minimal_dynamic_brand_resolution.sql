-- Sprint 69: Minimal dynamic Brand -> Workspace -> CMS resolution
--
-- This migration registers one shared Admin/Tenant read-only resolver and one
-- prompt skill that generates language/spelling/transliteration candidates only.
-- The model never selects authority. Canonical Brand Registry matching,
-- ambiguity handling, Tenant scope, and downstream authorization remain
-- deterministic in backend code.
--
-- Additive only. No provider call, provider write, external send, credential
-- decryption, broad collation conversion, destructive DDL, or secret return.

INSERT INTO system_layer_tool_descriptor_source_registry
  (source_key, module_path, descriptor_export, handler_resolution_mode,
   tool_count_expected, status, metadata_json, secrets_included)
VALUES
  (
    'brand_workspace_context_v1',
    'brandWorkspaceContextResolver.js',
    'BRAND_WORKSPACE_CONTEXT_SYSTEM_TOOLS',
    'handler_name_or_snake_to_camel',
    2,
    'active',
    JSON_OBJECT(
      'admin_tenant_shared', TRUE,
      'accepted_brand_variables', JSON_ARRAY('brand_name','brand_ref','target_key','site_url'),
      'prompt_candidates_field', 'candidate_refs',
      'prompt_skill_key', 'brand_reference_interpreter_v1',
      'tenant_identity_source', 'signed_jwt_only',
      'temporary_cache_ttl_seconds', 900,
      'virtual_assets_read_only', TRUE,
      'collation_strategy', 'separate_reads_application_join',
      'provider_calls_allowed', FALSE,
      'mutations_allowed', FALSE,
      'external_sends_allowed', FALSE,
      'credential_decrypt_allowed', FALSE,
      'secrets_included', FALSE
    ),
    0
  )
ON DUPLICATE KEY UPDATE
  module_path = VALUES(module_path),
  descriptor_export = VALUES(descriptor_export),
  handler_resolution_mode = VALUES(handler_resolution_mode),
  tool_count_expected = VALUES(tool_count_expected),
  status = VALUES(status),
  metadata_json = VALUES(metadata_json),
  secrets_included = 0,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO tenant_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path,
   input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
  (
    'brand_workspace_context_resolve',
    'Resolve Brand Workspace Context',
    'Resolve a requested Brand from name, alias, key, domain, or URL; request prompt-generated candidate_refs only when deterministic matching fails; then return Tenant-authorized Workspace, persisted/virtual assets, Brand Core, CMS, safe connection metadata, and WordPress diagnostic handoff. Tenant identity comes only from the signed JWT.',
    'POST',
    '/system/tools/call',
    JSON_OBJECT(
      'type', 'object',
      'properties', JSON_OBJECT(
        'tool_args', JSON_OBJECT(
          'type', 'object',
          'properties', JSON_OBJECT(
            'brand_name', JSON_OBJECT('type','string','minLength',1,'maxLength',255),
            'brand_ref', JSON_OBJECT('type','string','minLength',1,'maxLength',2048),
            'target_key', JSON_OBJECT('type','string','minLength',1,'maxLength',255),
            'site_url', JSON_OBJECT('type','string','minLength',1,'maxLength',2048),
            'candidate_refs', JSON_OBJECT(
              'type','array','maxItems',8,
              'items',JSON_OBJECT('type','string','minLength',1,'maxLength',255)
            ),
            'asset_limit', JSON_OBJECT('type','integer','minimum',1,'maximum',100,'default',50)
          ),
          'anyOf', JSON_ARRAY(
            JSON_OBJECT('required',JSON_ARRAY('brand_name')),
            JSON_OBJECT('required',JSON_ARRAY('brand_ref')),
            JSON_OBJECT('required',JSON_ARRAY('target_key')),
            JSON_OBJECT('required',JSON_ARRAY('site_url'))
          ),
          'additionalProperties', FALSE
        )
      ),
      'required', JSON_ARRAY('tool_args'),
      'additionalProperties', FALSE
    ),
    JSON_OBJECT('name','brand_workspace_context_resolve'),
    'tenant,admin,brand,workspace,assets,virtual_assets,brand_core,cms,wordpress,multilingual,prompt_skill,read_only,no_provider_call,no_external_send,no_secrets,descriptor_backed',
    1,
    373
  )
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  http_method = VALUES(http_method),
  http_path = VALUES(http_path),
  input_schema = VALUES(input_schema),
  fixed_body = VALUES(fixed_body),
  tags = VALUES(tags),
  is_enabled = VALUES(is_enabled),
  sort_order = VALUES(sort_order);

INSERT INTO platform_engine_registry
  (engine_key, display_name, engine_type, runtime_key,
   supported_task_classes_json, capabilities_json, default_policy_key,
   status, notes)
VALUES
  (
    'brand_reference_resolution_engine',
    'Brand Reference Resolution Engine',
    'generic',
    NULL,
    JSON_ARRAY('brand_reference_interpret'),
    JSON_OBJECT(
      'model_role','candidate_generation_only',
      'authorized_catalog_required',TRUE,
      'deterministic_registry_validation_required',TRUE,
      'tenant_authority_separate',TRUE,
      'provider_call_from_resolver',FALSE
    ),
    'brand_reference_interpretation_policy_v1',
    'active',
    'Text-skill engine for spelling, spacing, script, and transliteration candidates. It does not select a Brand, grant authority, or call providers.'
  )
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  engine_type = VALUES(engine_type),
  runtime_key = VALUES(runtime_key),
  supported_task_classes_json = VALUES(supported_task_classes_json),
  capabilities_json = VALUES(capabilities_json),
  default_policy_key = VALUES(default_policy_key),
  status = VALUES(status),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO platform_engine_policy_registry
  (policy_key, engine_key, scope_type, scope_id, mode, risk_default,
   approval_required_min_risk, require_scope_guard, require_audit,
   require_validators, max_changes_json, validators_json,
   blocked_terms_json, allowed_resource_patterns_json,
   blocked_resource_patterns_json, status, notes)
VALUES
  (
    'brand_reference_interpretation_policy_v1',
    'brand_reference_resolution_engine',
    'global',
    NULL,
    'diagnose_only',
    'low',
    'high',
    1,
    1,
    1,
    JSON_OBJECT('max_candidates',8,'max_catalog_items',100),
    JSON_ARRAY(
      'authorized_catalog_only',
      'deterministic_registry_validation_after_prompt',
      'ambiguity_fail_closed',
      'tenant_authority_after_resolution'
    ),
    JSON_ARRAY('grant authority','invent target key','invent brand','cross tenant'),
    JSON_ARRAY('brand:*'),
    JSON_ARRAY('credential:*','secret:*','provider_write:*'),
    'active',
    'Prompt output is candidate_refs only. It cannot grant authority, bypass ambiguity, mutate registries, or expose brands outside the authorized catalog.'
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
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO platform_engine_policy_rules
  (rule_key, policy_key, engine_key, priority, task_class, resource_kind,
   resource_pattern, condition_json, strategy_key, risk_level,
   auto_apply_allowed, dry_run_required, approval_required,
   validator_commands_json, blocked_terms_json, allowed_terms_json,
   required_skill_keys_json, status, notes)
VALUES
  (
    'brand_reference_candidate_generation_v1',
    'brand_reference_interpretation_policy_v1',
    'brand_reference_resolution_engine',
    100,
    'brand_reference_interpret',
    'brand',
    '*',
    JSON_OBJECT('requires_interpretation_status','interpretation_required'),
    'diagnose_only',
    'low',
    0,
    1,
    0,
    JSON_ARRAY('authorized_catalog_only','max_eight_candidates','json_output_only'),
    JSON_ARRAY('authority_decision','tenant_override','credential_request','invented_target_key'),
    JSON_ARRAY('spelling_variant','spacing_variant','transliteration','script_variant','domain_variant'),
    JSON_ARRAY('brand_reference_interpreter_v1'),
    'active',
    'Generate bounded candidate references only after deterministic matching fails.'
  )
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
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO platform_engine_skill_prompt_registry
  (skill_key, engine_key, display_name, prompt_contract_version,
   task_classes_json, required_tools_json, forbidden_tools_json,
   validator_commands_json, success_criteria_json, fallback_behavior_json,
   prompt_template, status, notes)
VALUES
  (
    'brand_reference_interpreter_v1',
    'brand_reference_resolution_engine',
    'Brand Reference Interpreter',
    'v1',
    JSON_ARRAY('brand_reference_interpret'),
    JSON_ARRAY('brand_workspace_context_resolve'),
    JSON_ARRAY('provider_write','credential_read','registry_mutation','cross_tenant_catalog'),
    JSON_ARRAY('authorized_catalog_only','candidate_count_lte_8','no_invented_target_keys','json_shape_valid'),
    JSON_OBJECT(
      'candidate_refs_only',TRUE,
      'max_candidates',8,
      'may_transform_spacing',TRUE,
      'may_transliterate',TRUE,
      'may_translate_brand_sound_not_meaning',TRUE,
      'authority_decision',FALSE
    ),
    JSON_OBJECT(
      'no_confident_candidate','return_empty_candidate_refs',
      'multiple_plausible_candidates','return_all_bounded_candidates_for_backend_ambiguity_check',
      'never_request_internal_ids',TRUE
    ),
    'You are a Brand reference interpretation skill. Input contains user_brand_reference and authorized_brand_catalog. Produce JSON only: {"detected_language":"...","detected_script":"...","candidate_refs":["..."]}. Generate at most 8 likely spelling, spacing, transliteration, and script variants. Use only names, domains, and target keys already present in authorized_brand_catalog as evidence. Do not decide authorization, do not claim a final match, do not invent a target_key or Brand, do not expose another tenant, and do not request credentials. Empty candidate_refs is valid when evidence is weak. The backend resolver performs the final deterministic match and ambiguity check.',
    'active',
    'Lightweight text policy; no model call is embedded in the resolver. Agents use it only after interpretation_required.'
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
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO execution_policies
  (policy_group, policy_key, policy_value, active, execution_scope,
   affects_layer, blocking, notes)
VALUES
  (
    'Dynamic Brand Workspace Context Governance',
    'brand_workspace_context_minimal_policy_v1',
    JSON_OBJECT(
      'tool','brand_workspace_context_resolve',
      'direct_match_first',TRUE,
      'prompt_only_after_not_found',TRUE,
      'prompt_skill','brand_reference_interpreter_v1',
      'prompt_output','candidate_refs_only',
      'authorized_catalog_only',TRUE,
      'temporary_cache_ttl_seconds',900,
      'cache_is_authority',FALSE,
      'authorization_rechecked_every_call',TRUE,
      'virtual_assets_read_only',TRUE,
      'connection_states',JSON_ARRAY('configured','credentials_present','authorized','live_verified'),
      'live_verified_requires_wordpress_diagnostic',TRUE,
      'broad_collation_conversion_required',FALSE,
      'mixed_collation_join_strategy','separate_reads_application_join',
      'tenant_identity_source','signed_jwt_only',
      'provider_calls_allowed',FALSE,
      'mutations_allowed',FALSE,
      'external_sends_allowed',FALSE,
      'secrets_included',FALSE
    ),
    'TRUE',
    'brand|workspace|assets|brand_core|cms|wordpress|admin|tenant',
    'brandReferenceResolver|brandWorkspaceContextResolver|systemLayerRoutes|prompt_router',
    'TRUE',
    'Minimal dynamic resolution: deterministic direct/cache match, prompt-generated candidate refs only when required, deterministic validation, virtual assets, and separated connection state.'
  )
ON DUPLICATE KEY UPDATE
  policy_value = VALUES(policy_value),
  active = VALUES(active),
  execution_scope = VALUES(execution_scope),
  affects_layer = VALUES(affects_layer),
  blocking = VALUES(blocking),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;
