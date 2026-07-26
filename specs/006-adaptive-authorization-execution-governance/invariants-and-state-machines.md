# Invariants and State Machines

## Purpose

Define rules that implementation, migrations, APIs, dashboards, workers, and adapters may not violate.

## Authority invariants

1. An alias, route, tool, UI control, plugin discovery result, or adapter registration never grants authority.
2. Tenant scope comes from authenticated authority and cannot be widened by request input.
3. A relationship proves structural authority but does not activate a capability grant unless policy explicitly marks the grant as unnecessary.
4. A capability grant proves enabled authority but does not bypass relationship or resource ownership checks.
5. A hard deny cannot be overridden by a lower-priority allow.
6. Missing or ambiguous mandatory authority fails closed.
7. Every state-changing dispatch is authorized again at the final execution boundary.
8. No adapter may execute a capability version for which it is not certified.
9. No approval may authorize a request whose normalized evidence differs from the approved evidence.
10. A decision cannot silently substitute another tenant, resource, capability version, adapter, or credential scope.

## Presentation invariants

1. `grant=active` remains active when `approval=required`.
2. `ready_requires_approval` is not `pending`, `inactive`, or `blocked`.
3. Execution success and verification success are separate states.
4. Display projections are derived and never become authorization sources.
5. Counts MUST report at least active grants, approval-gated active grants, immediately executable capabilities, blocked capabilities, and stale capabilities separately.

## Decision invariants

1. The policy decision point is side-effect-free.
2. Every decision records a revision vector and expiry.
3. Identical normalized input and revision vector produce identical effect and obligations.
4. `conditional` is not executable until obligations are satisfied.
5. Bounded explanations expose reason codes, not credentials or raw cross-tenant evidence.
6. The selected adapter is deterministic or the decision is blocked as ambiguous.

## Approval invariants

1. Approval decisions are append-only.
2. Rejection, expiry, revocation, or staleness cannot be overwritten as approval.
3. Self-approval is denied unless the effective policy explicitly permits it.
4. High-impact approval binds subject, capability version, action, resource, request hash, policy revision, relationship revision, grant revision, adapter version, expiry, and nonce.
5. Changed bound evidence invalidates approval.
6. Expired approval cannot be renewed by changing its timestamp. A new approval decision is required.

## Envelope invariants

1. State-changing envelopes are single-use by default.
2. An envelope cannot move from `consumed`, `expired`, `stale`, or `revoked` back to a ready state.
3. Reuse is permitted only for an explicitly idempotent operation with identical request hash and authority revisions.
4. Envelope payloads never contain raw credentials.
5. Consumption is concurrency-safe and must permit at most one winning executor.

## Execution invariants

1. Every unsafe retryable operation requires an idempotency key.
2. Reusing an idempotency key with a different request hash returns a conflict.
3. Provider acknowledgement is not equivalent to verified desired state.
4. Mutating capabilities require a readback contract or an explicit, reviewed `verification_not_supported` classification.
5. Compensation is recorded as a separate outcome and never rewrites original execution evidence.
6. Every attempt is auditable by subject, decision, envelope, adapter, resource, timestamps, and bounded evidence references.

## Grant state machine

```text
active -> suspended
active -> revoked
active -> expired
suspended -> active
suspended -> revoked
suspended -> expired
expired -> terminal
revoked -> terminal
```

A new grant row or version is required after a terminal state.

## Approval state machine

```text
required -> approved
required -> rejected
required -> expired
approved -> consumed
approved -> stale
approved -> revoked
approved -> expired
rejected -> terminal
consumed -> terminal
stale -> terminal
revoked -> terminal
expired -> terminal
```

## Execution envelope state machine

```text
created -> ready_requires_approval
created -> ready_for_dispatch
created -> blocked
ready_requires_approval -> ready_for_dispatch
ready_requires_approval -> expired
ready_requires_approval -> stale
ready_for_dispatch -> dispatch_reserved
ready_for_dispatch -> expired
ready_for_dispatch -> stale
ready_for_dispatch -> revoked
dispatch_reserved -> consumed
dispatch_reserved -> ready_for_dispatch only when reservation safely expires before provider dispatch
consumed -> terminal
blocked -> terminal
expired -> terminal
stale -> terminal
revoked -> terminal
```

## Execution state machine

```text
not_started -> queued
not_started -> running
queued -> running
queued -> failed
running -> succeeded
running -> failed
succeeded -> compensated
failed -> compensated when partial external effect exists
```

Execution state and verification state advance independently.

## Verification state machine

```text
not_applicable -> terminal
pending -> acknowledged
pending -> observed
pending -> incomplete
acknowledged -> observed
acknowledged -> incomplete
observed -> verified
observed -> mismatched
observed -> incomplete
verified -> terminal
mismatched -> reconciliating
incomplete -> reconciling
reconciling -> verified
reconciling -> mismatched
reconciling -> compensated
```

## Illegal transitions

Examples that MUST fail with a structured conflict:

- `expired -> approved`
- `consumed -> ready_for_dispatch`
- `revoked_grant -> active` by timestamp update
- `rejected_approval -> approved` by row mutation
- `succeeded_execution -> not_started`
- `verified -> pending`
- `ambiguous_binding -> adapter_selected` without a new decision revision

## Derived readiness

```text
ready =
  availability active
  and binding resolved
  and relationship satisfied
  and grant active or not_required
  and authorization allowed
  and approval approved or not_required
  and freshness current

ready_requires_approval =
  availability active
  and binding resolved
  and relationship satisfied
  and grant active or not_required
  and authorization conditional
  and approval required
  and freshness current
```

Derived readiness is recalculated from source states and is never persisted as independent authority.
