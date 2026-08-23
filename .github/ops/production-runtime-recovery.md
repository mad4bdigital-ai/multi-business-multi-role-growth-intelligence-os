# Production Runtime Recovery Control Plane

## Purpose

This recovery path moves the orchestration source of truth to GitHub Environment variables and secrets. It does **not** require the application runtime SQL registry, migration ledger, or target tables to be readable before GitHub can select the recovery plan.

The workflow supports three modes:

- `verify`: prove the exact protected Production SHA is live and execute read-only probes.
- `primary`: deploy the exact protected Production SHA directly from GitHub to the hosting provider, prove `/version` and `/deployment-info`, then execute the already-governed runtime recovery operations.
- `fallback`: deploy and prove the exact SHA, then use a protected bootstrap database principal to apply an explicit repository migration sequence and least-privilege grants from GitHub configuration.

No mutation occurs unless `apply_execution=true` **and** the operator supplies the exact confirmation string:

```text
RECOVER:<strategy>:<40-character-production-sha>
```

## Why the control plane is outside SQL

A recovery system cannot depend on the same SQL schema it is expected to recover. `RUNTIME_RECOVERY_TARGETS_JSON` therefore describes database targets and migration order in GitHub. SQL is a recovery **target**, not the orchestration registry.

The fallback operator can work with:

- an existing database whose application tables are incomplete;
- an existing empty database;
- a missing database only when database creation is explicitly enabled in **both** the GitHub environment variable and the selected target plan.

The operator never invents schema. For an empty database, the target plan must list the canonical repository bootstrap migrations in dependency order. A migration such as `20260815_custom_gpt_mcp_catalog_levels.sql` is intentionally blocked until its base tables exist.

## GitHub Environment

Use the protected GitHub Environment named `Production` so normal environment approvals and secret isolation remain in effect.

### Release and deployment variables

| Variable | Purpose |
| --- | --- |
| `PRODUCTION_SOURCE_BRANCH` | Protected release branch. Recommended: `Production`. |
| `PRODUCTION_BASE_URL` | Live application base URL. Current expected value: `https://auth.mad4b.com`. |
| `PRODUCTION_DEPLOY_URL` | Direct hosting-provider deployment endpoint. This must be GitHub -> provider, not GitHub -> stale application runtime. |
| `PRODUCTION_DEPLOY_METHOD` | Provider method, normally `POST`. |
| `PRODUCTION_DEPLOY_BODY_JSON` | Provider request body template. Supports `{{repository}}`, `{{branch}}`, `{{sha}}`, `{{target_id}}`, `{{run_id}}`, `{{run_attempt}}`. |
| `PRODUCTION_DEPLOY_AUTH_HEADER` | Header used by the provider credential, normally `Authorization`. |
| `HOSTINGER_DEPLOYMENT_TARGET_ID` | Provider target/site/deployment identifier if the provider API requires one. |
| `PRODUCTION_VERSION_PATH` | Default `/version`. |
| `PRODUCTION_DEPLOYMENT_INFO_PATH` | Default `/deployment-info`. |
| `PRODUCTION_VERIFY_ATTEMPTS` | Maximum deployment parity probes. Default `24`. |
| `PRODUCTION_VERIFY_INTERVAL_SECONDS` | Delay between parity probes. Default `10`. |

### Protected deployment secrets

| Secret | Purpose |
| --- | --- |
| `PRODUCTION_DEPLOY_AUTH_VALUE` | Hosting-provider API credential. |
| `PRODUCTION_PROBE_AUTH_VALUE` | Runtime credential used only for protected operational probes/steps. |

`PRODUCTION_DEPLOY_AUTH_VALUE` and `PRODUCTION_PROBE_AUTH_VALUE` must never be placed in JSON variables.

## Primary strategy

The primary strategy is preferred when the merged runtime recovery endpoints are live after rollout.

Order is fixed:

1. prove `expected_production_sha` is the current protected `Production` branch head;
2. deploy that exact SHA directly through `PRODUCTION_DEPLOY_URL`;
3. require both `/version` and `/deployment-info` to contain the exact SHA;
4. execute read-only `RUNTIME_RECOVERY_PROBES_JSON`;
5. execute `PRIMARY_GOVERNED_STEPS_JSON`;
6. execute `RUNTIME_RECOVERY_FINAL_PROBES_JSON`;
7. prove the protected Production branch head did not move during the run.

### Read-only probe example

