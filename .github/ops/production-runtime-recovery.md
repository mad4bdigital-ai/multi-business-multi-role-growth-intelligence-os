# Production Runtime Recovery Control Plane

## Deployment model

Production already uses Hostinger Auto Deploy. The repository contract is:

```text
merge/push to Production
  -> Hostinger Auto Deploy
  -> GET /health
  -> GET /version
  -> GET /deployment-info
  -> exact Production branch + exact 40-character SHA proof
  -> governed recovery only after parity is proven
```

This workflow **does not trigger deployment** and does not need a Hostinger deployment API credential. It observes the deployment that Hostinger starts from the `Production` branch and refuses every recovery mutation until both provenance endpoints report the exact expected branch and full SHA.

This matches `docs/hostinger-node-deploy.md`: `Production` is the deployment trigger, while SQL migration and grants remain separate governed states.

## Canonical route contract

Machine-readable source of truth:

```text
.github/ops/production-runtime-recovery-routes.json
```

The routes are intentionally not supplied as GitHub Variables. GitHub Variables can configure request bodies and expected response contracts, but cannot redirect the recovery operator to another URL path.

| route_key | Method | Path | Purpose |
| --- | --- | --- | --- |
| `health` | GET | `/health` | Hostinger process health |
| `version` | GET | `/version` | exact deployment provenance |
| `deployment_info` | GET | `/deployment-info` | second independent provenance surface |
| `gpt_tools` | GET | `/gpt/tools` | Admin/System tool catalog readiness |
| `gpt_tool_call` | POST | `/gpt/tools/call` | canonical governed tool execution envelope |
| `session_context` | GET | `/activation/session-context/read-only` | Session Context persistence/readback |

The CI test reads the actual repository route modules and the recovery route contract together. A path rename in application code without updating this contract must fail CI.

### Route failure classification

The operator distinguishes routing from dependencies:

```text
404 / 405 -> route_contract_missing
401 / 403 -> route_present_auth_not_ready
5xx       -> route_present_runtime_dependency_failed
2xx / 3xx -> route_present
```

That distinction matters for the current incident. A `502` on a known route should not be described as “route missing”; it proves the edge was reached but the live origin/runtime did not complete the request. A final functional probe still requires the expected success status and response contract.

## Exact Hostinger parity gate

The workflow no longer searches response text for a SHA. `/version` and `/deployment-info` must both return structured JSON with:

```json
{
  "gitCommitFull": "<exact 40-character Production SHA>",
  "gitBranch": "Production"
}
```

Both endpoints must match. A short commit, a matching substring, a matching build artifact with the wrong branch, or only one matching endpoint is insufficient.

Default observation window:

```text
PRODUCTION_VERIFY_ATTEMPTS=36
PRODUCTION_VERIFY_INTERVAL_SECONDS=10
```

This gives Hostinger Auto Deploy up to six minutes to become runtime-current before the recovery run fails closed. These variables change waiting behavior only; they do not trigger a deployment.

## GitHub Environment configuration

Use the protected GitHub Environment `Production`.

### Required/normal variables

| Variable | Purpose |
| --- | --- |
| `PRODUCTION_SOURCE_BRANCH` | expected release branch; default `Production` |
| `PRODUCTION_BASE_URL` | default `https://auth.mad4b.com` |
| `PRODUCTION_VERIFY_ATTEMPTS` | Auto Deploy parity attempts; default `36` |
| `PRODUCTION_VERIFY_INTERVAL_SECONDS` | delay between parity attempts; default `10` |
| `PRODUCTION_PROBE_AUTH_HEADER` | default `Authorization` |
| `RUNTIME_RECOVERY_PROBES_JSON` | read-only functional probes using `route_key` |
| `PRIMARY_GOVERNED_STEPS_JSON` | governed mutation sequence using `route_key` |
| `RUNTIME_RECOVERY_FINAL_PROBES_JSON` | final functional exit probes |
| `RUNTIME_RECOVERY_TARGETS_JSON` | explicit fallback DB/bootstrap plans |
| `RUNTIME_RECOVERY_ALLOW_CREATE_DATABASE` | global missing-DB creation gate; default `false` |
| `MYSQL_BOOTSTRAP_HOST` | direct MySQL/MariaDB hostname for fallback |
| `MYSQL_BOOTSTRAP_PORT` | default `3306` |

### Secrets

| Secret | Purpose |
| --- | --- |
| `PRODUCTION_PROBE_AUTH_VALUE` | protected bearer credential for runtime operational routes |
| `MYSQL_BOOTSTRAP_USER` | fallback bootstrap DB principal |
| `MYSQL_BOOTSTRAP_PASSWORD` | fallback bootstrap DB password |

There is deliberately no `PRODUCTION_DEPLOY_URL`, `PRODUCTION_DEPLOY_AUTH_VALUE`, or Hostinger target secret in this recovery workflow.

## Primary strategy: exact runtime route path

The canonical governed execution route is:

```text
POST /gpt/tools/call
```

The HTTP body envelope is:

```json
{
  "name": "<tool-name>",
  "tool_args": {}
}
```

