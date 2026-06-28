# Feature Specification: SQL Cache Resilience

**Branch**: `gpt/006-sql-cache-resilience-20260628`  
**Status**: In progress  
**Delivery mode**: `multi_pr`

## Problem

The SQL compatibility cache reads complete allowlisted tables with `SELECT *`, serializes each complete result as one Redis value, and shares Redis transport with queue/job/idempotency workloads. Current runtime evidence shows repeated values around 17.2 MB exceeding the 10 MiB provider request limit. The `endpoints` registry is the highest-impact source because list reads include thousands of rows and large `schema_json` contracts.

## Goals

- Keep MySQL as runtime authority and Redis as optional acceleration.
- Prevent oversized cache writes before transport.
- Isolate cache failures from BullMQ, job state, and idempotency.
- Replace runtime-critical complete-table reads with bounded repository queries.
- Exclude contract blobs from list/search projections.
- Enforce tenant-safe cache keys and no-secret cache policy.
- Add deterministic tests, observability, rollout, rollback, and production verification.

## Non-goals

- Replacing MySQL or Redis technology.
- Caching raw credentials or authorization material.
- Migrating every legacy compatibility caller in one PR.
- Applying production configuration or migrations in this specification PR.

## Requirements

- **FR-001**: MySQL MUST remain authoritative; cache failure MUST be nonfatal.
- **FR-002**: Cache serialization MUST be measured with UTF-8 byte length before Redis `SET`.
- **FR-003**: Default maximum cache value MUST be 1,048,576 bytes and configurable below the provider request ceiling.
- **FR-004**: Oversized values MUST return `skipped_oversize`, skip transport, and preserve the loader result.
- **FR-005**: Cache outcomes MUST be structured: `hit`, `miss`, `stored`, `skipped_oversize`, `unavailable`, `circuit_open`, or `error`.
- **FR-006**: SQL cache MUST use a dedicated Redis client; BullMQ/job/idempotency clients MUST remain independent.
- **FR-007**: Cache client retries and timeouts MUST be bounded and offline queueing disabled.
- **FR-008**: Concurrent misses for one effective key MUST share one in-process loader promise.
- **FR-009**: Transport failures MUST open a bounded circuit; oversize keys MUST enter bounded cooldown.
- **FR-010**: Cache keys MUST use a new version namespace and include every required tenant/workspace/user/brand/connection scope.
- **FR-011**: Unfiltered complete-table caching MUST be forbidden for tenant/user-scoped or secret-capable data.
- **FR-012**: Endpoint execution MUST use a point query over `parent_action_key`, `endpoint_key`, and active status.
- **FR-013**: Endpoint list/search MUST use explicit projections, stable ordering, bounded pagination, and omit `schema_json`.
- **FR-014**: `schema_json` MUST be loaded only for the selected endpoint detail/contract operation.
- **FR-015**: Registry mutation invalidation MUST use exact keys or generation/version keys; broad request-path scans are forbidden.
- **FR-016**: Same-cycle mutation readback MUST bypass cache.
- **FR-017**: Metrics MUST cover hit, miss, store, oversize skip, error, circuit state, loader duration, and byte size without payloads or raw scope IDs.
- **FR-018**: Existing public API contracts MUST remain backward compatible.
- **FR-019**: Any index addition MUST be additive and justified by governed index inventory and `EXPLAIN` evidence.
- **FR-020**: Feature flags MUST permit independent rollback of cache v2, endpoint repository reads, and dedicated cache transport.

## Security requirements

- Raw credentials, tokens, passwords, API keys, private keys, authorization headers, and encrypted credential payloads MUST NOT enter cache values, logs, metrics, or keys.
- Missing required cache scope MUST bypass cache rather than fall back to a global key.
- Cache bypass MUST NOT bypass authentication, authorization, resource authority, approval, or readback controls.

## Success criteria

- A 17 MB fixture causes zero Redis `SET` calls.
- Unicode boundary tests enforce bytes, not JavaScript character count.
- Cache Redis outage leaves SQL reads successful and queue health unchanged.
- Endpoint metadata lists contain no `schema_json` and enforce bounded pagination.
- Endpoint contract resolution performs one selected-record query and detects duplicate active matches.
- Cross-tenant key collision and secret-capable field tests pass.
- Production observation records zero oversized cache writes and no cache-caused queue degradation.
