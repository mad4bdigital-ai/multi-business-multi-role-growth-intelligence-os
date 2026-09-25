# Production Recovery Closure

## Purpose

Provide one fail-closed, exact-SHA Production Recovery closure contract that composes existing Recovery Control Plane evidence without creating a parallel execution path.

The closure must never infer success from a script exit code, a migration completion marker, or a later unrelated probe. It reports `recovered` only from durable, server-derived, same-cycle evidence.

## Scope

This feature closes the verification/classification layer for the existing Production Recovery Control Plane. It does not authorize Production mutation, migration apply, grant repair, provider access, deployment, or restart.

The implementation reuses the existing Recovery Kernel, durable full inspection, role-selection proof, baseline-before-ordinary-migration ordering, role baseline rebuild, canonical grants readback, Production activation readiness, and governed response-chunk durable smoke.

## Required core gates

A core recovery may be classified only when all are true:

1. exact source SHA verified;
2. durable full inspection verified;
3. Governance baseline ready;
4. runtime-persistence baseline ready;
5. canonical grants ready;
6. bootstrap ledger ready;
7. MCP catalog schema ready;
8. Admin catalog functional readback ready;
9. Device catalog functional readback ready;
10. response-chunk storage smoke ready;
11. Production activation readiness ready;
12. backup evidence verified;
13. Production mutation audit complete;
14. no unknown outcome remains.

## Backup evidence

Backup evidence is mandatory before any recovery may be classified as recovered. The evidence must be exact-SHA bound, hash-addressed, timestamped, cover runtime, governance, and runtime-persistence roles, be verified, and contain no secrets.

## Functional verification

Migration/schema success alone is insufficient. Closure requires behavioral readback:

- `listAdminTools` works against the recovered catalog;
- `listDeviceTools` works against the recovered catalog;
- governed response chunk write/read/delete smoke succeeds through the durable runtime-persistence authority;
- Production activation readiness is ready.

## Unknown outcomes

Any unknown provider/database execution outcome is terminal for closure until reconciliation. Blind retry is forbidden. `unknown_outcome=true` must force closure status `unknown_outcome`.

## Non-DB degradation

Local Connector credential binding/401 and 429 attribution are independent of DB recovery. They remain visible as:

- `connector_auth_ready`
- `rate_limit_attribution_ready`

If every core recovery gate is complete but either non-DB gate is not ready, the closure status is `degraded_non_db`, not `recovered`, and DB recovery must not be replayed because of those gaps.

## Authority model

The GPT/caller may provide only the expected SHA to the Recovery Kernel closure capability. Readiness booleans, backup paths, inspection IDs, and functional smoke claims are resolved from a server-injected evidence resolver.

Caller-supplied recovery truth is forbidden.

## Acceptance

The final contract is `mad4b.production-recovery-closure.v1`.

A recovered closure must expose:

- `status=recovered`
- `core_recovered=true`
- all required core gates true
- `unknown_outcome=false`
- `automatic_retry_allowed=false`
- `read_only_probe=true`
- no database/provider/Production mutation performed by closure evaluation
- `secrets_included=false`
- deterministic `closure_sha256`.

Source merge alone never activates Production recovery.


## Convergence extension

The same feature now also defines one consequential Recovery Kernel entrypoint:

`platform_recovery_converge_v1`

It is a durable resumable state machine, not a monolithic SQL transaction. The caller may select only exact `expected_sha`, an existing `run_id`, and `action=advance|status|reconcile`. SQL, database names, credentials, provider routes, arbitrary targets, and caller-declared readiness are forbidden.

Every stage is bound to `run_id + plan_hash + step_id + idempotency_key`. Completed stages are not replayed. One advance executes at most one consequential/bounded mutation before returning to a durable boundary.

The canonical order is: identity → backup evidence → durable full inspection → conditional governance baseline → verify → conditional runtime-persistence baseline → verify → grants → verify → MCP catalog migration → catalog verify → durable response-chunk smoke → Admin tools readback → Device tools readback → Production activation readiness → connector auth probe → conditional 429 recovery → conditional two-phase credential rebind → connector auth verify → Local Manager create/claim/complete E2E → deployment parity → final gate.

The runtime role is inspected and preserved; this convergence plan does not rebuild it.
