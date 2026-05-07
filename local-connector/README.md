# local-connector

This is a lightweight break-glass HTTP connector that runs on this Windows machine and is exposed to the internet exclusively via a Cloudflare Tunnel. The GPT admin assistant calls it when the primary Cloud Run API is unavailable. It exposes a small set of CLI and file operations behind the same `BACKEND_API_KEY` bearer token as the main API, binds only to `127.0.0.1` so it is never reachable without the tunnel, and logs every authenticated request to stdout.

---

## Setup

1. **Install cloudflared**
   Download the Windows installer from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ and ensure `cloudflared` is on your PATH.

2. **Authenticate the tunnel** (one-time, if not already done)
   ```
   cloudflared tunnel login
   ```

3. **Copy and fill the env file**
   ```
   copy .env.example .env
   ```
   Open `.env` and set `BACKEND_API_KEY` to the same value used by the Cloud Run API.

4. **Test locally**
   ```
   node server.mjs
   ```
   Visit `http://127.0.0.1:3001/` — you should see a JSON health response.

5. **Install as a Windows service** (run PowerShell as Administrator)
   ```
   .\install-service.ps1
   ```
   This registers cloudflared as an auto-start Windows service pointing at `cloudflared-config.yml`. The connector at `connector.mad4b.com` will be live immediately and will restart automatically on reboot.

6. **(Optional) Run the Node server as a service**
   Use [NSSM](https://nssm.cc/) or Windows Task Scheduler to keep `node server.mjs` running. Example with NSSM:
   ```
   nssm install local-connector "node" "D:\Nagy\Multi-Business-Multi-Role-Growth-Intelligence-OS\local-connector\server.mjs"
   nssm start local-connector
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

Authentication: send `Authorization: Bearer <BACKEND_API_KEY>` on every authenticated request.

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

---

## File endpoint

Enable with `CONNECTOR_FILES_ENABLED=true` and list allowed absolute paths in `CONNECTOR_FILE_PATHS` (comma-separated).

```
CONNECTOR_FILES_ENABLED=true
CONNECTOR_FILE_PATHS=C:\path\to\file.txt,C:\another\config.json
```

Actions: `list` (returns allowlist), `read` (returns file content), `write` (creates or overwrites).

---

## How the tunnel works (CNAME approach)

No public IP or firewall changes are needed on the Windows machine. `cloudflared` makes an outbound connection to Cloudflare's edge. Inbound HTTPS requests to `connector.mad4b.com` are routed by Cloudflare through the tunnel to `http://127.0.0.1:3001`. TLS is handled automatically by Cloudflare.

The Hostinger DNS record that makes this work is a CNAME:
```
connector → 95e4ba8c-782b-4819-9f80-04af4457ce73.cfargotunnel.com
```
This CNAME is already live in the `mad4b.com` DNS zone.

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
