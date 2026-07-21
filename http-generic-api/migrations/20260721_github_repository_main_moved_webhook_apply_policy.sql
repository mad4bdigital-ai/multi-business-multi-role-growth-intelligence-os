-- Register the exact dynamic apply-authorization policy for the governed
-- GitHub repository-main-moved webhook provisioner.
-- Scope is limited to one app/capability/intent/runtime tuple. The runtime still
-- requires a reviewed dry-run, typed confirmation, expected commit SHA, a ready
-- apply-authorized envelope, same-cycle hook readback, successful signed ping,
-- audit evidence, and secret-reference validation. No secret is returned.

INSERT INTO `capability_apply_authorization_policy_registry` (
  `policy_key`,
  `app_key`,
  `capability_key`,
  `operation_intent`,
  `runtime_surface`,
  `status`,
  `allow_external_write`,
  `allow_credential_binding`,
  `allow_no_credential_binding`,
  `requires_ready_for_dispatch`,
  `requires_dispatch_allowed`,
  `requires_zero_blocking_gaps`,
  `requires_audit_evidence`,
  `requires_readback`,
  `requires_typed_confirmation`,
  `requires_same_cycle_dry_run`,
  `allowed_source_tiers_json`,
  `policy_json`,
  `notes`
)
VALUES (
  'github_repository_main_moved_webhook_provision_apply_v1',
  'github',
  'github_repository_main_moved_webhook_provision',
  'github_repository_main_moved_webhook_provision',
  'system_layer',
  'active',
  1,
  0,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  JSON_ARRAY('platform_managed_fallback'),
  JSON_OBJECT(
    'external_write_allowed', TRUE,
    'provider_call_allowed', TRUE,
    'provider_call_surface', 'github_app.repository_hooks.create_or_update_and_ping',
    'readback_surface', 'github_app.repository_hooks.get_and_deliveries',
    'server_side_secret_resolution_allowed', TRUE,
    'credential_payload_return_allowed', FALSE,
    'inline_secret_input_allowed', FALSE,
    'callback_url_fixed', 'https://auth.mad4b.com/webhooks/github/repository-main-moved',
    'events_fixed', JSON_ARRAY('push'),
    'signed_ping_status_required', 200,
    'expected_commit_sha_required', TRUE,
    'same_cycle_readback_required', TRUE,
    'audit_required', TRUE,
    'secrets_included', FALSE
  ),
  'Exact external-write apply policy for idempotent GitHub repository-main-moved webhook create/update, signed ping verification, hook readback, and secret-reference validation.'
)
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