The GitHub variables never contain a raw `path` or `url`. Every step supplies a `route_key`; the operator resolves that key through the reviewed route contract. A configured step containing `path` or `url` is rejected.

### 225 and 1048 read-only probes

`RUNTIME_RECOVERY_PROBES_JSON` should use the exact canonical tool-call route:

```json
[
  {
    "name": "225 already-applied dry-run",
    "route_key": "gpt_tool_call",
    "body": {
      "name": "governed_migration_execute",
      "tool_args": {
        "migration": "225_sprint67_capability_resolution_envelope_ledger.sql",
        "mode": "dry_run",
        "expected_checksum_sha256": "35b034940c2be63d9bf8a8099573cac1c5a75b5fffd8ccfad60a453ed3cf7419",
        "expected_statement_count": 3
      }
    },
    "expected_status": 200,
    "expected_json": {
      "result": {
        "already_applied": true,
        "applies_sql": false
      }
    }
  },
  {
    "name": "1048 already-applied dry-run",
    "route_key": "gpt_tool_call",
    "body": {
      "name": "governed_migration_execute",
      "tool_args": {
        "migration": "1048_transport_response_chunk_schema_recovery.sql",
        "mode": "dry_run",
        "expected_checksum_sha256": "aecfbd9d87dca6eba11677cd992637f55ecf3c0743f704df4bbea48c57d8d788",
        "expected_statement_count": 34
      }
    },
    "expected_status": 200,
    "expected_json": {
      "result": {
        "already_applied": true,
        "applies_sql": false
      }
    }
  }
]
```

These two migrations are verification-only in the current incident. They are never placed in a Primary `apply` step.

## 20260815 exact migration path

Current contract:

```text
file: 20260815_custom_gpt_mcp_catalog_levels.sql
sha256: 528143808adac23eb457058c4c34dd95c4c5d462bca9ac4b170b1f19b2006681
statement_count: 7
```

Primary uses the same `/gpt/tools/call` route and `governed_migration_execute` tool. A representative dry-run step is:

```json
{
  "name": "20260815 dry-run",
  "route_key": "gpt_tool_call",
  "body": {
    "name": "governed_migration_execute",
    "tool_args": {
      "migration": "20260815_custom_gpt_mcp_catalog_levels.sql",
      "mode": "dry_run",
      "expected_checksum_sha256": "528143808adac23eb457058c4c34dd95c4c5d462bca9ac4b170b1f19b2006681",
      "expected_statement_count": 7
    }
  },
  "expected_status": 200
}
```

The corresponding apply entry must be explicitly marked:

```json
{
  "name": "20260815 typed apply",
  "route_key": "gpt_tool_call",
  "mutation": true,
  "body": {
    "name": "governed_migration_execute",
    "tool_args": {
      "migration": "20260815_custom_gpt_mcp_catalog_levels.sql",
      "mode": "apply",
      "expected_checksum_sha256": "528143808adac23eb457058c4c34dd95c4c5d462bca9ac4b170b1f19b2006681",
      "expected_statement_count": 7,
      "typed_confirmation_phrase": "execute migration 20260815_custom_gpt_mcp_catalog_levels.sql"
    }
  },
  "expected_status": 200
}
```

Authorization/readiness must still precede apply according to the existing governed migration contract from PR #7564. The recovery workflow does not turn deployment parity into migration authorization.

## Session Context and catalog routes

Final Session Context verification uses:

```json
{
  "name": "Session Context final readback",
  "route_key": "session_context",
  "expected_status": 200
}
```

Final Admin/System tool-catalog verification uses:

```json
{
  "name": "Admin/System tools final readback",
  "route_key": "gpt_tools",
  "expected_status": 200
}
```

For the current incident, the latter is an important response-chunk test: a final `500/502` with `response_chunk_schema_incomplete` is a dependency/readiness failure, not a route-discovery failure.

## Grant boundary

The GitHub fallback is intentionally narrower than a broad runtime writer profile. Its built-in default table set is exactly:

```text
customer_sessions
gpt_session_turns
actions
dynamic_audit_scheduler_runs
execution_log
json_assets
```

Allowed privileges are exactly:

```text
SELECT, INSERT, UPDATE
```

No `database.*` grant is generated. The fallback cannot grant DELETE, CREATE, DROP, ALTER, INDEX, EXECUTE, GRANT OPTION, or other privileges.

The existing PR #7564 `runtime_inventory_writer` profile also covers `endpoints` and `openapi_endpoint_inventory_sync_runs`. Do not silently use that broader profile when the recovery authorization is only for the six tables above. Either explicitly authorize the broader profile in a separate operation or keep the six-table fallback plan.

## Fallback for incomplete or empty databases

Fallback is used only after the exact Hostinger Auto Deploy SHA is already proven live. It does not ask SQL which migrations should run. GitHub supplies the explicit target plan.

A target can represent:

- an existing populated DB with one missing feature migration;
- an existing empty DB that needs canonical baseline migrations;
- a missing DB, but only with two independent creation gates.

Example for the current runtime DB:

