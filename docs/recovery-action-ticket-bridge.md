# Recovery Action Ticket Bridge

## Purpose

The private Recovery Action bridge closes the Action/runtime contract gap for one consequential Recovery Kernel step. An authenticated administrator submits only the registered plan and step references, a single-use approval token, and an idempotency key. The server resolves the immutable plan and step, issues the execution ticket through the existing Recovery Kernel ticket issuer, stores it in the durable Recovery store, and forwards the ticket references internally to the injected Host Breakglass mutation boundary.

The bridge does not create a second ticket format. It reuses `createExecutionTicket()` and `executeRemediationStep()` from `http-generic-api/recoveryKernel.js`, preserving the existing bindings for inspection evidence, target fingerprints, Production SHA, plan hash, step hash, idempotency, single-use state, expiry, approval, fencing, and readback.

## Private surfaces

The HTTP operation is `POST /admin/recovery/kernel/execute-approved` with operation ID `executeApprovedAdminRecoveryKernelStep`. The historical `POST /admin/recovery/kernel/execute` path is retained only as a server-issued-ticket alias; it now accepts the same five-field bridge contract and rejects caller-supplied ticket references. Both operations are marked only for the `admin_recovery_production` surface and remain excluded from the shared Admin Core and Activation projections.

The fixed System Tool is `recovery_kernel_execute_approved_step`. It is `requires_admin`, tagged as `private`, `principal_scoped`, and `consequential`, and uses `catalog_level: private_recovery`. The shared `recovery_kernel_call` read-only allowlist is intentionally unchanged. Tenant and non-admin principals cannot list, look up, or call the private descriptor.

The companion approval entrypoint is `POST /admin/recovery/kernel/approval-challenge`, operation ID `createAdminRecoveryApprovalChallenge`, plus the fixed System Tool `recovery_kernel_create_approval_challenge`. It accepts only `plan_id`, `plan_hash`, and `step_id`, and remains on the same private `admin_recovery_production` surface at `auth.mad4b.com`; it is not placed in Activation Admin. The operation creates a short-lived, non-transferable challenge through injected approval authorities, but never returns the approval token, an execution ticket, a signature, credentials, SQL, migration selection, or provider control. The token must be delivered through the separately governed approval authority; a challenge receipt without a governed delivery/verification path is not execution-ready.

## Caller contract

| Accepted field | Purpose |
| --- | --- |
| `plan_id` | Reference to the repository-bound Recovery plan. |
| `plan_hash` | Immutable plan binding. |
| `step_id` | Consequential step reference inside the plan. |
| `approval_token` | Single-use approval material verified against the durable approval record. |
| `idempotency_key` | Caller-provided replay/idempotency reference. |

The bridge rejects `execution_ticket_id`, `execution_ticket_hash`, `ticket_id`, `ticket_hash`, `signature`, and nested ticket objects. It also rejects all raw SQL, shell, credentials, database identifiers, migration selection, workflow/ref controls, and arbitrary provider controls through the fixed exact-key contract.

## Fail-closed behavior

Before issuing a ticket, the bridge requires the mutation-grade durable Recovery store, the server-side execution-ticket signer, the durable ticket verifier, approval verifier, fenced lock, Host Breakglass mutation executor, and same-cycle readback verifier. The approval-challenge entrypoint independently requires a durable plan/approval store (`getPlan`, `putApproval`, `getApprovalByPlanStep`), an approval store (`putChallenge`, `getChallenge`), and an injected approval issuer (`createChallenge`). Missing or incomplete authorities return an explicit `503` and the bridge records `database_mutation_performed: false`; no provider or target-database operation is attempted.

The default server composition remains `fail_closed`. The repository does not discover credentials, connect to Production, invoke Hostinger, invoke GitHub, run migrations, apply grants, use SSH/SQL, or activate live mutation adapters as part of this change. Injected non-live doubles are covered by focused tests only.

## Approval-to-execution sequence

The intended sequence is `registered plan → approval challenge → separately governed approval delivery → caller submits approval_token → server-issued execution ticket → fenced Host Breakglass execution → same-cycle readback → sanitized receipt`. The challenge endpoint is not an approval bypass and does not mint a token into the GPT response. The execution bridge remains the only route that can issue the execution ticket, and its exact-key contract continues to reject caller-generated ticket fields.

