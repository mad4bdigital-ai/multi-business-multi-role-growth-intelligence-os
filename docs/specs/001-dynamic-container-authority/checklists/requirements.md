# Requirements Quality Checklist

## Scope and decisions

- [x] Dynamic types and classifications.
- [x] Multi-parent containment with cycle prevention.
- [x] Sharing separate and read-only by default.
- [x] Explicit operation-bounded delegation.
- [x] Role templates and direct assignments.
- [x] Activity and Workflow container types.
- [x] No implicit `platform_owner` bypass.
- [x] Two approvers for destructive/credential/deployment overrides.
- [x] 15/60 minute TTLs.
- [x] Authority epoch and immutable snapshots.
- [x] Bounded deterministic traversal.

## Security

- [x] Authorization before credentials.
- [x] Passive preview.
- [x] Deny/restrict precedence.
- [x] Cross-tenant rejection.
- [x] Ambiguity blocks.
- [x] Delegation cannot exceed delegator authority.
- [x] Override scope, expiry, one-time consumption, and stale-snapshot rules.
- [x] Distinct approvers.
- [x] No secrets in bindings, caches, ledgers, logs, or responses.
- [x] Threat model documented.

## Data and performance

- [x] Canonical authority separated from graph projection.
- [x] Additive schema and legacy adapters.
- [x] Bounded traversal, closure, and indexes.
- [x] Proposed initial limits.
- [ ] Benchmark and approve p95/p99 budgets.
- [ ] Complete migration statement count and rollback SQL in implementation PR.

## API

- [x] OpenAPI 3.1 additive contracts.
- [x] Strict schemas.
- [x] 400/401/403/404/409/422/429/503 classes.
- [x] Stable errors.
- [x] Idempotency and optimistic concurrency represented.
- [ ] Finalize route scopes before implementation.

## Testing and rollout

- [x] Multi-parent, cycle, conflict, deny, sharing, delegation, stale epoch, replay, and audit cases.
- [x] Shadow-first, read-only canary, bounded mutation, non-destructive rollback.
- [ ] Approve mismatch thresholds.
- [ ] Approve performance limits.
- [ ] Complete rollback drill.

## Design-freeze approval gate

- [ ] Domain review.
- [ ] Security review.
- [ ] Database/index review.
- [ ] API contract review.
- [ ] Performance review.
- [ ] Rollout/rollback review.
- [ ] Confirm auth-lifecycle repair remains separate.
