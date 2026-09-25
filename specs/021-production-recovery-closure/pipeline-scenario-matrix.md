# Production Recovery Convergence — Pipeline Scenario Matrix

This matrix is normative for platform_recovery_converge_v1. The operation is resumable and exact-SHA bound. A stage may advance only when its evidence and nested authority are valid for the same run, plan, step, idempotency key, and deployed Production SHA.

## Canonical pipeline

    production_identity
    → database_full_inspection
    → backup_evidence
    → governance_baseline_rebuild? → governance_baseline_verify
    → runtime_persistence_baseline_rebuild?
    → runtime_persistence_baseline_verify
    → canonical_grants_apply → canonical_grants_verify
    → bootstrap_ledger_verify
    → mcp_catalog_migration_apply → mcp_catalog_verify
    → response_chunk_storage_smoke
    → admin_tools_functional_readback
    → device_tools_functional_readback
    → production_activation_readiness
    → connector_auth_probe
       ├─ 200 authenticated → connector_two_phase_rebind skipped
       ├─ 401 credential_invalid → connector_two_phase_rebind
       ├─ 429 → local_manager_rate_limit_recovery
       └─ 403/5xx/transport → no credential rotation
    → connector_auth_verify
    → local_manager_e2e_round_trip
    → deployment_parity
    → final_production_activation_readiness
    → recovery_closure

Every consequential or bounded-mutation stage rechecks exact Production deployment parity immediately before execution. One advance call may execute at most one consequential/bounded mutation.

## Scenario matrix

| Scenario | Classification | Mutation allowed | Durable state | Next safe action |
| --- | --- | --- | --- | --- |
| /version or /deployment-info does not match expected SHA | blocked | No | Current run retained | Restore exact Production SHA parity |
| /deployment-info branch is not Production | blocked | No | Current run retained | Correct Production deployment binding |
| Full role inspection unavailable | blocked | No | Current run retained | Restore host-local read-only inspection authority |
| Full inspection evidence is not durable | blocked | No | Current run retained | Restore independent durable Recovery evidence store |
| Runtime non-empty; Governance zero-object | selected repair | Governance only | Inspection evidence retained | Rebuild Governance only; Runtime remains untouched |
| Governance non-empty | rebuild skipped | No baseline rebuild | Step becomes skipped_not_required | Verify Governance baseline independently |
| Runtime Persistence zero-object | selected repair | Runtime Persistence only | Inspection evidence retained | Rebuild Runtime Persistence only |
| Runtime role zero-object | unsupported by this convergence slice | No implicit Runtime rebuild | Run remains fail-closed | Use separately registered Runtime recovery authority |
| Backup evidence missing | blocked | No | Inspection remains usable | Capture and verify all-role backup evidence |
| Runtime Persistence non-empty + readiness=false | blocked handoff | No migration from convergence | Same run/finding evidence retained | Create a separate Recovery Kernel remediation plan for `runtime_persistence.schema.repair`, then resume after fresh readback |
| Runtime Persistence non-empty + readiness=true | repair skipped | No schema repair | Inspection evidence retained | Continue to independent verify |
| Runtime Persistence readiness missing/null | blocked | No | Current run retained | Re-run durable inspection with explicit readiness evidence |
| Role classification/count inconsistent or missing | blocked | No | Current run retained | Re-run full role census; do not infer non-empty from `zero_object=false` |
| Grant readiness missing/null | blocked | No grant mutation | Current run retained | Re-run inspection with Governance privilege readiness |
| MCP catalog readiness missing/null | blocked | No migration | Current run retained | Re-run inspection with MCP catalog readiness |
| Backup not exact-SHA, not durable, or hash invalid | blocked | No | Current run retained | Replace with exact-SHA hash-addressed durable backup |
| Nested approval missing | awaiting_approval | No | Current step retained | Obtain server-resolved step-bound approval |
| Approval belongs to another step/run/SHA/idempotency key | hard reject | No | No success recorded | Issue correct nested approval |
| Nested authority or operation differs from plan | hard reject | No | No success recorded | Use the registered authority for that exact stage |
| Production moves after an earlier successful mutation | blocked before next mutation | No next mutation | Prior receipt retained | Restore exact SHA or start a new exact-SHA run |
| Mutation returns known not-applied failure | blocked | Retry after blocker fixed | Prior verified steps retained | Resume same run without replay |
| Mutation outcome unknown | unknown_outcome | Blind retry forbidden | Original operation retained | Read-only reconcile under same idempotency key |
| Process exits after durable `executing` checkpoint but before terminal receipt | executing → unknown_outcome after bounded stale window | Blind retry forbidden | Execution claim + step checkpoint retained | Read same-run status; after stale window use read-only reconciliation |
| Reconciliation still unknown | unknown_outcome | No | Same run retained | Escalate evidence acquisition; no second mutation |
| Governance grant readback fails | blocked | No MCP migration | Grant receipt retained | Repair grants and resume |
| Bootstrap ledger not ready | blocked | No MCP migration | Prior steps retained | Repair/read bootstrap ledger |
| MCP catalog migration required | consequential | Fixed migration only | Step-bound receipt | Execute only 20260815_custom_gpt_mcp_catalog_levels.sql through registered authority |
| MCP catalog remains schema_contract_not_ready | blocked | No downstream closure | Current run retained | Reconcile migration/readback |
| Response chunk write/read smoke fails | blocked or unknown_outcome | No active state | Smoke receipt retained | Reconcile runtime-persistence state |
| listAdminTools or repo_inspect fails | blocked | No | Current run retained | Repair Admin catalog/dispatch |
| listDeviceTools fails | blocked | No | Current run retained | Repair Device catalog/dispatch |
| Production activation readiness not ready | blocked | No connector mutation | Current run retained | Resolve readiness dimensions |
| Connector authenticated operation returns 200 | ready | No rebind | Probe receipt | Continue |
| Connector returns 401 credential invalid | recoverable auth branch | Two-phase rebind only | Pending credential reference only | Prepare → local install → authenticated probe → commit/revoke old |
| New connector credential probe fails | blocked | Old credential remains active | Pending credential cancelled when safe | Fix local install/probe |
| Credential commit outcome unknown after successful probe | unknown_outcome | Blind rebind retry forbidden | Commit evidence retained | Reconcile active credential state |
| Connector returns 403 | authorization blocker | No credential rotation | Probe receipt | Resolve authorization/policy |
| Connector returns 429 and retry contract is healthy | degraded while rate limit persists | No credential rotation | Backoff/correlation retained | Wait bounded Retry-After; resume same run |
| Connector 429 handling contract is broken | blocked | No credential rotation | Failure evidence retained | Repair Local Manager retry/backoff behavior |
| Connector returns 502/503/504/transport error | availability blocker | No credential rotation | Request evidence retained | Restore origin/tunnel/provider availability |
| Local Manager create succeeds but claim fails | blocked | No final active | Command receipt retained | Repair device claim/lease authority |
| Claim succeeds but completion outcome is unknown | unknown_outcome | No duplicate command | Claim identity retained | Read command status/reconcile |
| Final deployment parity changes, including between the parity stage and final gate | blocked | No final recovered state | Prior receipts retained | Restore exact deployment parity and resume same run |
| Final Production activation recertification regresses after connector/Local Manager mutation | blocked | No final recovered state | Prior receipts retained | Restore activation readiness and resume same run |
| Every stage pass or explicitly skipped_not_required, final parity passes, and closure evaluator returns recovered | recovered (`active=true`) | N/A | Terminal idempotency receipt + closure hash | None |

