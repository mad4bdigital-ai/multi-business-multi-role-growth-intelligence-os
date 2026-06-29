# Security Checklist

## Identity and scope

- [x] Tenant and workspace authority derive from authenticated context.
- [x] Cross-tenant access fails closed.
- [x] Aliases and UI exposure do not grant authority.
- [ ] Relationship revision consistency is validated in implementation tests.

## Approval and replay

- [x] Approval binds subject, action, resource, request hash, revisions, adapter, expiry, and nonce.
- [x] State-changing envelopes are single-use unless policy explicitly permits idempotent reuse.
- [x] Changed evidence makes approval stale.
- [ ] Concurrent approval and replay tests pass.

## Execution

- [x] PDP remains side-effect-free.
- [x] Every executor is a PEP or uses the shared PEP kernel.
- [x] Mutations require idempotency, audit, and readback.
- [x] Ambiguous or uncertified adapters cannot execute.
- [ ] All pilot execution boundaries are covered by integration tests.

## Secrets and evidence

- [x] Decision, approval, envelope, and evidence contracts forbid raw secrets.
- [x] External resource evidence is stored as bounded references or hashes.
- [ ] Secret-redaction tests pass for every public response and log path.

## Rollout

- [x] Shadow mode precedes enforcement.
- [x] External high-impact execution remains shadow-only initially.
- [ ] Security review, rollback rehearsal, and production parity are approved.
