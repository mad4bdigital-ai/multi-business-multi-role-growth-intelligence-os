-- Register the repository-scoped authority required to make the already-installed
-- GitHub Repository Policy Controller reachable through the governed capability
-- envelope lifecycle. This migration performs metadata/registry writes only.
-- It does NOT call GitHub, apply a Ruleset, mutate a protected ref, read credential
-- payloads, deploy code, or authorize a live Apply by itself.
-- provider_call_executed=false; external_write_executed=false;
-- credential_payload_read=false; protected_ref_mutation=false;
-- force_push=false; secrets_included=false.

INSERT INTO platform_resource_adapters
  (adapter_key, resource_type, provider_key, adapter_kind, installed_tool_key, identity_resolver_key,
   metadata_normalizer_key, children_normalizer_key, content_policy, supports_plan, supports_read,
   supports_write, status, metadata_json, created_at, updated_at)
VALUES
  ('github_repository_policy_v2', 'repository', 'github', 'composite',
   'github_repository_policy_controller', 'platform_resource_context_resolve',
   'github_repository_policy_normalizer_v2', 'repository_capability_children_normalizer_v2',
   'metadata_only', 1, 1, 1, 'active',
   JSON_OBJECT(
     'provider','github',
     'effect_class','external_write',
     'target_branch','main',
     'provider_surface','github_rulesets_api',
     'same_cycle_readback_required',TRUE,
     'rollback_on_postcondition_failure',TRUE,
     'force_push_allowed',FALSE,
     'repository_content_mutation_allowed',FALSE,
     'credential_payload_read',FALSE,
     'secrets_included',FALSE), NOW(), NOW())
ON DUPLICATE KEY UPDATE
  resource_type=VALUES(resource_type), provider_key=VALUES(provider_key), adapter_kind=VALUES(adapter_kind),
  installed_tool_key=VALUES(installed_tool_key), identity_resolver_key=VALUES(identity_resolver_key),
  metadata_normalizer_key=VALUES(metadata_normalizer_key), children_normalizer_key=VALUES(children_normalizer_key),
  content_policy=VALUES(content_policy), supports_plan=VALUES(supports_plan), supports_read=VALUES(supports_read),
  supports_write=VALUES(supports_write), status='active', metadata_json=VALUES(metadata_json), updated_at=NOW();

INSERT INTO platform_capability_readback_contracts
  (contract_id, contract_key, contract_version, capability_key, adapter_key, verification_type,
   acknowledgement_required, verification_required, expected_effect_class, input_schema_json,
   observed_state_schema_json, provider_binding_constraints_json, certification_status, status,
   is_current, current_contract_key, valid_from, expires_at, revoked_at, source_registry, source_key,
   secrets_included, created_at, updated_at)
VALUES
  (UUID(), 'github_repository_policy_controller_readback_v2', 1,
   'repository_policy_controller', 'github_repository_policy_v2',
   'github_ruleset_same_cycle_readback', 1, 1, 'external_write',
   JSON_OBJECT(
     'type','object',
     'required',JSON_ARRAY('binding_key','expected_main_sha','expected_policy_fingerprint'),
     'properties',JSON_OBJECT(
       'binding_key',JSON_OBJECT('type','string'),
       'expected_main_sha',JSON_OBJECT('type','string','pattern','^[0-9a-f]{40}$'),
       'expected_policy_fingerprint',JSON_OBJECT('type','string','pattern','^[0-9a-f]{64}$'))),
   JSON_OBJECT(
     'type','object',
     'required',JSON_ARRAY('server_policy_gate_complete','main_sha','policy_fingerprint'),
     'properties',JSON_OBJECT(
       'server_policy_gate_complete',JSON_OBJECT('type','boolean','const',TRUE),
       'main_sha',JSON_OBJECT('type','string'),
       'policy_fingerprint',JSON_OBJECT('type','string'))),
   JSON_OBJECT(
     'provider','github',
     'target_branch','main',
     'ruleset_readback_required',TRUE,
     'strict_required_status_checks',TRUE,
     'required_review_thread_resolution',TRUE,
     'dismiss_stale_reviews_on_push',TRUE,
     'bypass_actors_allowed',FALSE,
     'force_push_allowed',FALSE,
     'direct_push_allowed',FALSE,
     'same_cycle_readback_required',TRUE,
     'rollback_on_postcondition_failure',TRUE,
     'secrets_included',FALSE),
   'certified', 'certified', 1, 'github_repository_policy_controller_readback_v2',
   NOW(), NULL, NULL, 'repository_capability_bindings', 'github_repository_policy_controller', 0, NOW(), NOW())
