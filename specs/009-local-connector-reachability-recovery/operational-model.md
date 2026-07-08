# Operational Model

## Operational objectives

- Detect whether failure is in auth-host, break-glass host, tunnel, runtime, local service, or authorization.
- Recommend a safe recovery action without exposing secrets.
- Keep tenant recovery separate from admin emergency recovery.
- Make recovery observable and auditable.

## Health dimensions

| Dimension | Example status | Source |
|---|---|---|
| Config | configured / missing | DB bootstrap/config |
| Registration | registered / not_registered | runtime startup registration |
| Auth-host route | healthy / timeout / 502 | auth-host proxy probe |
| Break-glass route | healthy / timeout / 502 | admin host probe |
| Tunnel | connected / disconnected / unknown | Cloudflare/tunnel probe |
| Local service | running / stopped / unknown | heartbeat or local adapter |
| Authorization | fresh / stale / missing | auth/session/device-token evidence |

## Alerting

Create operational alerts for:

- `connector_route_unregistered`: config exists but no registered route.
- `tenant_auth_host_unreachable`: auth-host path probe fails.
- `break_glass_unreachable`: break-glass path fails.
- `tunnel_unreachable`: tunnel endpoint fails independently.
- `heartbeat_stale`: heartbeat TTL exceeded.
- `target_ambiguous`: multiple devices require explicit selection.
- `recovery_verification_failed`: a recovery action completed but readback did not prove success.

## Runbook: both paths return 502

1. Read `connector_diagnostics` without active device calls.
2. Confirm canonical device, aliases, and selected config.
3. Check registered routes for the canonical device.
4. Probe auth-host route and break-glass route independently.
5. Check tunnel provider state if available.
6. If both external hosts fail, classify `host_or_tunnel_dependency_unreachable`.
7. Do not mark recovered until one route has same-cycle success readback.

## Runbook: format or Windows reinstall

1. User selects device or declares reinstall/format.
2. Auth-host verifies ownership and fresh authorization.
3. Recovery planner returns `relink_device` or `reinstall_connector`.
4. Old route generation is marked stale, not deleted.
5. New runtime registers with incremented generation.
6. Old token/route is revoked after successful replacement readback.

## Runbook: multiple devices

1. List eligible devices by tenant/user.
2. Return canonical ID, labels, last seen, route status, and risk indicators.
3. Require explicit selection unless exactly one active device exists.
4. Use aliases only for display and lookup assistance.

## SLOs and freshness

- Heartbeat freshness target: under 120 seconds for active devices.
- Stale threshold: configurable by profile; default 5 minutes.
- Probe timeout: configurable by profile; default 10 seconds, maximum 120 seconds.
- Recovery verification: same-cycle readback required before status `recovered`.

## Rollback

- Disable active probes while keeping read-only diagnostics.
- Disable auto-install recovery while preserving target list and health readback.
- Mark route lifecycle profile as disabled to revert to safe defaults.
- Keep break-glass mutations disabled unless separately approved.
