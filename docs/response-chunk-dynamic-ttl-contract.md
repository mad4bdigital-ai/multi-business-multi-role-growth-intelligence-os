# Response Chunk Dynamic TTL Contract

## Purpose

Governed tool responses that can exceed the client response budget must use the platform response chunk continuation contract instead of returning oversized inline payloads or relying on fallback surfaces first.

This coverage exists for the route/tool contract changes in `http-generic-api/routes/gptToolsRoutes.js` that expose dynamic TTL controls and extend the contract to repository automation surfaces.

## Required continuation behavior

When a governed response is chunked, callers must read the chunk stream before using fallback or secondary search surfaces.

The canonical continuation tool is:

- `response_chunk_read`

The continuation sequence is:

1. Read the current returned chunk.
2. Call `response_chunk_read` with the returned `chunk_id` and `next_cursor`.
3. Repeat until `page.has_more` is false.
4. Use fallback surfaces only after all chunks are read, the chunk cache has expired, or the authorized chunk tool is unavailable.

## Dynamic TTL controls

The chunk read schema must preserve dynamic TTL controls across Admin, Tenant, System, Device, repository inspection, and repository automation surfaces.

Supported TTL fields are:

- `chunk_ttl_ms`
- `chunk_ttl_minutes`
- `response_options.chunk_ttl_ms`
- `response_options.chunk_ttl_minutes`
- `response_chunk_ttl_ms`
- `response_chunk_ttl_minutes`

The bounded TTL policy is:

- minimum: 5 minutes
- default: 15 minutes
- maximum: 120 minutes
- extension: each successful chunk read may extend the durable cache expiry according to the requested bounded TTL

## Repository automation requirement

Repository automation and repository inspection surfaces must not drop this contract when new routes or tools are added. Any new repo automation surface that can return large result sets, file diffs, workflow inventories, tool catalogs, or branch/release diagnostics must expose a bounded response envelope with dynamic TTL support.

A route is incomplete when it exposes chunking but omits the dynamic TTL input schema, or when it can time out before a chunk envelope is created.

## Verification evidence

The runtime smoke that verifies this behavior is `response_chunk_durable_recovery_smoke`. It must verify:

- a durable response chunk row exists after the chunk id is returned
- memory-cache eviction can recover from durable storage
- UTF-16 cursor policy is preserved
- Unicode reconstruction is exact
- no secrets are returned
- sliding TTL extension is observed

## Guardrail

Do not merge a new repo automation route or tool that can exceed response budgets unless it has explicit continuation behavior and dynamic TTL schema coverage.
