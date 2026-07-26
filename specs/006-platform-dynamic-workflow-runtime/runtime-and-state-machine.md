# Runtime, State Machines, Idempotency, and Recovery

## Runtime ownership

The platform owns definition/version, compiled plan, authority/policy, approval, canonical state, audit/transition ledger, idempotency, readback, and normalized output.

n8n, Make, MCP, HTTP, and agent runtimes are execution adapters only.

## Adapter interface

```text
resolveReadiness(context)
validateInput(plan, context)
dispatch(plan, context, idempotency)
inspect(receipt, context)
cancel(receipt, context)
readback(receipt, context)
normalizeOutput(raw, context)
```

Readiness states:

- `ready`
- `ready_requires_approval`
- `degraded`
- `blocked`
- `unsupported`

## Workflow version lifecycle

```text
draft
 -> compiled
 -> validated
 -> awaiting_approval
 -> active
 -> deprecated
 -> retired
```

Any definition change creates a new draft version.

## Run states

```text
draft
compiled
validated
awaiting_approval
ready
claimed
running
awaiting_external_callback
verifying
completed
completed_with_warnings
paused
retry_scheduled
compensating
cancelled
failed
blocked
```

## Compare-and-set transitions

Every transition includes expected state, expected monotonic version, target state, command/idempotency key, authority/approval evidence, reason, and optional external receipt.

State change, transition ledger, and outbox effects commit atomically. Stale commands return `409 STATE_VERSION_CONFLICT`.

## Claims and leases

Workers claim work with an atomic lease containing owner/token, acquired time, heartbeat, expiry, attempt, and expected run/step version.

Reclaim after expiry requires idempotency and adapter-receipt inspection to avoid duplicate external effects.

## Idempotency scopes

Separate namespaces for:

- workflow run creation;
- step dispatch;
- callback ingestion;
- approval application;
- retry scheduling;
- cancellation;
- outbox delivery;
- readback verification.

A repeated key with the same request hash returns the original result. A repeated key with a different hash returns `409 IDEMPOTENCY_KEY_REUSED`.

## Transactional outbox

The database transaction writes:

1. canonical state transition;
2. transition ledger;
3. outbox command/event;
4. idempotency result placeholder.

Dispatch occurs after commit. Delivery workers use leases, bounded retries, provider-specific backoff, and dead-letter handling.

## Callback security

Callbacks bind to exact run, step, adapter, and event type. Validation includes opaque token hash, signature/key reference, nonce, expiry, timestamp skew, content hash, idempotency key, and provider receipt correlation.

Callbacks create canonical transition commands; they never mutate run state directly.

## Retry taxonomy

- `transient_dependency`
- `rate_limited`
- `timeout_unknown_outcome`
- `validation_non_retryable`
- `authorization_non_retryable`
- `policy_non_retryable`
- `provider_rejected`
- `readback_inconclusive`
- `operator_intervention_required`

`timeout_unknown_outcome` requires inspect/readback before redispatch.

## Compensation

Compensation is explicit in the compiled plan. It requires authority, records new attempts/evidence, never deletes original evidence, may partially succeed, and does not claim atomic rollback across external providers.

## Completion rule

A run reaches `completed` only when required steps are successful, mandatory verification and readback pass, no unresolved approval/callback remains, output normalization succeeds, and audit/evidence persistence succeeds.