## Receipt policy

The outward receipt includes bounded plan, step, run, status, phase, idempotency, and readback state. It includes explicit flags indicating that the ticket was server-issued and forwarded internally, but it never returns the execution ticket ID, ticket hash, signature, raw logs, credentials, database identifiers, or provider secrets. Final recovery success still requires the existing readback verification path.

## Migration Execution Safety Layer

The bridge is now accompanied by a pure, injectable safety contract in `http-generic-api/migrationExecutionSafety.js`. This contract does not open a database connection and does not execute SQL. It supplies the preflight and state-machine invariants that a future live adapter must satisfy before any migration mutation can be considered eligible.

The artifact binding distinguishes the repository file hash, the normalized artifact hash, and the derived execution-bundle hash. The statement journal records an ordered `step_index`, statement fingerprint, precondition hash, postcondition hash, timestamps, result class, and reconciliation flag. A transformed or re-split SQL bundle cannot be treated as the approved artifact unless its derived hash remains bound to the plan.

The preflight contract requires an explicit approval identity, exact runtime SHA, target fingerprint, schema precondition fingerprint, supported engine/version, metadata-lock snapshot, capacity/headroom evidence, session-state declaration, health gates, dependency state, traffic mode, and migration-specific execution profile. It rejects blocking metadata locks, long-running target transactions, insufficient headroom, stale schema fingerprints, unsupported engines, non-zero replication lag, missing backup evidence when required by policy, unresolved prior outcomes, and unsafe backfill classifications.

The statement-boundary guard requires a fence assertion before every consequential statement and before recording success. It also exposes a heartbeat path for long waits. The durable execution state machine requires every transition to be persisted before advancing from `approved` through `claimed`, `executing`, `provider_returned`, `verifying`, `verified`, and `finalized`; non-durable transitions fail closed.

A provider response is never treated as success by itself. A passing database postcondition may finalize the ledger, a failed postcondition enters `partial_execution` reconciliation, and an unavailable postcondition after provider return becomes `execution_outcome_unknown`. If the database mutation succeeds but ledger finalization fails, the state is `applied_unrecorded` and the migration must not be retried blindly. The bounded emergency receipt contains only run, migration, SHA, target, result, postconditions, and reconciliation state; ticket internals, credentials, SQL, and provider details are excluded.

The repository test `http-generic-api/test-migration-execution-safety.mjs` exercises these invariants with non-live doubles. Passing this test is evidence of contract coverage only; it is not evidence that Production authorities, Hostinger connectivity, staging certification, or database permissions are live.

## Remaining live prerequisites

This bridge and its safety contract are repository changes, not a Production readiness claim. Live use remains blocked until a durable Production Recovery store, approved ticket signer/verifier, fenced lock with heartbeat, role-specific Hostinger mutation executor, same-cycle readback verifier, deployment-attestation binding, and migration-specific database preflight adapters are independently configured and reviewed. Those prerequisites are intentionally not supplied or activated by this Draft PR.

## Deployment attestation and baseline ordering

Consequential ticket issuance and execution now require a server-injected `deploymentIdentityProvider.readAttestation()` result. The result is checked against the immutable Production repository, branch, exact deployment SHA, Recovery manifest hash, target fingerprint, and a stable attestation hash. The hash basis excludes volatile process timestamps, while the receipt remains read-only and secret-free. The default composition still injects no provider, so the absence of this adapter returns fail-closed and cannot be converted into live authority by environment discovery.

Ordinary migration execution is also subordinate to an explicit `mad4b.baseline-before-ordinary-migration.v1` proof. The proof must carry the exact SHA and target key, a canonical hash, and completed predecessors for Recovery control-plane readiness, durable full inspection, governance baseline, runtime-persistence baseline, canonical grants readback, and governance authority. Missing, reordered, stale, or caller-invented predecessor evidence blocks before the database connection. Empty-database reconstruction remains a separate sequential role-bundle flow; it is not replaced by an ordinary migration.

Each selected baseline role now carries a `mad4b.role-bundle-binding.v1` containing the bundle-manifest checksum, role-bundle checksum, statement count, and statement fingerprints. The signed execution ticket binds the complete selected-role set to these bindings and to `deployment_attestation_hash`. During execution, `mad4b.role-bundle-progress.v1` records monotonic statement boundaries and transitions. Any partial execution, unknown provider outcome, or failed same-cycle verification sets `reconciliation_required: true` and `automatic_rerun_allowed: false`; retry or resume requires the existing durable receipt, exact plan/ticket/bundle/fence identity, and an explicit approval.

