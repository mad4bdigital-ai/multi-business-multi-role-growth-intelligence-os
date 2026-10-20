# Staging Backup — independent read-only policy identity

Tracking: [Issue #8534](https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/issues/8534).

## Scope

This change removes the wrong database identity dependency from the **read-only**
Staging backup-preflight CLI. The old CLI queried `platform_backup_policies`
using `runtime_app` and returned SQL 1142. It now **never** falls back to
`runtime_app`. A separate reader must be explicitly supplied.

No backup, dump, restore, approval, user creation, GRANT, migration, Production
mutation, or QA principal activation is performed by the new reader.

## Governed credential provision (separate owner/DB authority)

Before using the new reader, a Staging database owner must independently attest
the physical state of the four registry tables in the local **runtime-db**
service, without any Production connection. Existing Staging evidence includes
`ER_TABLEACCESS_DENIED_ERROR` on all four queries by the normal runtime user.
Do not interpret empty `information_schema.TABLES` for that user as absent tables.

Under an independently approved, audited Staging DB change, create a dedicated
login with **only** table-scoped SELECT rights on:

- `growth_runtime.platform_backup_policies`
- `growth_runtime.platform_backup_approvals`
- `growth_runtime.platform_backup_runs`
- `growth_runtime.platform_copy_locations`

No schema-wide SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP or GRANT OPTION.
Do not modify the grants of `runtime_app` or the existing Control Plane writer.
This repository change deliberately includes **no** DDL/GRANT execution script.

## Ephemeral readback

Use a one-shot Local Connector execution container on the private
`http-generic-api_default` Docker network from the approved exact image.
Provide the reader credentials only from an independently owned local private
environment source (never Git, command-line parameters, a PR comment, or the
long-running app environment). No public ports need to be published.

The private one-shot environment must include:
`NODE_ENV=staging`,
`DEPLOYMENT_ENVIRONMENT=staging_local_windows_docker`,
`DEPLOY_COMMIT=<certified exact Staging SHA>`,
`DB_HOST=runtime-db`,
`DB_NAME=<local runtime schema>`,
`DB_USER=<normal runtime principal name, not its password>`,
`CONTROL_PLANE_WRITE_DB_USER=<existing dedicated writer principal name>`,
`STAGING_BACKUP_POLICY_READER_ENABLED=true`,
`STAGING_BACKUP_POLICY_READER_HOST=runtime-db`,
`STAGING_BACKUP_POLICY_READER_DATABASE=<local runtime schema>`,
`STAGING_BACKUP_POLICY_READER_USER=<separate least-privileged principal>`,
`STAGING_BACKUP_POLICY_READER_PASSWORD=<private secret>`.
The optional reader port must equal `3306`.

Run `node scripts/staging-backup-restore-readiness.mjs
--expected-source-sha=<certified exact Staging SHA>` from that container.

The executable validates the actual `DATABASE()` / `CURRENT_USER()`,
reads `SHOW GRANTS FOR CURRENT_USER()`, refuses extra privileges or missing
grants, and executes only the existing fixed SELECT inventory SQL.
Exit code 2 is intentional. A policy census **never authorizes** export, restore
or QA fixtures. If the independent reader cannot complete an authorized query,
`policy_inventory_verified=false`, `existing_policy_count=null`, and
`BACKUP_POLICY_INVENTORY_UNVERIFIED` indicate that policy existence is unknown;
this is not evidence that the registry contains zero policies. Only a successful
census with `policy_inventory_verified=true` and no matching policy may report
`DATABASE_BACKUP_POLICY_MISSING` and `existing_policy_count=0`. Actual policy
activation, backup execution and QA fixture writes remain independently gated.

## Tests and independent acceptance

`npm run test:staging:backup-reader` verifies Staging identity, dedicated
principal, narrow grants, no runtime fallback, redacted failures, and compatibility
with the previous 13-case preflight suite.

This code can pass while the real environment remains blocked. Only after
separate owner-signed `backup_apply` approval, approved destination, independently
custodied keys, fresh encrypted Staging backup and isolated restore of the
**same artifact**, and cleanup evidence may QA apply or OA/MC live tests proceed.
Production promotion remains blocked.
