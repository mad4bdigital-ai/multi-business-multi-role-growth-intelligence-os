# Windows Docker Staging — quiescent startup and dedicated writer

## Authority / scope

This is a **Staging-only** runtime contract for `NODE_ENV=staging` and
`DEPLOYMENT_ENVIRONMENT=staging_local_windows_docker`.
No Production migration, DB mutation, credential creation, or automatic deployment
is authorized by this change.

The fixed baseline image from `34cce2e5` is preserved as immutable evidence.
**It does not contain this fix and must not be deployed as the solution.**

## Policy

- Default: `STAGING_STARTUP_BACKGROUND_MUTATIONS_MODE=quiescent`.
- The Staging Compose override pins that value, so changing a local env file cannot re-enable startup jobs.
- `startDynamicAuditScheduler` and `startOpenApiEndpointInventorySync` exit before obtaining a database connection when quiescent.
- OpenAPI auto sync additionally has `OPENAPI_ENDPOINT_INVENTORY_SYNC_DISABLED=true` pinned in Staging Compose.
- Any unexpected policy value fails closed.
- `CONTROL_PLANE_WRITE_AUTHORITY_ENABLED=true` is required for the local Windows Staging runtime. The dedicated writer user cannot equal `DB_USER`, `root`, or `admin`; required dedicated fields are checked by `resolveControlPlaneWriteDbConfig`.
- The dedicated write host must be `runtime-db`, the Runtime host must also be `runtime-db`, and `CONTROL_PLANE_WRITE_DB_NAME` must exactly equal `DB_NAME`. Staging cannot use an external/Production target for Control Plane writes.
- Missing writer identity fails startup before the HTTP listener opens. No automatic grant or identity provisioning occurs.
- `allow_governed` is the only explicit background-startup opt-in. Enabling it requires separately reviewed source/Compose changes and a governed release.

## Required private Staging configuration (do not commit values)

Provision a distinct least-privileged MariaDB principal locally and configure
`CONTROL_PLANE_WRITE_AUTHORITY_ENABLED=true` and these existing fields in the
approved Staging secret/environment source:

- `CONTROL_PLANE_WRITE_DB_HOST=runtime-db`
- `CONTROL_PLANE_WRITE_DB_NAME` (same value as `DB_NAME`)
- `CONTROL_PLANE_WRITE_DB_USER` (distinct from `DB_USER`, non-root)
- `CONTROL_PLANE_WRITE_DB_PASSWORD` (secret; never log or commit)
- Optional connection limits from the existing authority contract.

Validate server-observed `DATABASE()`, `CURRENT_USER()`, and scoped `SHOW GRANTS`
from the **intended** Staging network/session before any release attempt. Plan grants
separately under explicit Staging database governance and minimum privilege;
neither this PR nor its CI may create users or apply grants.

## Gated release sequence

1. GitHub CI and exact-head source review, owner attestation, and explicit Staging authorization.
2. Certify new exact-head immutable image, including image labels, in-image manifest, Git tree/context provenance.
3. Validate Staging dedicated writer credentials, local DB target, schema privileges, and startup policy with secrets redacted. Verify backup and restore readiness.
4. Re-run three-file Compose parity: `docker-compose.yml`,
   `docker-compose.staging.yml`, and
   `docker-compose.staging.windows-service.yml`. Compare every non-app service,
   bind mount, secret, and localhost-only port.
5. Pin app to the **new** content-addressed image and supply matching runtime
   provenance fields; do not regenerate or rebuild image during deploy.
6. If separately authorized, replace the `app` service **only**, without
   `--build` or starting/recreating databases, Redis, or tunnel services.
7. Accept only after app health, manifest readback, local host ingress,
   OAuth/MCP regression, scheduler skip evidence, database observability, and
   five-service identity checks. Fail and roll back to the prior image and
   matching prior app-only environment on gate failure.

## Limits and remaining risk

Quiescent mode suppresses the two known **startup background** writers only.
It does **not** provide a universal database read-only guarantee. Authorized API
requests, other module imports, external applications, manual jobs, or
independently scheduled processes may still write. A full no-write claim requires
a separate end-to-end inventory and read-only role/execution evidence.
Restoring the older app image may also restore its original background tasks;
rollback should be monitored.

**No Staging or Production deployment is part of this branch.**

## Tests

`cd http-generic-api && npm run test:staging:startup-safety`

The canonical CI test manifest also includes
`node test-staging-startup-mutation-policy.mjs`.
