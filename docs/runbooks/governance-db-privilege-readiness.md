# Governance DB Privilege Readiness Runbook

## Purpose

This runbook is the Production verification companion to Issue #6813 and the Governance DB writer authority source repair.

It verifies that a provider-capable, already-provisioned dedicated Governance DB writer has the exact reviewed table-scoped privilege matrix and no broader global, schema-wide, unrelated-table, extra-table, column-level, or role-derived privileges.

The Production database credentials remain in the runtime environment. The GitHub readiness workflow must not duplicate `DB_*` or `GOVERNANCE_DB_*` credential values into GitHub Actions secrets merely to perform this proof.

This runbook and its workflow do **not** create MariaDB accounts, execute `GRANT`, write secrets, deploy Production, mutate application data, migrate providers, redesign the datastore, or authorize Migration Apply.

## Provider-capability gate

Before credential readiness or a privilege probe is meaningful, `resolveGovernanceProductionPreflight()` evaluates the repository authority:

`http-generic-api/config/governance-db-provider-capabilities.json`

The current Production policy is `hostinger_web_cloud_mysql` / `managed_hpanel_mysql` and does not satisfy the dedicated Governance writer contract. The expected fail-closed code is:

`GOVERNANCE_DB_PROVIDER_CAPABILITY_UNSUPPORTED`

While that code is active:

- do not request or copy Governance credentials merely to make the probe progress;
- do not copy `DB_USER` into `GOVERNANCE_DB_USER`;
- do not broaden the ordinary runtime account;
- do not repeat Migration readiness expecting a different result;
- choose a separately reviewed provider migration or Governance datastore redesign first.

See `docs/governance-db-provider-capability.md` for the remediation boundary.

## Required privilege matrix

After a future provider remediation makes the provider-capability gate truthfully supported, the dedicated principal must have exactly:

| Table | Required privileges |
|---|---|
| `capability_resolution_envelope_ledger` | `SELECT, INSERT, UPDATE` |
| `approval_holds` | `INSERT` |
| `governed_migration_authorization_registry` | `SELECT, INSERT, UPDATE` |
| `capability_apply_authorization_policy_registry` | `SELECT, INSERT, UPDATE` |
| `runtime_dispatch_certification_registry` | `SELECT, INSERT, UPDATE` |
| `governed_migration_ledger` | `SELECT` |
| `platform_resource_authority_bindings` | `SELECT, INSERT` |

The dedicated principal must not carry schema-wide privileges, unrelated table privileges, column-level grants, applicable roles, `GRANT ALL`, `DROP`, `ALTER`, `CREATE`, `DELETE`, `FILE`, `PROCESS`, `SUPER`, account-management authority, or equivalent broad administrative authority.

The readiness probe expects direct table grants for the dedicated principal. Do not substitute a role, column-level grant, broad role, or schema-level grant merely to make the probe pass.

## Preconditions

Before the live privilege probe can pass, all of the following must already be true through separately governed operations:

1. The Production database provider capability policy is truthfully `supported` for a dedicated Governance database, its independent writer principal, and exact direct table-scoped grants.
2. The dedicated MariaDB Governance writer principal has been created outside the application runtime.
3. Only the reviewed table/operation matrix has been granted directly to that principal, with no role or column-grant path.
4. The repaired source and runtime-readback readiness tooling have been promoted through the normal `main -> Production` lifecycle.
5. The Production Node.js runtime contains the ordinary runtime `DB_*` configuration and the dedicated Governance DB credentials required by the writer contract.
6. The exact current `Production` branch SHA is known and the running deployment reports that same SHA and branch.

The current Hostinger managed Production fails prerequisite 1 and must not skip ahead to credential or GRANT work.

Required dedicated Governance database identity after provider remediation:

- `GOVERNANCE_DB_NAME`
- `GOVERNANCE_DB_USER`
- `GOVERNANCE_DB_PASSWORD`

The Governance username must be distinct from `DB_USER`. An exact same username is rejected with `GOVERNANCE_DB_IDENTITY_NOT_DEDICATED`.

Physical connection fields may use only the bounded host/port fallbacks when appropriate:

- `GOVERNANCE_DB_HOST` -> physical `DB_HOST`
- `GOVERNANCE_DB_PORT` -> physical `DB_PORT`, then `3306`
- `GOVERNANCE_DB_NAME` -> **no fallback**; it must name the independent Governance database

`GOVERNANCE_DB_NAME` must be distinct from `DB_NAME`; the application rejects both a missing Governance database name and a name equal to the ordinary Runtime database. The Governance database must contain only the reviewed Governance-owned tables for the relevant contract, and its writer/readback behavior must be tested independently.

