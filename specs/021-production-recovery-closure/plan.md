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


## Composite convergence entrypoint

The consequential surface is `POST /admin/recovery/kernel/platform-converge` with capability key `platform_recovery_converge_v1`.

The caller provides only exact SHA, optional existing run ID, and advance/status/reconcile action. The server composition projects the durable store, step executors and approval resolver; the request cannot inject them.

One advance may execute read-only stages freely but returns after at most one consequential/bounded mutation. Resume uses the same durable run and skips already verified stages.

The connector lane is conditional: rate limiting runs the Retry-After/backoff recovery path; credential-invalid runs two-phase rebind. They must not be conflated.

The final gate derives `active` only after database, grants, catalog, chunks, activation, connector authentication, Local Manager command E2E and deployment parity all verify.
\n## Hardened transition controls\n\n- A fixed-origin GET-only reader verifies `https://auth.mad4b.com/version` and `/deployment-info`; caller-selected origins are forbidden.\n- Read adapters normalize native Recovery Kernel inspection/readiness contracts into convergence evidence without widening mutation authority.\n- A pre-mutation parity guard runs before every consequential/bounded mutation.\n- Each mutation declares one canonical `authority_ref` and `nested_operation`; receipts using a different authority or operation are rejected.\n- One `advance` request can complete at most one consequential/bounded mutation before returning a durable checkpoint.\n- Persistent external rate limiting with valid Retry-After/backoff persistence is classified `degraded`, preserving the same run for later resume.\n- The full branch model is maintained in `pipeline-scenario-matrix.md`.\n