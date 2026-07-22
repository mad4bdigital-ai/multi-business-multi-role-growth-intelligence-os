# ADR-001: Hybrid Activation Operation Ledger

**Status**: Accepted  
**Date**: 2026-07-22  
**Decision owner**: Platform Admin / Activation Runtime  
**Resolves**: Q-001

## Context

Tenant Activation spans OAuth, gateway verification, membership, session context, workspace/bootstrap, connections, provider validation, tool readiness, governed dispatch, readback, delivery, acknowledgement, reconciliation, and deployment freshness.

The platform already has general operation/execution concepts that provide durable identity, tenant/user ownership, idempotency, timestamps, audit correlation, and common execution lifecycle behavior. Activation also requires domain-specific stages and states that should not expand the general operation model with large numbers of nullable or Activation-only fields.

## Decision

Adopt a hybrid model:

1. The existing general operation ledger remains the authoritative owner of shared operation identity and cross-cutting execution facts.
2. An Activation-specific projection, linked one-to-one by `operation_id`, owns Activation lifecycle interpretation and domain-specific state.
3. Activation stage attempts, evidence, delivery, acknowledgement, and reconciliation are stored in specialized records linked to the same operation identity.
4. The physical table mapping must reuse existing tables where their semantics fit and introduce only additive schema where required.
5. The implementation must not create a second independent operation identity or a competing source of truth.

## Ownership boundaries

### General operation ledger owns

- `operation_id`;
- tenant and user ownership;
- operation type;
- idempotency identity/hash;
- operation fingerprint;
- general lifecycle status;
- creation/update/completion timestamps;
- common audit and execution correlation.

### Activation projection owns

- Activation mode (`managed`, `dedicated`, `mixed`);
- current Activation stage;
- detailed Activation status and retryability;
- session/workspace/bootstrap/connection/provider/tool readiness interpretation;
- OAuth-to-gateway transition gap classification;
- reconnect guidance decision;
- deployment freshness classification;
- links to Activation stage attempts, evidence, delivery, acknowledgement, and reconciliation.

## Consistency rules

- The general operation and initial Activation projection are created in one database transaction when possible.
- State ownership must not overlap: the general status represents the operation lifecycle; the Activation status represents the detailed domain outcome.
- Projection update failures must be visible and retryable; they must not silently report success.
- Delivery retries use delivery identity and never replay the underlying operation.
- Unknown mutation outcomes remain governed by the general operation fingerprint and Activation reconciliation state.
- Public APIs expose one `operation_id`; storage topology is internal.

## Consequences

### Positive

- Reuses existing identity, idempotency, and audit infrastructure.
- Avoids adding Activation-only columns and states to shared operation tables.
- Avoids a second independent lifecycle system.
- Gives Activation clear domain ownership and queryable stage evidence.
- Supports additive migration, feature-gated rollout, and safer rollback.
- Preserves interface → application → domain → infrastructure boundaries.

### Costs and risks

- Requires transactional or otherwise reliable consistency between the general ledger and Activation projection.
- Requires an explicit status mapping to prevent contradictory general and Activation states.
- Adds specialized tables or projections after inventory confirms what cannot be reused.
- Requires tests for partial writes, optimistic concurrency, projection repair, rollback, and reconciliation.

## Rejected alternatives

### Extend the general ledger only

Rejected because Activation-specific stages, delivery, acknowledgement, deployment freshness, and reconnect policy would overload shared schemas and common code.

### Create a fully independent Activation ledger

Rejected because it would duplicate operation identity, idempotency, attempts, timestamps, audit, and reconciliation concepts and could create competing sources of truth.

## Implementation constraints

- Complete T001-T003 inventory before choosing physical tables.
- T014 must map every logical entity to an existing or additive table.
- New schema is additive in the first rollout.
- No queue or event-sourcing dependency is introduced in the first version unless transaction boundaries prove insufficient and a separate ADR approves it.
- Emergency rollback preserves general operations and Activation evidence; tables are not dropped during rollback.

## Verification

Required verification includes:

- single operation identity across all stages;
- atomic create or visible repairable partial state;
- status mapping consistency;
- duplicate/idempotency prevention;
- unknown-outcome reconciliation;
- delivery retry without execution replay;
- cross-tenant object-level authorization;
- additive migration and rollback tests.
