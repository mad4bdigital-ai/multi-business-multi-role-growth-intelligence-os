-- Resolve verified medium operational-attention items that no longer require
-- operator action. Approval-bearing skill grants, the general mode-choice check,
-- unresolved runtime issues, and the Hostinger dev connector are intentionally
-- excluded from this migration.
--
-- Evidence collected before this migration:
-- - Production Hostinger target b49fe2ae-5974-11f1-9baf-8e76a7e1749f is
--   active/valid, uses github_main_auto_deploy, has ssh_path_status=skipped_by_user,
--   ssh_normal_updates_allowed=false, and ssh_break_glass_only=true.
-- - credentialIntakeEnforcement.js and its focused test cover platform and tenant
--   credential handoff, platform auto-promotion metadata, tenant boundaries, and
--   no-secret responses.
-- - OpenClaude health is ready_for_live_provider_dispatch with route/provider
--   dispatch live, dispatch_allowed=1, apply_allowed=0, and repo mutation disabled.
-- - listAdminSystemTools exposes runtime_endpoint_call; a fail-closed call to
--   google_docs_api__getDocument reached its descriptor and returned structured
--   invalid_request for missing documentId before any provider call.
-- - response_chunk_read exposes durable, dynamically extendable chunk TTL and
--   was successfully used for complete governed continuation reads.
-- - GitHub connector 9f94af7b-21da-4f36-a407-b08aeafbef97 is active/ready and
--   supersedes gated legacy target_resolved connector
--   9901bcae-30f6-4fcc-9f01-746e4d0b29b0.
--
-- Safety contract:
-- - exact readiness/connector/alert targeting
-- - current status/lifecycle guards
-- - no provider call, external write, or external send
-- - no credential payload read or secret return
-- - no schema change or destructive SQL
-- - secrets_included=false

UPDATE readiness_checks
SET check_status = 'pass',
    detail = 'Passed by policy supersession: production Hostinger uses GitHub main auto-deploy; SSH is skipped for normal updates and retained for break-glass only.',
    checked_at = CURRENT_TIMESTAMP
WHERE check_id IN (
  '4226f266-6287-11f1-8ecd-456940024c79',
  '84d2dc4c-627a-11f1-8ecd-456940024c79',
  '07f00750-6267-11f1-8ecd-456940024c79',
  'eb8b482f-625b-11f1-8ecd-456940024c79',
  'c43d3458-61c6-11f1-8ecd-456940024c79'
)
  AND check_status IN ('pending', 'warn');

UPDATE readiness_checks
SET check_status = 'pass',
    detail = 'Credential intake handoff is implemented and covered for platform/admin and tenant/user scopes, including no-secret responses and platform auto-promotion metadata.',
    checked_at = CURRENT_TIMESTAMP
WHERE check_id = '3efd554e-61b5-11f1-8ecd-456940024c79'
  AND check_status IN ('pending', 'warn');

UPDATE readiness_checks
SET check_status = 'pass',
    detail = 'OpenClaude provider bridge is live and ready for scoped provider dispatch; apply and repository mutation remain disabled.',
    checked_at = CURRENT_TIMESTAMP
WHERE check_id = 'openclaude-provider-bridge-contract-'
  AND check_status IN ('pending', 'warn');

UPDATE readiness_checks
SET check_status = 'pass',
    detail = 'System facade callability is active: runtime_endpoint_call is exposed and google_docs_api__getDocument resolves through the descriptor dispatcher with structured fail-closed validation.',
    checked_at = CURRENT_TIMESTAMP
WHERE check_id IN (
  '9346bcab-4b65-11f1-b256-614c56cd019b',
  'e36d7196-4b64-11f1-b256-614c56cd019b',
  'a7e37ab2-4b63-11f1-b256-614c56cd019b'
)
  AND check_status IN ('pending', 'warn');

