# Governance DB Privilege Readiness Runbook

## Purpose

This runbook is the Production verification companion to Issue #6813 and the Governance DB writer authority source repair.

It verifies that an already-provisioned dedicated Governance DB writer has the exact reviewed table-scoped privilege matrix and no broader global, schema-wide, unrelated-table, or extra-table privileges.

This runbook and its workflow do **not** create MariaDB accounts, execute `GRANT`, write secrets, deploy Production, mutate application data, or authorize Migration 1050 Apply.

## Required privilege matrix

| Table | Required privileges |
|---|---|
| `capability_resolution_envelope_ledger` | `SELECT, INSERT, UPDATE` |
| `approval_holds` | `INSERT` |
| `governed_migration_authorization_registry` | `SELECT, INSERT, UPDATE` |
| `capability_apply_authorization_policy_registry` | `SELECT, INSERT, UPDATE` |
| `runtime_dispatch_certification_registry` | `SELECT, INSERT, UPDATE` |
| `governed_migration_ledger` | `SELECT` |

The dedicated principal must not carry schema-wide privileges, unrelated table privileges, `GRANT ALL`, `DROP`, `ALTER`, `CREATE`, `DELETE`, `FILE`, `PROCESS`, `SUPER`, account-management authority, or equivalent broad administrative authority.

The readiness probe expects direct table grants for the dedicated principal. Do not substitute a broad role or schema-level grant merely to make the probe pass.

## Preconditions

Before the live probe can be run, all of the following must already be true through separately governed operations:

1. The dedicated MariaDB Governance writer principal has been created outside the application runtime.
2. Only the reviewed table/operation matrix has been granted.
3. The repaired source has been promoted through the normal `main -> Production` lifecycle.
4. The GitHub `Production` environment contains the runtime DB secrets needed to resolve Environment Authority and the dedicated Governance DB credentials.
5. The exact current `Production` branch SHA is known.

No credential value should be placed in workflow inputs, comments, logs, artifacts, or issue text.

## Workflow

Use the manual workflow:

`Governance DB Privilege Readiness`

It requires two non-secret inputs:

- `expected_production_sha`: the exact 40-character SHA currently at the `Production` branch head.
- `confirm`: exactly `PROBE_GOVERNANCE_DB_PRIVILEGES`.

The workflow fails closed if the supplied SHA does not exactly match the live `Production` ref before the database-secret-bearing probe step is reached.

## What the probe does

The live script first runs `resolveGovernanceProductionPreflight()` and therefore requires:

- a dedicated `GOVERNANCE_DB_USER` / `GOVERNANCE_DB_PASSWORD` identity with no fallback to `DB_USER` / `DB_PASSWORD`;
- Environment Authority resolving `production_branch = Production`;
- Environment Authority resolving `promotion_target_branch = Production`.

After preflight, it opens the dedicated Governance DB connection and performs only read-only metadata operations:

- connection ping;
- `CURRENT_USER()` and `DATABASE()` identity/database consistency readback;
- `information_schema.USER_PRIVILEGES` readback for the current principal;
- `information_schema.SCHEMA_PRIVILEGES` readback for the current principal;
- `information_schema.TABLE_PRIVILEGES` readback for the current principal.

It performs no `INSERT`, `UPDATE`, `DELETE`, DDL, `CREATE USER`, `GRANT`, migration SQL, provider mutation, deployment, or restart.

The output intentionally excludes the MariaDB username, password, host, database name, raw grant rows, and secret values. It reports only bounded readiness booleans, counts, and missing privileges from the repository-defined expected matrix.

## Success contract

A successful probe requires all of these conditions:

- every required table privilege is present;
- no unexpected global privilege exists other than `USAGE`;
- no schema-wide privilege exists;
- no privilege exists on an unrelated table or schema;
- no extra privilege exists on one of the allowed tables;
- the connected database matches the configured Governance DB target;
- the Production Environment Authority preflight is valid.

Any mismatch fails closed with `GOVERNANCE_DB_PRIVILEGE_READINESS_FAILED` or another typed no-secret preflight/probe error.

## After a successful probe

A green privilege readiness run is necessary but not sufficient to close Issue #6813. Continue with the independently governed closure sequence:

1. re-read governed Migration 1050 ledger/state;
2. obtain a **fresh** Migration 1050 readiness authorization;
3. run the governed readiness/dry-run lifecycle;
4. confirm authorization bootstrap and dry-run progress without broadening the ordinary runtime DB identity;
5. keep Migration Apply as a separate authorization.

Do not reuse the authorization consumed by run `31379417191`.
