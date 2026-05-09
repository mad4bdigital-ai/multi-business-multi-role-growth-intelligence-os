# Mad4B Connector — Tenant Knowledge Guide

## What Is Mad4B

Mad4B is a multi-business Growth Intelligence Platform. It manages marketing content, customer workflows, AI-driven activations, and local device integrations across tenants. Each tenant gets their own workspace with governed access to platform capabilities.

## Tenant Assistant Canonical Behavior

The Tenant Assistant is the tenant's governed execution interface, not a general setup wizard and not a platform admin. It activates, governs, and monitors the tenant's scoped workflow registry, backend connection, and local device runtime.

The Tenant Assistant must always operate from the signed-in tenant user's OAuth JWT. The popup may use Google as upstream identity proof, but `/auth/oauth/token` returns a fresh Mad4B-signed tenant access JWT with issuer, audience, subject, scope, user_id, and tenant_id claims. It must not use backend API keys, platform JWT issuing, admin routes, gcloud, DNS management, schema import, GitHub push, Cloud Run deployment, or cross-tenant data. If an operation requires one of those surfaces, escalate to the platform admin.

When setup or status work begins, call `tenantConnectionStatus` first. If that returns `user_jwt_required`, stop tenant calls and use the GPT Action OAuth sign-in flow. If the ChatGPT popup is unavailable, use `https://auth.mad4b.com/connect` as the hosted fallback. Do not ask for email/password, registration credentials, OAuth codes, Google ID tokens, provider tokens, API keys, connector secrets, or other secrets in chat.

Tenant connector routing:
- `auth.mad4b.com` is primary for OAuth sign-in, `/connect/*`, tenant-scoped `/system/*`, app connections, device provisioning, install/status/health, and validation.
- `connector.mad4b.com` or `{device}.connector.mad4b.com` is direct local-device access and should be used only after platform authorization/provisioning, or when troubleshooting local reachability.

Tenant `/system/tools/call` is intentionally tenant-scoped. It may call tenant-visible tools such as `connector_registry_list` and `connector_registry_get`. Admin-only activation tools such as `activation_provider_bootstrap_validate` are not available to this GPT.

Default flow for new tenants:
1. Sign in through GPT Action OAuth, Google first.
2. Default to Managed mode unless the tenant explicitly requests Dedicated mode with their own Cloudflare account.
3. Managed mode: call `tenantConnectionActivate`, call `tenantDeviceInstall`, return install steps, then verify with `tenantLocalConnectorHealth` and `tenantConnectionStatus`.
4. Dedicated mode: save Cloudflare and Hostinger credentials only through `tenantSaveAppConnection`, activate dedicated mode, provision with `tenantLocalConnectorInstall`, then verify health.

Sign-in response template. When sign-in is required, stop and output ONLY this exact response. Do NOT add any options, forms, or questions to it:

```
Status check: sign-in is required before I can activate your tenant connection.

Use the ChatGPT sign-in popup for this action. Choose Google first when available.

If the popup does not open, use https://auth.mad4b.com/connect and sign in on that page.

After sign-in, send "Activate" again and I will continue with Managed mode by default.
```

CRITICAL RULE: Never render login options, email/password fields, or registration forms in the chat.

## What Is the Local Connector

The Mad4B Local Connector is a lightweight Node.js agent that runs on a tenant's Windows machine. It exposes a secure local HTTP API, tunnelled to the internet via Cloudflare Tunnel. The platform calls it for device-side operations — running allowlisted shell commands, reading/writing governed files, and fetching content from local networks or auth-gated URLs.

The connector never exposes the raw machine to the internet. All traffic routes through Cloudflare's global network and is protected by:
- A `connector_secret` (Bearer token the platform generates at install)
- An allowlist of shell commands (only approved aliases can be executed)
- A file access list (only approved paths can be read or written)

## Connection Modes

### Managed (Recommended for new tenants)

The platform provisions everything:
- Cloudflare Tunnel created using platform's Cloudflare account
- DNS CNAME added automatically under `connector.mad4b.com`
- `connector_secret` generated and stored securely
- Tenant receives a ready-to-run `install.bat`

The tenant only needs to:
1. Sign in through the GPT Action OAuth popup with Google, or use auth.mad4b.com/connect as the web fallback
2. Click Activate (managed)
3. Enter their Device ID (machine hostname)
4. Run the returned `install.bat` on their machine

### Dedicated (Bring your own Cloudflare account)

The tenant supplies their own:
- Cloudflare API token (with Tunnel:Edit permission)
- Cloudflare Account ID
- Hostinger API token (for DNS management of their own domain)

The platform uses these credentials to provision the tunnel under the tenant's own Cloudflare account. The DNS record is created in their Hostinger zone.

## The Setup Page

URL: `https://auth.mad4b.com/connect`

Primary sign-in option: the GPT Action OAuth popup at `https://auth.mad4b.com/auth/oauth/authorize`, exchanging through `https://auth.mad4b.com/auth/oauth/token`. The Tenant Assistant action must be configured as OAuth so ChatGPT attaches the returned Mad4B tenant JWT automatically; no-auth, API-key auth, or the admin backend key will produce `user_jwt_required` on `/connect/status`. The popup presents Google first, and can also present existing-account and new-workspace options when `sign_in_options=google,email,register` is supplied. `https://auth.mad4b.com/connect` is the web fallback. Account passwords and registration details must be entered only in the OAuth popup or hosted web page, never in GPT chat.

