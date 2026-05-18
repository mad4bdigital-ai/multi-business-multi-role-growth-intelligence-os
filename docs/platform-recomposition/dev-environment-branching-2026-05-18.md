# Dev Environment Branching

Date: 2026-05-18
Branch: `dev-autopilot-routing`

## Purpose

This branch isolates local connector Autopilot routing work from production `main`.

Production:

```text
auth.mad4b.com -> main branch
local.mad4b.com -> Auth runtime/local GPT schema alias
connector.mad4b.com -> admin break-glass connector
```

Development target:

```text
dev.mad4b.com -> dev-autopilot-routing branch
```

## Required separation

`dev.mad4b.com` must not serve the same Node.js process or checkout as `auth.mad4b.com`.

It should run from a separate Hostinger Node.js app or separate checkout directory configured to pull:

```text
repo   = mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os
branch = dev-autopilot-routing
app    = http-generic-api/server.js
```

## Validation targets

Use the dev runtime to validate:

- `local_connector_device_routes`
- route selector fallback
- Desktop Manager route registration
- token-gated installer regression tests
- tenant-safe local connector onboarding

before merging to `main`.

## Merge rule

Only merge back to `main` after:

1. `dev.mad4b.com/health` is healthy.
2. Autopilot route selector smoke tests pass.
3. Installer route smoke tests pass without printing secrets.
4. Tenant local gateway tests pass.
5. Rollback path is documented.
