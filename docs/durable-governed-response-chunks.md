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

## Migration

```text
http-generic-api/migrations/20260618_governed_tool_response_chunks.sql
```

The migration is additive and creates one indexed table. Apply it only through the governed migration runner after dry-run preflight and typed confirmation.

## Validation
Required checks before merge:

- unit test for persistence, load, integrity mismatch, expiry, DB outage, and secret policy
- integration-style reconstruction of Arabic and emoji JSON after memory-cache eviction
- syntax/import validation of every modified route
- migration dry-run preflight
- PR CI gate

## Rollback
Code can be rolled back without dropping the table. The table is backward-compatible and may remain unused. Do not drop it during emergency rollback; remove it only through a separately reviewed destructive migration after retention review.
