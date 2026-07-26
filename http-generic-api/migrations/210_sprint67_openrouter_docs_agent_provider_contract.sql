-- Sprint 67: OpenRouter-first model provider contract for Docs Agent drafting.
-- Registry/instruction-contract only. This migration stores no secrets, does not
-- enable provider dispatch, and does not mark the provider active before a live
-- credential binding and same-cycle bridge smoke exist.

INSERT INTO ai_model_providers
  (provider_key, display_name, provider_type, credential_binding_key,
   supports_streaming, supports_tool_use, supports_prompt_cache,
   secrets_returned_to_agent, status, notes)
VALUES
  ('openrouter_openai_compatible',
   'OpenRouter OpenAI-Compatible Platform Bridge',
   'proxy',
   'credential_bindings:platform:openrouter_api_key',
   1, 1, 0, 0,
   'planned',
   'OpenRouter is the priority model provider for Docs Agent drafting through a platform-managed OpenAI-compatible bridge. No API key is returned to agents; dispatch remains blocked until credential binding and bridge smoke certification pass.')
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  provider_type = VALUES(provider_type),
  credential_binding_key = VALUES(credential_binding_key),
  supports_streaming = VALUES(supports_streaming),
  supports_tool_use = VALUES(supports_tool_use),
  supports_prompt_cache = VALUES(supports_prompt_cache),
  secrets_returned_to_agent = VALUES(secrets_returned_to_agent),
  status = VALUES(status),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO ai_model_registry
  (model_key, provider_key, display_name, model_family,
   canonical_message_protocol_json, allowed_content_blocks_json,
   thinking_metadata_policy_json, tool_use_policy_json, cost_policy_json,
   status, notes)
VALUES
  ('openrouter_docs_agent_writer_v1',
   'openrouter_openai_compatible',
   'OpenRouter Docs Agent Writer',
   'openai_compatible_chat',
   JSON_OBJECT(
     'protocol','openai_chat_completions',
     'endpoint_shape','/api/v1/chat/completions',
     'message_roles',JSON_ARRAY('system','developer','user','assistant','tool'),
     'response_contract','return_unified_diff_or_structured_doc_patch',
     'platform_transport_only',true
   ),
   JSON_OBJECT(
     'allowed',JSON_ARRAY('text','json','unified_diff'),
     'denied',JSON_ARRAY('raw_secret','credential_value','binary_blob','unbounded_file_dump')
   ),
   JSON_OBJECT(
     'chain_of_thought_visible',false,
     'allowed_reasoning_summary','brief_patch_rationale_only',
     'must_not_return_hidden_reasoning',true
   ),
   JSON_OBJECT(
     'tool_use_allowed',false,
     'platform_tool_use_by_orchestrator_only',true,
     'model_must_not_call_provider_or_repo_tools_directly',true
   ),
   JSON_OBJECT(
     'budget_class','docs_agent_low_to_medium',
     'default_model_slug','~openai/gpt-latest',
     'fallback_model_slug','openai/gpt-4o-mini',
     'max_input_chars',120000,
     'max_output_chars',24000,
     'requires_runtime_budget_check',true
   ),
   'planned',
   'Docs Agent drafting profile using OpenRouter through the platform bridge. Planned until OPENROUTER_API_KEY credential binding and no-secret bridge dry-run are certified.'),
  ('openrouter_docs_agent_reviewer_v1',
   'openrouter_openai_compatible',
   'OpenRouter Docs Agent Reviewer',
   'openai_compatible_chat',
   JSON_OBJECT(
     'protocol','openai_chat_completions',
     'endpoint_shape','/api/v1/chat/completions',
     'message_roles',JSON_ARRAY('system','developer','user','assistant'),
     'response_contract','return_risk_review_and_required_doc_targets',
     'platform_transport_only',true
   ),
   JSON_OBJECT(
     'allowed',JSON_ARRAY('text','json'),
     'denied',JSON_ARRAY('raw_secret','credential_value','binary_blob','unbounded_file_dump')
   ),
   JSON_OBJECT(
     'chain_of_thought_visible',false,
     'allowed_reasoning_summary','brief_evidence_summary_only',
     'must_not_return_hidden_reasoning',true
   ),
   JSON_OBJECT(
     'tool_use_allowed',false,
     'platform_tool_use_by_orchestrator_only',true,
     'model_must_not_call_provider_or_repo_tools_directly',true
   ),
   JSON_OBJECT(
     'budget_class','docs_agent_review_low',
     'default_model_slug','~openai/gpt-latest',
     'fallback_model_slug','openai/gpt-4o-mini',
     'max_input_chars',80000,
     'max_output_chars',12000,
     'requires_runtime_budget_check',true
   ),
   'planned',
   'Docs Agent review profile using OpenRouter through the platform bridge. Planned until credential binding and no-secret bridge dry-run are certified.')
