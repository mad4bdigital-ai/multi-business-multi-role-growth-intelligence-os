# Dynamic Capability Governance Security Checklist

## Identity and isolation

- [x] Canonical capability identity precedes security policy.
- [x] Aliases and projections are explicitly non-authoritative.
- [x] Tenant/Admin exposure separation is mandatory.
- [x] Tenant and user identity are derived from signed authentication.
- [x] Cross-tenant and foreign-resource denial is specified.

## Mutation and approval

- [x] Unknown classification fails closed.
- [x] Every mutation class has minimum obligations.
- [x] State-changing envelopes are single-use by default.
- [x] Approval binds capability, resource, request hash, revision, and expiry.
- [x] Idempotency and unknown-provider-effect behavior are defined.

## Credentials and adapters

- [x] Pending, invalid, revoked, expired, or wrong-scope credentials cannot execute.
- [x] Adapters cannot choose broader credentials or authority.
- [x] Adapter certification is versioned and drift-sensitive.
- [x] Provider acknowledgement is separate from verified success.
- [x] Secret values are forbidden in manifests, projections, evidence, and logs.

## Implementation verification

- [ ] Cross-tenant tests deny before credential/provider access.
- [ ] Selector ambiguity and Admin-alias Tenant requests deny.
- [ ] Approval/envelope replay and stale revision tests deny.
- [ ] Secret scanners pass for all response and evidence contracts.
- [ ] Uncertified/stale adapters and missing readback contracts deny.
- [ ] Rollback preserves containment and evidence.
- [ ] Security review approves each high-impact cohort.
