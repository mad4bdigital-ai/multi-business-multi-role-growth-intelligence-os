# local-connector

A lightweight break-glass HTTP connector running on this Windows machine (`mohammedlap`), exposed exclusively via Cloudflare Tunnel. Serves two purposes:

1. **Break-glass recovery** — the GPT admin assistant calls it directly when Cloud Run is unavailable, to run `gh`/`gcloud` CLI, shell aliases, or file ops.
2. **Platform-orchestrated device ops** — the Cloud Run API (`/dispatch`, `/local-connector/*`) uses the tunnel URL from `local_connector_user_configs` to execute governed shell/file commands on behalf of the GPT.

Binds only to `127.0.0.1`; Cloudflare Tunnel is the sole entry point. Every authenticated request is logged to stdout.

**Device:** mohammedlap | **Port:** 7070 | **Tunnel:** 95e4ba8c-782b-4819-9f80-04af4457ce73

**Cloudflare Tunnel routes:**
- `connector.mad4b.com → localhost:7070` (this connector)

Managed n8n is centralized on GCloud at `n8n.mad4b.com`. Local/self-hosted n8n should be exposed through connector-scoped routes such as `https://{user-device}.connector.mad4b.com/n8n`.

---

## Setup

### Option A — GPT-assisted (recommended)

The admin GPT can generate a pre-filled installer and hand you a Drive download link:

1. Open the admin GPT and activate a session.
2. Ask: *"Generate the local connector installer"*
3. GPT calls `local_connector_install_bundle` → generates `install-connector-<date>.bat` with the tunnel token pre-filled → uploads to Google Drive → returns a download link.
4. Download the `.bat` file, right-click → **Run as administrator**.
5. The script installs cloudflared via winget if missing, registers the service with the embedded token, and starts it. `connector.mad4b.com` is live within ~30 seconds.

### Option B — Manual

1. **Install cloudflared** (if not already on PATH):
   ```
   winget install --id Cloudflare.cloudflared
   ```
   Or download from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

2. **Get the tunnel token** from Cloudflare Zero Trust dashboard → Networks → Tunnels → find `connector.mad4b.com` → Configure → copy the token.

3. **Install the cloudflared service** (run PowerShell as Administrator from the repo root):
   ```powershell
   .\install-local-connector.ps1 -TunnelToken "eyJh..."
   ```
   This installs and starts cloudflared as a Windows service. The tunnel is live immediately and restarts automatically on reboot.

4. **Test locally**
   ```
   node server.mjs
   ```
   Visit `http://127.0.0.1:7070/` — you should see a JSON health response. Default port is 7070; set `CONNECTOR_PORT` in `.env` to override.

