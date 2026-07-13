-- Sprint 69: Governed dynamic container projection apply policy
-- Purpose:
--   Allow the admin-only dynamic_container_projection_apply virtual tool to receive
--   explicit apply authorization through the capability envelope policy registry.
-- Safety:
--   - Internal MySQL projection mutation only; provider calls and external writes are forbidden.
--   - Requires ready dispatch, zero blocking gaps, audit evidence, typed confirmation,
--     same-cycle dry-run, pinned source snapshot/counts, same-cycle ID readback, and envelope consumption.
--   - Does not activate the raw inventory-only projection endpoint.

INSERT INTO `capability_apply_authorization_policy_registry`
  (`policy_key`, `app_key`, `capability_key`, `operation_intent`, `runtime_surface`, `status`,
   `allow_external_write`, `allow_credential_binding`, `allow_no_credential_binding`,
   `requires_ready_for_dispatch`, `requires_dispatch_allowed`, `requires_zero_blocking_gaps`,
   `requires_audit_evidence`, `requires_readback`, `requires_typed_confirmation`,
   `requires_same_cycle_dry_run`, `allowed_source_tiers_json`, `policy_json`, `notes`)
VALUES
  ('dynamic_container_projection_apply_policy_v1', 'platform_orchestration',
   'dynamic_container_projection_apply', 'dynamic_container_projection_apply', 'auth_host', 'active',
   0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
   JSON_ARRAY('platform_managed_fallback'),
   JSON_OBJECT(
     'internal_sql_mutation_only', TRUE,
     'provider_call_forbidden', TRUE,
     'external_write_forbidden', TRUE,
     'credential_payload_read_forbidden', TRUE,
     'expected_source_snapshot_required', TRUE,
     'expected_projection_counts_required', TRUE,
     'same_cycle_dry_run_required', TRUE,
     'same_cycle_projection_readback_required', TRUE,
     'envelope_consumption_required', TRUE,
     'raw_inventory_endpoint_activation_forbidden', TRUE,
     'secrets_included', FALSE
   ),
   'Admin-only fixed policy for the governed dynamic container projection apply virtual tool. The raw projection endpoint remains inventory-only.')
ON DUPLICATE KEY UPDATE
  `app_key` = VALUES(`app_key`),
  `capability_key` = VALUES(`capability_key`),
  `operation_intent` = VALUES(`operation_intent`),
  `runtime_surface` = VALUES(`runtime_surface`),
  `status` = VALUES(`status`),
  `allow_external_write` = VALUES(`allow_external_write`),
  `allow_credential_binding` = VALUES(`allow_credential_binding`),
  `allow_no_credential_binding` = VALUES(`allow_no_credential_binding`),
  `requires_ready_for_dispatch` = VALUES(`requires_ready_for_dispatch`),
  `requires_dispatch_allowed` = VALUES(`requires_dispatch_allowed`),
  `requires_zero_blocking_gaps` = VALUES(`requires_zero_blocking_gaps`),
  `requires_audit_evidence` = VALUES(`requires_audit_evidence`),
  `requires_readback` = VALUES(`requires_readback`),
  `requires_typed_confirmation` = VALUES(`requires_typed_confirmation`),
  `requires_same_cycle_dry_run` = VALUES(`requires_same_cycle_dry_run`),
  `allowed_source_tiers_json` = VALUES(`allowed_source_tiers_json`),
  `policy_json` = VALUES(`policy_json`),
  `notes` = VALUES(`notes`),
  `updated_at` = CURRENT_TIMESTAMP;
