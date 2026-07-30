# Data Model: Registry-First Operation Authority

## Minimal new registries

### `operation_registry`

| Column | Purpose |
|---|---|
| `operation_key` | Stable canonical operation identity. |
| `version` | Contract version. |
| `display_name` | Human-readable name. |
| `description` | Bounded purpose. |
| `operation_class` | Read, mutation, repository, workflow, provider, or other class. |
| `scope_type` | Admin, Tenant, user, workspace, or internal. |
| `risk_level` | Low through critical. |
| `execution_mode` | Synchronous, asynchronous, or hybrid. |
| `input_schema_json` | Strict request schema. |
| `output_schema_json` | Stable response schema. |
| `status` | Draft, shadow, active, degraded, disabled, archived. |
| `revision_hash` | Deterministic authority digest. |

### `operation_step_registry`

Stores ordered or DAG steps, `handler_key`, input mapping, success condition, retry policy, failure policy, timeout, compensation requirement, and status.

### `operation_execution_bindings`

Maps an operation to an adapter/runtime with priority, fallback rank, compatibility predicates, approval/readback requirements, validity, and status.

### `execution_adapter_registry`

Stores adapter identity, family, runtime surface, capabilities, supported effects, idempotency/readback/resume support, owner, certification, and lifecycle.

### `operation_tool_projections`

Stores generated Admin/Tenant tool projection identity, operation revision, endpoint/schema/auth/manifest revisions, projection digest, audience, visibility state, and rollback pointer.

### `generated_artifact_registry`

Stores path pattern, generator key, source authority, reconciliation policy, run stage, manual-edit policy, validation command key, and lifecycle.

## Existing surfaces to reuse

- Operation and step run ledgers.
- Operation events and artifacts.
- Idempotency receipts.
- Capability resolution envelope ledger.
- Approval holds and typed approvals.
- Budget and quota authority.
- Endpoint, Admin tool, Tenant tool, action, workflow, and capability-manifest registries.
- Execution plans, plan steps, plan events, worker leases, and connected sessions.
- Runtime, provider, browser, workflow, device, and connection health surfaces.
- Audit and execution logs.

## Supporting views

Future implementation should expose bounded readback views:

- effective operation contracts;
- effective operation bindings;
- operation projection readiness;
- operation authority gaps;
- adapter health and capacity;
- operation run status and evidence completeness;
- projection revision parity;
- generated-artifact reconciliation readiness.

## Constraints

- Unique active operation key/version.
- Strict top-level JSON Schema for Tenant projections.
- Known `handler_key` and `adapter_key` only.
- No secret-like fields in schema metadata or adapter metadata.
- Active bindings require active operation and certified/allowed adapter state.
- Projection audience must match operation scope.
- Tenant projection requires exportable capability manifest status.
- Revision and source digests are immutable after activation.

## Example operation contract

```json
{
  "operation_key": "repo.change.execute",
  "version": 1,
  "operation_class": "repository_mutation",
  "scope_type": "admin",
  "risk_level": "high",
  "execution_mode": "asynchronous",
  "status": "shadow"
}
```

## Example binding

```json
{
  "binding_key": "repo.change.execute.managed_git_worker.v1",
  "operation_key": "repo.change.execute",
  "adapter_key": "managed_git_worker",
  "runtime_key": "ephemeral_git_runtime",
  "priority": 100,
  "fallback_rank": 1,
  "requires_readback": true,
  "status": "shadow"
}
```

## Migration posture

This file is a conceptual contract only. Future SQL must be additive, indexed, rollbackable or disable-first, documented, tested, and applied through the governed migration runner with same-cycle readback.
