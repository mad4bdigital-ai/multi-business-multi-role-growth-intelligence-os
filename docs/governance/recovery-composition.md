# Recovery Composition Contract

The Recovery/Survival Plane is composed through `http-generic-api/recoveryComposition.js`. The composition root creates the canonical `mad4b.recovery-composition.v1` object and passes bounded dependency groups to the Recovery Kernel, Host Breakglass routes, and Runtime Bootstrap routes.

## Current repository behavior

The server composition root uses `fail_closed` mode. It does not discover adapters from environment variables, `.env` files, Hostinger files, GitHub variables, or provider clients. It does not create a database connection, GitHub dispatch client, SSH session, SQL session, or mutation executor as part of composition. Consequently, consequential Recovery execution remains denied unless a separately constructed composition injects every required authority adapter.

Read-only repository-owned inspection and plan surfaces remain available where their existing route contracts permit them. This is not mutation authority and is not a substitute for a Production adapter.

## Injectable authority graph

A non-live test composition may be created with `mode: "injected_non_live"`. It must provide the complete graph below; partial graphs are rejected before route construction can authorize a consequential step.

| Component | Contract boundary | Purpose |
|---|---|---|
| `recoveryStore` | Durable append-only state, idempotency, claims, reservations, ticket lifecycle, and evidence methods | Stores plans, findings, runs, approvals, execution tickets, and evidence independently of target databases. |
| `approvalIssuer` / `approvalVerifier` / `approvalStore` | Short-lived, step-bound, non-transferable approval challenge lifecycle | Issues and verifies approval authority without returning approval secrets through the GPT-facing surface. |
| `recoveryLock` | `acquire`, `heartbeat`, `assertFence`, and `release` | Supplies a durable fenced lease before and between consequential boundaries. |
| `executionTicketSigner` / `executionTicketVerifier` | Signed, exact-plan/step/target ticket authority | Binds one ticket to the exact Production SHA, target, plan, step, idempotency key, and role selection. The verifier reference is also bound into `recoveryStore`. |
| `mutationExecutor` | Registered capability execution payload | Performs no arbitrary SQL, shell, provider, or credential operations; the implementation must remain server-controlled and capability-scoped. |
| `hostLocalMutationExecutor` | Hostinger role-specific mutation handoff | Must be separately governed and is never inferred from Local Connector or staging credentials. |
| `readbackVerifier` | Same-cycle postcondition and behavioral verification | Recovery is not considered complete from HTTP acknowledgement alone. |
| `partialReceiptStore` | Immutable partial-mutation receipt persistence | Prevents automatic resume after an unknown or partial mutation outcome. |

The contract deliberately requires a complete authority graph. It rejects missing methods and rejects a ticket verifier that is not the same verifier object bound to the durable store.

## Production activation boundary

This patch does **not** activate the graph in Production and does not provide credentials, database names, DSNs, SQL, SSH commands, provider calls, or Hostinger configuration. A future Production adapter, if separately approved, must be constructed outside the GPT-facing request body, bind to the exact deployed Production SHA and role-specific Hostinger identities, retain the existing Admin-governed authority path, use the fenced lock and durable evidence store, and perform same-cycle readback. Local Connector fallback remains forbidden for Production.

The composition contract is therefore a wiring boundary and a safety gate, not a claim that live Production mutation is currently available.