5. **(Optional) Run the Node server as a service**
   Use [NSSM](https://nssm.cc/) or Windows Task Scheduler to keep `node server.mjs` running. Example with NSSM:
   ```
   nssm install local-connector "node" "D:\Nagy\Multi-Business-Multi-Role-Growth-Intelligence-OS\local-connector\server.mjs"
   nssm start local-connector
   ```

### Diagnosing tunnel errors

Cloudflare error **1033** means cloudflared is configured but not running. Fix:
```powershell
# Check service status
Get-Service cloudflared

# Start if stopped
Start-Service cloudflared

# View recent errors
Get-EventLog -LogName System -Source cloudflared -Newest 10

# Or ask GPT: "check cloudflare tunnel status" → calls cloudflare_tunnel_status tool
```

---

## Endpoints

| Method | Path       | Auth required | Description                                        |
|--------|-----------|---------------|----------------------------------------------------|
| GET    | `/`        | No            | Health check — hostname, platform, uptime          |
| GET    | `/health`  | No            | Same as `/`                                        |
| POST   | `/github`  | Yes           | Run `gh` CLI. Body: `{ args, timeout_ms? }`        |
| POST   | `/gcloud`  | Yes           | Run `gcloud` CLI. Body: `{ args, timeout_ms? }`    |
| POST   | `/shell`   | Yes           | Run an allowlisted command alias (see below)       |
| POST   | `/files`   | Yes           | Read or write an allowlisted file path             |

All error responses use the shape `{ ok: false, error: { code, message } }`.

Authentication: send `Authorization: Bearer <CONNECTOR_SECRET>` or `x-connector-secret: <CONNECTOR_SECRET>` on every authenticated request. `CONNECTOR_SECRET` is an Admin-only break-glass credential and is independent of `auth.mad4b.com`; do not use `BACKEND_API_KEY` for the standalone connector except during an explicitly documented legacy-device migration window.

---

## Shell allowlist format

`CONNECTOR_SHELL_ALLOWLIST` is a JSON object in the `.env` file. Each key is the alias name callers pass as `alias` in the request body.

```json
{
  "git_status": {
    "command": "git",
    "args": ["status"],
    "display_name": "Git status",
    "allow_extra_args": true,
    "max_extra_args": 2,
    "timeout_ms": 30000
  },
  "node_ver": {
    "command": "node",
    "args": ["--version"],
    "display_name": "Node version"
  }
}
```

Fields:

| Field            | Required | Default | Description                                            |
|-----------------|----------|---------|--------------------------------------------------------|
| `command`        | Yes      | —       | Executable name (on PATH) or absolute path             |
| `args`           | Yes      | —       | Fixed argument array prepended before any extra_args   |
| `display_name`   | No       | alias   | Human-readable label returned in responses             |
| `allow_extra_args` | No     | false   | Whether callers may append additional arguments        |
| `max_extra_args` | No       | 10      | Maximum number of caller-supplied extra args           |
| `timeout_ms`     | No       | 120000  | Per-alias timeout override (max 600000)                |

Shell request body for `action=run`:
```json
{ "action": "run", "alias": "git_status", "extra_args": ["--short"], "timeout_ms": 15000 }
```

### Required local verification aliases

Every local connector installation used for platform administration should support these governed aliases, either as built-in aliases or via `CONNECTOR_SHELL_ALLOWLIST`:

| Alias | Purpose |
|---|---|
| `local_disk_list` | List local fixed/removable/network volumes. |
| `local_dir_list` | List a bounded directory path, used to validate registered project paths. |
| `local_file_search` | Search for a bounded file pattern under a path, used to validate markers such as `package.json`. |

The active Essam connector was upgraded to expose these aliases through `/shell` without opening arbitrary command execution. `local_dir_list` and `local_file_search` accept bounded PowerShell parameters through `extra_args`; they must not delete, overwrite, or move files.

Example directory validation:

```json
{
  "action": "run",
  "alias": "local_dir_list",
  "extra_args": [
    "-Path",
    "D:\\Nagy\\Multi-Business-Multi-Role-Growth-Intelligence-OS",
    "-Limit",
    "20"
  ]
}
```

Example marker search:

```json
{
  "action": "run",
  "alias": "local_file_search",
  "extra_args": [
    "-Path",
    "D:\\Nagy\\Multi-Business-Multi-Role-Growth-Intelligence-OS",
    "-Pattern",
    "package.json",
    "-Limit",
    "10"
  ]
}
```

---

## File endpoint

Enable with `CONNECTOR_FILES_ENABLED=true` and list allowed absolute paths in `CONNECTOR_FILE_PATHS` (comma-separated).

```
CONNECTOR_FILES_ENABLED=true
CONNECTOR_FILE_PATHS=C:\path\to\file.txt,C:\another\config.json
```

Actions:
- `list` without `path` returns the allowlist.
- `list` with an allowlisted directory `path` returns directory entries.
- `list_drives` returns detected local drive roots and which allowlisted roots sit on each drive.
- `locate_repo` searches only below allowlisted roots for repo markers such as `.git`, `AGENTS.md`, `package.json`, and `http-generic-api/openapi.yaml`.
- `read` returns file content.
- `write` creates or overwrites a file.

When an allowlisted path is a directory, `read` and `write` may target files under that directory.
Use `locate_repo` after connector health to identify the working project path on the connected device without opening unrestricted disk traversal.

---

## Dependency installer endpoint

Enable with `CONNECTOR_DEPENDENCIES_ENABLED=true`. The connector installs only package keys from `CONNECTOR_DEPENDENCY_ALLOWLIST`; default recovery packages are `gh` and `googlecloudsdk` through Chocolatey.

Actions:
- `status` returns whether dependency install is enabled.
- `list` returns installable allowlisted package keys.
- `install` installs one allowlisted `package_key`, then runs its post-install version check when configured.

This endpoint exists so GPT can restore local recovery tools without arbitrary shell package commands. Keep the allowlist narrow.

---

## Apps and browser endpoints

Enable with `CONNECTOR_APPS_ENABLED=true`. App and browser control uses `CONNECTOR_APP_ALLOWLIST`; callers pass only `app_alias` or `browser_alias`, never raw commands.

Default app aliases:
- `edge`
- `chrome`
- `vscode`
- `notepad`

Each app may include classification fields:
- `capability_class`: `browser`, `developer_tool`, `utility`, `desktop_app`, or a custom class
- `risk_class`: `low`, `interactive`, `state_changing`, `destructive`, or a custom risk label
- `browser`: whether the app can be used by `/browser`

`POST /apps` actions:
- `status`
- `list`
- `launch`
- `status_app`
- `close`

`POST /browser` actions:
- `list`
- `open_url` for absolute `http` or `https` URLs only
- `screenshot` for a bounded JPEG desktop screenshot after browser interaction

Use `/browser` for web-console inspection and `/apps` for allowlisted app lifecycle control. Keep form submission, publishing, billing, deletion, and DNS mutations on governed API routes rather than blind UI clicks.
Responses include `classification` metadata so GPT can choose the right guardrail before acting.

---

## How the tunnel works (CNAME approach)

No public IP or firewall changes are needed on the Windows machine. `cloudflared` makes an outbound connection to Cloudflare's edge. Inbound HTTPS requests are routed through the tunnel to `127.0.0.1`. TLS is handled automatically by Cloudflare.

Hostinger DNS CNAMEs in `mad4b.com`:
```
connector → 95e4ba8c-782b-4819-9f80-04af4457ce73.cfargotunnel.com  (→ localhost:7070)
n8n       → ghs.googlehosted.com.                                 (→ centralized GCloud n8n)
```

Published application routes (Cloudflare dashboard → Networks → Tunnels → mohammedlap → Published application routes):
- `connector.mad4b.com` → `http://localhost:7070`

## Platform-orchestrated provisioning (Sprint 36+)

For new users/devices, the platform route `POST /local-connector/install` now provisions the full routing chain:

1. Creates a named Cloudflare tunnel for the user/device.
2. Publishes the Cloudflare application route for the generated hostname.
3. Adds the Hostinger DNS CNAME.
4. Stores `tunnel_url`, tunnel metadata, and `connector_secret` in `local_connector_user_configs`.
5. Returns an install bundle with `install-local-connector.ps1`, `.env`, `start-connector.bat`, and `install.bat`.

Generated hostnames use the shape:

```
{user-label}-{device-label}-{hash}.connector.mad4b.com
```

The optional `hostname` request field may override this, but it must remain under `.connector.mad4b.com`.

Credential source depends on auth:

- owner/admin bearer auth uses Cloud Run root env credentials for Cloudflare and Hostinger.
- signed-in users and tenant API keys resolve `cloudflare` and `hostinger` credentials from `user_app_connections`.
- API-key callers must belong to the same tenant and provide the target `user_id` when the key is app-level.

When a user logs in from a new device, call the same install route with the new `device_id`; the route is idempotent for existing devices and provisions a new tunnel/DNS path for new devices.

This makes provisioning fully automated for any user/device. The platform stores `connector_secret` per device and uses it when proxying requests through `/dispatch`.

The generated `.env` is the local runtime contract for `server.mjs`:

```
BACKEND_API_KEY=<device connector secret>
CONNECTOR_PORT=7070
CONNECTOR_SHELL_ENABLED=true
CONNECTOR_SHELL_ALLOWLIST={...}
```

Run `install-local-connector.ps1` as Administrator from the `local-connector` folder. It writes `.env`, registers the Cloudflare tunnel with the returned connector token, and starts `server.mjs`. Later launches can use `start-connector.bat` directly.

---

## Running on a spare device

The same tunnel ID can be active on multiple machines simultaneously. Cloudflare load-balances across all connected cloudflared instances. To add a spare:

1. Copy `cloudflared-config.yml` and the credentials file (`~/.cloudflared/<tunnel-id>.json`) to the spare device.
2. Copy and fill `.env` with the same `BACKEND_API_KEY`.
3. Start cloudflared on the spare: `cloudflared tunnel run --config cloudflared-config.yml`.
4. Start the Node server on the spare: `node server.mjs`.

Both machines will serve requests — if one disconnects, Cloudflare continues routing to the other automatically.

---

## Security notes

- The server binds to `127.0.0.1` only. It is never reachable on `0.0.0.0` or any network interface. Cloudflare Tunnel is the only entry point from the internet.
- Shell commands are executed via `spawn` with `shell: false`. Arguments containing shell metacharacters (`; & | \` $ < > \ ! { } ( ) \n \r`) are rejected with a 400.
- Only paths explicitly listed in `CONNECTOR_FILE_PATHS` can be read or written. Paths are resolved before comparison.
- All authenticated requests are logged to stdout with timestamp, method, path, and action details. Secrets are never logged.