Store the following shape in `RUNTIME_RECOVERY_PROBES_JSON`. Paths and request envelopes must match the deployed runtime contract.

```json
[
  {
    "name": "225 dry run",
    "method": "POST",
    "path": "/<governed-migration-route>",
    "body": {
      "migration": "225_sprint67_capability_resolution_envelope_ledger.sql",
      "mode": "dry_run"
    },
    "expected_status": 200,
    "expected_json": {
      "already_applied": true,
      "applies_sql": false
    }
  },
  {
    "name": "1048 dry run",
    "method": "POST",
    "path": "/<governed-migration-route>",
    "body": {
      "migration": "1048_transport_response_chunk_schema_recovery.sql",
      "mode": "dry_run"
    },
    "expected_status": 200,
    "expected_json": {
      "already_applied": true,
      "applies_sql": false
    }
  }
]
```

Do not copy placeholder paths into Production. Set them to the actual route exposed by the deployed recovery contract.

### Governed mutation steps

`PRIMARY_GOVERNED_STEPS_JSON` is a JSON array. Mutation entries must include `"mutation": true` so the phase cannot be confused with read-only probes. A safe sequence for the current incident is:

1. authorize `20260815_custom_gpt_mcp_catalog_levels.sql`;
2. dry-run it;
3. typed apply it;
4. read back ledger and schema;
5. dry-run least-privilege grant profile;
6. apply that grant profile;
7. re-read Session Context, MCP Catalog, response chunk persistence, Admin/System Tools, and operational tasks.

The exact request body stays in GitHub configuration so it can be changed without making SQL registry availability a prerequisite for orchestration.

## Fallback strategy

Use fallback only when the exact release is proven live but the runtime-mediated recovery path is unavailable, or when the database is too incomplete to supply its own recovery registry.

### Bootstrap connection variables and secrets

| Name | Type | Purpose |
| --- | --- | --- |
| `MYSQL_BOOTSTRAP_HOST` | variable | Direct MariaDB/MySQL hostname reachable from GitHub Actions. |
| `MYSQL_BOOTSTRAP_PORT` | variable | Default `3306`. |
| `MYSQL_BOOTSTRAP_USER` | secret | Temporary bootstrap principal with only the authority required to create the configured schema/grants. |
| `MYSQL_BOOTSTRAP_PASSWORD` | secret | Bootstrap password. |
| `RUNTIME_RECOVERY_ALLOW_CREATE_DATABASE` | variable | Global database-creation gate. Keep `false` unless an explicit empty/missing database bootstrap is intended. |
| `RUNTIME_RECOVERY_TARGETS_JSON` | variable | Explicit target, migration, postcondition, and least-privilege grant plan. |

The application `DB_USER` password is not required by the fallback operator. The target application principal is named in the plan only so the bootstrap principal can grant it the minimum privileges.

### Existing runtime database target

The current `20260815` migration checksum is pinned below. It must not be applied unless the two base endpoint-tool tables already exist.

```json
[
  {
    "key": "runtime",
    "database": "u338416126_growthOS",
    "principal": "u338416126_growthOS",
    "principal_host": "%",
    "allow_create_database": false,
    "migrations": [
      {
        "file": "http-generic-api/migrations/20260815_custom_gpt_mcp_catalog_levels.sql",
        "expected_checksum": "528143808adac23eb457058c4c34dd95c4c5d462bca9ac4b170b1f19b2006681",
        "requires_tables": [
          "admin_platform_endpoint_tools",
          "tenant_platform_endpoint_tools"
        ],
        "done_when": [
          {
            "table": "admin_platform_endpoint_tools",
            "columns": ["mcp_catalog_level"]
          },
          {
            "table": "tenant_platform_endpoint_tools",
            "columns": ["mcp_catalog_level"]
          }
        ]
      }
    ],
    "grants": [
      {"table": "customer_sessions", "privileges": ["SELECT", "INSERT", "UPDATE"]},
      {"table": "gpt_session_turns", "privileges": ["SELECT", "INSERT", "UPDATE"]},
      {"table": "actions", "privileges": ["SELECT", "INSERT", "UPDATE"]},
      {"table": "dynamic_audit_scheduler_runs", "privileges": ["SELECT", "INSERT", "UPDATE"]},
      {"table": "execution_log", "privileges": ["SELECT", "INSERT", "UPDATE"]},
      {"table": "json_assets", "privileges": ["SELECT", "INSERT", "UPDATE"]}
    ]
  }
]
```

