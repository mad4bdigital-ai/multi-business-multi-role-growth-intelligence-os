# Runtime Breakglass Environment Contract

This document defines the repository-owned Runtime Breakglass boundary for the two supported runtime environments. The catalog is intentionally independent of the database so that status and planning remain available when a target database has no schema, no ledger, or no readable application catalog.

## Environment authority

| Environment | Source branch | Runtime and deployment authority | Fixed target source | Mutation authority | Readback authority |
|---|---|---|---|---|---|
| `staging` | `main` | Local Windows device running Docker Compose | `docker_local` | Local operator only; Admin route is read-only | Local Docker health, version, deployment manifest, and staging certification |
| `production` | `Production` | Hostinger Cloud Business Plan with Hostinger Auto Deploy from the `Production` branch | `repository_allowlist` for apply; `runtime_env` for generic dry-run discovery; `host_local_role_env` for host-side full inspection only | Reviewed GitHub workflow for repository-bound apply; explicit Hostinger CLI for role-local inspection | Hostinger parity plus bounded GitHub workflow evidence or secret-free host-local evidence |

The authoritative implementation is `http-generic-api/config/runtime-breakglass-catalog.json`. The existing environment authority is defined by `http-generic-api/config/deployment-branch-policy.json`, `http-generic-api/config/domain-family-policy.json`, and `autopilot-portable-staging/auto-deploy-policy.json`.

## Contract families

The catalog exposes separate contracts rather than a free-form executor:

| Contract | Purpose | Staging | Production | Database requirement |
|---|---|---|---|---|
| `runtime_diagnose` | Read-only route, identity, schema, and readiness evidence | Plan or local dry-run | Plan, fixed workflow dry-run, or explicit host-local full inspection | No database access for plan; dry-run follows the selected environment authority and role topology |
| `schema_repair` | Reviewed incident-schema repair | Local operator path only | GitHub workflow with repository allowlist and typed confirmation | Existing governed bootstrap prerequisites |
| `grant_repair` | Reviewed least-privilege grant repair | Local operator path only | GitHub workflow with independent grant confirmation | Existing schema and same-cycle grant readback |
| `empty_database_rebuild` | Baseline schema/bundle rebuild for a missing or zero-table database | Local operator path only | GitHub workflow with repository allowlist | `zero_tables` classification only |
| `full_database_rebuild` | Reviewable plan and dry-run for a complete rebuild | Plan or dry-run | Plan or dry-run | Non-empty destructive replacement is not routable |

The implementation never accepts a database name, credential, repository, workflow file, ref, or raw environment value from the caller. Production target identifiers are resolved inside the reviewed GitHub workflow from repository-owned environment variables. The workflow does not print those values or place them in uploaded evidence.

## Surfaces and authority

`GET /admin/runtime-breakglass/status`, `POST /admin/runtime-breakglass/runs`, and `GET /admin/runtime-breakglass/runs/{run_id}` are Admin Core surfaces. They require the dedicated backend service API key and reject user JWT access. The POST route is a bounded broker, not a generic GitHub executor: it accepts only catalog keys and modes, validates the current Production branch SHA before dispatch, sets a server-generated correlation id, and reads back only the fixed workflow identity and bounded artifact metadata.

`GET /deployment-info/runtime-breakglass-status` and `POST /deployment-info/runtime-breakglass-plan` are Host-internal service-key routes. They are database-independent and read-only. Staging requests are explicitly reported as local Windows/Docker operator work and are never dispatched to the Production workflow.

## Safety invariants

The following invariants are part of the contract and are tested by `http-generic-api/test-runtime-breakglass-broker.mjs`:

1. Environment selection is explicit and cannot fall back from Production to Staging or from Staging to Production.
2. Staging is fixed to `main`, local Windows/Docker, the staging hostname family, and a local operator authority.
3. Production is fixed to `Production`, Hostinger Auto Deploy, the production hostname family, and the reviewed workflow dispatched from `main`.
4. `runtime_env` is a Hostinger-side discovery source for dry-run only. It cannot be used for migration or grant apply.
5. Migration and grant apply are independent operations. Combined apply is not represented by this catalog.
6. `full_database_rebuild` is plan/dry-run only. Replacement of a non-empty database requires a separate destructive review and is not available through these routes.
7. Every non-plan Production run requires an exact 40-character Production SHA, a typed operation confirmation where applicable, a bounded idempotency key, and a readback binding.
8. Secrets, credential values, raw `.env` content, raw database identifiers, raw logs, and connection strings are excluded from responses and evidence.

This contract does not deploy, restart, migrate, grant, modify GitHub or Hostinger secrets/variables, invoke a Hostinger endpoint, or promote `Production`. Those actions remain separate operational approvals.
