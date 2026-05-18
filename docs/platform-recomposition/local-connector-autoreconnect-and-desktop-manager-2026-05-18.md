# Local Connector Auto-Reconnect, Safe Upgrade, and Desktop Manager

Date: 2026-05-18  
Status: active design + partial implementation  
Scope: `essam-pc` canonical local connector, `local.mad4b.com` public gateway, `connector.mad4b.com` admin/break-glass path

## Purpose

The local connector must not depend on a single `server.mjs` process or a manually opened desktop app. A bad connector upgrade, a failed Node process, a stopped `cloudflared` service, or a Windows restart must not leave the platform without a recovery path.

The durable operating model is:

```text
Watchdog + Safe Upgrade = survival and automatic recovery layer
Desktop Manager = user-facing control and repair interface
```

The desktop app is useful and should be built, but it must sit above the watchdog/safe-upgrade layer, not replace it.

## Current canonical device identity

The physical Windows device was previously represented by two names:

- `mohammedlap` — manually seeded historical device id.
- `essam-pc` — reinstall/fetch-with-shell device id.

These were merged into one canonical device identity:

```text
canonical device_id: essam-pc
historical alias: mohammedlap -> essam-pc
canonical config_id: 8db63b00-4fce-11f1-b256-614c56cd019b
```

The alias registry table is:

```text
local_connector_device_aliases
```

Runtime routes now resolve aliases before device lookup in:

- `http-generic-api/routes/localGatewayToolsRoutes.js`
- `http-generic-api/routes/connectorProxyRoutes.js`

The canonical `essam-pc` row owns the recovery tunnel metadata, including `cf_token`, `cf_tunnel_id`, `cf_tunnel_name`, `connector_secret`, and `tunnel_url`.

## Public, schema, runtime, and admin surfaces

### Auth runtime

```text
https://auth.mad4b.com
```

This is the primary backend runtime. Tenants can use Auth directly when the schema points there.

### Local GPT schema alias

```text
https://local.mad4b.com
```

`local.mad4b.com` is not a physical device runtime. It is a separate hostname over the same Auth runtime so a dedicated GPT Action schema can target local gateway tools without duplicating or confusing the main Auth schema.

Flow:

```text
local.mad4b.com
-> Cloudflare
-> Hostinger vhost
-> PHP proxy
-> auth.mad4b.com runtime
-> /local/tools + DB policy routing
-> device_runtime_url
-> local connector/device tools
```

### Device runtime URL

The server-to-device URL is separated in DB:

```text
local_connector_user_configs.device_runtime_url
```

This is the URL Auth uses internally to reach the local connector. It should not be confused with `local.mad4b.com`.

### Admin / break-glass connector

```text
https://connector.mad4b.com
```

This remains an admin/break-glass surface and should not be treated as the tenant-facing public gateway. If used as `device_runtime_url`, that should be treated as a temporary compatibility state until a dedicated device runtime hostname is provisioned.

Validated behavior:

- `GET https://local.mad4b.com/health` returns healthy.
- Unauthenticated `GET /local/tools` returns `401`.
- Admin authenticated `GET /local/tools` returns all gateway tools.
- Tenant JWT `GET /local/tools` returns tenant-safe tools only and hides `local.admin.*`.
- Tenant `local.connector.health` succeeds through device-scoped credentials.

### Admin / break-glass connector

```text
https://connector.mad4b.com
```

This remains an admin/break-glass surface. It is not the tenant/member default gateway.

## Implemented DB metadata

Migration:

```text
094_sprint62e_local_connector_auto_reconnect.sql
```

Adds metadata to `local_connector_user_configs`:

- `auto_reconnect_enabled`
- `watchdog_installed`
- `watchdog_version`
- `agent_version`
- `desired_agent_version`
- `active_slot`
- `last_health_at`
- `last_reconnect_at`
- `last_repair_at`
- `last_repair_status`
- `last_error_code`
- `last_error_message`
- `recovery_notes`

Adds recovery event table:

```text
local_connector_recovery_events
```

Event types include:

- `health_ok`
- `health_failed`
- `service_restart`
- `cloudflared_restart`
- `safe_upgrade`
- `rollback`
- `repair_bundle`
- `manual_recovery`
- `watchdog_install`

## Implemented connector agent files

The connector agent release files are served by Auth via:

```text
GET /connector-agent/manifest.json
GET /connector-agent/files/:fileName
```

Current release files:

- `local-connector/server.mjs`
- `local-connector/connector-watchdog.ps1`
- `local-connector/connector-safe-upgrade.ps1`

The manifest returns:

- release version
- file URLs
- SHA256 hashes
- file sizes
- upgrade policy

Smoke test alias:

```text
connector_agent_smoke
```

Expected checks:

