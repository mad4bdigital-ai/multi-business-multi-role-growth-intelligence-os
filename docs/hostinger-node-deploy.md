# Hostinger Node.js Auto Deploy

## Purpose

Hostinger hPanel supports Auto Deploy from a Git repository. This is the preferred deployment mode for the platform Node.js apps. Manual ZIP uploads such as `connector-api.zip` should be treated as legacy fallback only.

Target state:

```text
push to dev branch -> Hostinger Auto Deploy -> dev.mad4b.com validation
push/merge to main -> Hostinger Auto Deploy -> auth.mad4b.com production validation
```

## Apps

| Hostname | Role | Preferred deploy source |
|---|---|---|
| `dev.mad4b.com` | Development/staging runtime for branch deployment tests before production | GitHub repo `dev` or the governed active development branch |
| `auth.mad4b.com` | Production control plane and `/connector-agent/server.mjs` distributor | GitHub repo `main` |
| `connector.mad4b.com` | Admin-only break-glass Cloudflare Tunnel to the active admin Windows `local-connector/server.mjs` on port 7070. It is not a Hostinger Node app and must not run `http-generic-api/server.js`. | Managed by Cloudflare Tunnel + local Windows service, not Hostinger Auto Deploy |

`dev.mad4b.com` must expose `/deployment-info` with branch and commit evidence. `auth.mad4b.com` is the production app and remains the critical distributor for `/connector-agent/version`. `connector.mad4b.com/health` must identify `service: local-connector`, a Windows hostname, and `platform: win32`; if it identifies `http_generic_api_connector`, DNS or hPanel routing has drifted and break-glass recovery is compromised.

## Repository readiness

The repository root is Hostinger-ready:

```json
{
  "scripts": {
    "start": "cd http-generic-api && npm start",
    "postinstall": "cd http-generic-api && npm ci --omit=dev"
  }
}
```

`http-generic-api/package-lock.json` exists, so `postinstall` can install production API dependencies deterministically.

## Hostinger hPanel setup

For each Hostinger Node.js app that should auto-deploy. Do **not** configure `connector.mad4b.com` here; it is a Cloudflare Tunnel to the local Windows connector service and must remain independent of Hostinger app startup failures.

1. Open hPanel.
2. Go to the website/app, for example `auth.mad4b.com`.
3. Open **Deployments** or **Settings and redeploy**.
4. Choose Git/GitHub repository deployment instead of manual upload.
5. Connect repository:

```text
mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os
```

6. Select branch by environment:

```text
dev.mad4b.com  -> dev or the governed active development branch
auth.mad4b.com -> main
```

7. Use repository root as app root unless Hostinger explicitly supports separate app root and install/start commands.
8. Use start command:

```bash
npm start
```

9. Keep environment variables in hPanel only. Do not commit `.env`.
10. Enable Auto deploy on push to `main`.

## Required hPanel environment variables

Keep the existing production variables configured in hPanel for `auth.mad4b.com`. The repo must not contain secrets.

At minimum, the runtime needs the existing DB/auth/provider variables already used by the deployed app. For connector-agent distribution, no extra secret is required, but the deployed repository must include:

```text
local-connector/server.mjs
http-generic-api/routes/connectorAgentRoutes.js
```

## Session Insight target write readback deployment note

When deploying migration `285_sprint68_session_insight_target_write_readback.sql`, verify the running Hostinger runtime exposes the new read-only routes `/platform/session-insight-promotions/target-write-readbacks/create` and `/platform/session-insight-promotions/target-write-readbacks/list` before live smoke. The expected evidence is a readback for an already executed internal SQL backlog target write with no target item modification, rollback execution, provider call, credential payload read, external write, raw transcript, or secrets.

## Verification after auto deploy

After Hostinger completes a dev deployment, verify:

```text
https://dev.mad4b.com/health
https://dev.mad4b.com/deployment-info
https://dev.mad4b.com/dev/db/status   # backend auth required
```

The deployment info must match the expected branch and commit before production promotion.

After Hostinger completes a production deployment, verify:

```text
https://auth.mad4b.com/health
https://auth.mad4b.com/connector-agent/version
```

Expected connector-agent version response:

```json
{
  "ok": true,
  "agent": {
    "has_n8n_lifecycle": true
  }
}
```

This proves `auth.mad4b.com` is serving the current `local-connector/server.mjs` with the governed n8n lifecycle actions.

For Local Manager capability changes, also verify the deployed `connectorAgentRoutes.js` behavior, because `/connector-agent/installer.ps1` is the final `.env` writer for capability flags and dynamic grants. A successful app update or Settings refresh alone does not prove `CONNECTOR_POWERSHELL_ENABLED`, `CONNECTOR_WIN_ENABLED`, `CONNECTOR_FILE_PATHS`, or `CONNECTOR_APP_ALLOWLIST` were applied.

## Local connector update flow

Once `auth.mad4b.com/connector-agent/version` is correct, update the Windows connector machine with:

```powershell
cd C:\mad4b-connector
Invoke-WebRequest `
  -Uri "https://auth.mad4b.com/connector-agent/server.mjs?cacheBust=$(Get-Date -UFormat %s)" `
  -OutFile "C:\mad4b-connector\server.mjs" `
  -UseBasicParsing
Restart-Service local-connector
```

Then verify via platform device tool:

```json
{
  "device_id": "mohammedlap",
  "user_id": "f242960c-2857-4b4d-a504-ee50f8a278b4",
  "action": "diagnose"
}
```

## Deployment authority

Hostinger hPanel Auto Deploy is the primary repository-to-Hostinger deployment path for `dev.mad4b.com` and `auth.mad4b.com`. The repository intentionally does not contain a GitHub Actions SSH fallback workflow and does not require Hostinger SSH secrets in GitHub.

A current checkout on the Hostinger filesystem is not enough to prove production is serving the new code. Always verify the running process through `/health` and `SERVICE_VERSION`. If files are updated but `/health.version` still reports an older version, classify it as process reload lag and use hPanel **Settings and redeploy** / **Restart**, or the governed Hostinger SSH deploy executor only after its target is active and smoke-validated.

When the governed Hostinger SSH deploy executor is used, treat its deployment result as two separate states: file sync and runtime reload. The response must expose `deploy.parsed`, `deploy.reload_verification`, and `deploy.continuation`. A successful checkout with `restart_signal=tmp/restart.txt` is still `live_ready=false` until the follow-up `/health` readback confirms the expected runtime version or commit. The continuation checkpoint must use `deploy_reload_pending` and `secrets_included=false` while that health readback is outstanding.

Do not use GitHub Actions to deploy `connector.mad4b.com`; that hostname must stay on the Cloudflare Tunnel/local-service path so it can recover Hostinger/auth outages.

## Security notes

- Do not commit `.env`, API keys, private keys, Hostinger credentials, or Cloudflare tokens.
- Keep secrets in hPanel environment variables, not GitHub Actions deployment secrets.
- Avoid manual ZIP uploads except for emergency rollback.
- Verify `/connector-agent/version` after every deployment that affects local connector behavior.

## Rollback

Rollback through Hostinger hPanel deployment history.
