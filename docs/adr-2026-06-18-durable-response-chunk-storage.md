# ADR: Durable Storage for Governed Tool Response Chunks

- **Status:** Proposed for merge
- **Date:** 2026-06-18

## Context
The governed tool dispatcher exposes cursor-based continuation for oversized JSON responses. The original cache was process-local, so a restart, deployment, or request landing on another process could make an unexpired `chunk_id` unreadable.

## Decision
Use MySQL as the durable authority and retain the process-local map as a hot cache. Persist the complete serialized JSON before returning a chunk identifier. Store SHA-256, UTF-8 byte length, expiry, redaction state, and cursor policy. Recover from SQL on memory miss and verify integrity before slicing.

## Consequences
- Continuations survive process restarts and cross-process routing.
- Chunk creation depends on database availability and fails closed with `503 response_chunk_persistence_unavailable` when durable storage is unavailable.
- Read latency increases only on memory misses.
- Storage grows until expired rows are cleaned; the expiry index supports bounded cleanup.
- The public continuation contract remains backward compatible.

## Alternatives Considered
- **Memory only:** rejected because it cannot survive restart or process changes.
- **Redis:** not selected because MySQL is already the primary governed runtime authority and no new dependency is justified.
- **Embed payload in the token:** rejected due to response size, disclosure, and integrity risks.

## Rollback
Revert the runtime wiring while leaving the additive table in place. Do not drop the table during emergency rollback; any destructive schema removal requires a separate reviewed migration and retention decision.
