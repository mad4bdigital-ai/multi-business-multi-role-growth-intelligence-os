# Implementation PR-2B: Lifecycle Operation Service

## Status

Domain/runtime service foundation only. This slice does not wire public routes, apply migrations, activate registries, deploy, restart, call providers, read credentials, send external messages, or mutate production.

## Scope

This slice implements the service boundary for Spec 012 tasks T027 and T029 on top of the already-merged lifecycle contracts and additive persistence foundation.

It adds:

- `activationRetryReconciliationPolicy.js` for governed retry authorization and deterministic reconciliation outcome classification;
- `activationLifecycleOperationService.js` for transaction-bound operation transitions, optimistic version enforcement, monotonic stage attempts, same-operation evidence checks, governed retry scheduling, and reconcile-before-retry handling;
- `test-activation-lifecycle-operation-service.mjs` for offline deterministic regression coverage;
- explicit CI registration.

## Invariants

- `unknown_outcome` cannot be replayed or scheduled for retry before reconciliation.
- Stable retry states require a governed approval reference.
- Every retry creates a new monotonic stage attempt.
- `active` requires bounded evidence associated with the same operation.
- Reconciliation never executes the original mutation.
- `executed` reconciliation can recover success only with same-operation evidence.
- `not_executed` returns the operation to `degraded`; any later replay still requires governed retry approval.
- Delivery and acknowledgement overlays remain outside this service and cannot rewrite execution outcome.
- All mutations are transaction-bound and optimistic-version checked.

## Persistence boundary

The service composes the existing `activationOperationProjectionRepository.js` foundation and the additive tables declared by migration `20260724_activation_operation_projection_foundation.sql`.

The migration remains unapplied and unauthorized in this slice. The service is not wired into runtime routes until a later governed integration PR confirms migration readiness and readback.

## Validation

The regression test uses a deterministic in-memory repository adapter and verifies:

- valid operation transitions and optimistic version increments;
- monotonic stage attempt numbering;
- stage attempt terminal semantics;
- same-operation evidence before `active`;
- denial of blind retry from `unknown_outcome`;
- governed retry approval for stable failure states;
- reconciliation transitions for `still_unknown` and `not_executed`;
- terminal-state retry denial;
- no premature route/runtime wiring.

## Deferred work

- Apply and verify the additive migration under its own governed capability envelope.
- Wire the service into Activation route orchestration and dual-write/readback flows.
- Implement delivery, acknowledgement, status, observability, and production smoke slices.
- Record T027 and T029 completion only after merge and same-cycle `main` readback.
