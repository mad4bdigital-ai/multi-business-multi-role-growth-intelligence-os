# Requirements Checklist

- [x] Every managed run has explicit tenant, user, parent ticket, capability, resource, effect, and idempotency scope.
- [x] Capability and resource grants are resolved from existing runtime authorities.
- [x] Authority snapshots are immutable and fingerprinted.
- [x] Approval policy is derived from effect and access policy.
- [x] Approval decisions verify the authenticated principal meets or exceeds `required_role`.
- [x] Revoked or drifted authority blocks step creation.
- [x] Repeated step requests reuse one step.
- [x] Generic orchestration routes cannot bypass managed enforcement.
- [x] Secret-bearing fields and recognizable secret values are rejected.
- [x] Migration 1043 is additive and remains unapplied in this PR.
- [ ] Migration ledger and readiness evidence recorded.
- [ ] Production exact-SHA and protected-user-path verification recorded.
- [ ] Cancellation, rollback, reassignment, and bounded retry completed.
- [ ] Final tenant-safe report and post-merge audit completed.
