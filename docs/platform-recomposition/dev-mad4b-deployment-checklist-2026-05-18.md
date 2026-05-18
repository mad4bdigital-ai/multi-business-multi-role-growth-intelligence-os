# dev.mad4b.com Deployment Checklist

Date: 2026-05-18
Branch: `dev-autopilot-routing`

## Current state

DNS has been created:

```text
dev.mad4b.com CNAME auth.mad4b.com
proxied = true
```

This only routes traffic to the same Hostinger origin. It does **not** by itself make `dev.mad4b.com` read from the dev branch.

## Required Hostinger separation

Create a separate Hostinger Node.js app for:

```text
dev.mad4b.com
```

It must use a separate checkout/path from production:

```text
production auth path: HOSTINGER_AUTH_NODE_PATH
dev path:        HOSTINGER_DEV_NODE_PATH
```

Recommended path shape:

```text
/home/u338416126/domains/dev.mad4b.com/nodejs
```

The app entry point should remain:

```text
http-generic-api/server.js
```

The code deployed to that directory must come from:

```text
repo:   mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os
branch: dev-autopilot-routing
```

## GitHub Actions support

The fallback workflow on this branch now supports:

```text
workflow: .github/workflows/deploy-hostinger-node.yml
target:   dev
```

The `deploy-dev` job uses:

```text
environment: hostinger-dev
```

Required GitHub environment/repository secrets:

```text
HOSTINGER_SSH_PRIVATE_KEY
HOSTINGER_SSH_HOST
HOSTINGER_SSH_USER
HOSTINGER_SSH_PORT
HOSTINGER_DEV_NODE_PATH
HOSTINGER_DEV_RESTART_CMD
```

`HOSTINGER_DEV_RESTART_CMD` may be empty if Hostinger restart can be triggered by touching:

```text
tmp/restart.txt
```

## Validation

After deployment:

```bash
curl -fsS https://dev.mad4b.com/health
```

Expected:

```json
{ "ok": true, "status": "healthy" }
```

Optional follow-up endpoint to add:

```text
GET /deployment-info
```

Should report:

```text
branch = dev-autopilot-routing
host   = dev.mad4b.com
```

## Safety rule

Do not point `dev.mad4b.com` to the same running Node process as `auth.mad4b.com` for Autopilot development. That would test DNS only, not branch-isolated runtime behavior.

## Next work on this branch

1. Add `/deployment-info` endpoint for branch/runtime verification.
2. Add route selector fallback using `local_connector_device_routes`.
3. Add Desktop Manager route registration API.
4. Add installer route smoke test that does not print script contents or secrets.
