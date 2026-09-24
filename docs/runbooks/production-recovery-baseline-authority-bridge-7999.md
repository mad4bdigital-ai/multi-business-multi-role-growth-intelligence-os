# Production Recovery baseline-only authority bridge

## Scope

This slice closes the missing deployment-owned authority bridge for the existing Production Recovery baseline reconstruction path. It does **not** deploy, restart, configure, or activate Production.

The only consequential capability admitted by the new host-local executor is one approved role step whose canonical capability is:

- `runtime.baseline.rebuild_empty`
- `governance.baseline.rebuild_empty`
- `runtime_persistence.baseline.rebuild_empty`

Each invocation is strictly one role, one Recovery plan step, one single-use execution ticket, one fenced lease, and one exact role-bundle binding.

Ordinary migration apply, grant repair, raw SQL, shell/SSH execution, provider mutation, and automatic Production activation remain unavailable through this binding.

## Activation remains external and explicit

Repository source alone does not activate this authority. The Hostinger Production runtime must separately and deliberately configure:

- `RECOVERY_SERVER_MANAGED_BINDING_MODULE=./productionRecoveryBaselineAuthorityBinding.js`
- `RECOVERY_SERVER_MANAGED_BINDING_MODE=production_live`
- `RECOVERY_PRODUCTION_APPROVAL_SECRET`
- `RECOVERY_PRODUCTION_EXECUTION_PRIVATE_KEY_JWK`
- optional `RECOVERY_PRODUCTION_EXECUTION_PUBLIC_KEY_JWK`
- the already-governed independent `RECOVERY_CONTROL_DB_*` configuration

The module fails closed when explicit Hostinger Production runtime identity or server-owned signing/approval material is missing. Configuration values are never returned in binding/readiness envelopes.

Configuring the module is a separate Production runtime action and is not authorized by merging this source PR.

## Execution chain

1. A durable full-role inspection establishes exact SHA, target fingerprint, zero-object role classification, object-count fingerprints, canonical findings, and schema-bundle bindings.
2. Recovery planning derives the immutable multi-role remediation plan.
3. Ticket issuance derives a **step-scoped** role-selection proof from that immutable plan. The caller cannot select or widen the role set.
4. The execution ticket binds the exact Production SHA, target role, step hash, role-selection hash, role-bundle binding, deployment attestation, approval binding, and idempotency key.
5. The Production host-local executor accepts only the matching `<role>.baseline.rebuild_empty` capability.
6. Before the first DDL statement, Runtime Bootstrap recomputes the role-bundle binding from the exact checkout and rejects any difference from the server-issued Recovery binding.
7. Bootstrap rechecks zero-object evidence and DDL privilege preconditions, performs one role bundle sequentially, and persists immutable partial receipts if an unknown/partial outcome occurs.
8. The Recovery Kernel retains the fence and performs an independent same-cycle full-role inspection. The rebuilt role must become non-empty, required role tables must be present, and the role must no longer be selected for rebuild.
9. Only verified execution can finalize the execution ticket and approval lifecycle. Failed/unknown outcomes are reconciliation-only and are not automatically replayed.

## Authority separation

The concrete binding exposes a complete Recovery composition because the composition contract requires every adapter. The Governance Migration Ledger adapter is deliberately fail-closed in this slice: calling it returns `RECOVERY_PRODUCTION_ORDINARY_MIGRATION_NOT_ENABLED`.

This means a complete composition does not imply broad Production write authority. The effective mutation surface remains bounded by the baseline-only executor.

## Safety invariants

- caller routing overrides are rejected;
- caller-supplied tickets/signatures are rejected by the existing Recovery Action bridge;
- approval token material is resolved server-side only;
- execution tickets are server-issued and single-use;
- target role comes from the approved step, not from a runtime request selector;
- one ticket executes one role only;
- exact role-bundle bytes are rebound before DDL;
- the Recovery Control Store remains independent from every target database;
- same-cycle readback has no mutation authority;
- automatic replay after partial/unknown execution remains forbidden;
- source merge performs no Production deployment, configuration, database mutation, grant, migration, provider call, or restart.

## Current delivery boundary

This PR is source and synthetic-certification work only. A future Production activation must separately prove:

1. the exact deployed Production SHA contains this implementation;
2. the independent Recovery Control Store is provisioned and mutation-grade;
3. current durable inspection evidence is fresh and exact-SHA bound;
4. the binding module and server-owned secrets are configured without exposing them;
5. Production Recovery preflight reports a resolved graph and eligible authority;
6. a separate typed authorization exists for the actual Production baseline execution.

No prior typed authorization should be reused after the exact source SHA changes.