- manifest returns `ok: true`
- agent id is `mad4b-local-connector`
- `server.mjs` has a SHA256 hash
- watchdog and safe-upgrade files have SHA256 hashes
- downloaded `server.mjs` hash header matches manifest hash

## Safe upgrade policy

Script:

```text
local-connector/connector-safe-upgrade.ps1
```

Rules:

1. Load `https://auth.mad4b.com/connector-agent/manifest.json`.
2. Download `server.mjs` to `server.mjs.next`.
3. Verify SHA256 from manifest.
4. Run `node --check` on the candidate file.
5. Backup the active `server.mjs`.
6. Store the previous known-good file as `server.mjs.stable`.
7. Replace active `server.mjs`.
8. Restart the `local-connector` Windows service.
9. Check local health at `http://127.0.0.1:7070/health`.
10. If health fails, restore `server.mjs.stable` and restart.
11. If rollback also fails, mark manual recovery required.

Safe-upgrade must be the only mechanism allowed to replace the active connector runtime.

## Watchdog policy

Script:

```text
local-connector/connector-watchdog.ps1
```

Scheduled task:

```text
Mad4B-LocalConnector-Watchdog
```

Expected schedule:

- Runs as `SYSTEM`.
- Runs every minute.
- Uses highest run level.

Responsibilities:

1. Check `cloudflared` service.
2. Check `local-connector` service.
3. Check `http://127.0.0.1:7070/health`.
4. Restart stopped services.
5. If health remains down after restart, restore stable connector file.
6. Write diagnostics to local watchdog log.
7. Leave the system in `manual_required` only if service restart and rollback both fail.

Validated on `essam-pc` after reinstall:

```text
cloudflared = Running
local-connector = Running
local health = 200
Mad4B-LocalConnector-Watchdog = Ready
LastTaskResult = 0
```

## Installer delivery

Short-lived installer links are created by the admin tool:

```text
local_connector_installer_download_link
```

The generated download URL now uses the connector-agent surface:

```text
/connector-agent/installer.ps1?token=...
```

The older path below should be considered deprecated because it can be intercepted by protected `/local-connector/*` middleware:

```text
/local-connector/install/download?token=...
```

The installer URL is public only in the sense that it does not require a backend API key. It is still protected by a short-lived HMAC token. The token must not be stored in docs, logs, tickets, or chat transcripts.

The downloaded file should be saved on the Windows device under:

```powershell
C:\mad4b-connector\local-connector\install-local-connector-essam-pc.ps1
```

Run as Administrator:

```powershell
cd C:\mad4b-connector\local-connector
Set-ExecutionPolicy -Scope Process Bypass -Force
.\install-local-connector-essam-pc.ps1
```

The script uses its own folder as `$Root`.

## Current operational verification commands

On the Windows device:

```powershell
Get-Service cloudflared, local-connector
Invoke-WebRequest http://127.0.0.1:7070/health -UseBasicParsing
Get-ScheduledTask -TaskName Mad4B-LocalConnector-Watchdog
Get-ScheduledTaskInfo -TaskName Mad4B-LocalConnector-Watchdog
```

Expected state:

```text
cloudflared: Running
local-connector: Running
local health: 200
watchdog task: Ready
LastTaskResult: 0
```

From platform tools:

```text
connectorHealth
health_check
local_gateway_public_smoke
connector_agent_smoke
```

## Sensitive local tool gating

The public gateway enforces policies from `local_gateway_tools` before dispatch:

- `consent_required`
- `risk_label`
- `consent_text`
- `required_entitlement_key`
- `default_service_mode`
- `approval_hold_type`
- `approval_required_role`
- `approval_ttl_minutes`

Validated blocks:

- `local.connector.files` without consent -> `403 consent_required`
- `local.connector.files` with consent but no entitlement -> `403 entitlement_required`

Approval-hold flow has been implemented and partially tested. Final end-to-end dispatch for sensitive file operations depends on the connector path accepting the same auth token and tunnel URL that Auth resolves from DB.

## Known current follow-up

After reinstall, the local Windows services and watchdog are healthy. If Auth-to-device calls fail while direct `/health` works, check these in order:

1. DB `local_connector_user_configs.tunnel_url` points to the active tunnel or break-glass host.
2. DB `connector_secret` matches the `BACKEND_API_KEY` written in `C:\mad4b-connector\local-connector\.env`.
3. Auth proxy fallback tokens include both per-device `connector_secret` and platform `BACKEND_API_KEY`.
4. The connector endpoint being called exists in the installed `server.mjs` version.
5. `cloudflared` tunnel status is healthy in Cloudflare.

Avoid manual replacement of `server.mjs`. Use `connector-safe-upgrade.ps1` or the installer.

## Desktop Manager plan

