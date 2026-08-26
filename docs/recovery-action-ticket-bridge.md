# Recovery Action Ticket Bridge

## Purpose

The private Recovery Action bridge closes the Action/runtime contract gap for one consequential Recovery Kernel step. An authenticated administrator submits only the registered plan and step references, a single-use approval token, and an idempotency key. The server resolves the immutable plan and step, issues the execution ticket through the existing Recovery Kernel ticket issuer, stores it in the durable Recovery store, and forwards the ticket references internally to the injected Host Breakglass mutation boundary.

The bridge does not create a second ticket format. It reuses `createExecutionTicket()` and `executeRemediationStep()` from `http-generic-api/recoveryKernel.js`, preserving the existing bindings for inspection evidence, target fingerprints, Production SHA, plan hash, step hash, idempotency, single-use state, expiry, approval, fencing, and readback.

## Private surfaces

The HTTP operation is `POST /admin/recovery/kernel/execute-approved` with operation ID `executeApprovedAdminRecoveryKernelStep`. The historical `POST /admin/recovery/kernel/execute` path is retained only as a server-issued-ticket alias; it now accepts the same five-field bridge contract and rejects caller-supplied ticket references. Both operations are marked only for the `admin_recovery_production` surface and remain excluded from the shared Admin Core and Activation projections.

The fixed System Tool is `recovery_kernel_execute_approved_step`. It is `requires_admin`, tagged as `private`, `principal_scoped`, and `consequential`, and uses `catalog_level: private_recovery`. The shared `recovery_kernel_call` read-only allowlist is intentionally unchanged. Tenant and non-admin principals cannot list, look up, or call the private descriptor.

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

Before issuing a ticket, the bridge requires the mutation-grade durable Recovery store, the server-side execution-ticket signer, the durable ticket verifier, approval verifier, fenced lock, Host Breakglass mutation executor, and same-cycle readback verifier. Missing or incomplete authorities return an explicit `503` and the bridge records `database_mutation_performed: false`; no provider or target-database operation is attempted.

The default server composition remains `fail_closed`. The repository does not discover credentials, connect to Production, invoke Hostinger, invoke GitHub, run migrations, apply grants, use SSH/SQL, or activate live mutation adapters as part of this change. Injected non-live doubles are covered by focused tests only.

## Receipt policy

The outward receipt includes bounded plan, step, run, status, phase, idempotency, and readback state. It includes explicit flags indicating that the ticket was server-issued and forwarded internally, but it never returns the execution ticket ID, ticket hash, signature, raw logs, credentials, database identifiers, or provider secrets. Final recovery success still requires the existing readback verification path.

## Remaining live prerequisites

This bridge is a repository contract and wiring change, not a Production readiness claim. Live use remains blocked until a durable Production Recovery store, approved ticket signer/verifier, fenced lock, role-specific Hostinger mutation executor, same-cycle readback verifier, and deployment-attestation binding are independently configured and reviewed. Those prerequisites are intentionally not supplied or activated by this Draft PR.
