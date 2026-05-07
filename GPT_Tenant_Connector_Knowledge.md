# Mad4B Connector — Tenant Knowledge Guide

## What Is Mad4B

Mad4B is a multi-business Growth Intelligence Platform. It manages marketing content, customer workflows, AI-driven activations, and local device integrations across tenants. Each tenant gets their own workspace with governed access to platform capabilities.

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
1. Sign in at auth.mad4b.com/connect
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

Three sections:
1. **Sign in / Sign up** — email+password or Google OAuth
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
- Check email/password. If using Google, the Google account email must match the registered email.

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