A lightweight Windows desktop/tray app should still be built, but it must act as a UI/controller over the recovery layer.

Recommended responsibilities:

- Show connector status.
- Show Cloudflared status.
- Show Auth gateway status.
- Display device id and canonical alias mapping.
- Button: reconnect.
- Button: repair.
- Button: check for updates.
- Button: install/reinstall watchdog.
- Button: view logs.
- Button: run safe upgrade.

The Desktop Manager must not replace `server.mjs` directly. It should call:

```powershell
connector-safe-upgrade.ps1
```

for upgrades, and should call watchdog/service operations for repair.

## Do not repeat these failure modes

1. Do not create duplicate physical device rows under new names. Use `local_connector_device_aliases`.
2. Do not place public installer downloads under `/local-connector/*`, because middleware may require `BACKEND_API_KEY` before token validation.
3. Do not import installer helpers from `localConnectorInstallRoutes.js` into `connectorAgentRoutes.js` if it creates circular route imports. Keep installer serving standalone or move shared helpers into a neutral utility module.
4. Do not replace `server.mjs` directly on a live device. Use safe-upgrade and rollback.
5. Do not expose installer tokens or generated scripts in chat/logs/docs.

## Auth-to-device alignment result - 2026-05-18

After reinstall, Windows services and watchdog were healthy, but Auth-to-device dispatch returned `502` while public `/health` worked. The root cause was not a secret mismatch. The DB `connector_secret` matched the local `.env` `BACKEND_API_KEY`:

```text
len = 48
sha256 = e156ef3bbe6b6c25b5a8c37b0e08e87af1a354dd33ecd7b5f2dfd83715bc84db
```

The mismatch was the URL used by Auth. The canonical DB row was using the raw Cloudflare tunnel target:

```text
https://f85825dd-5a0d-4e37-ad57-2d229b7eb0d6.cfargotunnel.com
```

Cloudflare ingress routing requires the configured hostname. DNS showed `connector.mad4b.com` points to the same healthy tunnel:

```text
connector.mad4b.com CNAME f85825dd-5a0d-4e37-ad57-2d229b7eb0d6.cfargotunnel.com
```

The canonical config was therefore updated to:

```text
local_connector_user_configs.tunnel_url = https://connector.mad4b.com
```

`cf_tunnel_id`, `cf_tunnel_name`, and `cf_token` remain unchanged.

Validated after alignment:

```text
local.connector.health -> HTTP 200
call_id = 9cff7a41-bb59-4545-9532-dd73d934748f
```

Sensitive approval flow validated end-to-end:

```text
local.connector.files without direct dispatch -> approval_required 202
approval_hold_id = ab799fb6-b4e8-48ab-8bd6-36ab57e39a9c
first_call_id = 4bcf8698-6892-4f98-9d43-d19e130eb50a

approved local.connector.files list_drives -> HTTP 200
second_call_id = 085638c4-31e6-42ea-af66-a0afebe08e8d
```

## Dedicated device runtime hostname promotion - 2026-05-18

`connector.mad4b.com` was intentionally kept as admin/break-glass only. A dedicated runtime hostname was provisioned for the canonical Essam device:

```text
lc-8db63b00.mad4b.com
```

DNS:

```text
lc-8db63b00.mad4b.com CNAME f85825dd-5a0d-4e37-ad57-2d229b7eb0d6.cfargotunnel.com
proxied = true
```

Cloudflare Tunnel ingress was updated from version 4 to version 5 with this additional rule before the `http_status:404` catch-all:

```text
hostname = lc-8db63b00.mad4b.com
service  = http://localhost:7070
```

The canonical DB row now uses:

```text
public_gateway_url = https://local.mad4b.com
device_runtime_url = https://lc-8db63b00.mad4b.com
admin_recovery_url = https://connector.mad4b.com
```

Validated after promotion:

```text
local.connector.health -> HTTP 200
call_id = 6e94070a-287b-4100-9717-ece6277e9719
```

Sensitive approval flow revalidated end-to-end on the dedicated runtime hostname:

```text
approval_hold_id = f4feb96b-19ed-4065-a7e0-30e866c65fb8
first_call_id = 692d48fa-32c9-4a3e-93cc-e949e9eda0f8
second_call_id = 3c217925-d668-4b5f-81de-f630e53e6cf7
approved_dispatch_status = 200
approved_dispatch_tool = connector_files
```

## Tenant new-device registration flow

When a tenant/member registers a new Windows device, the platform must not ask an operator to manually create `lc-*` hostnames. Provisioning is automatic through the shared function:

```text
provisionLocalConnectorInstall(req, body)
```

Used by:

```text
connectRoutes.js
 dispatchRoutes.js
```

The canonical flow is:

