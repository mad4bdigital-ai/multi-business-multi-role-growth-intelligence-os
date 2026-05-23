# Local Manager n8n Runtime Governance

## Purpose

This runbook defines how Mad4B Local Manager resolves, starts, and exposes n8n runtimes. The database registry is the source of truth for every n8n runtime path, port, folder, and public URL.

## Runtime classes

### Platform-managed n8n

The platform-managed n8n instance is reserved for Mad4B platform operations. While the platform-managed runtime is temporarily hosted on an admin workstation, it must be registered as a managed connected system and explicitly marked as a temporary origin.

Required profile fields:

```json
{
  "runtime_role": "platform_managed",
  "exposure_scope": "public_platform_domain",
  "service_mode": "managed",
  "reserved_platform_domain": true,
  "local_url": "http://127.0.0.1:5678/",
  "public_url": "https://n8n.mad4b.com/",
  "editor_base_url": "https://n8n.mad4b.com/",
  "webhook_url": "https://n8n.mad4b.com/",
  "temporary_until_vps": true
}
```

`https://n8n.mad4b.com/` is reserved for the platform-managed n8n only. Tenant and user n8n profiles must never use this hostname.

### Tenant local n8n

Tenant/user n8n is self-serve by default and runs locally from Local Manager. It must use a tenant-specific data folder and a non-platform port. The default tenant local web port is `5682` so it cannot accidentally become the origin for `https://n8n.mad4b.com/` and does not conflict with n8n's default Task Broker port `5679`. Tenant profiles should explicitly set a separate task broker port such as `5683` and launcher health check port such as `5684`.

Required profile fields:

```json
{
  "runtime_role": "tenant_local",
  "exposure_scope": "local_only",
  "service_mode": "self_serve",
  "reserved_platform_domain": false,
  "local_only": true,
  "local_url": "http://127.0.0.1:5682/",
  "public_url": "",
  "port": 5682,
  "task_broker_port": 5683,
  "task_broker_url": "http://127.0.0.1:5683/",
  "launcher_health_check_port": 5684,
  "editor_base_url": "http://127.0.0.1:5682/",
  "webhook_url": "http://127.0.0.1:5682/"
}
```

Local Manager reads this profile from `/local-manager/device/controls?section=n8n` and writes the generated start script from the returned DB-backed profile. It must not hard-code a tenant n8n port, public URL, data folder, editor base URL, or webhook URL.

## Tenant public tunnel mode

Tenant public n8n exposure is optional. When enabled, the platform should create or assign a tenant/device-specific public hostname and store it on the tenant n8n profile.

Preferred shape:

```json
{
  "runtime_role": "tenant_local",
  "exposure_scope": "tenant_public_tunnel",
  "public_tunnel_mode": "cloudflare_tenant_hostname",
  "local_url": "http://127.0.0.1:5682/",
  "public_url": "https://n8n-8db63b00.mad4b.com/",
  "port": 5682,
  "task_broker_port": 5683,
  "task_broker_url": "http://127.0.0.1:5683/",
  "launcher_health_check_port": 5684,
  "editor_base_url": "https://n8n-8db63b00.mad4b.com/",
  "webhook_url": "https://n8n-8db63b00.mad4b.com/"
}
```

Tenant public hostnames should avoid tenant names, emails, or sensitive labels. Prefer opaque IDs derived from connector config IDs, device route IDs, or short stable hashes.

## HTTPS on localhost

Do not default n8n to `https://127.0.0.1:<port>`. Local HTTPS requires certificate and key management, causes browser trust prompts unless a trusted local CA is installed, and can break editor/webhook behavior. Cloudflare should provide HTTPS at the public hostname while the local origin may remain HTTP on `127.0.0.1`.

## Execution modes

Local Manager and local connector execution have separate responsibilities:

- `background` mode runs through the local connector service. Use it for health checks, policy, shell aliases, file probes, n8n health, backups, and non-UI tasks.
- `desktop` mode runs through the foreground Local Manager app. Use it for opening browsers, opening n8n, notifications, prompts, approvals, and other UI-visible actions.

GPT/admin desktop actions should use the DB-backed desktop command queue. The Local Manager app polls with its device token and completes commands with bounded, non-secret results.

## Validation rules

- Tenant profiles must not use `https://n8n.mad4b.com/`.
- Tenant profiles must not use port `5678` unless explicitly marked `runtime_role: platform_managed` and `reserved_platform_domain: true`.
- Tenant profiles should not use web port `5679` because n8n's task broker defaults to `5679`. Use web port `5682`, broker port `5683`, and launcher health check port `5684` unless a DB profile explicitly reserves another non-conflicting range.
- Every n8n profile must include `secrets_included: false` in returned payloads.
- Raw secrets, n8n API keys, Cloudflare tokens, or connector secrets must not be stored inside `connected_systems.config_json`.
- Public exposure must be auditable through DB state and must be reversible.

## Operational sequence

For tenant n8n local start:

1. Local Manager loads the authenticated device profile from `/local-manager/device/controls?section=n8n`.
2. Backend resolves or creates the `connected_systems` row and active `installations` row.
3. Local Manager writes a start script using only DB-returned profile fields.
4. Local Manager starts n8n locally.
5. Health is validated through local connector or direct local browser.

For tenant n8n public exposure:

1. User/admin requests public exposure.
2. Platform creates or assigns a tenant/device-specific hostname.
3. Platform writes `public_url`, `editor_base_url`, `webhook_url`, and `exposure_scope` to the n8n connected system profile.
4. Local Manager restarts n8n using the updated DB profile.
5. Platform validates public reachability and records audit evidence.
