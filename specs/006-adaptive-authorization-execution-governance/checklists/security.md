# Security Checklist

## Identity and scope

- [x] Tenant and workspace authority derive from authenticated context.
- [x] Cross-tenant access fails closed.
- [x] Aliases and UI exposure do not grant authority.
- [ ] Relationship revision consistency is validated in implementation tests.

## Approval and replay

- [x] Approval binds subject, action, resource, request hash, revisions, adapter, expiry, and nonce.
- [x] State-changing envelopes are single-use unless policy permits bounded idempotent reuse.
- [x] Changed evidence makes approval stale.
- [ ] Concurrent approval and replay tests pass.

## Execution and evidence

- [x] The decision point remains side-effect-free.
- [x] Every executor is an enforcement point or uses the shared kernel.
- [x] Mutations require idempotency, audit, and readback.
- [x] Ambiguous or uncertified adapters cannot execute.
- [x] Public contracts forbid credential material and store bounded evidence references.
- [ ] Integration and redaction tests pass for every pilot boundary.

## Rollout

- [x] Shadow mode precedes enforcement.
- [x] External high-impact execution remains shadow-only initially.
- [ ] Security review, rollback rehearsal, and production parity are approved.
