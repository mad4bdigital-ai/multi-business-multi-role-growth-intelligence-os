# Dev Governed Migration Client Runbook

## Purpose

This runbook defines the only supported remote path for inspecting or executing governed migrations against the development database.

The client is a transport adapter. It does not contain SQL, replace the governed migration runner, or bypass migration authorization.

## Safety boundaries

- Target host is fixed to `https://dev.mad4b.com`.
- The database status preflight must return a database name ending in `_dev`.
- Production database names are rejected.
- HTTP, alternate hosts, redirects, embedded credentials, URL query strings, and URL fragments are rejected.
- The client exposes only an explicit migration and capability-envelope allowlist.
- Free-form database commands and restore operations are not supported.
- State-changing requests always require `--apply`.
- Mutating shell aliases remain gated by `DEV_MIGRATION_APPLY_ENABLED=true`.
- An allowlisted mutating tool call may use either that environment flag or a syntactically valid persisted capability-envelope UUID carried in the tool arguments. The dev runtime remains authoritative and must validate envelope status, scope, expiry, approval, and apply authorization before mutation.
- The client reports `apply_authority_source` as `environment_flag` or `capability_envelope` for audit readback.
- The underlying dev runtime still enforces migration authorization, checksums, typed confirmation, capability envelopes, execution ledger, and schema readback.
- Credentials are read from the caller environment and are never printed.

## Required caller configuration

Provide one approved backend credential in the caller environment:

```bash
export DEV_GROWTH_OS_API_KEY='<approved dev backend key>'
```

`BACKEND_API_KEY` is accepted only as the existing platform fallback. Do not place credentials in command arguments, URLs, source control, or logs.

Keep mutation disabled by default:

```bash
unset DEV_MIGRATION_APPLY_ENABLED
```

## Read-only readiness sequence

### 1. Verify dev database identity

```bash
npm run dev:migration:status
```

Expected evidence:

```text
base_url=https://dev.mad4b.com
db_name ends with _dev
mutation_requested=false
secrets_included=false
```

Stop immediately if the database suffix is not `_dev`.

### 2. Probe the dev tool registry

```bash
npm run dev:migration:probe
```

The probe calls `admin_tool_catalog_search` through the dev `/gpt/tools/call` dispatcher. It must show the governed migration and capability-envelope tools required for the rollout.

### 3. Read migration schema state

Use the generic client with a read-only allowlisted tool:

```bash
node scripts/dev-governed-migration-client.mjs \
  --action=tool-call \
  --tool=governed_migration_schema_readback \
  --tool-args-json='{"migration_file":"20260711_transactional_outbox_shadow_sync_foundation.sql"}'
```

Use the returned schema evidence to determine whether the migration is absent, partially present, or already applied. Do not infer state from deployment metadata alone.

### 4. Run migration dry-run

```bash
node scripts/dev-governed-migration-client.mjs \
  --action=tool-call \
  --tool=governed_migration_execute \
  --tool-args-json='{"migration_file":"20260711_transactional_outbox_shadow_sync_foundation.sql","mode":"dry_run"}'
```

Dry-run must return:

- authorized migration file identity
- checksum and statement count
- target schema preflight
- destructive-operation classification
- required typed confirmation for apply
- no database mutation

Do not continue when checksum, authorization, schema preflight, or statement validation fails.

## Apply preparation

Apply is a separate, plan-bound operation.

Before enabling apply, collect and review:

1. Dev database identity and current table count.
2. Migration checksum and statement count.
3. Dry-run output.
4. Current migration authorization record.
5. Apply-policy record.
6. Required typed confirmation.
7. Capability-envelope requirements.
8. Rollback and containment plan.
9. Expected schema readback.

The migration is additive. Rollback should normally disable consumers and leave the inactive tables in place rather than dropping them.

## Apply authorization sequence

The exact tool arguments must come from current tool schemas and dry-run evidence. A typical governed sequence is:

1. Bootstrap or verify the migration authorization record.
2. Bootstrap or verify the apply-policy record.
3. Create a dev-local capability envelope through the allowlisted shell alias.
4. Approve the dev-local envelope.
5. Bind the envelope to the migration apply authorization when required.
6. Enable the caller-side feature flag.
7. Execute the migration with the exact typed confirmation.
8. Read schema state in the same cycle.
9. Run outbox status and dry-run checks.