```json
[
  {
    "key": "runtime",
    "database": "u338416126_growthOS",
    "principal": "u338416126_growthOS",
    "principal_host": "%",
    "allow_create_database": false,
    "baseline_bootstrap_migrations": [],
    "incident_recovery_migrations": [
      {
        "kind": "migration",
        "file": "http-generic-api/migrations/20260815_custom_gpt_mcp_catalog_levels.sql",
        "expected_checksum": "528143808adac23eb457058c4c34dd95c4c5d462bca9ac4b170b1f19b2006681",
        "requires_tables": [
          "admin_platform_endpoint_tools",
          "tenant_platform_endpoint_tools"
        ],
        "done_when": [
          {"table": "admin_platform_endpoint_tools", "columns": ["mcp_catalog_level"]},
          {"table": "tenant_platform_endpoint_tools", "columns": ["mcp_catalog_level"]}
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

`20260815` cannot bootstrap an empty database by itself. It is blocked until these canonical base tables exist:

```text
admin_platform_endpoint_tools
tenant_platform_endpoint_tools
```

For a completely empty DB, the target must list the reviewed canonical baseline bootstrap artifact in `baseline_bootstrap_migrations` first. The current allowlist contains `http-generic-api/schema.sql` with its reviewed SHA-256 and statement count; the operator applies it only when the database is missing or has zero tables, and rejects it for a non-empty database. The operator will not copy Production schema, infer DDL from another environment, or synthesize missing tables.

`incident_recovery_migrations` is a separate field and is restricted to the reviewed incident allowlist. At present only `20260815_custom_gpt_mcp_catalog_levels.sql` can be applied, with its checksum, statement count, dependency checks, and postconditions. Migrations `225_sprint67_capability_resolution_envelope_ledger.sql` and `1048_transport_response_chunk_schema_recovery.sql` remain verification-only and are rejected from fallback apply. The legacy ambiguous `migrations` field is forbidden; this prevents a canonical directory path from being treated as an execution allowlist.

Primary and fallback recovery executions use one shared `production-runtime-recovery-production` concurrency group, so they cannot mutate the same Production runtime/database concurrently. Any non-snapshot route request also validates `PRODUCTION_BASE_URL` against the canonical `production.hostname` in `http-generic-api/config/deployment-branch-policy.json`: HTTPS, exact hostname, no userinfo, no explicit port, no path prefix, query, or fragment. The operator repeats the centralized policy preflight itself before strategy execution, even when invoked outside the workflow.

Database creation requires both:

```text
RUNTIME_RECOVERY_ALLOW_CREATE_DATABASE=true
```

and:

```json
"allow_create_database": true
```

## Snapshot mode

`strategy=snapshot` remains a separate DB-independent, read-only mode for situations where SQL is empty or unavailable and we need a bounded catalog/session descriptor from GitHub or a reviewed repository snapshot.

Allowed sources:

```text
github_snapshot
repository_snapshot
```

Snapshot mode cannot create a durable session, cannot claim runtime authority, cannot mutate a database, and cannot perform provider mutation.

## Execution gates

Mutation requires all of the following at the same time:

```text
1. expected_production_sha is a full SHA
2. it is still the exact Production branch head
3. Hostinger /version reports gitCommitFull=<SHA> and gitBranch=Production
4. Hostinger /deployment-info reports the same
5. route topology has no 404/405 for canonical required routes
6. apply_execution=true
7. confirmation=RECOVER:<strategy>:<exact-sha>
```

Primary and fallback must not run concurrently. The workflow concurrency key is strategy/target-bound and Production Environment approval remains in force.

## Recommended current incident order

```text
A. promote the intended reviewed snapshot to Production
B. let Hostinger Auto Deploy run normally
C. strategy=verify
   -> exact /version + /deployment-info parity
   -> canonical route topology
   -> 225/1048 dry-run
D. strategy=primary plan mode
E. if governed runtime path is healthy:
   -> authorize 20260815
   -> dry-run
   -> typed apply
   -> ledger/schema readback
   -> six-table least-privilege grants only if explicitly authorized
F. if runtime-mediated recovery is unavailable because SQL/schema is incomplete:
   -> strategy=fallback plan mode
   -> review exact target/migration/grant list
   -> fallback apply with exact SHA-bound confirmation
G. final functional probes
```

## Exit criteria

The incident is closed only when the same cycle proves:

- `/health` is healthy;
- `/version.gitCommitFull` equals exact Production SHA and `gitBranch=Production`;
- `/deployment-info` proves the same exact identity;
- 225 dry-run returns already applied/no SQL;
- 1048 dry-run returns already applied/no SQL;
- `20260815` is applied/read back when required;
- `mcp_catalog_level` exists on both endpoint-tool tables;
- `/activation/session-context/read-only` succeeds and Session Context can persist;
- `/gpt/tools` succeeds without response chunk inline-limit failure;
- `customer_sessions`, `gpt_session_turns`, `actions`, `dynamic_audit_scheduler_runs`, `execution_log`, and `json_assets` have the explicitly authorized least privileges;
- response chunk persistence is schema-ready in the live DB binding used by the deployed runtime.