UPDATE connected_systems
SET status = 'archived',
    config_json = JSON_SET(
      COALESCE(NULLIF(config_json, ''), '{}'),
      '$.execution_readiness', 'superseded',
      '$.resolution_classification', 'archived_superseded',
      '$.resolution_reason', 'active_ready_github_connector_replacement',
      '$.superseded_by_system_id', '9f94af7b-21da-4f36-a407-b08aeafbef97',
      '$.migration_provider_call_executed', FALSE,
      '$.migration_external_write_executed', FALSE,
      '$.migration_external_send_executed', FALSE,
      '$.credential_payload_read', FALSE,
      '$.secrets_included', FALSE
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE system_id = '9901bcae-30f6-4fcc-9f01-746e4d0b29b0'
  AND system_key = 'github_com_connector_target_resolved'
  AND status = 'pending';

UPDATE operational_alerts
SET lifecycle_status = 'resolved',
    lifecycle_revision = lifecycle_revision + 1,
    verification_state = 'verified',
    evidence_type = 'readiness_policy_supersession_readback',
    evidence_ref = 'target://b49fe2ae-5974-11f1-9baf-8e76a7e1749f',
    evidence_json = JSON_SET(
      COALESCE(evidence_json, JSON_OBJECT()),
      '$.resolution_classification', 'superseded',
      '$.resolution_reason', 'production_uses_github_main_auto_deploy',
      '$.production_target_status', 'active',
      '$.production_target_validation_status', 'valid',
      '$.deployment_strategy', 'github_main_auto_deploy',
      '$.ssh_path_status', 'skipped_by_user',
      '$.ssh_normal_updates_allowed', FALSE,
      '$.ssh_break_glass_only', TRUE,
      '$.migration_provider_call_executed', FALSE,
      '$.migration_external_write_executed', FALSE,
      '$.migration_external_send_executed', FALSE,
      '$.credential_payload_read', FALSE,
      '$.secrets_included', FALSE
    ),
    lifecycle_actor = 'migration:20260722_resolve_verified_medium_readiness_and_connector_attention',
    lifecycle_note = 'Resolved after live target readback confirmed the historical SSH readiness path is superseded for normal production updates.',
    resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
    resolution_note = 'GitHub main auto-deploy is the normal production path; SSH remains break-glass only.',
    secrets_included = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE alert_id IN (
  'a1035373-9ab4-4cc1-93f5-54f4a66d84b6',
  'a8c8f20e-cba7-4318-b778-0295f589da3c',
  '9c6ea599-f149-47f0-929b-7eb08dc497db',
  'e964acba-6684-4bb2-98aa-a8a15eca8fae',
  '546b79a1-e2fc-48d7-bf4e-297582b4a0ff'
)
  AND lifecycle_status IN ('open', 'acknowledged', 'investigating');

UPDATE operational_alerts
SET lifecycle_status = 'resolved',
    lifecycle_revision = lifecycle_revision + 1,
    verification_state = 'verified',
    evidence_type = 'credential_intake_contract_and_test_readback',
    evidence_ref = 'test://test-credential-intake-missing-credential-handoff.mjs',
    evidence_json = JSON_SET(
      COALESCE(evidence_json, JSON_OBJECT()),
      '$.platform_scope_covered', TRUE,
      '$.tenant_scope_covered', TRUE,
      '$.platform_auto_promotion_metadata_covered', TRUE,
      '$.tenant_boundary_covered', TRUE,
      '$.secrets_must_not_be_returned', TRUE,
      '$.migration_provider_call_executed', FALSE,
      '$.migration_external_write_executed', FALSE,
      '$.migration_external_send_executed', FALSE,
      '$.credential_payload_read', FALSE,
      '$.secrets_included', FALSE
    ),
    lifecycle_actor = 'migration:20260722_resolve_verified_medium_readiness_and_connector_attention',
    lifecycle_note = 'Resolved after implementation and focused regression coverage confirmed platform and tenant credential-intake handoff behavior.',
    resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
    resolution_note = 'Credential-intake handoff is implemented with scoped metadata and no-secret responses.',
    secrets_included = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE alert_id = 'be604cb0-e550-4b71-93e6-948028c410ae'
  AND lifecycle_status IN ('open', 'acknowledged', 'investigating');

UPDATE operational_alerts
SET lifecycle_status = 'resolved',
    lifecycle_revision = lifecycle_revision + 1,
    verification_state = 'verified',
    evidence_type = 'live_openclaude_health_readback',
    evidence_ref = 'health://dev_agent_openclaude_bridge_health',
    evidence_json = JSON_SET(
      COALESCE(evidence_json, JSON_OBJECT()),
      '$.readiness', 'ready_for_live_provider_dispatch',
      '$.route_live', TRUE,
      '$.provider_dispatch_enabled', TRUE,
      '$.live_provider_ready', TRUE,
      '$.dispatch_allowed', TRUE,
      '$.apply_allowed', FALSE,
      '$.repo_mutation_allowed', FALSE,
      '$.migration_provider_call_executed', FALSE,
      '$.migration_external_write_executed', FALSE,
      '$.migration_external_send_executed', FALSE,
      '$.credential_payload_read', FALSE,
      '$.secrets_included', FALSE
    ),
    lifecycle_actor = 'migration:20260722_resolve_verified_medium_readiness_and_connector_attention',
    lifecycle_note = 'Resolved after live OpenClaude health readback confirmed scoped provider-dispatch readiness.',
    resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
    resolution_note = 'The provider bridge is live and dispatch-ready; apply and repository mutation remain disabled.',
    secrets_included = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE alert_id = '8858b083-5afd-4d1d-b878-68c90ba825a2'
  AND lifecycle_status IN ('open', 'acknowledged', 'investigating');

UPDATE operational_alerts
SET lifecycle_status = 'resolved',
    lifecycle_revision = lifecycle_revision + 1,
    verification_state = 'verified',
    evidence_type = 'system_facade_callability_readback',
    evidence_ref = 'system-tool://runtime_endpoint_call',
    evidence_json = JSON_SET(
      COALESCE(evidence_json, JSON_OBJECT()),
      '$.runtime_endpoint_call_exposed', TRUE,
      '$.google_docs_get_document_descriptor_callable', TRUE,
      '$.structured_fail_closed_validation', TRUE,
      '$.observed_error_code', 'invalid_request',
      '$.provider_call_executed', FALSE,
      '$.migration_external_write_executed', FALSE,
      '$.migration_external_send_executed', FALSE,
      '$.credential_payload_read', FALSE,
      '$.secrets_included', FALSE
    ),
    lifecycle_actor = 'migration:20260722_resolve_verified_medium_readiness_and_connector_attention',
    lifecycle_note = 'Resolved after live system-tool discovery and fail-closed descriptor dispatch confirmed the facade is registry-callable.',
    resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
    resolution_note = 'runtime_endpoint_call is exposed and google_docs_api__getDocument resolves with structured input validation before provider execution.',
    secrets_included = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE alert_id IN (
  '2c18a318-22aa-4e33-97a4-cc7d93ff1fdb',
  'b812e948-2e57-4a4d-aa1c-823c99ec529c',
  '191fc2a7-e864-4c7a-81d2-ac8a416173b8'
)
  AND lifecycle_status IN ('open', 'acknowledged', 'investigating');

UPDATE operational_alerts
SET lifecycle_status = 'resolved',
    lifecycle_revision = lifecycle_revision + 1,
    verification_state = 'verified',
    evidence_type = 'durable_response_chunk_contract_readback',
    evidence_ref = 'system-tool://response_chunk_read',
    evidence_json = JSON_SET(
      COALESCE(evidence_json, JSON_OBJECT()),
      '$.durable_cache_enabled', TRUE,
      '$.dynamic_ttl_supported', TRUE,
      '$.ttl_extension_on_successful_read', TRUE,
      '$.complete_chunk_consumption_verified', TRUE,
      '$.provider_call_executed', FALSE,
      '$.migration_external_write_executed', FALSE,
      '$.migration_external_send_executed', FALSE,
      '$.credential_payload_read', FALSE,
      '$.secrets_included', FALSE
    ),
    lifecycle_actor = 'migration:20260722_resolve_verified_medium_readiness_and_connector_attention',
    lifecycle_note = 'Resolved after durable response-chunk caching, configurable TTL, and successful complete continuation reads were verified.',
    resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
    resolution_note = 'The governed response_chunk_read contract now provides durable cache metadata, dynamic TTL controls, and retention extension after successful reads.',
    secrets_included = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE alert_id = '150a5110-6b16-11f1-8ecd-456940024c79'
  AND alert_key = 'known.response_chunk_cache_expiry'
  AND lifecycle_status IN ('open', 'acknowledged', 'investigating');

UPDATE operational_alerts
SET lifecycle_status = 'resolved',
    lifecycle_revision = lifecycle_revision + 1,
    verification_state = 'verified',
    evidence_type = 'active_connector_replacement_readback',
    evidence_ref = 'connected-system://9f94af7b-21da-4f36-a407-b08aeafbef97',
    evidence_json = JSON_SET(
      COALESCE(evidence_json, JSON_OBJECT()),
      '$.resolution_classification', 'archived_superseded',
      '$.superseded_connector_id', '9901bcae-30f6-4fcc-9f01-746e4d0b29b0',
      '$.replacement_connector_id', '9f94af7b-21da-4f36-a407-b08aeafbef97',
      '$.replacement_status', 'active',
      '$.replacement_execution_readiness', 'ready',
      '$.migration_provider_call_executed', FALSE,
      '$.migration_external_write_executed', FALSE,
      '$.migration_external_send_executed', FALSE,
      '$.credential_payload_read', FALSE,
      '$.secrets_included', FALSE
    ),
    lifecycle_actor = 'migration:20260722_resolve_verified_medium_readiness_and_connector_attention',
    lifecycle_note = 'Resolved after the gated legacy target-resolved connector was archived in favor of the active ready GitHub API connector.',
    resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
    resolution_note = 'The one-endpoint gated legacy connector is superseded by the active 41-endpoint ready connector.',
    secrets_included = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE alert_id = 'aa5ad403-92f1-4ffd-bf04-9ec7b49b43b1'
  AND source_record_id = '9901bcae-30f6-4fcc-9f01-746e4d0b29b0'
  AND lifecycle_status IN ('open', 'acknowledged', 'investigating');