For governed remote execution, prefer the fixed process-local apply alias:

```text
dev_governed_migration_client_apply
```

The wrapper launches the same client with `DEV_MIGRATION_APPLY_ENABLED=true` only inside that child process. It does not persist or mutate the server environment, and it still requires `--apply`, resource authority, allowlisted actions, and all server-side migration and capability-envelope checks.

Example tool call arguments passed to the alias:

```bash
--action=tool-call \
--tool=governed_migration_execute \
--tool-args-base64='<base64 encoded approved apply arguments>' \
--apply
```

For local execution where one shell owns both the environment and child process, the direct client remains supported:

```bash
DEV_MIGRATION_APPLY_ENABLED=true \
node scripts/dev-governed-migration-client.mjs \
  --action=tool-call \
  --tool=governed_migration_execute \
  --tool-args-base64='<base64 encoded approved apply arguments>' \
  --apply
```

Do not rely on a separate remote `env set` request to remain visible to a later process or runtime instance. After the child process exits, readback should show no persistent apply flag.

## Post-apply verification

Required same-cycle verification:

1. `/dev/db/status` still reports the same `_dev` database.
2. Migration execution ledger reports success.
3. Schema readback confirms all expected tables and indexes.
4. Seeded consumer remains:

```text
consumer_key=prod_shadow_v1
transport_key=noop
status=disabled
```

5. `npm run outbox:status` completes against dev runtime.
6. `npm run outbox:dry-run` produces no external request.
7. No event type or external consumer becomes active implicitly.
8. No production database or production runtime was called.

## Failure handling

- Authentication failure: classify as `authorization_gated`; stop.
- Dev database suffix failure: stop; do not retry with another target.
- Tool unavailable: treat as deployment or registry drift; do not bypass with SQL.
- If only `v_app_integration_capability_map` is absent, capability resolution may use the official read-only base-table projection.
- If only `v_workspace_resource_grant_effective` is absent, capability resolution may use the official read-only `workspace_resource_grants` + active `memberships` projection. Permission errors, missing base tables, invalid schema, and all other database failures remain fail-closed.
- Checksum or statement-count mismatch: stop and reconcile the committed migration.
- Capability-envelope failure: stop; never reuse a stale or unrelated envelope.
- Ambiguous transport result: perform ledger and schema readback before any retry.
- Partial schema evidence: classify as degraded and prepare a governed repair plan.

## Dev outbox read-only verification

After the outbox foundation migration has a successful ledger and schema readback, verify the worker without enabling delivery:

```bash
npm run dev:outbox:status
npm run dev:outbox:dry-run
```

The dev client permits only `platform_outbox_worker --action=status` and `--action=dry-run`. It rejects `run-once`, `loop`, `--apply`, unknown arguments, consumer keys outside the bounded identifier pattern, and limits outside `1..500` before the request reaches the dev runtime.

Expected status evidence:

- target database name ends in `_dev`
- consumer `prod_shadow_v1` exists
- transport remains `noop`
- consumer remains disabled
- delivery feature flag is not enabled
- no endpoint or credential reference is required for the disabled noop consumer

Expected dry-run evidence:

- readiness and masking policy are evaluated
- no event claim, delivery state change, provider call, or external HTTP request occurs
- output reports `mutation_requested=false`
- output reports `secrets_included=false`

Stop and classify the environment as degraded if status or dry-run reports an active consumer, non-noop transport, missing active mask policy, embedded credentials, secret query parameters, or an external request attempt.

## Production prohibition

This client must never be changed to accept `auth.mad4b.com`, arbitrary base URLs, or a database without the `_dev` suffix.

Production migration execution must use its own independently approved plan, authorization, capability envelope, release gate, and readback. Dev evidence does not authorize production apply.

## Hetzner portability

When dev or staging moves to Hetzner, retain the same contract:

- environment-specific HTTPS dispatcher
- explicit database identity guard
- fixed tool allowlist
- caller-side apply feature flag
- server-side migration authorization and ledger
- typed confirmation
- schema readback

Only the approved environment hostname and credential source should change. The migration runner and migration file remain unchanged.