No credential value should be placed in workflow inputs, comments, logs, artifacts, issue text, or public runtime responses.

## Workflow

Use the manual workflow:

`Governance DB Privilege Readiness`

It requires two non-secret inputs:

- `expected_production_sha`: the exact 40-character SHA currently at the `Production` branch head.
- `confirm`: exactly `PROBE_GOVERNANCE_DB_PRIVILEGES`.

The workflow fails closed if the supplied SHA does not exactly match the live `Production` ref before evidence collection. It then checks out that exact Production source for the no-database regression and performs a public GET against:

`/deployment-info?include_governance_db_readiness=1`

The running Production process performs the bounded readiness path with its runtime-local environment. Provider capability is evaluated before credential readiness. If provider capability is unsupported, no Governance database connection or SQL readback is attempted.

When provider capability is supported, the runtime may continue to the read-only database metadata probe. The GitHub runner receives only the bounded no-secret projection. After collecting evidence, the workflow re-reads the protected `Production` ref and fails closed if it moved.

The workflow does not receive or connect with Production database credentials.

## Runtime evidence boundary

The normal `/deployment-info` response is unchanged unless `include_governance_db_readiness=1` is explicitly requested.

The opt-in readiness projection is cached for a bounded interval so repeated public requests cannot create an unbounded database-probe loop. The public projection includes only verdict and safety fields such as:

- readiness status and a bounded typed error code;
- exact Production environment-authority booleans when that stage is reached;
- dedicated Governance identity configured boolean when that stage is reached;
- exact privilege-matrix verdict when that stage is reached;
- database-connection and SQL-readback performed booleans;
- explicit `sql_mutation_performed=false`;
- explicit `migration_apply_performed=false`;
- explicit `provider_mutation_performed=false`;
- explicit `deployment_performed=false`;
- explicit `secrets_included=false`.

It does **not** expose the MariaDB username, password, host, database name, raw privilege rows, role names, missing-grant details, or secret values.

## What the runtime probe does

The live service first runs `resolveGovernanceProductionPreflight()` in this order:

1. assert the repository-defined Production database provider can represent the dedicated Governance writer contract;
2. require a distinct `GOVERNANCE_DB_USER` / `GOVERNANCE_DB_PASSWORD` identity with no fallback to `DB_USER` / `DB_PASSWORD`;
3. require Environment Authority resolving `production_branch = Production`;
4. require Environment Authority resolving `promotion_target_branch = Production`.

If the provider gate fails, the readiness service stops with bounded no-secret evidence before a database connection.

Only after all preflight stages pass does it open the dedicated Governance DB connection and perform read-only metadata operations:

- connection ping;
- `CURRENT_USER()` and `DATABASE()` identity/database consistency readback;
- `information_schema.USER_PRIVILEGES` readback for the current principal;
- `information_schema.SCHEMA_PRIVILEGES` readback for the current principal;
- `information_schema.TABLE_PRIVILEGES` readback for the current principal;
- `information_schema.COLUMN_PRIVILEGES` readback for the current principal;
- `information_schema.APPLICABLE_ROLES` readback for the current principal.

It performs no `INSERT`, `UPDATE`, `DELETE`, DDL, `CREATE USER`, `GRANT`, migration SQL, provider mutation, deployment, or restart.

## Success contract

A successful probe requires all of these conditions:

- the Production provider capability policy supports the dedicated writer contract;
- runtime deployment SHA exactly equals the authorized current `Production` SHA;
- runtime deployment branch is exactly `Production`;
- the Governance username is distinct from the ordinary runtime username;
- every required table privilege is present;
- no unexpected global privilege exists other than `USAGE`;
- no schema-wide privilege exists;
- no privilege exists on an unrelated table or schema;
- no extra privilege exists on one of the allowed tables;
- no column-level privilege exists;
- no applicable MariaDB role exists for the principal;
- the connected database matches the configured Governance DB target;
- the Production Environment Authority preflight is valid;
- the protected `Production` ref remains unchanged after runtime evidence collection.

Any mismatch fails closed with bounded no-secret evidence.

## After a successful probe

A green privilege readiness run is necessary but not sufficient to close Issue #6813. Continue with the independently governed closure sequence:

1. re-read the governed migration ledger/state;
2. obtain a **fresh** governed migration readiness authorization for the exact migration being advanced;
3. run the governed readiness/dry-run lifecycle;
4. confirm authorization bootstrap and dry-run progress without broadening the ordinary runtime DB identity;
5. keep Migration Apply as a separate authorization.

Do not reuse a previously consumed migration readiness authorization.