ON DUPLICATE KEY UPDATE
  contract_version=VALUES(contract_version), capability_key=VALUES(capability_key), adapter_key=VALUES(adapter_key),
  verification_type=VALUES(verification_type), acknowledgement_required=VALUES(acknowledgement_required),
  verification_required=VALUES(verification_required), expected_effect_class=VALUES(expected_effect_class),
  input_schema_json=VALUES(input_schema_json), observed_state_schema_json=VALUES(observed_state_schema_json),
  provider_binding_constraints_json=VALUES(provider_binding_constraints_json), certification_status=VALUES(certification_status),
  status='certified', is_current=1, current_contract_key=VALUES(current_contract_key), source_registry=VALUES(source_registry),
  source_key=VALUES(source_key), secrets_included=0, updated_at=NOW();

INSERT INTO capability_apply_authorization_policy_registry (
  policy_key, app_key, capability_key, operation_intent, runtime_surface, status,
  allow_external_write, allow_credential_binding, allow_no_credential_binding,
  requires_ready_for_dispatch, requires_dispatch_allowed, requires_zero_blocking_gaps,
  requires_audit_evidence, requires_readback, requires_typed_confirmation,
  requires_same_cycle_dry_run, allowed_source_tiers_json, policy_json, notes)
VALUES (
  'github_repository_policy_controller_apply_v1',
  'github',
  'repository_policy_controller',
  'github_repository_policy_apply',
  'system_layer',
  'active',
  1, 0, 1, 1, 1, 1, 1, 1, 1, 1,
  JSON_ARRAY('platform_managed_fallback'),
  JSON_OBJECT(
    'external_write_allowed',TRUE,
    'provider_call_allowed',TRUE,
    'provider_call_surface','github_app.repository_rulesets.create_or_update',
    'readback_surface','github_app.repository_rulesets.get',
    'server_side_github_app_auth_required',TRUE,
    'credential_binding_required',FALSE,
    'credential_payload_return_allowed',FALSE,
    'inline_secret_input_allowed',FALSE,
    'target_branch','main',
    'expected_main_sha_required',TRUE,
    'expected_policy_fingerprint_required',TRUE,
    'capability_binding_sha256_required',TRUE,
    'same_cycle_readback_required',TRUE,
    'rollback_on_postcondition_failure',TRUE,
    'typed_confirmation','APPLY_GITHUB_MAIN_REVIEW_POLICY',
    'bypass_actors_allowed',FALSE,
    'force_push_allowed',FALSE,
    'repository_content_mutation_allowed',FALSE,
    'audit_required',TRUE,
    'secrets_included',FALSE),
  'Exact dynamic external-write authority for the GitHub Repository Policy Controller. Apply remains impossible without a ready exact envelope, separate apply authorization, typed confirmation, current-main CAS, exact policy fingerprint and same-cycle readback.')
ON DUPLICATE KEY UPDATE
  app_key=VALUES(app_key), capability_key=VALUES(capability_key), operation_intent=VALUES(operation_intent),
  runtime_surface=VALUES(runtime_surface), status='active', allow_external_write=VALUES(allow_external_write),
  allow_credential_binding=VALUES(allow_credential_binding), allow_no_credential_binding=VALUES(allow_no_credential_binding),
  requires_ready_for_dispatch=VALUES(requires_ready_for_dispatch), requires_dispatch_allowed=VALUES(requires_dispatch_allowed),
  requires_zero_blocking_gaps=VALUES(requires_zero_blocking_gaps), requires_audit_evidence=VALUES(requires_audit_evidence),
  requires_readback=VALUES(requires_readback), requires_typed_confirmation=VALUES(requires_typed_confirmation),
  requires_same_cycle_dry_run=VALUES(requires_same_cycle_dry_run), allowed_source_tiers_json=VALUES(allowed_source_tiers_json),
  policy_json=VALUES(policy_json), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;

INSERT INTO repository_capability_bindings
  (capability_binding_id, capability_binding_key, repository_binding_id, capability_key, operation_intent,
   business_activity_type_key, adapter_key, policy_key, readback_contract_key, credential_ref, effect_class,
   configuration_json, lifecycle_status, capability_version, lock_version, is_primary, metadata_json, created_by)
