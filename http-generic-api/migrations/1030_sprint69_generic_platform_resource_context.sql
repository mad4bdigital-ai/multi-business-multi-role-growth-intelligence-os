-- Sprint 69: Generic Platform Resource Context
--
-- Registers one resource-first Admin/Tenant resolver plus bounded helper tools
-- for catalog discovery, exact-key relationship expansion, and safe diagnostic
-- handoff. Brand, Workspace, Asset, CMS Site, and Connection are supported as
-- equal entry points. The older Brand Workspace resolver remains a compatibility
-- surface and is not removed.
--
-- Additive only. No provider call, provider write, external send, credential
-- decryption, broad collation conversion, destructive DDL, or secret return.

INSERT INTO system_layer_tool_descriptor_source_registry
  (source_key, module_path, descriptor_export, handler_resolution_mode,
   tool_count_expected, status, metadata_json, secrets_included)
VALUES
  (
    'platform_resource_context_v1',
    'platformResourceContextResolver.js',
    'PLATFORM_RESOURCE_CONTEXT_SYSTEM_TOOLS',
    'handler_name_or_snake_to_camel',
    5,
    'active',
    JSON_OBJECT(
      'resource_first', TRUE,
      'supported_resource_types', JSON_ARRAY('brand','workspace','asset','site','connection'),
      'entry_mode', 'auto_or_typed',
      'helper_tools', JSON_ARRAY(
        'platform_resource_context_catalog',
        'platform_resource_context_related',
        'platform_resource_context_diagnostic_handoff'
      ),
      'prompt_skill_key', 'resource_reference_interpreter_v1',
      'prompt_role', 'candidate_generation_only',
      'tenant_identity_source', 'signed_jwt_only',
      'brand_context_optional', TRUE,
      'compatibility_tool', 'brand_workspace_context_resolve',
      'mixed_collation_strategy', 'separate_reads_application_join',
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
    'platform_resource_context_resolve',
    'Resolve Platform Resource Context',
    'Resolve an authorized Brand, Workspace, Asset, CMS Site, or Connection from a typed or auto-detected reference and return the related resource graph. Prompt-generated candidate_refs are hints only; final matching and authorization remain deterministic.',
    'POST',
    '/system/tools/call',
    JSON_OBJECT(
      'type','object',
      'properties',JSON_OBJECT(
        'tool_args',JSON_OBJECT(
          'type','object',
          'properties',JSON_OBJECT(
            'reference',JSON_OBJECT('type','string','minLength',1,'maxLength',2048),
            'resource_ref',JSON_OBJECT('type','string','minLength',1,'maxLength',2048),
            'resource_type',JSON_OBJECT('type','string','enum',JSON_ARRAY('auto','brand','workspace','asset','site','connection'),'default','auto'),
            'brand_name',JSON_OBJECT('type','string','minLength',1,'maxLength',255),
            'brand_ref',JSON_OBJECT('type','string','minLength',1,'maxLength',2048),
            'target_key',JSON_OBJECT('type','string','minLength',1,'maxLength',255),
            'workspace_ref',JSON_OBJECT('type','string','minLength',1,'maxLength',2048),
            'asset_ref',JSON_OBJECT('type','string','minLength',1,'maxLength',2048),
            'site_ref',JSON_OBJECT('type','string','minLength',1,'maxLength',2048),
            'site_url',JSON_OBJECT('type','string','minLength',1,'maxLength',2048),
            'connection_id',JSON_OBJECT('type','string','minLength',1,'maxLength',255),
            'candidate_refs',JSON_OBJECT('type','array','maxItems',8,'items',JSON_OBJECT('type','string','minLength',1,'maxLength',255)),
            'include_brand_context',JSON_OBJECT('type','boolean','default',TRUE)
          ),
          'anyOf',JSON_ARRAY(
            JSON_OBJECT('required',JSON_ARRAY('reference')),
            JSON_OBJECT('required',JSON_ARRAY('resource_ref')),
            JSON_OBJECT('required',JSON_ARRAY('brand_name')),
            JSON_OBJECT('required',JSON_ARRAY('brand_ref')),
            JSON_OBJECT('required',JSON_ARRAY('target_key')),
            JSON_OBJECT('required',JSON_ARRAY('workspace_ref')),
            JSON_OBJECT('required',JSON_ARRAY('asset_ref')),
            JSON_OBJECT('required',JSON_ARRAY('site_ref')),
            JSON_OBJECT('required',JSON_ARRAY('site_url')),
            JSON_OBJECT('required',JSON_ARRAY('connection_id'))
          ),
          'additionalProperties',FALSE
        )
      ),
      'required',JSON_ARRAY('tool_args'),
      'additionalProperties',FALSE
    ),
    JSON_OBJECT('name','platform_resource_context_resolve'),
    'tenant,admin,resource_context,brand,workspace,asset,cms,site,connection,auto_detection,multilingual,read_only,no_provider_call,no_external_send,no_secrets,descriptor_backed',
    1,
    374
  ),
  (
    'platform_resource_context_catalog',
    'List Authorized Platform Resources',
    'List the signed principal authorized Brand, Workspace, Asset, CMS Site, and Connection references with type filtering, normalized search, and cursor pagination. Tenant catalogs are constructed only after membership and effective resource authorization.',
    'POST',
    '/system/tools/call',
    JSON_OBJECT(
      'type','object',
      'properties',JSON_OBJECT(
        'tool_args',JSON_OBJECT(
          'type','object',
          'properties',JSON_OBJECT(
            'resource_type',JSON_OBJECT('type','string','enum',JSON_ARRAY('auto','brand','workspace','asset','site','connection'),'default','auto'),
            'search',JSON_OBJECT('type','string','maxLength',255),
            'cursor',JSON_OBJECT('type','integer','minimum',0,'default',0),
            'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',100,'default',25)
          ),
          'additionalProperties',FALSE
        )
      ),
      'required',JSON_ARRAY('tool_args'),
      'additionalProperties',FALSE
    ),
    JSON_OBJECT('name','platform_resource_context_catalog'),
    'tenant,admin,resource_context,catalog,discovery,pagination,read_only,no_provider_call,no_external_send,no_secrets,descriptor_backed',
    1,
    375
  ),
  (
    'platform_resource_context_related',
    'Expand Related Platform Resources',
    'Expand the authorized one-hop graph for one canonical resource_type and resource_key. This helper uses deterministic exact-key resolution and never invokes language interpretation.',
    'POST',
    '/system/tools/call',
    JSON_OBJECT(
      'type','object',
      'properties',JSON_OBJECT(
        'tool_args',JSON_OBJECT(
          'type','object',
          'properties',JSON_OBJECT(
            'resource_type',JSON_OBJECT('type','string','enum',JSON_ARRAY('brand','workspace','asset','site','connection')),
            'resource_key',JSON_OBJECT('type','string','minLength',1,'maxLength',2048),
            'include_brand_context',JSON_OBJECT('type','boolean','default',TRUE)
          ),
          'required',JSON_ARRAY('resource_type','resource_key'),
          'additionalProperties',FALSE
        )
      ),
      'required',JSON_ARRAY('tool_args'),
      'additionalProperties',FALSE
    ),
    JSON_OBJECT('name','platform_resource_context_related'),
    'tenant,admin,resource_context,relationships,exact_key,read_only,no_provider_call,no_external_send,no_secrets,descriptor_backed',
    1,
    376
  ),
  (
    'platform_resource_context_diagnostic_handoff',
    'Prepare Resource Diagnostic Handoff',
    'Resolve any authorized resource reference and return safe CMS/connection diagnostic contexts. Registry configuration and credential presence are reported separately from live connectivity, which remains not_checked until a provider diagnostic runs.',
    'POST',
    '/system/tools/call',
    JSON_OBJECT(
      'type','object',
      'properties',JSON_OBJECT(
        'tool_args',JSON_OBJECT(
          'type','object',
          'properties',JSON_OBJECT(
            'reference',JSON_OBJECT('type','string','minLength',1,'maxLength',2048),
            'resource_ref',JSON_OBJECT('type','string','minLength',1,'maxLength',2048),
            'resource_type',JSON_OBJECT('type','string','enum',JSON_ARRAY('auto','brand','workspace','asset','site','connection'),'default','auto'),
            'candidate_refs',JSON_OBJECT('type','array','maxItems',8,'items',JSON_OBJECT('type','string','minLength',1,'maxLength',255))
          ),
          'anyOf',JSON_ARRAY(
            JSON_OBJECT('required',JSON_ARRAY('reference')),
            JSON_OBJECT('required',JSON_ARRAY('resource_ref'))
          ),
          'additionalProperties',FALSE
        )
      ),
      'required',JSON_ARRAY('tool_args'),
      'additionalProperties',FALSE
    ),
    JSON_OBJECT('name','platform_resource_context_diagnostic_handoff'),
    'tenant,admin,resource_context,diagnostic_handoff,cms,wordpress,connection,read_only,no_provider_call,no_external_send,no_secrets,descriptor_backed',
    1,
    377
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
    'resource_reference_resolution_engine',
    'Platform Resource Reference Resolution Engine',
    'generic',
    NULL,
    JSON_ARRAY('resource_reference_interpret'),
    JSON_OBJECT(
      'resource_types',JSON_ARRAY('brand','workspace','asset','site','connection'),
      'model_role','candidate_generation_only',
      'authorized_catalog_required',TRUE,
      'deterministic_registry_validation_required',TRUE,
      'tenant_authority_separate',TRUE,
      'provider_call_from_resolver',FALSE
    ),
    'resource_reference_interpretation_policy_v1',
    'active',
    'Text-skill engine for spelling, spacing, script, transliteration, label, domain, and identifier candidates across governed resource types. It does not select authority or call providers.'
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
    'resource_reference_interpretation_policy_v1',
    'resource_reference_resolution_engine',
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
      'tenant_authority_before_catalog_and_after_resolution'
    ),
    JSON_ARRAY('grant authority','invent resource key','invent tenant resource','cross tenant'),
    JSON_ARRAY('brand:*','workspace:*','asset:*','site:*','connection:*'),
    JSON_ARRAY('credential:*','secret:*','provider_write:*'),
    'active',
    'Prompt output is candidate_refs only. It cannot grant authority, bypass ambiguity, mutate registries, expose another tenant, or invent a valid resource key.'
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
    'resource_reference_candidate_generation_v1',
    'resource_reference_interpretation_policy_v1',
    'resource_reference_resolution_engine',
    100,
    'resource_reference_interpret',
    'resource',
    '*',
    JSON_OBJECT('requires_interpretation_status','interpretation_required'),
    'diagnose_only',
    'low',
    0,
    1,
    0,
    JSON_ARRAY('authorized_catalog_only','max_eight_candidates','json_output_only'),
    JSON_ARRAY('authority_decision','tenant_override','credential_request','invented_resource_key'),
    JSON_ARRAY('spelling_variant','spacing_variant','transliteration','script_variant','domain_variant','identifier_variant'),
    JSON_ARRAY('resource_reference_interpreter_v1'),
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
    'resource_reference_interpreter_v1',
    'resource_reference_resolution_engine',
    'Platform Resource Reference Interpreter',
    'v1',
    JSON_ARRAY('resource_reference_interpret'),
    JSON_ARRAY('platform_resource_context_resolve','platform_resource_context_catalog'),
    JSON_ARRAY('provider_write','credential_read','registry_mutation','cross_tenant_catalog'),
    JSON_ARRAY('authorized_catalog_only','candidate_count_lte_8','no_invented_resource_keys','json_shape_valid'),
    JSON_OBJECT(
      'candidate_refs_only',TRUE,
      'max_candidates',8,
      'supported_resource_types',JSON_ARRAY('brand','workspace','asset','site','connection'),
      'may_transform_spacing',TRUE,
      'may_transliterate',TRUE,
      'may_normalize_labels_and_domains',TRUE,
      'authority_decision',FALSE
    ),
    JSON_OBJECT(
      'no_confident_candidate','return_empty_candidate_refs',
      'multiple_plausible_candidates','return_all_bounded_candidates_for_backend_ambiguity_check',
      'never_request_internal_ids',TRUE
    ),
    'You are a governed platform resource reference interpretation skill. Input contains user_resource_reference, requested_resource_type, and authorized_resource_catalog. Produce JSON only: {"detected_language":"...","detected_script":"...","candidate_refs":["..."]}. Generate at most 8 likely spelling, spacing, transliteration, script, label, domain, or identifier variants. Use only labels and resource keys already present in authorized_resource_catalog as evidence. Do not decide authorization, do not claim a final match, do not invent a resource key or resource, do not expose another tenant, and do not request credentials. Empty candidate_refs is valid when evidence is weak. The backend resolver performs final deterministic matching and ambiguity checks.',
    'active',
    'Lightweight text policy. No model call is embedded in the resolver; agents use it only after interpretation_required.'
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

