# Governed Migration Origin / Runner P0 Runbook — 2026-08-21

Tracking issue: #7512

## Scope

This runbook isolates and repairs the request/process boundary used by:

`POST /gpt/tools/call -> governed_migration_execute -> governedMigrationExecutionTool -> scripts/governed-migration-runner.mjs`

It deliberately does not apply migrations or grant database privileges.

## Observed failure classes

### Class A — runner reached, child exits

Migration:

`20260815_custom_gpt_mcp_catalog_levels.sql`

Observed behavior: the route reaches the governed migration runner, the child exits unsuccessfully, and the caller has received only a generic command-level diagnostic when runner stderr/stdout carries no usable structured detail.

Expected fixture:

- SHA-256: `528143808adac23eb457058c4c34dd95c4c5d462bca9ac4b170b1f19b2006681`
- statements: `7`

### Class B — origin disconnect before application envelope

Migrations:

- `225_sprint67_capability_resolution_envelope_ledger.sql`
- `1048_transport_response_chunk_schema_recovery.sql`

Observed behavior: raw `HTTP 502 Bad Gateway`, with Cloudflare reachable and Hostinger origin reported in error state, before the governed `/gpt/tools/call` JSON response is completed.

Recorded incident windows:

- 225: `2026-08-21T00:04:58Z`
- 1048: `2026-08-21T00:09:54Z`

Do not label these migrations themselves as failed until origin/process evidence proves that the runner returned a migration failure.

## Current main implementation snapshot

Inspected main SHA:

`badabc9f0898281d94d72c43d942dcfaccf4e6af`

Relevant files:

- `http-generic-api/routes/gptToolsRoutes.js`
- `http-generic-api/governedMigrationExecutionTool.js`
- `http-generic-api/scripts/governed-migration-runner.mjs`

Current execution tool behavior:

- uses promisified `execFile`;
- defaults to a `300000 ms` child timeout;
- defaults to a `4 MiB` capture buffer;
- sanitizes runner stderr/stdout;
- recognizes a specific runner authorization message;
- returns `governed_migration_runner_failed` for other nonzero child exits.

Current runner behavior includes an authorization check before migration file read.

## Safety boundary

During this P0 diagnosis/patch cycle, do not run:

- `docker compose restart`
- `docker compose up`
- `docker compose down`
- `docker compose build`
- `docker compose pull`
- migration apply
- database grants
- direct Production DB mutation

Never emit credentials, environment values, connection strings, API keys, tokens, or DB passwords into logs/artifacts.

## Phase 1 — collect origin evidence, read-only

From the deployed Compose directory:

```bash
docker compose --env-file ./.env.staging \
  -f ./docker-compose.yml \
  -f ./docker-compose.staging.yml \
  --profile tunnel ps -a
```

Resolve the app container id:

```bash
APP_ID="$(docker compose \
  --env-file ./.env.staging \
  -f ./docker-compose.yml \
  -f ./docker-compose.staging.yml \
  --profile tunnel ps -q app)"
```

Inspect lifecycle state:

```bash
docker inspect "$APP_ID" --format \
'container_status={{.State.Status}} running={{.State.Running}} restarting={{.State.Restarting}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} error={{.State.Error}} restart_count={{.RestartCount}} started={{.State.StartedAt}} finished={{.State.FinishedAt}}'
```

Read app logs only:

```bash
docker compose \
  --env-file ./.env.staging \
  -f ./docker-compose.yml \
  -f ./docker-compose.staging.yml \
  --profile tunnel logs \
  --since=45m \
  --no-color app
```

Retain only redacted lines relevant to:

- the two recorded timestamps;
- `Error` / `Fatal`;
- `exit` / `SIG` / `OOM`;
- `governed_migration`;
- `DB_` / `ER_`;
- `ECONN*` / socket reset / timeout.

Classify the result into exactly one proven category where possible:

1. parent container crash/restart;
2. OOM/resource kill;
3. DB/pool/socket failure;
4. reverse-proxy/origin deadline;
5. child lifecycle bug;
6. other proven failure.

If evidence is insufficient, keep the status `origin_failure_unclassified`; do not infer a migration failure.

## Phase 2 — request deadline hardening

### Requirement

A request-bound migration dry-run must finish or fail locally before the upstream connection can be dropped by the hosting/proxy layer.

### Patch target

`http-generic-api/governedMigrationExecutionTool.js`

### Design

1. Replace the unqualified 300-second request-bound default with a governed deadline derived from the deployed origin/proxy budget.
2. Keep a safety margin so the local error envelope is written before upstream termination.
3. On timeout, return a dedicated typed error such as:

`governed_migration_runner_timeout`

4. Include only safe metadata:

- migration;
- mode;
- duration_ms;
- timeout_ms;
- exit code when available;
- signal when available;
- captured stderr/stdout byte counts;
- truncation flags;
- correlation id.

5. Never retry a timed-out migration automatically.
6. Never convert a timeout into permission to skip readback or authorization.

The concrete timeout value must not be guessed in code review; set it from confirmed Hostinger/Cloudflare/deployment evidence.

## Phase 3 — child lifecycle hardening

Verify with tests that:

- child failure cannot terminate the parent Node process;
- timeout cleanup targets only the intended child/process group;
- `error`, `exit`, `close`, timeout, signal, and buffer-limit paths are all handled;
- no uncaught exception leaves `/gpt/tools/call`;
- caller abort/connection close does not crash the app;
- the route never attempts a duplicate response;
- a subsequent health/tool call still succeeds after a forced runner failure.

If `execFile` cannot provide the lifecycle visibility required by these guarantees, migrate this path to `spawn` with explicit bounded stdout/stderr capture. Do not migrate solely for style; require a testable lifecycle benefit.

## Phase 4 — runner diagnostic durability

### Patch target

`http-generic-api/scripts/governed-migration-runner.mjs`

Each fatal phase must map to a stable diagnostic code:

- `runner_authorization_failed`
- `runner_migration_path_failed`
- `runner_migration_read_failed`
- `runner_checksum_failed`
- `runner_statement_parse_failed`
- `runner_db_preflight_failed`
- `runner_execution_failed`
- `runner_readback_failed`

Names may be adjusted to existing repository conventions, but phase separation is required.

The final fatal diagnostic must be emitted before process termination. Avoid an immediate exit sequence that can lose buffered stdout/stderr. Keep final diagnostic output small, deterministic, JSON-compatible, and secret-safe.

## Phase 5 — route correlation

Carry one request-local execution/correlation id through:

`gptToolsRoutes -> governedMigrationExecutionTool -> governed-migration-runner`

Log safe structured lifecycle markers for:

- request accepted;
- runner start;
- runner pid if available;
- child close/exit;
- response envelope created;
- response completed or caller aborted.

Do not log request auth headers or environment objects.

## Phase 6 — regression suite

Required regression cases:

1. authorized dry-run succeeds;
2. unauthorized migration becomes a typed 409 authorization failure;
3. JSON stderr from nonzero child is preserved safely;
4. plain stderr from nonzero child is sanitized and bounded;
5. hanging child becomes a local timeout envelope;
6. output over capture budget fails deterministically without parent crash;
7. signaled child surfaces the signal;
8. parent stays healthy after every failure case;
9. client abort does not create an uncaught exception;
10. suite proves no apply/grant side effect.

## Migration fixtures

### 225

- SHA-256: `35b034940c2be63d9bf8a8099573cac1c5a75b5fffd8ccfad60a453ed3cf7419`
- expected statements: `3`
- apply confirmation: `APPLY_225_SPRINT67_CAPABILITY_RESOLUTION_ENVELOPE_LEDGER`

### 1048

- SHA-256: `aecfbd9d87dca6eba11677cd992637f55ecf3c0743f704df4bbea48c57d8d788`
- expected statements: `34`
- apply confirmation: `APPLY_1048_TRANSPORT_RESPONSE_CHUNK_SCHEMA_RECOVERY`

## P0 exit gates

Do not move to migration apply until all are true:

- [ ] 225/1048 origin behavior is classified by evidence.
- [ ] Request-bound child execution has a proven safe local deadline.
- [ ] Timeout produces a typed application response where the connection remains available.
- [ ] Runner failure cannot restart/kill the parent application.
- [ ] 20260815 dry-run returns success or a specific typed phase/authorization diagnostic.
- [ ] 225 dry-run completes through the application envelope.
- [ ] 1048 dry-run completes through the application envelope.
- [ ] Container restart/OOM state remains stable during controlled dry-runs.
- [ ] No migration apply occurred in this PR.
- [ ] No DB grant occurred in this PR.

## Separate dependency: runtime session DB grant

The `customer_sessions` INSERT permission issue is separate from raw origin 502 handling. Coordinate the least-privilege writer/permission work with #6813 after the migration execution path is stable.

Do not add `GRANT OPTION` or `ALL PRIVILEGES`.

## Governed rollout after P0 closure

1. dry-run 20260815
2. apply 20260815
3. readback `mcp_catalog_level`
4. dry-run 225
5. apply 225
6. ledger/table readback
7. dry-run 1048
8. typed authorization for 1048
9. apply 1048
10. response-chunk schema readback
11. least-privilege runtime grants
12. session-context verification
13. Admin/System catalog verification
14. Migration 1051 readiness
15. Main policy readiness
16. Main apply + verify
17. Production readiness
18. Production apply + verify

Main and Production authorization/execution remain independent.
