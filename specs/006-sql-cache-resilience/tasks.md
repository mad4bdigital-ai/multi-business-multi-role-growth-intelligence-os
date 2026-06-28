# Tasks

## Specification

- [x] **T001** Define the complete-table Redis oversize failure mode.
- [x] **T002** Define MySQL authority and optional-cache invariants.
- [x] **T003** Define byte guard, Redis isolation, focused repositories, scope safety, and invalidation.
- [x] **T004** Define phased rollout, rollback, production verification, and audit.

## Containment

- [ ] **T005** Capture current cache error frequency and runtime status.
- [ ] **T006** Apply temporary cache disablement or restrictive safe allowlist.
- [ ] **T007** Verify queue/job/idempotency health and record containment evidence.

## Cache safety

- [ ] **T008** Add validated 1 MiB default maximum value size.
- [ ] **T009** Measure UTF-8 serialized bytes before Redis transport.
- [ ] **T010** Add structured outcomes and no-payload metrics/logs.
- [ ] **T011** Add single-flight, circuit breaker, oversize cooldown, and bounded cleanup.
- [ ] **T012** Add 17 MB and Unicode regression tests.

## Redis isolation

- [ ] **T013** Introduce dedicated cache Redis client and `CACHE_REDIS_URL`.
- [ ] **T014** Add bounded retries/timeouts and disabled offline queue.
- [ ] **T015** Prove cache failure does not affect BullMQ/job/idempotency.

## Repository reads

- [ ] **T016** Implement endpoint metadata pagination without `schema_json`.
- [ ] **T017** Implement selected endpoint contract point lookup and duplicate detection.
- [ ] **T018** Migrate endpoint execution and action/policy resolution.
- [ ] **T019** Inventory and migrate remaining runtime-critical whole-table callers.
- [ ] **T020** Add mapping, parity, and invalid-input tests.

## Scope and invalidation

- [ ] **T021** Introduce `sql:v2` keys and cacheability metadata.
- [ ] **T022** Enforce required tenant/workspace/user/brand/connection scopes.
- [ ] **T023** Exclude secret-capable fields and tables.
- [ ] **T024** Add generation invalidation and direct-SQL mutation readback.
- [ ] **T025** Add cross-tenant collision and stale-generation tests.

## Database, documentation, and rollout

- [ ] **T026** Run governed index inventory and `EXPLAIN`.
- [ ] **T027** Create/apply additive migration only if required, with ledger evidence.
- [ ] **T028** Update runbook, configuration, architecture, canonicals, knowledge guide, and OpenAPI when applicable.
- [ ] **T029** Pass focused and full CI validation.
- [ ] **T030** Complete staging, canary, production observation, and rollback rehearsal.
- [ ] **T031** Record release readiness and post-merge audit.
- [ ] **T032** Open closeout PR and mark completion only after all evidence exists.
