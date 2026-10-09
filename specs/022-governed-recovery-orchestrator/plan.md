# Implementation Plan — Feature 022

## Architecture
Keep recoveryKernel.js, recoveryComposition.js, recoveryExecutionTicket.js, and recoveryExecutionBinding.js as existing authority roots. The new recoveryOrchestrator.js is a generic coordination layer; it does not replace or bypass their checks. Bind it only through server_managed components. A future adapter bridge must validate the existing Recovery Composition and its authority provenance before it may call executeRecovery.

### Components
- \`createRecoveryCapabilityRegistry\`: bounded server-owned descriptor validation and read-only listing.
- \`planRecovery\`: bounded inspect + immutable SHA plan persisted in a non-target durable store.
- \`executeRecovery\`: exact binding → signed approval verifier → fenced lease → atomic claim → durable intent → fence check → adapter dispatch → independent readback → durable finalization.
- \`reconcileRecovery\`: UNKNOWN → independent verifier → atomic finalization; never re-dispatch.
- \`buildRecoveryOrchestratorRoutes\`: admin-only GET capability discovery, no write verbs.
- \`Recovery UI\`: later milestone; must consume the three separate diagnostic, execution and activation readiness states.

## Dynamic adapter contract
\`{id,provider_id,resource_kind,environments,operations:[{key,risk,requires_independent_readback:true}],inspect,execute?}\`.
Provider adapters must source credentials from server vault, enforce exact resource identity and tenancy, return no secrets, and expose no raw URL/SQL/command to caller.

## Persistence contract (server-owned)
\`putPlan/getPlan\` must be durable, with integrity-checked readback.
\`claimStep\` must be atomic, unique by plan ID with persistent replay prevention.
\`appendIntent\` must commit BEFORE dispatch and return a verified evidence digest.
\`markUnknown\` must be CAS/fenced, never overwriting already finalized RECOVERED.
\`finishStep\` and \`finishReconciliation\` must be CAS/fenced, independently verifiable and durable.
No in-memory Map implementation qualifies for live execution.

## Concurrency and failure policy
Use an exact resource lease plus strictly monotonic fencing tokens. The store must reject stale token and duplicate claims. An adapter needs idempotent external requests or independent resource probes; HTTP 5xx/timeout is an UNKNOWN outcome, not a license to resend. A failed claim/intention/fence must cause ZERO provider side effects. If a post-dispatch verifier/store fails, mark UNKNOWN with durable evidence and let reconciliation decide. Pre-existing already recovered state must never regress.

## Delivery phases
P0: Core contracts and source tests, dry-run-only capability discovery (this branch).
P1: Server composition adapter wiring with selected vetted providers, native Staging durable store and independent proof.
P2: Adapters for Hostinger/MariaDB/Windows/GitHub/WordPress/Browser; multi-process chaos drills and rollback/compensation.
P3: Unified Admin UI, detailed evidence view, provider capability health, and per-action user consent.
P4: Production authority under a separate exact-head owner-signed release ticket, independent Staging certificate and immutable rollback evidence.

## Hazards and controls
Never accept a provider \`verified:true\` as final authority. Never persist raw credentials or accept caller-defined URLs. Never equate current \`runtime.ready\` with \`production_activation_eligible\`. Require clock bounds and source SHA on every execution. Reject stale or historical device identities, cross-account DB grants, and missing platform TPM proof. Ensure E2E source inventory doesn't masquerade as native certification.