INSERT INTO agent_skills
  (skill_id, skill_key, display_name, description, skill_type, scope,
   capability_json, requires_approval, status)
VALUES
  (
    '8f43bc59-b6dd-4aa0-a1b5-67119d5f6810',
    'resource_reference_interpreter_v1',
    'Platform Resource Reference Interpreter',
    'Generate bounded multilingual and identifier candidate references from an authorized resource catalog. Candidate generation only; deterministic backend validation and Tenant authority remain mandatory.',
    'logic_execution',
    'global',
    JSON_OBJECT(
      'task_class','resource_reference_interpret',
      'candidate_generation_only',TRUE,
      'max_candidates',8,
      'authorized_catalog_only',TRUE,
      'provider_call_embedded',FALSE,
      'authority_decision',FALSE,
      'secrets_included',FALSE
    ),
    0,
    'active'
  )
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  skill_type = VALUES(skill_type),
  scope = VALUES(scope),
  capability_json = VALUES(capability_json),
  requires_approval = VALUES(requires_approval),
  status = VALUES(status);

INSERT INTO execution_policies
  (policy_group, policy_key, policy_value, active, execution_scope,
   affects_layer, blocking, notes)
VALUES
  (
    'Platform Resource Context Governance',
    'platform_resource_context_dynamic_policy_v1',
    JSON_OBJECT(
      'primary_tool','platform_resource_context_resolve',
      'helper_tools',JSON_ARRAY(
        'platform_resource_context_catalog',
        'platform_resource_context_related',
        'platform_resource_context_diagnostic_handoff'
      ),
      'resource_first',TRUE,
      'supported_resource_types',JSON_ARRAY('brand','workspace','asset','site','connection'),
      'direct_match_first',TRUE,
      'prompt_only_after_not_found',TRUE,
      'prompt_skill','resource_reference_interpreter_v1',
      'prompt_output','candidate_refs_only',
      'authorized_catalog_only',TRUE,
      'brand_context_optional',TRUE,
      'compatibility_tool','brand_workspace_context_resolve',
      'connection_states',JSON_ARRAY('configured','credentials_present','authorized','live_verified'),
      'live_verified_requires_provider_diagnostic',TRUE,
      'broad_collation_conversion_required',FALSE,
      'mixed_collation_join_strategy','separate_reads_application_join',
      'tenant_identity_source','signed_jwt_only',
      'provider_calls_allowed',FALSE,
      'mutations_allowed',FALSE,
      'external_sends_allowed',FALSE,
      'secrets_included',FALSE
    ),
    'TRUE',
    'resource_context|brand|workspace|asset|cms|site|connection|admin|tenant',
    'platformResourceContextResolver|systemLayerRoutes|prompt_router|module_loader',
    'TRUE',
    'Generic resource-first context resolution with catalog, exact relationship expansion, safe diagnostic handoff, and candidate-only language interpretation.'
  )
ON DUPLICATE KEY UPDATE
  policy_value = VALUES(policy_value),
  active = VALUES(active),
  execution_scope = VALUES(execution_scope),
  affects_layer = VALUES(affects_layer),
  blocking = VALUES(blocking),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;