ON DUPLICATE KEY UPDATE
  provider_key = VALUES(provider_key),
  display_name = VALUES(display_name),
  model_family = VALUES(model_family),
  canonical_message_protocol_json = VALUES(canonical_message_protocol_json),
  allowed_content_blocks_json = VALUES(allowed_content_blocks_json),
  thinking_metadata_policy_json = VALUES(thinking_metadata_policy_json),
  tool_use_policy_json = VALUES(tool_use_policy_json),
  cost_policy_json = VALUES(cost_policy_json),
  status = VALUES(status),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO platform_runtime_config
  (config_key, config_json, status, note)
VALUES
  ('docs_agent_openrouter_instruction_contract_v1',
   JSON_OBJECT(
     'contract_key','docs_agent_openrouter_instruction_contract_v1',
     'provider_key','openrouter_openai_compatible',
     'primary_model_key','openrouter_docs_agent_writer_v1',
     'review_model_key','openrouter_docs_agent_reviewer_v1',
     'activation_status','planned_pending_credential_and_bridge_smoke',
     'transport_rule','platform_api_only',
     'provider_direct_calls_from_agent',false,
     'secrets_returned_to_agent',false,
     'required_inputs',JSON_ARRAY(
       'docs-impact-classifier manifest',
       'bounded git diff',
       'current target documentation snippets',
       'platform instruction bundle',
       'repository safety policy'
     ),
     'instruction_bundle',JSON_OBJECT(
       'system_identity','Growth Intelligence Platform Docs Agent Writer',
       'primary_goal','produce minimal, accurate documentation patches for repository changes',
       'must_use','platform governed API/orchestrator only',
       'must_not_use',JSON_ARRAY('direct provider credentials','native GitHub mutations','local shell','database writes','provider API outside platform bridge'),
       'required_context',JSON_ARRAY('activation/session context when available','AI_Agent_Knowledge_Guide.md','docs/change-documentation-governance.md','docs/ai-docs-agent-governance.md','docs/auto-docs-agent/README.md','deployment_parity_checklist.md for deployment/runtime changes'),
       'output_contract','unified diff or structured docs patch plus concise rationale',
       'write_scope','documentation files only unless orchestrator explicitly marks a test/manifest update as required',
       'merge_policy','model never merges; GitHub auto-merge remains branch-protection gated'
     ),
     'safety_gates',JSON_OBJECT(
       'no_secrets',true,
       'no_main_direct_write',true,
       'docs_only_auto_merge_unit',true,
       'high_risk_requires_targeted_docs',true,
       'credential_binding_required_before_active',true,
       'bridge_smoke_required_before_active',true
     ),
     'docs_agent_tasks',JSON_ARRAY('draft_docs_patch','review_docs_patch','explain_docs_impact','suggest_required_doc_targets'),
     'forbidden_tasks',JSON_ARRAY('deploy production','restart services','mutate live database','read or output credentials','approve own PR','bypass branch protection'),
     'secrets_included',false
   ),
   'active',
   'Instruction contract for OpenRouter-backed Docs Agent drafting. Active as a contract only; provider dispatch remains planned until credential and bridge smoke certification pass.'
  ),
  ('openrouter_provider_activation_checklist_v1',
   JSON_OBJECT(
     'provider_key','openrouter_openai_compatible',
     'status','planned_pending_operator_credential',
     'required_steps',JSON_ARRAY(
       'create platform credential binding for OPENROUTER_API_KEY without exposing value',
       'run bridge health dry-run and confirm secrets_included=false',
       'run chat-completions dry-run with dry_run=true and no provider dispatch',
       'enable provider dispatch only after scoped proxy route exists and certification is updated',
       'promote ai_model_providers.status and ai_model_registry.status from planned to active only after same-cycle validation'
     ),
     'current_blockers',JSON_ARRAY('missing_openrouter_credential_binding','provider_dispatch_disabled_until_bridge_certified'),
     'secrets_included',false
   ),
   'active',
   'OpenRouter activation checklist. Records required validation gates without storing credentials.'
  )
ON DUPLICATE KEY UPDATE
  config_json = VALUES(config_json),
  status = VALUES(status),
  note = VALUES(note),
  updated_at = CURRENT_TIMESTAMP;

UPDATE dev_agent_provider_registry
SET status = 'planned',
    policy_json = JSON_OBJECT(
      'copy_platform_secret_to_device', false,
      'requires_provider_bridge', true,
      'preferred_for_docs_agent', true,
      'platform_api_only', true,
      'can_mutate_repo', false,
      'repo_mutation_allowed', false,
      'secrets_included', false,
      'instruction_contract_key', 'docs_agent_openrouter_instruction_contract_v1'
    ),
    notes = 'OpenRouter is the priority provider for Docs Agent drafting, but remains planned until platform credential binding and bridge smoke certification pass. Use platform API/orchestrator only; no provider secret is copied to agents or devices.',
    updated_at = CURRENT_TIMESTAMP
WHERE provider_key IN ('openclaude_openrouter_openai_compatible','codex_openrouter_custom_provider');
