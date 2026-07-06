# Capability Enablement Broker Operational Runbook

This runbook captures the first production-safe handoff pattern for the Capability Enablement Broker.

## Purpose

The broker diagnoses whether a requested capability can move from readiness analysis to a governed handoff. It remains diagnose-only and must not execute providers, read credential payloads, issue approvals, grant apply authority, or perform external mutations.

## Ready handoff contract

A request is handoff-ready only when all of the following are true:

- `decision = ready_for_dispatch`
- `effective_capability.status` is ready, including `virtual_admin_tool_ready` for guarded Admin virtual tools.
- `checks.envelope = approved`
- `dry_run.decision = ready_for_dispatch`
- `dry_run.gates.dispatch_allowed = true`
- `dry_run.gates.apply_allowed = false`
- `provider_calls_made = 0`
- `external_mutations_executed = false`
- `secrets_included = false`

## First real handoff evidence

The first real handoff used `repo_patch_apply` to create this runbook after a fresh `capability_enablement_resolve` returned `ready_for_dispatch` with an approved capability envelope. This proves the broker can graduate an Admin virtual tool from diagnosis to a governed dispatch handoff without bypassing capability envelopes or readback policy.

## Operational dashboard

Operators should track:

- Latest decisions by capability, operation, tenant, and workspace.
- Common reason codes such as `ENVELOPE_APPROVAL_REQUIRED`, `ENVELOPE_EXPIRED`, `CAPABILITY_NOT_REGISTERED`, `CAPABILITY_BINDING_MISSING`, `WORKSPACE_CONTEXT_MISSING`, and `SECRET_BOUNDARY_FAILED`.
- Handoff readiness counts for `ready_for_dispatch` and `needs_approval`.
- Expired-envelope and policy-denied queues.

## Safety notes

The broker is not an execution engine. Actual execution still requires the target tool's own typed confirmation, capability envelope, CI/readback gates, idempotency controls, and audit trail.
