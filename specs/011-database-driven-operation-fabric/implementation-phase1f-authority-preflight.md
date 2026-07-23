# Phase 1F Implementation — Plan-Only Runtime Authority Preflight

## Purpose

Compose the existing operation runtime verifier, dynamic capability enforcement shadow, and operational kill-switch policy into a bounded preflight. This phase does not create a new execution authority and does not perform dispatch.

## Authority chain

The preflight evaluates:

1. Phase 1E current-manifest and runtime-certification verification.
2. Capability-manifest enforcement using the existing MySQL-primary dynamic capability shadow.
3. Preservation of the existing legacy runtime authority decision.
4. Operational kill-switch state using the existing kill-switch policy module.
5. SHA-256 evidence bindings for required resource, credential-scope, approval, quota, audit, idempotency, rollback, compensation, and readback gates.

The preflight does not read evidence payloads. Boolean readiness enters the existing enforcement shadow, while the composition layer requires a non-secret digest for every required evidence-backed gate that passes.

## Result boundary

A successful result is `ready_for_governed_authority_handoff`. It always returns:

- `runtime_dispatch_authorized=false`;
- `runtime_authority_resolution_required=true`;
- `legacy_authority_preserved=true`;
- no envelope consumption or idempotency reservation;
- no database write, provider call, credential payload read, external write, or runtime activation.

The next stage must still resolve and consume the governed same-cycle authorities before execution.

## Evidence projection

The result includes bounded operation, manifest, dispatch, capability-gate, kill-switch, and SHA-256 evidence summaries. It omits raw resource references, capability manifest payloads, certification evidence references, credentials, provider transport details, and input payloads.

## Testing

Dependency-injected tests cover:

- a valid plan-only handoff;
- blocked Phase 1E verification;
- approval-pending adaptive authority;
- missing evidence digest;
- enabled kill switch;
- legacy authority denial;
- sensitive-field rejection;
- invariant safety flags proving no dispatch or mutation.

## Scope boundaries

This phase introduces no migration, database write, route, OpenAPI change, cache, dispatcher call, GPT tool projection, provider call, credential payload read, deployment, or merge.
