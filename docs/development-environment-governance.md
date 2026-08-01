# Development Environment Governance

## Purpose

`dev.mad4b.com` is reserved for the governed development/staging runtime. It is not a customer brand site and must not receive production traffic.

`main` is the source branch for the planned local staging runtime at `dev.mad4b.com`. It is not the Hostinger production deployment branch.

The machine-readable branch authority is `http-generic-api/config/deployment-branch-policy.json`.

## Environment contract

| Environment | Host | Source branch | Runtime/deployment path | Current status |
|---|---|---|---|---|
| staging | `dev.mad4b.com` | `main` | Local device | Planned |
| production | `auth.mad4b.com` | `Production` | Hostinger Auto Deploy | Active production path |
| connector recovery | `connector.mad4b.com` | Managed separately | Cloudflare Tunnel to local Windows connector | Independent recovery path |

## Staging lifecycle

The local staging runtime will be built in a future governed implementation. Until then:

- do not configure `dev.mad4b.com` as a Hostinger Auto Deploy target;
- do not treat it as available merely because DNS exists;
- do not use it as a production fallback;
- do not route tenant or admin production traffic through it;
- do not claim staging validation without live local-runtime evidence.

## Required future staging evidence

A valid local staging deployment must provide bounded, non-secret evidence:

```text
environment_key = staging
domain = dev.mad4b.com
github_owner = mad4bdigital-ai
github_repo = multi-business-multi-role-growth-intelligence-os
github_branch = main
commit_sha = <exact deployed main commit>
deployment_mode = local_staging_runtime
runtime_location = local_device
validation_status = pass | warn | fail
```

Required health surfaces should include:

```text
GET /health
GET /version
GET /deployment-info
GET /dev/db/status   # protected backend authorization
```

Hostname or Git branch inference alone is incomplete evidence. The runtime must report explicit branch, commit, environment, and local runtime identity.

## Promotion relationship

Staging and production use different deployment authorities:

```text
main
  -> planned local staging runtime at dev.mad4b.com
  -> governed source-pinned promotion candidate
  -> protected Production
  -> Hostinger Auto Deploy to auth.mad4b.com
```

A change may be promoted toward production only after:

1. exact-head GitHub CI passes for the intended `main` snapshot;
2. required generated artifacts are current;
3. local staging validation passes when the staging runtime exists and the change requires it;
4. a source-pinned candidate preserves the current `Production` head and equals the approved `main` tree;
5. exact candidate CI passes;
6. review and typed approval target the same candidate SHA;
7. the candidate is merged to protected `Production` without force push;
8. Hostinger deploys the resulting `Production` SHA;
9. production `/health`, `/version`, and `/deployment-info` match that SHA.

Until local staging exists, its missing evidence must be reported honestly. It must not be silently replaced by production probes or inferred from CI.

## Operational boundaries

- Staging must use separate local runtime configuration from production.
- Staging must not reuse production traffic routing as its normal path.
- Staging diagnostics must not authorize production mutations.
- Secrets must not appear in deployment metadata.
- Production environment variables remain in Hostinger hPanel.
- Local staging secrets must remain in the governed local secret boundary.
- `connector.mad4b.com` remains independent from both staging and Hostinger production.

## Database boundary

The staging implementation must define its database strategy before activation. Shared-production mutation through a staging runtime is prohibited.

Permitted future designs require explicit governance, such as:

- read-only production-compatible diagnostics;
- isolated staging schema/database;
- bounded synthetic fixtures;
- explicitly approved shadow comparisons.

The existence of `main` code or a local process never authorizes migration application.

## Current state classification

Current intended classification:

```text
dev.mad4b.com = planned_local_staging
source_branch = main
hostinger_auto_deploy = false
production_traffic_allowed = false
```

Production remains:

```text
auth.mad4b.com = production
source_branch = Production
deployment_mode = hostinger_auto_deploy
```