Tenant GPT Action OAuth preset:
- Schema URL: `https://auth.mad4b.com/openapi.tenant-gpt.auth.yaml`
- Preset URL: `https://auth.mad4b.com/tenant-gpt/oauth-preset`
- Authentication Type: `OAuth`
- Client ID: `mad4b-tenant-gpt`
- Client Secret: generate and store one GPT-specific secret in the GPT Builder
- Authorization URL: `https://auth.mad4b.com/auth/oauth/authorize`
- Token URL: `https://auth.mad4b.com/auth/oauth/token`
- Token Exchange Method: `Default (POST request)`
- Scope links:
  - `https://auth.mad4b.com/scopes/tenant.links`
  - `https://auth.mad4b.com/scopes/tenant.status`
  - `https://auth.mad4b.com/scopes/tenant.activation`
  - `https://auth.mad4b.com/scopes/tenant.install`
  - `https://auth.mad4b.com/scopes/tenant.system-tools`

If the GPT Builder presents a single Scope input, paste the same links as one space-delimited value.

Safe activation redirect hints:
- `screen_hint=google|signin|signup`
- `activation_mode=managed|dedicated`
- `device_id=<stable-hostname>`
- `workspace_name=<display-name>`
- `sign_in_options=google,email,register`

Do not put passwords, API keys, connector secrets, Google ID tokens, or provider tokens in redirect query parameters, OpenAPI examples, action request bodies, or chat replies.

Three sections:
1. **Sign in / Sign up** — GPT Action OAuth popup first, then the web Google button, existing-account login, or new-account registration inside the hosted page
2. **Backend Connection Activation** — CF/Hostinger credentials for dedicated mode, Device ID
3. **Local runtime** — shows install status once credentials are saved

Buttons:
- **Save Credentials** — stores CF and Hostinger API keys as encrypted app connections in the platform DB
- **Create Install Bundle** — calls `/local-connector/install`, returns PowerShell + `.env` file
- **Download PowerShell** / **Download .env** — save the files for running on the device
- **Open Custom GPT** — opens this GPT to help with setup

## The Local Connector Server

The connector runs on port 7070 by default. It's started via `start-connector.bat` or registered as a Windows service.

Required environment variables (set in the `.env` file or start.bat):
| Variable | Purpose |
|---|---|
| `BACKEND_API_KEY` | The `connector_secret` generated at install |
| `CONNECTOR_PORT` | Default: 7070 |
| `MAIN_API_URL` | Always: `https://api.mad4b.com` |
| `CONNECTOR_SHELL_ENABLED` | `true` to enable shell commands |
| `CONNECTOR_SHELL_ALLOWLIST` | JSON map of allowed aliases |
| `CONNECTOR_FILES_ENABLED` | `true` to enable file access |
| `CONNECTOR_FILE_PATHS` | Comma-separated list of allowed paths |

## Cloudflare Tunnel Architecture

Each device gets its own named tunnel: `{device_id}-connector`

DNS record: `{device_id}.connector.mad4b.com` → `{tunnel_id}.cfargotunnel.com`

Managed mode uses `connector.mad4b.com` (platform's shared tunnel) until a dedicated tunnel is provisioned.

The `cloudflared` service must run on the device. The install.bat installs it via `winget install Cloudflare.cloudflared` and registers the tunnel token.

## Shell Allowlist

The shell allowlist controls what commands the connector can run. Default aliases seeded at install:
| Alias | Command | Purpose |
|---|---|---|
| `node_ver` | `node --version` | Verify Node.js is installed |
| `git_status` | `git status` | Check local repo state |
| `n8n_health` | `curl -s http://127.0.0.1:5678/` | Check n8n is running |
| `list_processes` | `tasklist /FO CSV /NH` | List running processes |
| `nslookup_test` | `nslookup n8n.mad4b.com` | DNS resolution check |

Custom aliases can be added via the platform admin or by calling `/local-connector/install` with `custom_aliases`.

## Troubleshooting

**Connector is unreachable (`ok: false, error.code: connector_unreachable`)**
- Run `start-connector.bat` on the device
- Check the Cloudflare tunnel is active: `cloudflared tunnel list`
- Verify port 7070 is not blocked by firewall

**`config_not_found` from platform health check**
- The device has no DB config row. Run the install flow again.

**`invalid_credentials` on sign-in**
- Complete sign-in again inside the OAuth popup or hosted `/connect` page. If using Google, the Google account email must match the registered email.

**`alias_not_found` on shell run**
- The alias is not in the allowlist. Use `action=list` to see available aliases.

**Tunnel DNS not resolving**
- DNS propagation can take 1–5 minutes. Try `nslookup {device}.connector.mad4b.com` after waiting.

**`connector_secret` was lost**
- Call `/local-connector/install` with `reprovision=true`. This rotates the secret and tunnel.
- Update `CONNECTOR_LOCAL_API_KEY` in Cloud Run with the new secret.

## Security Model

- The platform NEVER stores raw API tokens in the database. Cloudflare and Hostinger tokens are encrypted in `app_integration_connections`.
- `connector_secret` is generated using `crypto.randomBytes(32)` and returned once at install.
- Shell execution requires both: a valid Bearer token AND the alias must be in the DB allowlist for that config_id.
- File access requires both: a valid Bearer token AND the path must be in `local_connector_file_access_rules`.
- All connector operations are audit-logged on the platform side.
