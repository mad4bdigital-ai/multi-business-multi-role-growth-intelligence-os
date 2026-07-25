# Phase 1L Implementation — Durable Operation Lifecycle

## Purpose

Implement Spec 011 task T305 as an additive persistence and application-service slice for durable status, checkpoints, approval, callbacks, cancellation requests, resume planning, and recovery classification.

## Authority reuse

The implementation does not create another run system. It reuses:

- `repository_automation_runs` as the run execution authority;
- `repository_automation_step_runs` as ordered step and attempt evidence;
- `operation_run_ownership` for Tenant, workspace, and user ownership;
- `operation_run_revision_pins` for the immutable revision bundle and resource fingerprint.

## Additive persistence

`operation_run_lifecycle_state` stores one optimistically versioned lifecycle record per run. It contains no execution payload and does not authorize dispatch.

`operation_run_lifecycle_events` stores one immutable event per state revision. `(run_id,event_key)` provides command and callback deduplication, while `(run_id,state_revision)` prevents multiple histories for the same transition.

Both tables use restrictive foreign keys and expose no delete path.

## Commands

The service supports:

- `initialize` at expected revision zero;
- `checkpoint` into awaiting-approval, awaiting-callback, awaiting-input, or interrupted states;
- `approve` and `reject` for an approval checkpoint;
- `callback` with command-ID and payload-hash deduplication;
- `cancel` as a durable cancellation request that blocks future dispatch;
- `resume` as a plan beginning at the first incomplete step;
- `recover` as a bounded classification and recovery-pending decision.

Every new command requires the expected state revision, current revision-bundle hash, current resource fingerprint, ownership context, a stable command ID, and a non-secret canonical payload.

## Consistency and idempotency

Commands lock the governed run context and lifecycle state, check an existing event key before optimistic revision validation, and therefore permit exact replay after the state has advanced. Reuse of an event key with a different payload fails with a conflict.

State and event writes occur in one transaction. The service reads both records back before commit and fails closed on a mismatch.

## Resume and recovery

Resume planning reads ordered step-run evidence and selects the first step whose status is not completed, succeeded, successful, or skipped. Completed steps are returned separately and are never placed in the pending list. The result always reports `dispatch_authorized=false`.

Recovery distinguishes terminal runs, external-signal waits, failed-run manual review, interrupted resumable work, and the absence of an incomplete step. It records classification only; it does not execute a retry.

## Status projection

Status reads return bounded event pages using an integer cursor and limit, plus non-secret run, lifecycle, revision, resource, and resume-plan evidence. Reads perform no write.

## Security

Lifecycle payloads are validated recursively before database access. Credential payloads, authorization headers, cookies, provider or endpoint URLs, tokens, private keys, passwords, and secret values are rejected. Safety markers must be explicitly false.

## Scope boundaries

This phase adds migration and application-service code only. It does not apply the migration, expose a route, change OpenAPI, execute a run, dispatch a step, call a provider, read credentials, activate runtime behavior, deploy, or merge. Public lifecycle endpoints remain a separate governed follow-up.