## Fenced execute-and-verify lifecycle

The third expansion makes the execution lifecycle explicitly single-cycle and verification-first. After the provider boundary acknowledges an operation, the Recovery Kernel persists `readback_pending`, re-asserts the same fencing lease, and invokes an injected verifier that must declare both `independent_authority: true` and `role_aware: true`. The verifier runs while the fence is held. A successful readback is persisted as `verified`, any required separate Governance Migration Ledger finalization occurs next, then the execution ticket and approval reservation are finalized, and only afterward is the lock released. A provider acknowledgement alone is never a successful recovery receipt.

The approval is bound to exactly one plan, one step, one target fingerprint, one target role, one operation, and one approval hash. The caller may submit an approval token reference, but cannot supply an execution-ticket ID, hash, signature, approval binding, migration selection, database identifier, or credential. Tickets are server-issued and cryptographically recomputed from the signed canonical payload; tampering with the role-specific target fingerprint fails closed during issuance or verification.

Ordinary migration ownership is intentionally separate from execution target. The repository migration `20260815_custom_gpt_mcp_catalog_levels.sql` is owned by the `governance` domain but targets the `runtime` database role and uses the runtime credential binding family. This mapping is checked canonically before provider dispatch; it must not be silently converted into a governance database target. The Governance Migration Ledger is a separate durable authority from the Recovery Store and is required before a verified ordinary migration can finalize. Empty-database baseline reconstruction remains a distinct role-bundle path and is exempt from the ordinary-migration ledger paradox until its own governed ledger prerequisite is available.

Verification by a separate read-only capability requires an exact durable `run_id` bound to the plan hash and step ID. Plan lookup, latest-run lookup, process memory, or an in-memory fallback cannot satisfy verification. When a same-cycle readback fails or the durable run identity is absent, the outcome is `reconciliation_required` and automatic replay is forbidden.

`production_live` is registered only as a contract name for future composition compatibility. `createRecoveryComposition({ mode: "production_live" })` rejects with `RECOVERY_PRODUCTION_LIVE_DISABLED`; this Draft PR adds no environment switch, production adapter, live credential path, or operational activation.

| New contract | Safety guarantee | Live status in this Draft PR |
| --- | --- | --- |
| `mad4b.recovery-deployment-identity-attestation.v1` | Exact repository/branch/SHA/manifest/target binding with stable hash-only evidence. | Injectable contract and tests only; no live provider. |
| `mad4b.baseline-before-ordinary-migration.v1` | Prevents ordinary migration apply before the declared Recovery and schema baseline predecessors. | Enforced in bootstrap apply preflight; no apply is authorized by this PR. |
| `mad4b.role-bundle-binding.v1` | Binds every selected role bundle and statement fingerprint set to the server-issued ticket. | Implemented and tested with non-live fixtures. |
| `mad4b.role-bundle-progress.v1` | Makes statement-boundary progress monotonic and reconciliation-first after partial/unknown outcomes. | Implemented in the baseline executor contract; durable live wiring remains absent. |

These additions improve the repository’s fail-closed safety boundary but do not certify Hostinger deployment parity, database readiness, grants, or any particular migration. The existing private Recovery surface, server-issued ticket semantics, separate least-privilege grants operation, and prohibition on Local Connector fallback for Production remain unchanged.

The focused coverage is in `http-generic-api/test-recovery-execution-binding.mjs`, with related assertions in the execution-ticket, Trust Model, Recovery Kernel, Action Bridge, composition, and runtime-bootstrap tests. The new test is registered in the canonical test manifest and authority registry.

## References

[1]: ../http-generic-api/recoveryExecutionBinding.js "Recovery execution binding contracts"
[2]: ../http-generic-api/recoveryExecutionTicket.js "Server-issued Recovery execution ticket contract"
[3]: ../http-generic-api/runtimeBootstrapContract.js "Runtime bootstrap and baseline execution contract"
[4]: ../http-generic-api/config/recovery-kernel-manifest.json "Recovery Kernel manifest"
