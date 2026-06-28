# Release Readiness Checklist

## Implementation

- [ ] Cache byte guard, structured outcomes, single-flight, circuit breaker, and cooldown are implemented.
- [ ] Dedicated cache Redis client is implemented and isolated from BullMQ/job/idempotency.
- [ ] Endpoint point lookup and bounded metadata list are implemented.
- [ ] Scope-safe keys and generation invalidation are implemented.
- [ ] Runtime-critical complete endpoint-table caching is removed.

## Security and validation

- [ ] Secret-capable tables and fields are excluded.
- [ ] Cross-tenant, invalid-input, oversize, Unicode, outage, and duplicate-row tests pass.
- [ ] Logs and health responses contain metadata only.
- [ ] Full CI, architecture, schema, canonical, and Spec Kit gates pass.

## Database and rollout

- [ ] Governed index inventory and `EXPLAIN` evidence are complete.
- [ ] Conditional migration decision and ledger evidence are recorded.
- [ ] Dev/staging and canary production verification pass.
- [ ] Observation records zero oversized writes and stable queue health.
- [ ] Rollback rehearsal, release readiness, post-merge audit, and closeout PR are complete.
