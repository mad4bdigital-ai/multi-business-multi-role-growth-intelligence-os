# Implementation Plan

## Delivery

Use `multi_pr` delivery because production verification and post-merge audit are required, and an additive index migration may be required after governed diagnostics.

1. Specification PR.
2. Cache-safety containment PR.
3. Dedicated Redis client PR.
4. Repository-query migration PRs.
5. Conditional additive index migration PR.
6. Staging/production verification.
7. Completion closeout PR.

## Target architecture

```text
interfaces/api -> application registry service -> domain cache policy
                                             -> MySQL repositories
                                             -> dedicated Redis cache adapter
BullMQ/jobs/idempotency ----------------------> independent queue Redis client
```

Controllers remain thin. Application services orchestrate. Domain policy decides cacheability, scope completeness, byte limit, and outcomes. Infrastructure owns SQL and Redis clients.

## Phase 0 — Containment

- Temporarily disable SQL cache or restrict its allowlist through the governed environment path.
- Exclude `endpoints`, credential-bearing tables, and tenant/user-scoped tables from generic whole-table caching.
- Verify BullMQ/job/idempotency health and capture error-rate evidence.

## Phase 1 — Cache safety

- Add validated `SQL_CACHE_MAX_VALUE_BYTES` defaulting to 1 MiB.
- Serialize once, measure UTF-8 bytes, and skip oversized writes before transport.
- Add structured outcomes, single-flight, bounded circuit breaker, and oversize cooldown.
- Add no-payload structured logs and bounded metrics.

## Phase 2 — Redis isolation

- Keep `REDIS_URL` for queue/job/idempotency.
- Add `CACHE_REDIS_URL` for SQL cache; transitional URL reuse may not reuse the client instance.
- Use bounded retries/timeouts, lazy connect, and `enableOfflineQueue: false`.
- Add startup/shutdown and failure-isolation tests.

## Phase 3 — Focused repositories

- Add endpoint metadata list/search repository with explicit columns and cursor pagination.
- Add selected endpoint contract point lookup with `LIMIT 2` to detect duplicates.
- Migrate endpoint execution, actions, execution policies, workflows, and task routes away from runtime-critical `SELECT *` reads.
- Inventory remaining compatibility callers and track owners.

Candidate endpoint lookup:

```sql
SELECT id, endpoint_id, parent_action_key, endpoint_key, endpoint_operation,
       provider_domain, provider_family, method, endpoint_path_or_function,
       module_binding, connector_family, status, execution_readiness,
       transport_action_key, runtime_binding_profile,
       required_variable_contracts, schema_json
FROM endpoints
WHERE parent_action_key = ? AND endpoint_key = ? AND status = 'active'
ORDER BY id
LIMIT 2;
```

List/search projections omit `schema_json`.

## Phase 4 — Keys and invalidation

Use versioned keys such as:

```text
sql:v2:endpoint:g<generation>:<parent_action_key>:<endpoint_key>
sql:v2:endpoint-list:g<generation>:<query-fingerprint>
```

Mutation sequence: commit MySQL, increment generation, perform direct-SQL same-cycle readback, record evidence, and allow old-generation keys to expire.

## Phase 5 — Conditional index

Run governed index inventory and `EXPLAIN`. Add `(parent_action_key, endpoint_key, status)` only when no equivalent effective index exists. Apply through the governed migration ledger with checksum and schema readback.

## Rollout and rollback

Flags:

- `SQL_CACHE_V2_ENABLED`
- `SQL_CACHE_V2_ENDPOINT_REPOSITORY_ENABLED`
- `SQL_CACHE_V2_DEDICATED_CLIENT_REQUIRED`

Roll out in dev/staging, shadow parity, canary, full production, and observation. Roll back by disabling flags or cache entirely; canonical MySQL data is never reverted.

## Required validation

- Focused cache/repository tests.
- Full explicit test manifest and architecture validation.
- Schema/OpenAPI guards when health contracts change.
- `node build-canonicals.mjs` and canonical parity.
- Spec Kit changed-scope completion gate.
- Release readiness, production parity, and post-merge audit.
