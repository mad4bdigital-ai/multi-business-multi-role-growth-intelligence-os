# ADR: MySQL-Primary SQL Cache Runtime Policy

## Status
Proposed for merge on the SQL cache safety work branch.

## Context
The SQL adapter previously cached complete registry tables in the same Redis connection used by BullMQ. The endpoint registry can exceed the provider request limit after serialization. Cache transport failures must never interrupt MySQL-backed reads or queue processing.

## Decision
MySQL remains the source of truth. Redis remains an optional, bounded acceleration layer.

A versioned policy row in `sql_cache_runtime_policies` controls cache enablement, key version, byte limits, circuit-breaker duration, single-flight behavior, and per-table policy. Runtime processes refresh the row on a bounded interval and retain the last known good policy during transient MySQL failures.

The cache enforces a non-overridable denylist for secret-capable and oversized whole-table surfaces. Whole-table endpoint caching remains disabled. Writes use optimistic concurrency through `revision`.

The admin API is limited to:
- `GET /admin/cache/sql-policy`
- `PATCH /admin/cache/sql-policy`

Both routes require backend authentication and an administrator principal. PATCH supports dry-run and requires `expected_revision`.

## Consequences
- Policy changes can take effect without a process restart.
- Invalid or unavailable policy data falls back to the last known good snapshot, then environment defaults.
- Cache failures remain fail-open to MySQL.
- Policy changes are auditable and conflict-safe.
- The migration must be authorized and applied through the governed migration runner after merge.
