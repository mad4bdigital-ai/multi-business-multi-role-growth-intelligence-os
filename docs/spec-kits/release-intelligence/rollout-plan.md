# Release Intelligence SPEC KIT Rollout Plan

## Phase 0: Spec-only branch

Goal: land the ADMIN/TENANT SPEC KIT with no runtime behavior change.

Deliverables:

- spec manifest
- ADMIN workflow spec
- TENANT workflow spec
- API and entity contracts
- phased rollout plan

Validation:

- docs only
- no provider call
- no runtime execution
- no database mutation
- no secrets

## Phase 1: Release Operation Ledger

Add SQL tables and read-only APIs:

- `release_operations`
- `release_operation_steps`
- `release_gate_events`
- `release_operation_evidence`

Acceptance:

- create dry-run operation without execution
- read operation summary
- read evidence manifest
- tenant filtering enforced
- admin cross-tenant audit enforced

## Phase 2: Capability Envelope Template Resolver

Add registry and resolver:

- `capability_envelope_templates`
- `runtime_target_template_bindings`
- resolver API for ADMIN and TENANT

Acceptance:

- Hostinger deploy template resolves without manual app_key guessing
- tenant target resolves tenant/workspace context from target ownership
- mismatch classifications are stable

## Phase 3: Dynamic Gate Manager

Add API and service for gate lifecycle:

- open gate
- close gate
- expire gate
- hard-disable gate
- read gate status

Acceptance:

- no fixed parity IDs
- TTL required
- operation binding required
- verification run binding required for close
- orphan gate detector exists

## Phase 4: Async Deploy Contract

Wrap runtime deploy adapters with operation lifecycle:

- dispatch returns `202 Accepted` or operation status
- 503 during restart maps to `restart_in_progress` when safe
- readback loop records final classification

Acceptance:

- deploy can be verified even when restart briefly returns 503
- failure remains explicit when readback fails
- no success without verification

## Phase 5: Self-Healing Release Advisor

Advisor creates plans, not direct execution.

Acceptance:

- detects main/production mismatch
- produces safe plan
- classifies approval requirements
- creates operation draft
- does not execute deploy without envelope and approval

## Phase 6: Tenant rollout

Expose tenant-scoped readiness and advisory flows.

Acceptance:

- tenant sees only owned targets
- tenant can request operation
- tenant sees sanitized evidence
- tenant cannot execute platform-critical deploy without approval

## Phase 7: Runtime adapter expansion

Add adapters after Hostinger is stable:

- Cloud Run
- VPS SSH
- GitHub Actions
- n8n runtime
- WordPress runtime
- local connector

Acceptance:

- each adapter implements the same lifecycle interfaces
- adapter-specific failure modes map to common classifications
- readback contract exists per adapter

## Merge readiness for implementation PRs

Each implementation PR must include:

- one clear behavior change
- tests for happy path and blocked path
- no secret response assertions
- ADMIN and TENANT scope checks where applicable
- release readiness or runtime verification readback
- rollback or cleanup plan