## Pipeline invariants

1. The caller never supplies SQL, database names, connector credentials, migration selection, provider URLs, or raw execution targets.
2. Zero-object evidence is role-specific. A zero-object Governance database never authorizes Runtime reconstruction.
3. Backup evidence is required before the first recovery mutation, while read-only full inspection may run before backup capture.
4. Baseline rebuild, grant apply, MCP migration, response-chunk smoke, connector rebind, and Local Manager E2E remain separate consequential stages.
5. The outer convergence run does not replace nested Recovery authority. Each mutation receipt must match the stage canonical authority reference and nested operation; the exact single-use approval is durably reserved and finalized around execution.
6. A successful consequential stage forces a checkpoint; one advance request cannot consume approval for a later mutation.
7. Unknown outcomes are not retryable until read-only reconciliation resolves the original idempotency key.
8. HTTP 401 may justify credential rebind; HTTP 429, 403, 5xx, DNS, tunnel, and transport failures do not.
9. Old connector credentials are revoked only after the newly installed credential succeeds on an authenticated probe.
10. `active=true` is an operational boolean only; `status=recovered` is emitted only after a server-derived final closure proves every core gate, backup restore evidence, mutation audit, final same-cycle exact deployment-parity recertification, and final Production activation recertification.
11. Missing readiness evidence is never equivalent to a failed readiness check. Repair eligibility requires explicit `false` evidence from the durable inspection.
12. Partial non-empty runtime-persistence drift is detected but not executed by convergence; it is handed off to the existing Recovery Kernel `runtime_persistence.schema.repair` plan so baseline-order proof remains authoritative. Partial Runtime or unregistered Governance schema corruption remains fail-closed.

## Live authority boundary

This PR implements the convergence state machine, read-adapter normalization, two-phase rebind coordinator, durable Local Manager rate-limit persistence, route contract, tests, and governance metadata. It does not itself activate Production mutation authority.

Live Production execution remains fail-closed until the deployment-owned composition injects and certifies every required mutation executor, backup evidence reader, functional readback adapter, connector/device binding, and nested approval resolver.


## Host-local Runtime grant diagnostic

When Production inspection proves that `local_manager_device_link_sessions` and `local_manager_desktop_commands` exist but the Runtime principal lacks `SELECT/INSERT/UPDATE`, the convergence run must remain read-only until the host-local authority is available. The dry-run receipt must report `host_local_execution_required`, `local_connector_required=false`, `local_connector_fallback_allowed=false`, and `database_mutation_performed=false`. Applying grants requires a server-derived `grant_binding_hash`, an explicit bounded resource list containing only those two tables, durable readback, and the host-local handoff; the outer control plane must never synthesize the hash or widen the grant scope.
