# Development Environment Governance

## Purpose

`dev.mad4b.com` is the governed development/staging environment for testing repo-branch deployments before production. It is a platform runtime environment, not a customer brand site.

Production remains `auth.mad4b.com` and is expected to track `main`. Dev may track `dev` or another explicitly approved development branch, but the active branch and commit must be visible through deployment evidence before any production promotion.

## Environment contract

| Environment | Host | Git branch | Role |
|---|---|---|---|
| development | `dev.mad4b.com` | `dev` or governed active dev branch | Validate branch deployments, DB clone behavior, diagnostics, smoke tests |
| production | `auth.mad4b.com` | `main` | Platform control plane, production dispatcher, tenant/admin runtime |
| connector recovery | `connector.mad4b.com` | managed separately | Break-glass/local connector tunnel surface |

## Required dev evidence

A valid dev deployment should provide:

```text
environment_key = development
domain = dev.mad4b.com
github_owner = mad4bdigital-ai
github_repo = multi-business-multi-role-growth-intelligence-os
github_branch = <active dev branch>
commit_sha = <deployed commit>
deployment_mode = hostinger_git | github_actions_ssh | hostinger_node
hostinger_root = /home/u338416126/domains/dev.mad4b.com/<runtime-root>
validation_status = pass | warn | fail
```

The public/passive dispatcher schema for this server URL is:

```text
http-generic-api/openapi.gpt-action.dev-dispatcher.yaml
```

It exposes only:

```text
GET /health
GET /deployment-info
GET /dev/db/status   # backend auth required
```

## Promotion gate

A change may move from dev to production only when:

1. GitHub CI passes for the candidate branch or PR.
2. `dev.mad4b.com/health` is healthy.
3. `dev.mad4b.com/deployment-info` matches the expected branch and commit.
4. Protected dev DB/status checks pass when the change touches data source behavior.
5. Release readiness or targeted smoke tests pass through the production control plane.
6. The operator explicitly approves merge/promotion to `main` and production deploy.

## Operational boundaries

- Do not run production mutations through the dev diagnostics schema.
- Do not treat Hostinger hPanel branch metadata as governed evidence unless it is mirrored to `/deployment-info`, DB environment registry, or repo documentation.
- Do not use `dev.mad4b.com` as a fallback for production tenant traffic.
- Do not expose secrets in deployment metadata; report only branch, commit, runtime path class, and validation status.

## Current known state

As of the governance update, `dev.mad4b.com` exists in Hostinger as an enabled addon site and has a Cloudflare proxied CNAME path, but it needs explicit branch/deployment evidence to become fully governed. Use hPanel Git deployments to recover the earlier branch, then mirror that branch into this repository's deployment registry/docs and `/deployment-info`.
