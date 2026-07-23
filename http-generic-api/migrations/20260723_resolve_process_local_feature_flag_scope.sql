-- Resolve the historical process-local feature flag scope issue after shared
-- governed runtime configuration and release-gate readback were verified.
--
-- Evidence collected before this migration:
-- - releaseGateManagerService.js writes compatibility state transactionally to
--   platform_runtime_config and reads it back from the same SQL authority.
-- - remote_runtime_hostinger_ssh_executor_enabled is persisted as disabled with
--   a dynamic release-gate snapshot and same_cycle_readback_required=true.
-- - three Hostinger release gates for the production target are hard_disabled,
--   including ba99eb81-d5e4-470d-87bd-474ef95a66d3.
-- - test-dynamic-release-gate-manager.mjs covers open, closed, expired, envelope,
--   shared compatibility config, and no-secret behavior.
--
-- Safety contract:
-- - exact alert ID and key targeting
-- - lifecycle-only internal persistence
-- - no provider call, external write/send, credential read, or secrets
-- - no schema change or destructive SQL

UPDATE operational_alerts
SET lifecycle_status = 'resolved',
    lifecycle_revision = lifecycle_revision + 1,
    verification_state = 'verified',
    evidence_type = 'shared_runtime_config_and_release_gate_readback',
    evidence_ref = 'config://remote_runtime_hostinger_ssh_executor_enabled',
    evidence_json = JSON_SET(
      COALESCE(evidence_json, JSON_OBJECT()),
      '$.resolution_verified', TRUE,
      '$.shared_runtime_config_table', 'platform_runtime_config',
      '$.shared_runtime_config_key', 'remote_runtime_hostinger_ssh_executor_enabled',
      '$.shared_runtime_config_status', 'disabled',
      '$.shared_runtime_config_manager', 'releaseGateManagerService.js',
      '$.shared_runtime_config_readback_function', 'readReleaseGate',
      '$.shared_runtime_config_write_function', 'writeCompatibilityConfig',
      '$.same_cycle_readback_required', TRUE,
      '$.dynamic_release_gate_manager_verified', TRUE,
      '$.verified_gate_ids', JSON_ARRAY(
        'ba99eb81-d5e4-470d-87bd-474ef95a66d3',
        '189baf99-8da1-4b46-b1ad-219f2c03805f',
        '3f000f9e-0a3e-4203-a19d-c9530d7b53db'
      ),
      '$.verified_gate_status', 'hard_disabled',
      '$.test_evidence', 'test-dynamic-release-gate-manager.mjs',
      '$.process_local_environment_mutation_required', FALSE,
      '$.migration_provider_call_executed', FALSE,
      '$.migration_external_write_executed', FALSE,
      '$.migration_external_send_executed', FALSE,
      '$.credential_payload_read', FALSE,
      '$.secrets_included', FALSE
    ),
    lifecycle_actor = 'migration:20260723_resolve_process_local_feature_flag_scope',
    lifecycle_note = 'Resolved after SQL-backed governed runtime configuration and dynamic release-gate readback were verified across the runtime boundary.',
    resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
    resolution_note = 'The affected Hostinger execution gate now uses shared SQL authority in platform_runtime_config, with transactional writes, same-cycle readback, TTL-bound gates, and fail-closed hard-disable state. Process-local environment mutation is no longer required for this flow.',
    secrets_included = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE alert_id = '150a504b-6b16-11f1-8ecd-456940024c79'
  AND alert_key = 'known.process_local_feature_flag_scope'
  AND lifecycle_status IN ('open', 'acknowledged', 'investigating');
