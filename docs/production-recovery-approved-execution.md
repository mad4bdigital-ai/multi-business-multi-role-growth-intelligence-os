# Governed Production Recovery Approved Execution

## Scope

This contract adds a Production Recovery capability without granting autonomous C5 authority to GPT callers. Human approval remains mandatory for every consequential plan step. The server owns all approval-token and execution-ticket material.

This change is repository-only. It does not connect to Production, execute SQL, apply grants, run migrations, invoke Hostinger, or activate a live provider by itself.

## Approval flow

The private Admin Recovery surface on `auth.mad4b.com` uses this sequence:

1. Create or resolve an immutable Recovery plan and consequential step.
2. Call `POST /admin/recovery/kernel/approval-challenge` with `plan_id`, `plan_hash`, and `step_id`.
3. The server persists the short-lived approval challenge and returns `confirmation_requirements` containing an exact typed confirmation phrase bound to `approval_id + plan_hash + step_id + expected_sha`.
4. The administrator types that exact phrase.
5. `POST /admin/recovery/kernel/execute-approved` validates the phrase and resolves the already-approved token only through the server-owned approval authority.
6. The existing Recovery Kernel issues and stores the execution ticket internally, acquires the fenced lock, executes through the governed Host Breakglass mutation boundary, performs independent role-aware same-cycle readback, and only then finalizes the ticket and approval.

The approval token is never returned to the GPT. Execution-ticket IDs, hashes, signatures, credentials, SQL, database identifiers, and provider controls are also never returned or caller-controlled.

## Request compatibility

The v2 bridge accepts the explicit server-managed confirmation fields:

- `plan_id`
- `plan_hash`
- `step_id`
- `approval_id`
- `expected_sha`
- `typed_confirmation`
- `idempotency_key`

The already-published private Recovery/System Tool projections still expose a field named `approval_token`. During the compatibility window, that field may carry only the exact server-issued typed confirmation phrase:

`APPROVE PRODUCTION RECOVERY <approval_id> <step_id> <expected_sha>`

When the value matches this grammar, `recoveryActionBridge.js` treats it as confirmation transport, not as approval-token material. It parses the approval and SHA references, verifies them against the durable approval record, resolves the real token internally, and never forwards the phrase as a token to the approval verifier. Raw caller-generated ticket fields remain forbidden.

A later governed generated-artifact refresh may project the explicit v2 fields directly. Compatibility does not weaken the server-side binding or token secrecy requirements.

## Empty-role bootstrap deadlock

`runtime_persistence` cannot be used as the prerequisite durable evidence store for rebuilding itself. Production live authority therefore requires a Recovery Store that is explicitly independent of all target databases:

- `recovery_store_contract = mad4b.recovery-durable-store.v1`
- `independent_of_target_databases = true`
- `target_database_binding = forbidden`
- durable append-only evidence operations are available before any target-role mutation

This is the bootstrap deadlock breaker. It does not create an exception that allows an unproven database rebuild.

The existing `database.empty_rebuild` / selected-role contracts continue to enforce the mutation conditions. A selected role may be rebuilt only when same-cycle inspection and the proof-carrying plan establish the role as empty, bind the exact Production SHA, bind the selected role and object-count fingerprint, and bind repository-owned role-bundle checksums/statements. A non-empty or unproven role remains fail-closed. `runtime_persistence` uses its dedicated repository-owned rebuild capability and must receive same-cycle postcondition readback before the step can finalize.

After `runtime_persistence` exists, ordinary durable inspection and baseline-order contracts remain authoritative. The independent Recovery Store remains the control-plane evidence authority rather than becoming dependent on the target role that it governs.

## Production live composition gate

`createProductionRecoveryComposition()` remains fail-closed by default. Direct caller construction using `mode: production_live` is rejected. A live candidate can be activated only through the server-managed deployment provider path and only when the secret-free envelope explicitly certifies:

- Production environment and Hostinger Auto Deploy runtime identity;
- canonical Admin Recovery host `auth.mad4b.com`;
- exact-SHA binding;
- single-use approval;
- server-side approval-token resolution;
- independent target-database-free bootstrap evidence;
- independent role-aware same-cycle readback;
- complete required authority graph.

The provider envelope must carry `mad4b.production-recovery-live-authorization.v1`. Missing or false certification fields produce a fail-closed composition and no provider/database access. The repository does not infer live authorization from environment variables, caller credentials, GPT input, or Local Connector metadata.

## Safety invariants

Production execution remains bounded by the existing Recovery Kernel invariants: immutable plan and step hashes, exact deployment SHA, target fingerprint, single-use approval reservation, single-use execution ticket, durable idempotency, fenced lock with heartbeat, repository-owned operation authority, independent same-cycle verification, reconciliation instead of blind replay after an unknown provider outcome, and least-privilege grants as a separate approved step.

No part of this contract authorizes rebuilding a non-empty database or applying the ordinary migration before baseline predecessors and readback are satisfied.

## Intended incident sequence

For the current empty-role incident the governed order remains:

`inspect → plan → preview → challenge → human typed confirmation → rebuild approved empty baseline role → same-cycle readback → next approved baseline role → same-cycle readback → separately approved least-privilege grants → 20260815_custom_gpt_mcp_catalog_levels.sql → Hard Activation → final readback`

Each consequential step receives its own bounded approval unless a higher-level plan contract explicitly and safely defines otherwise. This patch does not introduce blanket Production approval.
