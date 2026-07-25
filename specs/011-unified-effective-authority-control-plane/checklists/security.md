# Security Checklist

- [x] Tenant request parameters cannot expand signed scope.
- [x] Zero tenant ID is not Admin proof.
- [x] No generic Admin execution bypass is allowed.
- [x] Actor remains visible during delegation.
- [x] Impersonation is explicit, expiring, operation-bound, and audited.
- [x] Global visibility is separated from mutation.
- [x] Tool visibility is not execution authority.
- [x] Ambiguous resource/connection selection fails closed.
- [x] High-risk dispatch revalidates mutable authority.
- [x] Approval is request/resource/revision bound and single-use.
- [x] Shadow decisions cannot execute.
- [x] Resource inheritance is bounded and restriction-aware.
- [x] Cross-tenant explanations are redacted.
- [x] Secrets are forbidden from manifests and ledgers.
- [x] PDP outage cannot trigger local mutation bypass.
- [x] Versioned invalidation and reconciliation are required.

## Implementation gates

- [ ] Threat model reviewed by security owner.
- [x] Cross-tenant negative tests pass.
- [ ] Break-glass policy receives separate approval.
- [ ] Decision-ledger retention and access are approved.
- [x] Secret-like schema rejection is tested.
- [ ] Policy publication and rollback are governed.