1. Resolve the signed-in user and tenant.
2. Create or reuse `local_connector_user_configs.config_id`.
3. Generate deterministic device runtime hostname:

```text
lc-<first-config-id-segment>.mad4b.com
```

Example:

```text
config_id = 8db63b00-4fce-11f1-b256-614c56cd019b
runtime   = lc-8db63b00.mad4b.com
```

4. Provision or reuse a Cloudflare Tunnel.
5. Create/update Cloudflare DNS:

```text
lc-<config>.mad4b.com CNAME <tunnel-id>.cfargotunnel.com
proxied = true
```

6. Add Cloudflare Tunnel ingress before the catch-all rule:

```text
hostname = lc-<config>.mad4b.com
service  = http://localhost:7070
```

7. Store separated URLs on the device config:

```text
public_gateway_url = https://local.mad4b.com
device_runtime_url = https://lc-<config>.mad4b.com
admin_recovery_url = https://connector.mad4b.com
```

8. Seed `local_connector_app_routes` for the runtime hostname.
9. Generate installer/repair bundle. The installer displays `device_runtime_url`, not raw `*.cfargotunnel.com`.
10. Later local tool calls route as:

```text
local.mad4b.com or auth.mad4b.com
-> Auth runtime
-> DB policy/approval/entitlement checks
-> device_runtime_url
-> local connector
```

`connector.mad4b.com` remains admin/break-glass only.

Implementation status as of this doc update:

- Shared provisioning function reads/stores separated URL fields.
- Shared provisioning creates deterministic `lc-*` hostname values.
- Shared provisioning has helpers to create Cloudflare DNS CNAME and publish tunnel ingress routes.
- Signed installer generation reads `COALESCE(device_runtime_url, tunnel_url)`.
- The legacy direct `POST /local-connector/install` route still contains older duplicate provisioning logic and should be refactored to call `provisionLocalConnectorInstall()` directly to avoid drift.

## Autopilot customer-selectable route modes

The platform should support all connection options, but the customer should not need programming or networking expertise. The desktop app/bootstrapper should present simple choices and then configure the technical route automatically.

Customer-facing choices:

```text
Recommended automatic mode
Fast private connection
Direct IP connection
Local network connection
Cloudflare tunnel only
```

Internal route types are stored in:

```text
local_connector_device_routes
```

Supported route types:

```text
vpn_private_ip      preferred private route when platform VPN/overlay is available
direct_public_ip    public/static IP or router-port-forward route
dynamic_public_ip   public IP discovered by heartbeat, with changing endpoint support
lan_private_ip      same-network/local-office route
cloudflare_tunnel   default zero-config route through lc-<config>.mad4b.com
admin_recovery      admin-only break-glass route through connector.mad4b.com
```

Each route carries:

```text
endpoint_url
priority
health_status
requires_router_config
requires_vpn_agent
requires_admin_setup
tls_mode
auth_mode
route_metadata
```

Default priorities:

```text
10  vpn_private_ip
20  lan_private_ip
30  direct_public_ip
40  dynamic_public_ip
50  cloudflare_tunnel
90  admin_recovery
```

The route selector should choose the lowest-priority enabled healthy/unknown route, attempt dispatch, mark failures, and fall back automatically to the next route.

Initial DB support was added in migration:

```text
098_sprint62i_local_connector_device_routes.sql
```

For existing devices, the migration seeds:

```text
cloudflare_tunnel -> COALESCE(device_runtime_url, tunnel_url)
admin_recovery    -> COALESCE(admin_recovery_url, https://connector.mad4b.com)
```

Autopilot behavior expected from the desktop app/bootstrapper:

1. Detect available network capabilities.
2. Register device with Auth.
3. Provision Cloudflare tunnel by default.
4. Offer optional VPN/private route setup.
5. Offer direct IP only when public IP/port forwarding is detected or configured.
6. Add route rows to `local_connector_device_routes`.
7. Run health checks for each route.
8. Set preferred route priority based on customer selection.
9. Keep Cloudflare tunnel as fallback unless customer explicitly disables it.
10. Never use `connector.mad4b.com` for tenant/customer runtime.

## Next implementation steps

1. Refactor legacy direct `POST /local-connector/install` to call `provisionLocalConnectorInstall()` instead of duplicating provisioning logic.
2. Implement route selector in `connectorProxyRoutes.js` using `local_connector_device_routes` with fallback.
3. Add route registration/update endpoints for Desktop Manager.
4. Add a small regression smoke test for token-gated installer route that checks status/headers without printing installer content.
5. Update `local_connector_user_configs.watchdog_installed`, `watchdog_version`, and `agent_version` after successful install or heartbeat.
6. Log watchdog/repair events from local agent back to Auth when online.
7. Build the Desktop Manager as a tray app/bootstrapper on top of watchdog and safe-upgrade.
