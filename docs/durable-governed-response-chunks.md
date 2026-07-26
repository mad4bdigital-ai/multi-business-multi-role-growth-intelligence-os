# Durable Governed Tool Response Chunks

## Status
Implemented behind the existing `response_chunked` continuation contract. The in-process map remains a hot cache; MySQL is the durable fallback and runtime authority for continuation payloads.

## Problem
Oversized governed tool responses were cached only in process memory. A restart, deployment, or request landing on another process could invalidate a valid `chunk_id` before its advertised TTL elapsed.

## Contract
Clients continue to use the existing fields:

- `response_chunked`
- `chunk_id`
- `page.cursor`
- `page.next_cursor`
- `page.has_more`
- `continuation.next_call`
- `cache.ttl_ms`
- `cache.expires_at`

The change is additive. Optional cache metadata now includes:

- `durable`
- `cursor_policy`
- `response_sha256`

Cursor offsets use JavaScript UTF-16 code units (`utf16_code_unit_cursor_v1`) so existing `String.prototype.slice` behavior remains compatible. Clients must pass back the server-provided cursor without converting it to byte offsets.

## Write Path
1. Serialize the response JSON.
2. Compute UTF-8 byte length and SHA-256.
3. Persist the complete serialized response in `governed_tool_response_chunks` with an expiry timestamp.
4. Populate the in-process hot cache.
5. Return `chunk_id` and the first page.

No `chunk_id` is returned when durable persistence fails. The route returns a structured `503 response_chunk_persistence_unavailable` error instead.

## Read Path
1. Read the in-process cache.
2. On a cache miss, load the payload from MySQL.
3. Reject expired rows with `410 response_chunk_expired`.
4. Recompute byte length and SHA-256 before serving.
5. Reject mismatches with `500 response_chunk_integrity_failed`.
6. Extend expiry using the configured sliding TTL.

## Security
- `secrets_included` must remain false.
- Rows marked as secret-bearing are rejected.
- No provider credentials or raw authorization headers are persisted by this adapter.
- The table uses `utf8mb4` for complete Unicode storage.

## Migrations and automatic reconciliation

```text
http-generic-api/migrations/20260618_governed_tool_response_chunks.sql
http-generic-api/migrations/1018_sprint69_governed_response_chunk_schema_reconciliation.sql
```

The original migration creates the durable table. Migration `1018` reconciles pre-existing tables to the current contract: `response_bytes BIGINT UNSIGNED`, `cursor_policy` default `utf16_code_unit_cursor_v1`, millisecond `updated_at`, expiry index, and no-secret/SHA constraints. Both remain additive and idempotent.

After migration `1018` is bootstrapped once, `platform_runtime_config.governed_migration_reconciliation_scheduler` enables startup and interval reconciliation through the existing Dynamic Audit scheduler. The runtime adapter invokes `governed-migration-reconciler.mjs` under the scheduler's MySQL advisory lock. It cannot execute arbitrary SQL: each migration needs an exact active policy rule, DB authorization, passing static preflight, typed runner confirmation, ledger evidence, and schema readback.

## Governed recovery smoke

Admin tool `response_chunk_durable_recovery_smoke` performs one bounded, typed-confirmation smoke against the live durable chunk path. It:

1. creates a deterministic Arabic and emoji payload larger than 5,000 UTF-16 code units;
2. persists the complete response before returning `chunk_id`;
3. verifies the durable row, SHA-256, UTF-8 byte length, cursor policy, and no-secret flag;
4. evicts only that `chunk_id` from the process-local cache;
5. reads every continuation page and requires the first recovery source to be `governed_tool_response_chunk_store`;
6. reconstructs the serialized JSON exactly and verifies the first and last Unicode markers;
7. verifies sliding TTL extension.

Invocation requires:

```text
confirm=RUN_RESPONSE_CHUNK_DURABLE_RECOVERY_SMOKE
```

The tool returns bounded evidence only. It does not return the raw payload, call a provider, write externally, restart the process, or read credentials. The temporary row expires through the normal TTL cleanup path.

## Validation
Required checks before merge:

- unit test for persistence, load, integrity mismatch, expiry, DB outage, and secret policy
- integration-style reconstruction of Arabic and emoji JSON after memory-cache eviction
- typed-confirmation and negative-path coverage for the governed recovery smoke
- syntax/import validation of every modified route
- migration dry-run preflight when schema changes are present
- PR CI gate

## Rollback
Code can be rolled back without dropping the table. The table is backward-compatible and may remain unused. Do not drop it during emergency rollback; remove it only through a separately reviewed destructive migration after retention review.
