# Phase 0 Inventory and Reuse Decision Record

## Purpose

Establish the authoritative baseline for Spec 011 before runtime implementation or migration design. The governing rule is reuse-first: existing SQL, runtime, approval, capability, receipt, and evidence surfaces are extended or adapted before any parallel subsystem is proposed.

## Evidence basis

- Repository base: `9f2319aed27a311593c254120ec80a52fa380426`.
- SQL authority: production registry and lifecycle tables inspected through governed read-only DB access.
- Runtime authority reviewed: operation contract registry, execution envelope kernel, scoped approval kernel, execution concurrency kernel, repository automation control plane, release-operation ledger, and capability readback contracts.
- This record contains no credential values, provider payloads, or mutation authority.

## Runtime snapshot

| Surface | Rows | Decision |
|---|---:|---|
| `approval_holds` | 4371 | Reuse directly as the human approval lifecycle and identity-bound hold surface. |
| `capability_resolution_envelope_ledger` | 4620 | Reuse directly for capability-envelope lifecycle, approval linkage, expiry, and dispatch readiness. |
| `execution_plans` | 24 | Reuse as the plan-level durable execution anchor after contract hardening. |
| `execution_plan_steps` | 0 | Reuse after adding and certifying step-state, receipt, and next-action bindings. |
| `execution_plan_events` | 0 | Reuse as the append-only operation timeline after event schema certification. |
| `agent_delegations` | 0 | Extend rather than replace; current shape is insufficient for modes, plan hash, resource snapshots, risk ceilings, limits, revoke, and drift. |
| `repository_automation_runs` | 0 | Reuse as the repository-specialized projection of the durable operation model. |
| `repository_automation_step_runs` | 0 | Reuse as repository step projection after common step contracts exist. |
| `repository_automation_receipts` | 0 | Reuse as the first mutation-receipt implementation and reference model for the generic receipt contract. |
| `release_operations` | 8 | Reuse as the release-specialized durable operation projection. |
| `release_operation_steps` | 35 | Reuse as a proven step-lifecycle reference and adapter target. |
| `release_operation_evidence` | 4 | Reuse as a proven evidence-reference model; do not store raw secrets. |
| `operation_run_ownership` | 0 | Reuse for principal and Tenant ownership binding where an operation creates or resumes a run. |
| `platform_resource_operation_registry` | 32 | Reuse as SQL authority for semantic operation and resource compatibility. |
| `platform_capability_readback_contracts` | 19 | Reuse directly as the readback-contract authority. |

## Code surfaces

| Code surface | Reuse classification | Phase 1 role |
|---|---|---|
| `operationContractRegistry.js` | Transitional compatibility source | Adapter-backed semantic contract projection until SQL becomes complete authority. |
| `platformExecutionEnvelopeKernel.js` | Direct reuse after persistence binding | Envelope and dispatch contract inside durable steps. |
| `platformScopedApprovalKernel.js` | Direct reuse | Approval hash-chain, typed confirmation, and actor-bound decision evidence. |
| `platformExecutionConcurrencyKernel.js` | Direct reuse | Lease, concurrency, and stale-operation protection. |
| Repository Automation Control Plane | Specialized adapter | Managed repository delivery on top of the common operation contract. |
| Release Operation Ledger | Specialized adapter | Release and deployment operation, step, and evidence projection. |
| Existing reconciliation engines | Adapter composition | Resource-specific readback and unknown-outcome reconciliation. |

## Reuse decisions

### D-001 Durable operation anchor

Use `execution_plans` as the generic plan and operation anchor unless Phase 1 proves a non-overlapping requirement that cannot be represented additively. Do not create a parallel `platform_operations` table by default.

### D-002 Durable steps and events

Use `execution_plan_steps` and `execution_plan_events`. Their zero-row state is not a reason to replace them; it is a reason to certify and activate them with explicit contracts.

### D-003 Approval authority

Use `approval_holds` and the scoped approval kernel. Delegation may satisfy a policy decision, but it does not impersonate the user or replace the approval ledger.

### D-004 Capability authority

Use `capability_resolution_envelope_ledger`. Child-envelope issue or renewal must preserve or narrow the original plan, resource, intent, mode, checksum or SHA, and risk bindings.

### D-005 Agent delegation

Extend `agent_delegations`. Required additions include approval mode, plan hash, resource-snapshot bindings, allow and deny intents, risk ceiling, mutation and retry limits, expiry, revoke, stop-on-drift, policy version, and audit references.

### D-006 Mutation receipts

Use `repository_automation_receipts` as the initial certified implementation and contract reference. A generic receipt abstraction may be added only if repository, migration, release, and provider receipts cannot share the existing structure through additive columns or adapters.

### D-007 Evidence

Use bounded references patterned after `release_operation_evidence`. Evidence stores fingerprints, safe identifiers, completeness, freshness, and visibility; it never stores credentials, raw secrets, or unbounded provider payloads.

### D-008 Execution contract authority

Use `platform_resource_operation_registry` plus existing capability and readback registries as SQL authority. `operationContractRegistry.js` remains a compatibility projection during migration and must not become a second independent authority.

### D-009 OpenAPI draft

The OpenAPI file under Spec 011 is a non-authoritative design artifact. Canonical runtime OpenAPI changes only when route, handler, registry, policy, error, and test parity exist in the same implementation slice.

### D-010 Migration restraint

Phase 0 introduces no SQL migration. Phase 1 must provide a column-level gap analysis and engine-native validation before any additive migration is proposed.

## Confirmed gaps

1. No single common response currently guarantees durable state, completed steps, blockers, evidence references, and one canonical `next_action` across all operation families.
2. Existing plan steps and events need a certified state machine and append-only event contract.
3. `agent_delegations` lacks bounded approval modes and drift-safe plan or resource bindings.
4. A pre-dispatch pending receipt and unknown-outcome classification are not yet common across mutation families.
5. Execution contract resolution is split between code and SQL and needs one SQL-primary projection with compatibility adapters.
6. Structured CI diagnosis is not mandatory for every failed gate.
7. Spec and evidence OpenAPI drafts need explicit non-authority metadata and promotion rules.
8. Generic evidence references and resource-specific readbacks need a single bundle contract without creating a duplicate evidence store.

## Explicit non-gaps

- A new approval system is not required.
- A new capability-envelope ledger is not required.
- A second repository automation control plane is not required.
- A second release-operation ledger is not required.
- A new generic operation table is not authorized by Phase 0.
- Runtime routes, provider dispatch, production mutation, deployment, and migration apply are outside this increment.

## Phase 1 entry conditions

- JSON Schemas and error codes pass CI.
- Compatibility adapter responsibilities are approved.
- OpenAPI draft remains explicitly non-authoritative.
- Any proposed SQL change maps every column to a confirmed gap and proves no reusable existing field exists.
- State-machine, idempotency, receipt, delegation, no-secret, and Tenant-isolation tests are designed before runtime code.
