# Specification: Local Connector Runtime/Tunnel/Host Reachability Recovery

## Problem statement

A Local Connector configuration can exist and be bound to a user and tenant while neither the tenant-facing route nor the admin break-glass route is reachable. The current diagnostic surface can report `connector_auth_configured: true` and still show `registered_route_count: 0`, `health_status: unknown`, and `502` from host probes. This creates ambiguous recovery decisions and blocks safe auto-install, repair, and multi-device routing.

## Goals

- Separate tenant auth-host route health from admin break-glass route health.
- Make target device selection deterministic and profile-aware.
- Record route registration, heartbeat, tunnel status, host status, and local service status independently.
- Support disaster recovery for format, Windows reinstall, device replacement, and token loss.
- Enable auto-install and repair flows without relying on a stale saved device token.
- Preserve least privilege: tenant paths cannot silently become admin break-glass paths.
- Provide actionable diagnostics and structured recovery recommendations.

## Non-goals

- This spec does not implement a new connector runtime.
- This spec does not replace Cloudflare or require a new tunnel provider.
- This spec does not grant tenant users admin break-glass access.
- This spec does not execute installer scripts or rotate credentials in the specification PR.
- This spec does not define UI layout beyond required data contracts.

## Primary actors

- **Tenant user:** selects and repairs their own device through auth-host.
- **Local Manager desktop app:** presents identity, route health, reauth, and installer flows.
- **Local Connector service:** runs on a Windows device and exposes local device capabilities.
- **Auth-host backend:** owns tenant-scoped route selection, auto-install, and user authorization.
- **Admin operator:** uses break-glass diagnostics and host recovery when tenant path fails.
- **Cloudflare/edge provider:** transports tunnel traffic and reports tunnel availability.

## User stories

### US1: Explicit target device selection

As a tenant user with multiple devices, I can choose the exact device to inspect or repair, and auth-host resolves by `tenant_id + user_id + canonical_device_id` instead of hostname alias or last-seen device.

Acceptance criteria:
- A request without a device selector is rejected when more than one active device exists.
- Alias values are shown as metadata but not used as the authority key.
- A selected target returns route lifecycle, route health, and recovery recommendations.

### US2: Disaster recovery after format or Windows reinstall

As a user who formatted a device or reinstalled Windows, I can relink the device or create a replacement device identity without accidentally reusing a stale route.

Acceptance criteria:
- The system can mark old device routes as `stale` or `reprovision_required`.
- The recovery plan distinguishes relink, reinstall, replacement, and revoke.
- A new token is issued only after fresh authorization.

### US3: Separate tenant route from break-glass route

As an admin, I can tell whether the tenant auth-host path, break-glass path, tunnel endpoint, host, or local service is failing.

Acceptance criteria:
- Diagnostics show separate statuses for `tenant_auth_host`, `admin_break_glass`, `cloudflare_tunnel`, `host_runtime`, and `local_service`.
- A failure in one path does not overwrite the status of the other.
- Break-glass is recommended only for diagnostics and repair, not tenant actions.

### US4: Auto-install with fresh authorization

As a user, I can request auto-install or repair from Local Manager, and privileged installer generation requires fresh authorization and the selected target device.

Acceptance criteria:
- Installer creation refuses stale device-token-only authorization.
- The response returns structured `fresh_authorization_required` or `installer_created` states.
- The installer target contains the canonical device identity and route channel.

### US5: Runtime registration and heartbeat

As the platform, I can observe whether a connector runtime is actively registered and healthy.

Acceptance criteria:
- Runtime startup registers route claims with auth-host.
- Heartbeats update last seen, process state, local port state, tunnel state, and version.
- Missing heartbeat creates a `stale` state before `unreachable`.

## Functional requirements

- FR-001: Store canonical device identity separately from hostname aliases.
- FR-002: Store route records by `device_id`, `route_channel`, and `endpoint_url`.
- FR-003: Track `registered`, `healthy`, `degraded`, `stale`, `unreachable`, `revoked`, and `reprovision_required` states.
- FR-004: Track health evidence by probe target: auth-host proxy, break-glass host, tunnel endpoint, device runtime, and local service.
- FR-005: Provide profile-aware target selection using route lifecycle profiles from DB.
- FR-006: Require explicit selector when a user has more than one eligible device.
- FR-007: Auto-install must bind installer claims to tenant, user, canonical device, route channel, and freshness evidence.
- FR-008: Recovery plans must provide stable reason codes and next actions.
- FR-009: Diagnostics must never include plaintext tokens, connector secrets, or installer secrets.
- FR-010: Break-glass actions must be admin-only and audited.
- FR-011: Recovered status requires same-cycle readback from the previously failing route or a replacement route.
- FR-012: Route profile overrides may narrow privileges but must not silently weaken security barriers.

## Success criteria

- `registered_route_count` reflects live registered route records, not only config candidates.
- When both paths fail, diagnostics identify whether host, tunnel, local service, registration, or auth barrier failed.
- A user with multiple devices receives deterministic target options and cannot accidentally operate the wrong device.
- A formatted/reinstalled device can be relinked without reusing stale tokens.
- CI and contract tests cover state transitions, authorization barriers, and failure classification.
