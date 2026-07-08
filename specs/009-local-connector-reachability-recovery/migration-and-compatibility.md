# Migration and Compatibility Plan

## Migration policy

All persistence changes must be additive first. The existing `local_connector_user_configs` bootstrap/config table remains valid until a later closeout PR proves route registry parity and all runtime read paths have migrated.

No destructive changes are allowed in the initial implementation sequence.

## Proposed additive migrations

### M001: Canonical device identity

Create:

- `local_connector_devices`
- `local_connector_device_aliases`

Purpose:

- Separate canonical device identity from hostnames, config aliases, and historical labels.
- Support format, reinstall, and replacement without wrong-device actions.

Compatibility:

- Backfill from existing config rows where possible.
- Existing config `device_id` becomes an alias candidate until canonical identity is approved.

### M002: Route registry

Create:

- `local_connector_routes`

Purpose:

- Track channel-specific routes: `tenant_auth_host`, `admin_break_glass`, `cloudflare_tunnel`, and `local_service`.
- Track registration generation and route status independently from config status.

Compatibility:

- Existing `device_runtime_url`, `tunnel_url`, and `admin_recovery_url` become route candidates.
- `registered_route_count` must count registry rows, not only config-derived candidates.

### M003: Heartbeat and probe evidence

Create:

- `local_connector_heartbeats`
- `local_connector_probe_results`

Purpose:

- Store fresh runtime evidence and probe classification.
- Preserve same-cycle readback for recovery decisions.

Compatibility:

- Diagnostics may initially show `heartbeat_status: missing` for old clients.
- Missing heartbeat is not a breaking change; it means `unknown` or `stale`, never `healthy`.

### M004: Recovery plans

Create:

- `local_connector_recovery_plans`

Purpose:

- Record preview, approval, dispatch, verification, failure, and cancellation.
- Track recovery reason and route/device generation.

Compatibility:

- Recovery preview can be added before actual installer generation changes.
- Existing installer endpoint continues to work until gated rollout enables the new planner.

### M005: Profile keys

Extend existing `local_connector_route_lifecycle_profiles` JSON payloads with optional keys:

- `route_priority`
- `recovery_policy`
- `probe_timeouts`
- `heartbeat_ttl_seconds`
- `allow_auto_install`
- `require_explicit_device_selector`
- `break_glass_allowed_for_recovery_reasons`

Compatibility:

- Missing keys use safe defaults.
- Profile overlays may narrow permissions but cannot weaken global security floors.

## Backfill strategy

1. Read existing connector configs.
2. Create canonical device records in `candidate` or `active` status depending on evidence quality.
3. Create aliases for hostname, legacy config ID, user labels, and known device IDs.
4. Create route candidates from runtime/tunnel/admin URLs.
5. Keep route state `provisioned` until runtime registration or probe evidence exists.
6. Do not mark any route `healthy` during backfill.

## Rollout gates

- Gate 1: migrations applied and schema readback passes.
- Gate 2: read-only diagnostics returns additive fields without breaking old clients.
- Gate 3: heartbeat ingest runs in shadow mode.
- Gate 4: probe evidence runs read-only with no repair actions.
- Gate 5: recovery preview enabled.
- Gate 6: privileged installer generation enabled for canary devices only.
- Gate 7: old config-only health classification deprecated after parity readback.

## Compatibility rules

- Existing response fields remain present.
- New fields are optional and additive.
- Existing clients may ignore `route_lifecycle`, `target_selection`, `recovery_plan`, and `probe_summary`.
- New error codes use stable structured envelopes.
- Breaking behavior, such as requiring explicit target selection, must be gated by profile/version until UI support exists.

## Rollback strategy

- Disable new probes without dropping evidence tables.
- Disable heartbeat ingestion write path while keeping read-only config diagnostics.
- Disable recovery planner and auto-install gating separately.
- Revert profile flags to safe defaults.
- Keep additive tables in place for audit unless explicitly approved for cleanup.

## Open questions before migration PR

- What is the authoritative canonical device ID for already paired devices?
- Which existing rows are safe to backfill as active versus candidate?
- What retention period is acceptable for heartbeat and probe evidence?
- Which tenants/devices should be canary-enabled first?
- What UI version first supports explicit device selection and recovery reason display?
