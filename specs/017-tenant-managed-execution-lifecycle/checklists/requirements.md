# Requirements Checklist

- [x] Every managed run has explicit tenant, user, parent ticket, capability, resource, effect, and idempotency scope.
- [x] Authenticated non-admin tenant/user identity cannot be overridden by request-body identifiers.
- [x] Managed reads, steps, and status changes enforce the authenticated tenant/requester scope.
- [x] Capability and resource grants are resolved from existing runtime authorities.
- [x] Authority snapshots are immutable and fingerprinted.
- [x] Approval policy is derived from effect/access policy.
- [x] Approval decisions require platform admin authority or active same-tenant membership with the required role or tenant owner/admin authority.
- [x] Revoked or drifted authority blocks step creation.
- [x] Repeated step requests reuse one step.
- [x] Generic orchestration routes cannot bypass managed enforcement.
- [x] Preserved legacy workflow routes remain discoverable through an explicit non-runtime source bridge in the directly mounted builder.
- [x] Secret-bearing payload fields and recognizable secret values are rejected.
- [x] Migration is additive and remains unapplied in this PR.
- [ ] Migration ledger and readiness evidence recorded.
- [ ] Production exact-SHA and protected-user-path verification recorded.
- [ ] Cancellation, rollback, reassignment, and bounded retry completed.
- [ ] Final tenant-safe report and post-merge audit completed.
