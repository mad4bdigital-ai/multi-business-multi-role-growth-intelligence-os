# Capability Enablement Broker Operational Runbook

This runbook captures the production-safe handoff pattern for the Capability Enablement Broker.

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

## Operational dashboard

Operators should track latest decisions, common reason codes, handoff readiness counts, expired-envelope queues, policy-denied queues, and safety counters for provider calls, external mutations, and secrets.

## Safety notes

The broker is not an execution engine. Actual execution still requires the target tool's own typed confirmation, capability envelope, CI/readback gates, idempotency controls, and audit trail.
