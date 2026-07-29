# Implementation PR-2A: Activation Lifecycle Contracts

## Status

Repository-only contract foundation for Spec 012 tasks T015-T017. This document does not change runtime behavior, canonical OpenAPI, SQL, registry authority, credentials, providers, deployment, or production state.

## Contract authority

This contract consolidates and makes testable the state, error, reconnect, and compatibility rules already defined by:

- `spec.md` functional requirements and error taxonomy;
- `data-model.md` lifecycle entities, state catalog, and transition rules;
- `contracts/tenant-activation-lifecycle.openapi.yaml` proposed enums and response shapes;
- ADR-002 phased legacy-audience cutoff.

The machine-readable companion file is `pr-2a-lifecycle-contracts.json`.

## Operation lifecycle

### Non-terminal states

`created`, `authenticating`, `authorized`, `resolving_session`, `bootstrapping`, `validating`, `preparing_tools`, `ready`, `executing`, `readback_pending`, `delivery_pending`, `acknowledgement_pending`, `retry_scheduled`, `unknown_outcome`, and `reconciling`.

### Stable or terminal reported states

`active`, `degraded`, `authorization_gated`, `validation_rate_limited`, `contract_degraded`, `failed`, `cancelled`, and `rolled_back`.

`active` is evidence-backed successful completion for the current Activation operation. The other stable outcomes close the current attempt honestly; a later governed retry may create a new attempt or linked operation without rewriting the earlier outcome.

### Core transition rules

- `created → authenticating | authorized`.
- `authenticating → authorized | authorization_gated | failed`.
- `authorized → resolving_session` only after gateway and principal verification.
- `resolving_session → bootstrapping | authorization_gated | degraded`.
- `bootstrapping → validating | ready | degraded`.
- `validating → ready | degraded | validation_rate_limited | contract_degraded`.
- `ready → active` for readiness-only activation.
- `ready → executing` only for a separately permitted action.
- `executing → readback_pending` when authoritative completion evidence is required.
- `readback_pending → active | degraded | failed | unknown_outcome`.
- Ambiguous mutation transport produces `unknown_outcome → reconciling`; it never permits blind replay.
- `reconciling → active | degraded | failed | unknown_outcome` according to authoritative readback.
- A governed retry may enter `retry_scheduled`, then resume at the earliest failed/retryable stage or reconciliation stage. It must use a new monotonic stage attempt and preserve prior evidence.
- `cancelled` and `rolled_back` are terminal for the current operation.

No transition may enter `active` without required same-operation evidence/readback. Recovered success may not be inferred from an unrelated later operation.

## Stage-attempt lifecycle

Stage attempts are append-only and use:

- `pending → running | cancelled`;
- `running → succeeded | degraded | failed | unknown_outcome | cancelled`.

`succeeded`, `degraded`, `failed`, `unknown_outcome`, and `cancelled` are terminal for that attempt. Reconciliation is recorded separately; it does not rewrite an `unknown_outcome` attempt. A retry creates the next unique `(operation_id, stage_key, attempt_number)`.

## Delivery lifecycle

A delivery record is one delivery attempt and uses:

- `prepared → sent | failed | expired`.

`sent`, `failed`, and `expired` are terminal for that delivery attempt. Retrying delivery creates a new delivery attempt keyed by operation, channel, and monotonic attempt number. Delivery status does not rewrite Activation execution success.

## Acknowledgement lifecycle

Acknowledgement records use the stable states `acknowledged`, `rejected`, and `expired`. They are idempotent final consumer observations and do not rewrite execution or delivery outcomes.

## Error and reconnect policy

Reconnect guidance is permitted only when the verified failing stage is authentication/connection authorization. It is forbidden for membership, workspace, bootstrap, connection readiness, provider validation, tool readiness, contract, deployment, delivery, acknowledgement, or unknown-outcome failures.

Stable public codes are frozen in the machine-readable contract. Each code binds HTTP status, stage, retryability, reconnect behavior, user action, and required readback evidence.

Deployment mismatch never produces reconnect guidance.

## Compatibility contract

- Existing OAuth client credentials, public hosts, callback, and documented Tenant Activation URLs remain stable unless a separately approved migration changes them.
- Additive response fields remain optional during migration; existing required fields may not be removed or renamed.
- Proposed operation/status endpoints remain specification-only until canonical OpenAPI adoption, consumer review, generated parity, and governed rollout.
- New resource-bound tokens remain the only target token profile.
- Legacy generic-audience acceptance follows ADR-002 and emits no-secret compatibility telemetry.
- Hard cutoff: `2026-10-31T23:59:59Z`.
- Before cutoff, a still-valid accepted legacy token does not trigger reconnect guidance.
- At and after cutoff, an unbound legacy token is rejected with stable `401` authentication semantics and reconnect guidance.
- Emergency extension is not automatic, is limited to 14 days, and may not extend beyond `2026-11-14T23:59:59Z` without a new ADR/security decision.
- Compatibility code may be removed only after at least 30 days of zero accepted legacy usage after the hard cutoff and after rollback risk is closed.

## Deferred implementation

This PR does not:

- wire a runtime state machine;
- change canonical/generated OpenAPI;
- apply the PR-2 migration;
- register migration or runtime policy rows;
- activate retry, reconciliation, delivery, or acknowledgement behavior;
- mark T015-T017 complete before machine-readable parity tests and CI succeed.
