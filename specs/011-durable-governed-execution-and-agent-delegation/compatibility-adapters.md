# Phase 0 Compatibility Adapter Design

## Objective

Introduce one durable governed execution contract without breaking or duplicating existing operation families. Adapters translate existing SQL-primary and runtime surfaces into the Spec 011 schemas while keeping each existing subsystem authoritative for its current domain during phased rollout.

## Adapter map

| Existing surface | Adapter | Canonical output |
|---|---|---|
| `operationContractRegistry.js` and `platform_resource_operation_registry` | `execution_contract_projection_adapter` | Execution Contract Schema |
| `execution_plans` | `durable_operation_plan_adapter` | Durable Operation Schema |
| `execution_plan_steps` and `execution_plan_events` | `durable_operation_step_adapter` | Step state and bounded timeline |
| `approval_holds` and scoped approval kernel | `human_approval_decision_adapter` | Policy decision and approval evidence |
| `capability_resolution_envelope_ledger` | `capability_envelope_binding_adapter` | Step capability and dispatch readiness |
| `agent_delegations` | `agent_delegation_grant_adapter` | Delegation Grant Schema |
| `repository_automation_*` | `repository_operation_adapter` | Operation, Mutation Receipt, and repository readback |
| `release_operation_*` | `release_operation_adapter` | Operation, step, deployment evidence, and production readback |
| `platform_capability_readback_contracts` | `readback_contract_adapter` | Readback contract binding |
| Existing reconciliation engines | `reconciliation_result_adapter` | Mutation outcome and Evidence Bundle Schema |

## Adapter requirements

1. Adapters are deterministic and side-effect free unless explicitly dispatching through an approved operation step.
2. Tenant, workspace, user, and resource identity are server-derived and never trusted from Tenant request bodies.
3. Adapters cannot invent action keys, endpoint keys, capability keys, readback contracts, or approval policies.
4. Unknown or ambiguous registry bindings fail closed before provider access.
5. Legacy and canonical outputs are compared in shadow mode before a caller is migrated.
6. A compatibility adapter cannot widen mutation authority or bypass approval holds.
7. Adapter outputs include schema version, policy version, source authority, freshness, and `secrets_included=false`.
8. Provider-specific errors are translated into stable structured codes while raw bounded evidence remains behind governed references.

## Transition sequence

### Stage A — Shadow projection

Existing calls remain authoritative. The adapter produces the canonical operation, contract, receipt, and evidence projections for comparison only.

### Stage B — Read-only canonical consumers

Status, explain, operational attention, and audit consumers read the canonical projection while dispatch remains on the legacy path.

### Stage C — Low-risk dispatch

Selected low-risk operations dispatch through the durable step coordinator while the legacy adapter remains available for rollback.

### Stage D — Certified operation families

Repository and release operation families use the common kernel but preserve their specialized tables and readback logic.

### Stage E — Legacy retirement

A legacy path may be retired only after parity, error-rate, latency, Tenant-isolation, rollback, and production-readback evidence are recorded.

## No-duplication gate

Any implementation PR proposing a new operation, approval, delegation, receipt, reconciliation, or evidence table must include:

- the existing table and column inventory;
- why additive extension is insufficient;
- transaction and consistency boundaries;
- retention and no-secret policy;
- rollback plan;
- engine-native migration validation;
- an explicit architecture approval.