SELECT UUID(), 'growth_intelligence_platform.github.repository_policy_controller.production', binding.binding_id,
       'repository_policy_controller', 'github_repository_policy_apply',
       NULL, 'github_repository_policy_v2', 'github_repository_policy_controller_apply_v1',
       'github_repository_policy_controller_readback_v2', NULL, 'external_write',
       JSON_OBJECT(
         'target_branch','main',
         'policy_controller_version','github-repository-policy-controller-v2',
         'expected_main_sha_required',TRUE,
         'expected_policy_fingerprint_required',TRUE,
         'typed_confirmation','APPLY_GITHUB_MAIN_REVIEW_POLICY',
         'same_cycle_readback_required',TRUE,
         'rollback_on_postcondition_failure',TRUE,
         'bypass_actors_allowed',FALSE,
         'force_push_allowed',FALSE,
         'repository_content_mutation_allowed',FALSE,
         'secrets_included',FALSE),
       'active', 1, 1, 0,
       JSON_OBJECT(
         'authority_source','repository_authority_bindings',
         'apply_authority_source','capability_apply_authorization_policy_registry',
         'migration','1051_github_repository_policy_live_apply_authority.sql',
         'provider_call_executed',FALSE,
         'external_write_executed',FALSE,
         'credential_payload_read',FALSE,
         'secrets_included',FALSE),
       'migration:1051_github_repository_policy_live_apply_authority.sql'
FROM repository_authority_bindings binding
WHERE binding.binding_key='growth_intelligence_platform.github.primary.production'
  AND binding.lifecycle_status='active'
ON DUPLICATE KEY UPDATE
  repository_binding_id=VALUES(repository_binding_id), capability_key=VALUES(capability_key),
  operation_intent=VALUES(operation_intent), business_activity_type_key=VALUES(business_activity_type_key),
  adapter_key=VALUES(adapter_key), policy_key=VALUES(policy_key), readback_contract_key=VALUES(readback_contract_key),
  credential_ref=NULL, effect_class=VALUES(effect_class), configuration_json=VALUES(configuration_json),
  lifecycle_status='active', metadata_json=VALUES(metadata_json), updated_at=NOW();

INSERT INTO repository_capability_policy_layers
  (layer_id, capability_binding_id, scope_type, scope_ref, precedence, configuration_json,
   lifecycle_status, layer_version, lock_version, metadata_json, created_by)
SELECT UUID(), capability.capability_binding_id, layers.scope_type, layers.scope_ref, layers.precedence,
       layers.configuration_json, 'active', 1, 1,
       JSON_OBJECT('source','migration:1051_github_repository_policy_live_apply_authority.sql','secrets_included',FALSE),
       'migration:1051_github_repository_policy_live_apply_authority.sql'
FROM repository_capability_bindings capability
JOIN (
  SELECT 'platform' AS scope_type, '*' AS scope_ref, 100 AS precedence,
         JSON_OBJECT('require_readback',TRUE,'require_typed_confirmation',TRUE,'allow_bypass',FALSE) AS configuration_json
  UNION ALL SELECT 'repository','growth_intelligence_platform.github.primary.production',600,
         JSON_OBJECT('target_branch','main','managed_ruleset_only',TRUE)
  UNION ALL SELECT 'environment','production',700,
         JSON_OBJECT('active',TRUE,'same_cycle_readback_required',TRUE)
) layers
WHERE capability.capability_binding_key='growth_intelligence_platform.github.repository_policy_controller.production'
ON DUPLICATE KEY UPDATE
  precedence=VALUES(precedence), configuration_json=VALUES(configuration_json), lifecycle_status='active',
  layer_version=repository_capability_policy_layers.layer_version+1,
  lock_version=repository_capability_policy_layers.lock_version+1,
  metadata_json=VALUES(metadata_json), updated_at=NOW();

INSERT INTO governed_migration_authorization_registry
  (migration_file, authorization_status, authorization_source, policy_key, risk_tier,
   requires_preflight, requires_confirmation, allow_record_only, allow_apply, notes, metadata_json)
VALUES
  ('1051_github_repository_policy_live_apply_authority.sql', 'authorized', 'migration_seed',
   'governed_migration_runner_authorization_v1', 'high', 1, 1, 1, 1,
   'Authorize metadata-only registration of the repository policy controller live-apply authority. Applying this migration does not call GitHub and does not authorize APPLY_GITHUB_MAIN_REVIEW_POLICY.',
   JSON_OBJECT(
     'scope','github_repository_policy_live_apply_authority_registration',
     'typed_migration_confirmation_required',TRUE,
     'live_github_policy_apply',FALSE,
     'provider_calls',FALSE,
     'external_writes',FALSE,
     'protected_ref_mutation',FALSE,
     'force_push',FALSE,
     'credential_payload_read',FALSE,
     'secrets_included',FALSE))
ON DUPLICATE KEY UPDATE
  authorization_status=VALUES(authorization_status), authorization_source=VALUES(authorization_source),
  policy_key=VALUES(policy_key), risk_tier=VALUES(risk_tier), requires_preflight=VALUES(requires_preflight),
  requires_confirmation=VALUES(requires_confirmation), allow_record_only=VALUES(allow_record_only),
  allow_apply=VALUES(allow_apply), notes=VALUES(notes), metadata_json=VALUES(metadata_json), updated_at=CURRENT_TIMESTAMP;
