# Mad4B Tenant Connector Knowledge

This is the detailed reference file for Tenant GPT connector behavior. Keep `GPT_Tenant_Connector_Instructions.md` compact and under 8,000 characters; put long examples, UX details, troubleshooting, and stale-reference cleanup here.

## Core boundary

Tenant GPT uses one action connector only:

- `https://auth.mad4b.com/openapi.tenant-gpt.auth.yaml`
- OAuth via `https://auth.mad4b.com/auth/oauth/authorize` and `/auth/oauth/token`
- Client ID: `mad4b-tenant-gpt`

Do not configure or call a standalone `connector.mad4b.com` action in Tenant GPT. Direct connector access is admin/break-glass/local-device scoped and can expose the admin Windows hostname `Essam` while the tenant-registered device is different. That is not acceptable tenant evidence. Tenant connector evidence must come from tenant-visible `auth.mad4b.com` tools.

## Tenant action model

Tenant schema is MCP-style and exposes only:

1. `activateSession`
2. `listTools`
3. `callTool`
4. `writeSessionTurn`
5. `endSession`

Use `listTools`, then `callTool` with `name` and `tool_args`.

Tenant discovery and dispatch must remain user-JWT-safe. Tenant tools must not expose or route to `/admin/*`, `/admin/system/*`, `/connector/*`, direct `connector.mad4b.com`, or any backend-key-only workaround. If `listTools` exposes such a tool, or `callTool` returns `tenant_tool_route_not_allowed` / `admin_backend_api_key_required`, treat it as a platform tool-surface defect: do not ask the tenant for an admin/backend key, do not retry with admin credentials, and fall back to tenant-safe `connect_*` or local gateway tools discovered by `listTools`.

## Live repo knowledge loading

Do not paste or upload repository knowledge files into GPT Builder as long-lived copies. They drift from the repo and can conflict with runtime policy.

Admin GPT may read live repo files through governed admin repo tools such as `repo_inspect`. Tenant GPT must not use admin repo tools. Tenant GPT may read live repo knowledge only through tenant-visible `auth.mad4b.com` tools returned by `listTools`, and only when that tool exposes a bounded, tenant-safe subset.

Allowed tenant-safe knowledge categories:

- `GPT_Tenant_Connector_Instructions.md`
- `GPT_Tenant_Connector_Knowledge.md`
- tenant-facing `/connect` help docs
- tenant-visible activation, device, and integration guidance under `docs/`

Blocked from Tenant GPT unless explicitly transformed into a tenant-safe subset:

- `AI_Agent_Knowledge_Guide.md`
- `GPT_Admin_Assistant_Knowledge_Guide.md`
- admin-only runbooks
- raw migrations, DB schema dumps, secrets, backend credentials, or cross-tenant diagnostics

If no tenant-visible docs reader exists in `listTools`, continue from the compact instructions and current activation evidence. Do not fall back to native GitHub, browser scraping, uploaded GPT Builder files, or admin `repo_inspect`.

See `docs/live-repo-knowledge-loading-governance.md` for the admin/tenant boundary and the proposed `tenant_repo_doc_read` tool contract.

Correct:

```json
{ "name": "connect_activate", "tool_args": { "mode": "managed" } }
```

Incorrect:

```json
{ "name": "connect_activate", "mode": "managed" }
```

## Standard flow

1. `activateSession`
2. `listTools`
3. `callTool` with `connect_status`
4. If missing sign-in, stop and use the sign-in template from the compact Instructions file.
5. If workspace is missing, use tenant-visible onboarding/workspace tools or `/connect`.
6. If activation is missing, call `connect_activate`.
7. If device setup is needed, call `connect_device_install`.
8. Show the real installer output returned by backend.
9. After the installer runs, check status/health through tenant-visible auth-host tools only.

## Managed mode

Managed is the default for new tenants unless they ask for Dedicated or tenant-owned integrations.

```json
{ "name": "connect_activate", "tool_args": { "mode": "managed" } }
```

```json
{ "name": "connect_device_install", "tool_args": { "device_id": "nagy-mbp-m4" } }
```

Managed mode should not ask for dedicated Cloudflare or Hostinger credentials.

## Dedicated mode

Dedicated mode is for tenant-owned infrastructure or self-hosted/local runtime defaults.

```json
{ "name": "connect_activate", "tool_args": { "mode": "dedicated", "n8n_activation_mode": "self_hosted_local" } }
```

Dedicated device install may require tenant-owned app connections. Use `connect_app_integrations_list`, `connect_credential_intake_create`, `connect_app_connections_list`, then retry `connect_device_install`. Never ask the user to paste provider credentials in chat.

## Mixed app policy

There is no activation mode named `hybrid`. Activation mode remains `managed` or `dedicated`. Per-app mixed behavior belongs in `integration_modes` or `connect_integration_policy_update`.

Example:

```json
{
  "name": "connect_activate",
  "tool_args": {
    "mode": "managed",
    "integration_modes": {
      "cloudflare": "dedicated",
      "hostinger": "dedicated",
      "google_drive": "managed"
    }
  }
}
```

## Device and health rules

Device IDs must be stable lowercase IDs with letters, numbers, and hyphens only. Example: `nagy-mbp-m4`.

For “Check connector,” use `connect_status` or a tenant-visible connector health/status tool discovered by `listTools`. Do not call `connector.mad4b.com`. If any admin-only evidence reports a hostname different from the registered device ID, do not present that hostname as tenant evidence.

## /connect frontend requirements

`https://auth.mad4b.com/connect?activation_mode=managed&device_id=nagy-mbp-m4` should:

1. Parse and preserve `activation_mode` / `mode` and `device_id` through sign-in.
2. Call `/connect/status` after sign-in.
3. Activate managed mode automatically when allowed.
4. Call `/connect/device-install` with the preserved device ID.
5. Show the real installer response.
6. Avoid fake DNS/tunnel artifacts, fake terminal animation, and JWT copy blocks.
7. Use a calm Claude-style flow with one primary action at a time.

## Local Manager capability boundary

High-risk Local Manager capability installers such as `powershell_admin` and `windows_control` are local-consent/UAC surfaces and must not be remotely enabled by Tenant GPT. Tenant assistants may explain that the user must approve local device setup, but actual capability activation and validation must remain within tenant-visible `auth.mad4b.com` tools and scoped device status. Do not use admin `connector_ps`, `connector_win`, or direct `connector.mad4b.com` evidence in tenant responses.

## Windows `.ps1` fallback

When automatic launch is unavailable, Windows `.ps1` installer is the main fallback artifact. Show:

- Download `installer.ps1`
- Run as Administrator in PowerShell
- Return and click “Check connector”

Safe command after download:

```powershell
powershell -ExecutionPolicy Bypass -File .\installer.ps1
```

Never display raw connector secrets, Cloudflare tokens, device access tokens, backend API keys, `.env` contents, or full credential blobs.

## Maintenance

When tenant activation changes, update:

1. `GPT_Tenant_Connector_Instructions.md` for compact non-negotiable rules.
2. `GPT_Tenant_Connector_Knowledge.md` for detailed guidance.
3. `http-generic-api/openapi.tenant-gpt.auth.yaml` for wrapper-safe schema fields.
4. `http-generic-api/test-custom-gpt-schemas.mjs` for schema and boundary checks.
5. `/connect` frontend files under `http-generic-api/public/connect/` for UX changes.
6. Tenant tool registry migrations/seeds for DB tool schema changes.

If this file becomes stale, update it. Delete it only if a newer canonical tenant knowledge file replaces it and tests point to that replacement.
