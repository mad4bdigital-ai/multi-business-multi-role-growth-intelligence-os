# Production Recovery durable evidence adapters — #7999

This source-only MVP slice closes two deferred authorities from the Production Recovery composition without enabling live execution.

## Implemented

- **Immutable partial-mutation receipt authority** backed by the existing independent Recovery Control Store.
  - `receipt_id` is used as the existing store idempotency key.
  - `run_id` is derived from the canonical SHA-256 of the complete receipt.
  - Replaying the exact receipt is idempotent.
  - Rebinding the same `receipt_id` to different content fails through the existing Recovery Control Store idempotency invariant.
  - Receipt content is read back after persistence before success is returned.
  - Sensitive credential-bearing fields are rejected.

- **Production durable role-selection proof resolver** wrapping the canonical `resolveDurableRoleSelectionProof` authority.
  - Only the durable GitHub inspection-run reference is accepted from the request.
  - Caller-selected roles, fingerprints, finding IDs, or evidence hashes are not forwarded as authority.
  - Exact Production SHA, target key, selected-role rebuild operation, and canonical proof digests remain mandatory.
  - Resolution stays read-only.

## Deliberately not implemented

These remain blockers and are not faked by this slice:

- mutation executor;
- Hostinger host-local mutation executor;
- independent role-aware readback verifier;
- Governance Migration Ledger adapter.

The Governance Migration Ledger remains a separate durable authority and is not stored in the Recovery Control Store.

## Activation boundary

This module is not runtime wiring. Construction performs no database connection, GitHub dispatch, provider call, deployment, migration, grant, or Production mutation. `production_live` remains disabled. A later reviewed canary must compose the remaining four authorities and pass fresh non-Production certification before any Production activation decision.
