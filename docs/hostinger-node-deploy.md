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
| `connector.mad4b.com` | Hostinger Node app entry if kept in hPanel. Note: live DNS currently points to the Cloudflare Tunnel for the local connector. | GitHub repo `main` or disabled if unused |

`dev.mad4b.com` must expose `/deployment-info` with branch and commit evidence. `auth.mad4b.com` is the production app and remains the critical distributor for `/connector-agent/version`.

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

For each Node.js app that should auto-deploy:

1. Open hPanel.
2. Go to the website/app, for example `auth.mad4b.com`.
3. Open **Deployments** or **Settings and redeploy**.
4. Choose Git/GitHub repository deployment instead of manual upload.
5. Connect repository:

```text
mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os
```

6. Select branch:

```text
main
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

## Verification after auto deploy

After Hostinger completes the deployment, verify:

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

## Fallback workflow

The repository contains:

```text
.github/workflows/deploy-hostinger-node.yml
```

This workflow is manual-only. It is not triggered by push and should be used only if Hostinger Auto Deploy is degraded.

## Security notes

- Do not commit `.env`, API keys, private keys, Hostinger credentials, or Cloudflare tokens.
- Keep secrets in hPanel environment variables or GitHub Secrets for fallback only.
- Avoid manual ZIP uploads except for emergency rollback.
- Verify `/connector-agent/version` after every deployment that affects local connector behavior.

## Rollback

Preferred rollback is Hostinger hPanel deployment history.

If the fallback workflow was used, rerun it against a known-good ref or restore through hPanel.