For Hostinger accounts where the authenticated database principal is represented with a narrower host pattern than `%`, set `principal_host` to the actual account host. The workflow does not discover or widen the account automatically.

### Completely empty database target

For a new/empty database, `migrations` must start with the canonical baseline schema migrations from the repository. The final part can then contain feature migrations such as `20260815`.

Conceptually:

```json
{
  "key": "new-runtime",
  "database": "<database-name>",
  "principal": "<application-principal>",
  "principal_host": "<actual-account-host>",
  "allow_create_database": true,
  "character_set": "utf8mb4",
  "collation": "<approved-repository-collation>",
  "migrations": [
    "<canonical-baseline-migration-1.sql>",
    "<canonical-baseline-migration-2.sql>",
    "...",
    {
      "file": "http-generic-api/migrations/20260815_custom_gpt_mcp_catalog_levels.sql",
      "expected_checksum": "528143808adac23eb457058c4c34dd95c4c5d462bca9ac4b170b1f19b2006681",
      "requires_tables": ["admin_platform_endpoint_tools", "tenant_platform_endpoint_tools"],
      "done_when": [
        {"table": "admin_platform_endpoint_tools", "columns": ["mcp_catalog_level"]},
        {"table": "tenant_platform_endpoint_tools", "columns": ["mcp_catalog_level"]}
      ]
    }
  ]
}
```

Replace every placeholder with an existing canonical migration or real database/account value before storing the JSON. The recovery operator deliberately rejects migration paths outside `http-generic-api/migrations` and will not copy a Production schema or synthesize DDL to fill gaps.

Database creation additionally requires:

```text
RUNTIME_RECOVERY_ALLOW_CREATE_DATABASE=true
```

and the selected target must contain:

```json
"allow_create_database": true
```

Both gates are required.

## Migration safety

The fallback operator enforces:

- migration path confinement to `http-generic-api/migrations`;
- optional exact SHA-256 checksum pinning;
- explicit required-table checks;
- explicit post-migration table/column checks;
- governed ledger checksum conflict detection when a ledger contract is configured;
- no reapplication when a configured ledger proves a migration is already applied;
- no silent acceptance when the ledger says applied but declared schema postconditions are missing.

For an empty database, bootstrap migrations may initially run without ledger metadata. If a later migration is configured as ledger-required, the canonical `schema_migrations` table must already exist before that step. The operator does not create an ad-hoc replacement ledger.

## Grant safety

Fallback grants are restricted in code to:

```text
SELECT, INSERT, UPDATE
```

The operator:

- grants only named tables from the selected target plan;
- never issues `GRANT ... ON database.*`;
- never grants DDL privileges to the application principal;
- refuses privileges outside the three-value allow-list;
- stops when a required grant table is absent instead of treating absence as success.

## Recommended current incident sequence

### Phase A — no mutation

Run:

```text
strategy=primary
apply_execution=false
expected_production_sha=<exact current Production SHA>
```

Review the emitted plan and confirm all GitHub Environment variables point at Production.

### Phase B — rollout and governed recovery

After approval, run:

```text
strategy=primary
apply_execution=true
confirmation=RECOVER:primary:<exact current Production SHA>
```

Success requires the exact SHA on both deployment identity endpoints before the workflow is allowed to execute the configured governed mutation steps.

### Phase C — fallback only if Primary remains unavailable

First run fallback in plan mode:

```text
strategy=fallback
apply_execution=false
target_key=runtime
```

After reviewing the explicit migration/grant plan and confirming the bootstrap credential scope, run:

```text
strategy=fallback
apply_execution=true
confirmation=RECOVER:fallback:<exact current Production SHA>
```

Do not run Primary and Fallback concurrently.

## Exit criteria

The incident is not closed by an `applied` ledger row alone. Final probes must prove:

- exact Production SHA matches `/version` and `/deployment-info`;
- 225 and 1048 are no-op dry-runs with `already_applied=true` and `applies_sql=false`;
- `20260815` is represented in the governed ledger when that ledger is part of the target schema;
- `mcp_catalog_level` exists on both endpoint-tool tables;
- Session Context can persist;
- `actions` and `dynamic_audit_scheduler_runs` have the required write authority;
- `execution_log` and `json_assets` can persist;
- `gpt_session_turns` can persist;
- response chunk persistence is schema-ready and large Admin/System Tool responses no longer fall back to the inline limit failure.
