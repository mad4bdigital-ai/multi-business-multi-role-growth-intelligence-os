# Plan

## Architecture

Use the existing Recovery Kernel as the only public authority surface.

Add `productionRecoveryClosure.js` as a pure evaluator. It consumes one server-derived durable evidence pack and produces a deterministic no-secret closure result.

Register `production_recovery_closure` as an R0/C0 capability. The capability accepts only `expected_sha`; all recovery evidence must come from `productionRecoveryClosureEvidenceResolver` injected by the deployment-owned composition root.

## Evidence flow

```
exact Production SHA
→ durable full inspection
→ backup evidence
→ conditional Governance zero-object rebuild
→ conditional runtime-persistence zero-object rebuild
→ canonical grants apply/readback when explicitly required
→ bootstrap ledger readiness
→ MCP catalog migration only when explicitly required
→ MCP catalog schema + functional catalog readback
→ durable response-chunk smoke
→ Production activation readiness
→ connector + Local Manager recovery
→ final deployment parity
→ final Production activation recertification
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

The final gate derives `status=recovered` and `active=true` only after database, grants, catalog, chunks, connector authentication, Local Manager command E2E, final same-cycle deployment parity, final Production activation recertification, and the Production Recovery closure evaluator all verify.

## Hardened transition controls

- A fixed-origin GET-only reader verifies `https://auth.mad4b.com/version` and `/deployment-info`; caller-selected origins are forbidden.
- Read adapters normalize native Recovery Kernel inspection/readiness contracts into convergence evidence without widening mutation authority.
- A pre-mutation parity guard runs before every consequential/bounded mutation.
- Each mutation declares one canonical `authority_ref` and `nested_operation`; receipts using a different authority or operation are rejected.
- One `advance` request can complete at most one consequential/bounded mutation before returning a durable checkpoint.
- Persistent external rate limiting with valid Retry-After/backoff persistence is classified `degraded`, preserving the same run for later resume.
- The full branch model is maintained in `pipeline-scenario-matrix.md`.

- A stale `executing` checkpoint from a previous process is never replayed. After the bounded liveness window it is promoted to `unknown_outcome`; only read-only reconciliation may resolve the original idempotency key before execution can continue.

## Repair-selection proof

Repair selection is evidence-driven and tri-state. The full inspection must preserve `true | false | null` readiness rather than collapsing missing evidence to false. Consequential repair is allowed only on explicit false evidence. An unknown readiness state blocks before approval reservation or execution claim.

For a runtime-persistence role explicitly classified `nonempty_objects` with a positive object count and `runtime_persistence_ready=false`, this convergence run stops and returns `create_recovery_kernel_remediation_plan_for_runtime_persistence_schema_repair`. The separate Recovery Kernel plan owns `runtime_persistence.schema.repair` and its `apply_migration` baseline-order proof. The convergence entrypoint never bypasses that proof and never introduces a generic SQL repair path.

## Durable approval fencing

For mutating steps the outer convergence layer adds a replay-prevention fence around, but never replaces, nested Recovery authority:

`resolve approval → claim execution → reserve approval → persist executing → execute nested authority → validate/readback → finalize approval → persist pass → release reservation/claim`.

If provider or finalization outcome is unknown, the claim and reservation remain durable and automatic retry is forbidden. Reconciliation is read-only, proves `mutation_outcome_known` and `mutation_applied`, preserves the original mutation audit, then finalizes/releases the same authority records.
