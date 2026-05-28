# Sprint 64 Device Runtime Control Update — 2026-05-24

## Scope

This note records the device runtime, connector proxy, Local Manager, n8n, and model-runtime updates merged into `main` during the 18-hour window reviewed on 2026-05-24.

## Commits in the reviewed 18-hour window

```text
c1fc269  Support MCP servers JSON in credential intake
27caa69  Accept active connector hostname aliases in health proxy
e029618  Stabilize connector proxy diagnostics and route fallback
76f77c1  Prevent Local Manager downgrade update metadata
02e20d3  Fix Cloudflare tunnel ingress upsert for empty config
c3376ec  Prefer device runtime routes before admin recovery
383246d  Add governed n8n workflow runtime bindings
87b470c  Add task-specific model profiles for summaries classification and image edits
33cefa2  Fix local connector provisioning local apps variable
5675816  Support CONNECTOR_LOCAL_API_KEY alias for local connector auth
3cc4192  Add Gemini-first OpenRouter-fallback model runtime settings
```

## Current runtime decisions

- Essam / `essam-pc` remains the primary n8n runtime.
- `DESKTOP-91FDEFP` is Nagy's admin/control and local repo working-copy device.
- Friendly aliases for `DESKTOP-91FDEFP`: `nagyxs`, `nagy pc`, `nagy`.
- The Nagy repo path is `C:\Users\nagyx\source\repos\multi-business-multi-role-growth-intelligence-os`.
- The Nagy connector file allowlist is limited to the repo path above.
- Safe repo aliases on the Nagy connector: `repo_status`, `repo_branch`, `repo_log_latest`, `repo_compare_origin_main`, `repo_pull_ff_only`.

## Connector proxy policy

Use `GET /connector/{device_id}/diagnostics` before long-running device operations. Diagnostics must expose selected config, candidate routes, route health/error metadata, and the proxy timeout while excluding secrets.

Device route selection must prefer device-specific runtime URLs before admin recovery. Admin recovery routes must not mask a wrong-device response. Hostname differences are accepted only when they are backed by active `local_connector_device_aliases` rows.

`degraded` routes may be used as fallback candidates when no healthier route succeeds, but the route response must include error metadata so operators can distinguish stale health state from active failure.

## Message delivery timeout mitigation

Avoid using raw PowerShell for long scripts through auth-host. Long-running or restart-prone operations should be modeled as short connector shell aliases, Local Manager queued commands, or diagnostics-first workflows. This reduces Cloudflare/Passenger 502 responses and ChatGPT message-delivery timeouts.

When a setup action must restart `local-connector`, schedule the restart and return quickly instead of blocking the active proxy request.

## Route/config health metadata sync

Connector route health is the operational source of truth. To avoid stale database state:

- A successful registered route probe must update `local_connector_device_routes.health_status = 'healthy'` and also update `local_connector_user_configs.last_health_at` while clearing config-level errors.
- A route failure must update that route, but it must not mark the whole config failed when another enabled route for the same config is still healthy.
- Diagnostics must expose route freshness fields such as `last_health_at`, `health_age_seconds`, and `failure_after_success`, plus config freshness fields such as `config_last_health_at` and `config_health_age_seconds`.
- Fallback/admin-recovery route failures must not pollute the primary device status when a device-specific Cloudflare route is healthy.
- Connector agent heartbeat must also sync the primary Cloudflare route. A successful heartbeat marks the primary registered route healthy; a failed heartbeat degrades the primary registered route instead of leaving config and route metadata divergent.
- If a registered primary Cloudflare route is marked `down` but still matches the device runtime URL, the proxy must retry that registered route as a recoverable candidate before falling back to a synthetic runtime URL. This lets `markRouteSuccess()` heal the real database row instead of succeeding through an untracked synthetic route.
- Successful app-connection use must also heal validation metadata. When `executeAppAction()` returns `ok: true`, `user_app_connections.validation_status` becomes `validated` and `last_validated_at` is refreshed. Failed app actions should not automatically mark credentials failed because the failure may be payload/business logic rather than credential validity.
- n8n app credentials may be stored with environment-style keys (`N8N_API_KEY`, `N8N_BASE_URL`, `N8N_LOCAL_BASE_URL`, `N8N_WEBHOOK_BASE_URL`). The n8n adapter must normalize these aliases before testing or running app actions so pending validation can self-heal on successful use.

## Schema and guide alignment

The auth-host OpenAPI schema must document `/connector/{device_id}/diagnostics`. Agent instructions must direct agents to use diagnostics before long device calls and to prefer bounded aliases over raw PowerShell.

## 2026-05-28 Local Manager capability follow-up

The follow-up Local Manager release chain fixed the connector capability workflow end to end:

- `0.2.9` stopped the update loop by aligning Windows binary metadata with advertised release metadata.
- `0.2.10` added desktop command polling backoff and secret-safe diagnostics for transient SSL/network failures.
- `0.2.11` moved repair/capability installer execution into the app-owned UAC workflow.
- `0.2.12` made app-managed BAT bootstraps exit automatically instead of stopping at `Press any key`.
- PR #368 fixed the final `.env` writer in `/connector-agent/installer.ps1` so signed capability flags and dynamic grants render into the effective connector environment.

Validation must check live connector behavior, not only Local Manager Settings refresh. The accepted evidence is `connector_ps`, `connector_win`, `connector_files list_drives`, and `connector_apps list`. The Essam validation showed PowerShell `5.1.22621.6133`, Windows control process data, `D:\\` in `allowed_paths`, and dynamic app alias `cursor--user`.

See `docs/local-manager-capability-installer-governance-2026-05-28.md`.
