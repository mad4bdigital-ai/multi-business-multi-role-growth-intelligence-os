# Data Model

All schema changes are additive. Existing `local_connector_user_configs` remains the bootstrap/config source until read/write paths are migrated.

## local_connector_devices

Canonical device identity table.

Fields:
- `device_id` stable canonical identifier.
- `tenant_id` owner tenant.
- `user_id` owner user.
- `display_name` user-visible label.
- `current_hostname` latest hostname claim.
- `windows_install_instance_id` optional install-generation identifier.
- `device_generation` monotonically increasing integer.
- `status` active, stale, replaced, revoked.
- `created_at`, `updated_at`, `last_seen_at`.

## local_connector_device_aliases

Aliases and historical names.

Fields:
- `alias_id`.
- `device_id`.
- `alias_type`: hostname, legacy_config_id, user_label, pairing_code, windows_machine_guid_hash.
- `alias_value_hash` for sensitive identifiers.
- `display_value` sanitized human-readable value where safe.
- `status`: active, historical, revoked.

## local_connector_routes

One row per route channel and endpoint.

Fields:
- `route_id`.
- `device_id`.
- `route_channel`: tenant_auth_host, admin_break_glass, cloudflare_tunnel, local_service.
- `endpoint_url_hash` and sanitized `endpoint_host`.
- `priority`.
- `status`: provisioned, paired, registered, healthy, degraded, stale, unreachable, reprovision_required, revoked.
- `registration_generation`.
- `last_registered_at`, `last_success_at`, `last_failure_at`, `last_health_at`.
- `last_error_code`, `last_error_message` sanitized.

## local_connector_heartbeats

Bounded heartbeat evidence.

Fields:
- `heartbeat_id`.
- `device_id`, `route_id`.
- `runtime_version`, `local_manager_version`, `connector_version`.
- `process_status`.
- `local_port_status`.
- `tunnel_status`.
- `capabilities_hash`.
- `received_at`.

Retention: keep full heartbeat detail for 30 days, then aggregate daily status summaries.

## local_connector_probe_results

Probe evidence for active checks.

Fields:
- `probe_id`.
- `device_id`, `route_id`.
- `probe_type`: auth_host_proxy, break_glass_host, cloudflare_tunnel, runtime_health, local_service.
- `status`: success, failure, timeout, blocked, skipped.
- `latency_ms`.
- `error_code`, `error_message` sanitized.
- `request_id`.
- `checked_at`.

## local_connector_recovery_plans

Planned or executed recovery actions.

Fields:
- `recovery_plan_id`.
- `tenant_id`, `user_id`, `device_id`.
- `reason_code`: device_formatted, windows_reinstalled, device_replaced, route_unreachable, tunnel_unreachable, host_unreachable, stale_token.
- `recommended_action`: retry_probe, relink_device, reinstall_connector, rotate_token, revoke_route, break_glass_diagnostics.
- `requires_fresh_authorization`.
- `requires_admin_approval`.
- `status`: preview, approved, dispatched, verified, failed, cancelled.
- `evidence_json` sanitized.

## local_connector_route_lifecycle_profiles

Existing DB-backed profile table from PR #2357 remains the policy source for global/tenant/user/device overlays.

New profile keys expected by this spec:
- `route_priority`.
- `recovery_policy`.
- `probe_timeouts`.
- `heartbeat_ttl_seconds`.
- `allow_auto_install`.
- `require_explicit_device_selector`.
- `break_glass_allowed_for_recovery_reasons`.

## Sensitive data rules

- Store token hashes only.
- Store endpoint host and route ID, not full signed URLs when avoidable.
- Never persist plaintext installer secrets.
- Hash machine identifiers that are not user-facing.
- Keep audit evidence sufficient for recovery without exposing connector credentials.
