# Implemented Historical Specification: SQL Cache Resilience

Status: **Implemented / Historical**  
Original specification date: June 28, 2026  
Implementation and production verification completed: July 1, 2026

## Purpose

This document preserves the durable requirements and architectural decisions from the original SQL cache resilience specification. It describes implemented behavior. It is not an active delivery plan, release checklist, or completion tracker.

The current operational authority is [`docs/runbooks/sql-cache-operations.md`](../../runbooks/sql-cache-operations.md).

## Original problem

The compatibility SQL cache could read complete allowlisted tables, serialize a complete result into one Redis value, and share transport failure domains with queue, job, and idempotency workloads. Runtime evidence showed values around 17.2 MB exceeding the provider request limit. The `endpoints` registry was the highest-risk source because list reads could include thousands of records and large contract blobs.

## Implemented architecture

```text
API and Admin tools
        |
        v
MySQL-primary runtime policy and repository reads
        |
        +--> optional SQL cache acceleration
        |      - byte-size guard before transport
        |      - bounded retries and circuit breaker
        |      - oversized-value cooldown
        |      - in-process single-flight
        |      - scoped/versioned keys
        |
        +--> direct SQL fallback on cache failure

Queue, job, and idempotency workloads use independent runtime paths.
```

MySQL remains authoritative. Cache behavior may accelerate a read but cannot bypass authentication, authorization, resource authority, mutation approval, or same-cycle readback.

## Retained requirements

### Authority and failure isolation

- MySQL is the source of truth; cache failure is nonfatal and falls back to SQL.
- Cache outcomes are structured and observable: hit, miss, stored, oversized skip, unavailable, circuit open, bypass, or error.
- Cache transport retries and timeouts are bounded; offline queueing is not used for SQL cache operations.
- Concurrent misses for the same effective key share one in-process loader promise.
- Transport failures open a bounded circuit; oversized keys enter bounded cooldown.

Original traceability: FR-001 and FR-005 through FR-009.

### Size, scope, and secret safety

- Serialized values are measured by UTF-8 byte length before any cache write.
- The runtime maximum value size is policy-controlled and defaults to 1 MiB.
- Oversized values skip cache transport and preserve the SQL loader result.
- Keys are versioned and include every required tenant, workspace, user, brand, or connection scope.
- Missing required scope causes cache bypass, never a global fallback key.
- Credentials, tokens, passwords, API keys, private keys, authorization headers, and encrypted credential payloads must not enter cache values, keys, logs, or metrics.

Original traceability: FR-002 through FR-004, FR-010, and FR-011.

### Endpoint and registry safety

- The `endpoints` table is on the immutable SQL cache security denylist.
- Endpoint execution uses focused point queries rather than generic whole-table cache reads.
- Endpoint list and search surfaces use explicit projections, stable ordering, bounded pagination, and omit `schema_json`.
- Full contract/schema data is loaded only for the selected endpoint detail operation.
- Mutation invalidation uses exact keys or generation/version changes; broad request-path scans are forbidden.
- Same-cycle mutation readback bypasses cache.

Original traceability: FR-012 through FR-016.

### Observability, compatibility, and governance

- Runtime diagnostics expose process-lifetime hit, miss, store, error, bypass, circuit, cooldown, and single-flight evidence without payloads or raw scope identifiers.
- Derived hit, miss, and error ratios use explicit sample counts and thresholds.
- Critical and high SQL cache conditions are projected into the Admin operational-alert control plane.
- Existing public API contracts remain backward compatible.
- Schema and index changes are additive and require governed migration authorization, checksum binding, dry-run, typed approval, ledger persistence, and same-cycle readback.
- Runtime policy changes use revision-guarded partial updates and dry-run before apply.
- Rollback disables cache acceleration while preserving canonical MySQL data.

Original traceability: FR-017 through FR-020.

## Implemented surfaces

| Surface | Purpose | Primary evidence |
| --- | --- | --- |
| `sql_cache_runtime_policy_get` | Read the MySQL-primary policy and freshness state | #1954, #1950 |
| `sql_cache_runtime_policy_update` | Revision-guarded partial update with dry-run | #1954, #1950 |
| `sql_cache_runtime_diagnostics_get` | Read counters, derived metrics, circuit/cooldown state, policy freshness, and alerts | #2021 |
| `sql_cache_controlled_load_test` | Run an isolated in-memory cache and single-flight regression benchmark | #2021 |
| `governed_migration_authorization_bootstrap` | Create or rotate checksum-bound authorization before apply | #2015 |
| `governed_migration_execute` | Perform governed dry-run/apply with redacted child-runner diagnostics and ledger readback | #2021 |
| Operational-alert synchronization | Persist and reconcile verified runtime attention without false singleton truncation | #2025, #2028 |

## Implementation evidence map

| Requirement area | Runtime or test evidence |
| --- | --- |
| Byte-size guard, cooldown, circuit breaker, single-flight, fallback | `http-generic-api/sqlCache.js` and SQL cache tests |
| MySQL-primary policy and revision guards | `http-generic-api/sqlCachePolicy.js`, migration `1023_sprint69_sql_cache_runtime_policy.sql`, and `test-sql-cache-runtime-policy.mjs` |
| Admin policy tools | migration `20260629_sql_cache_admin_tool_export.sql` and `test-sql-cache-admin-tool-export.mjs` |
| Operational diagnostics and isolated benchmark | `http-generic-api/sqlCacheOperationalDiagnostics.js` and `test-sql-cache-operational-diagnostics.mjs` |
| Alert integration | `http-generic-api/operationalAlertService.js` and operational-alert control-plane tests |
| Redacted migration failure diagnostics | `http-generic-api/governedMigrationExecutionTool.js` and `test-governed-migration-execution-tool.mjs` |
| Operational procedures | `docs/runbooks/sql-cache-operations.md` |
| Canonical observability rules | `canonicals/system_bootstrap/10_observability_repair.md` |

## Historical acceptance evidence

A point-in-time production verification on July 1, 2026 established:

- policy loaded from `mysql_primary` with `stale=false`;
- `endpoints` remained security denied;
- SQL cache diagnostics were healthy with zero observed cache errors;
- the isolated 120-request benchmark reduced loader calls from 120 to 1 without touching production Redis or MySQL;
- operational-alert synchronization completed with `final_result_complete=true` and no truncated sources;
- governed migrations recorded checksum, statement-count, authorization, and ledger readback evidence.

These values are historical. Current health must always be read from the live policy, diagnostics, alert, and migration-ledger surfaces.

## Non-goals

- Replacing MySQL or Redis.
- Treating synthetic load-test output as production capacity evidence.
- Caching credential-bearing or authorization-sensitive material.
- Reintroducing generic whole-table caching for `endpoints`.
- Reviving the original phased task plan, stale checklists, or completion manifest.

## Change policy

Future SQL cache changes must be additive, tested, and governed. Update the implementation, deterministic tests, runbook, canonical observability guidance, and migration evidence together. Do not edit this historical specification to claim unverified current runtime state.
