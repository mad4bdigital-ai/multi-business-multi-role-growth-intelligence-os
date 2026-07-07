# Security and Governance Checklist

## Authority

- [x] No default-branch force push is allowed.
- [x] Protected branch mutation remains blocked by default.
- [x] Existing capability envelopes and typed confirmations remain required.
- [ ] Every mutation stage has a scoped capability policy.
- [ ] JIT envelope renewal is bounded and audited.

## Secrets

- [x] Spec Kit contains no secrets.
- [x] Proposed receipts store hashes and metadata, not credential payloads.
- [ ] Implementation verifies `secrets_included=false` on all evidence objects.
- [ ] Chunk collector redacts or rejects secret-like fields.

## Idempotency and replay safety

- [ ] Every mutation accepts or derives an idempotency key.
- [ ] Duplicate idempotency keys return existing receipt state.
- [ ] Ambiguous transport outcomes require readback before retry.
- [ ] Retry budget is finite and auditable.

## Failure behavior

- [ ] Stale SHA fails closed.
- [ ] Unknown mergeable state does not merge.
- [ ] Missing required checks do not merge.
- [ ] Post-merge closeout cannot silently skip required migrations or readiness checks.
