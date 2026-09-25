# Plan

## Architecture

Use the existing Recovery Kernel as the only public authority surface.

Add `productionRecoveryClosure.js` as a pure evaluator. It consumes one server-derived durable evidence pack and produces a deterministic no-secret closure result.

Register `production_recovery_closure` as an R0/C0 capability. The capability accepts only `expected_sha`; all recovery evidence must come from `productionRecoveryClosureEvidenceResolver` injected by the deployment-owned composition root.

## Evidence flow

```
exact Production SHA
→ backup evidence
→ durable full inspection
→ governance baseline
→ runtime-persistence baseline
→ canonical grants readback
→ bootstrap ledger readiness
→ ordinary migrations
→ MCP catalog schema + functional catalog readback
→ durable response-chunk smoke
→ Production activation readiness
→ closure evaluator
→ recovered | degraded_non_db | blocked | unknown_outcome
```

## Recovery ordering

The existing `mad4b.baseline-before-ordinary-migration.v1` contract remains authoritative:

1. recovery_control_plane_ready
2. durable_full_inspection
3. governance_baseline_ready
4. runtime_persistence_baseline_ready
5. canonical_grants_readback_ready
6. governance_authority_ready
7. ordinary migration

Standalone migration-first recovery remains forbidden.

## Failure behavior

- stale SHA → blocked;
- missing server resolver → fail closed;
- non-durable evidence → blocked;
- missing same-cycle evidence → blocked;
- missing backup evidence → blocked;
- any core functional readback false → blocked;
- unknown outcome → unknown_outcome/reconciliation required;
- DB core recovered with connector/429 gaps → degraded_non_db.

## Production boundary

This PR performs no Production operation. Live evidence resolver wiring, exact deployed-source verification, fresh durable inspection, backup capture, approvals, and mutations remain separate governed operations.
