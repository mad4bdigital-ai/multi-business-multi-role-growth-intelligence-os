# Mad4B Local Manager Bootstrapper Plan

## Purpose

Mad4B Local Manager is the desktop-facing bootstrapper and maintenance surface for the local connector. It should install, verify, recover, and upgrade the connector without exposing long-lived secrets to the user interface or GPT output.

## Scope

The bootstrapper covers:

- Local connector install and update orchestration.
- Cloudflared service presence and tunnel health checks.
- Node connector service presence and health checks.
- Watchdog scheduled task install and health reporting.
- Safe A/B connector-agent upgrade and rollback.
- Device route registration prompts for VPN, LAN, direct public IP, dynamic public IP, Cloudflare tunnel, and admin recovery.
- Optional n8n/browser local app readiness checks.

Out of scope for this phase:

- Arbitrary shell execution.
- Raw secret display.
- Direct database mutation from the desktop app.
- Unapproved Cloudflare/DNS changes outside governed backend APIs.

## Bootstrap flow

1. User or Local Manager requests a short-lived installer from the platform.
2. For app-owned flows, Local Manager sends `app_managed=true` and `suppress_pause=true`, downloads the signed BAT, and launches it through Windows UAC.
3. The BAT downloads `/connector-agent/installer.ps1` and exits with `exit /b 0` or `exit /b 1` in app-managed mode; manual downloads may still pause for visibility.
4. The PowerShell installer verifies the connector-agent manifest.
5. Installer downloads `server.mjs`, `connector-watchdog.ps1`, and `connector-safe-upgrade.ps1`.
6. Installer verifies SHA-256 for every downloaded agent file.
7. Installer writes `.env` locally using short-lived install payload data, including opt-in capability flags and dynamic app/path/helper grants.
8. Installer installs or verifies Node.js, cloudflared, and NSSM.
9. Installer installs the connector Node service.
10. Installer installs the watchdog scheduled task.
11. Connector reports heartbeat to `/connector-agent/heartbeat`.
12. Desktop Manager refreshes controls and operators verify live connector behavior.

## Runtime surfaces

### Platform surfaces

- `POST /local-connector/install/download-link`
- `GET /local-connector/install/download`
- `GET /connector-agent/manifest.json`
- `GET /connector-agent/files/:fileName`
- `POST /connector-agent/heartbeat`
- `GET /local-connector/install/status`
- `GET /local-connector/device-routes`
- `POST /local-connector/device-routes`
- `PATCH /local-connector/device-routes/:route_id`

### Local connector surfaces

- `GET /health`
- `POST /shell` for allowlisted commands only
- `POST /files` for allowlisted paths only
- `POST /apps` for allowlisted apps only
- `POST /browser` for allowlisted browsers only
- `POST /n8n` for scoped n8n controls only

## Desktop Manager screens

### 1. Status

Shows:

- Connector service status.
- Cloudflared status.
- Public runtime URL.
- Admin recovery URL.
- Last heartbeat timestamp.
- Last repair status.
- Agent version and watchdog version.

### 2. Routes

Shows registered route candidates ordered by priority:

1. VPN private IP
2. LAN private IP
3. Direct public IP
4. Dynamic public IP
5. Cloudflare tunnel
6. Admin recovery

The UI must mark `admin_recovery` as admin-only and must not allow tenant users to make `connector.mad4b.com` a normal runtime route.

### 3. Repairs

Permitted repairs:

- Restart connector service.
- Restart cloudflared service.
- Reinstall watchdog scheduled task.
- Run safe upgrade.
- Roll back to previous stable agent.

All repair attempts must write heartbeat/recovery events through the platform.

### 4. Logs

Shows bounded, redacted diagnostics only:

- Last connector health error code.
- Last route error code.
- Last watchdog event.
- Service status summaries.

Never show connector secret, Cloudflare token, API keys, cookies, or signed installer URLs.

## Security rules

- All backend calls use authenticated platform routes.
- No long-lived secret is printed in GPT or desktop UI output.
- Installer download tokens are short-lived and HMAC signed.
- Connector heartbeat accepts only bearer connector secret or backend service auth.
- Metadata payloads strip secret-like keys before database writeback.
- Route registration validates URL protocol, host restrictions, and route type.
- Admin recovery routes are admin-only.

## Telemetry and evidence

Every install, upgrade, rollback, and repair should produce:

- `local_connector_user_configs.last_health_at`
- `local_connector_user_configs.last_reconnect_at` when applicable
- `local_connector_user_configs.last_repair_at` when applicable
- `local_connector_user_configs.last_repair_status`
- `local_connector_recovery_events` row

## Acceptance checklist

- Manifest smoke verifies all required file hashes.
- Unsigned installer request is rejected.
- Unauthenticated heartbeat is rejected.
- Authenticated heartbeat writes config metadata and recovery event.
- Route registration rejects invalid route type.
- Route registration rejects `connector.mad4b.com` as a tenant runtime route.
- Route selector falls back across enabled healthy/unknown routes.
- Installer status does not include raw secrets.
- Desktop Manager displays only redacted diagnostics.

## Deployment order

1. Deploy connector-agent manifest and heartbeat route.
2. Deploy route registration API.
3. Deploy route selector fallback.
4. Deploy installer smoke tests.
5. Run non-secret dev smoke.
6. Enable Desktop Manager beta screen against dev.
7. Promote to main only after dev evidence is recorded.
