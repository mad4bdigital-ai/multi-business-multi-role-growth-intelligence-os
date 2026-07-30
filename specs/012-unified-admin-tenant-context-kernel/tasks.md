# Implementation Tasks

## Phase 1: Inventory and guardrails

- [ ] Inventory all current context, tenant, workspace, brand, resource, connection, capability, authority, OAuth, credential, fallback, and rollback resolvers.
- [ ] Inventory hardcoded identifiers, default-customer fallbacks, caller-supplied identity authority, provider-key-only selection, first-row selection, and owner-unsafe rollback paths.
- [ ] Add static scanner coverage in report-only mode where missing.
- [ ] Document current Admin, Tenant, personal, workspace, brand, OAuth, and rollback entry points.
- [ ] Create a compatibility ledger for `workspace_registry.workspace_type`, `user_app_connections`, `workspace_app_links`, legacy ownership, and overlapping PRs.

## Phase 2: Domain kernel

- [ ] Add principal, effective subject, workspace context, candidate, decision, pin, connection ownership, authority path, execution context, readiness decision, and outcome types.
- [ ] Add `workspaceOwnershipType` independently from the existing operational `workspaceType`.
- [ ] Implement deterministic connection precedence and ambiguity policy.
- [ ] Implement personal-owner, workspace, brand, and tenant eligibility predicates.
- [ ] Require exact owner scope in every resolved selected-connection decision.
- [ ] Omit selected connection and owner-scope fields from unresolved decisions; expose candidate and revision evidence without fabricated ownership.
- [ ] Bind workspace ownership, selected owner-scope type/ref, owner-scope revision, connection revision, authorization revision, and unresolved candidate revision vector into the context hash.
- [ ] Invalidate pins, plans, approvals, and envelopes when any hashed ownership or revision field changes.
- [ ] Implement context hash and tenant/workspace/brand/resource/connection invalidation graph.
- [ ] Implement high-risk and consequential-write fallback prohibition.
- [ ] Add unit and property tests.

## Phase 3: Persistence and registry adapters

- [ ] Add authorized-scope and membership repositories.
- [ ] Add an additive `workspace_ownership_type` persistence field without redefining `workspace_registry.workspace_type`.
- [ ] Add exact connection-ownership repository.
- [ ] Add brand connection binding repository.
- [ ] Persist a safe stable `providerAccountRef` or a versioned, domain-separated `providerAccountBindingHash` for every authorized connection.
- [ ] Preserve the non-secret provider-account binding after credential expiry or revocation and rotate it only through governed authorization completion.
- [ ] Add provider authorization-state repository with reconnect target/account/revision binding and explicit `issued → claimed → consumed` lifecycle.
- [ ] Implement revision-bound atomic compare-and-set claim so exactly one concurrent OAuth callback can continue.
- [ ] Persist `claimedAt`, `claimRevision`, and `claimTokenHash` as mandatory fields throughout `status=claimed`; reject incomplete claimed rows.
- [ ] Verify the internal token against the persisted state-bound hash after worker handoff or process restart; never authorize completion from status/revision alone.
- [ ] Keep raw claim tokens internal, short-lived, state-specific, and non-exportable.
- [ ] Add compare-and-set credential replacement keyed by target connection revision, claimed-state revision, and verified claim token.
- [ ] Atomically commit encrypted credential replacement, provider-account binding update, connection revision increment, and authorization-state consumption, or leave all effects unapplied.
- [ ] Add capability, two-stage readiness, context pin, and execution ledger repositories.
- [ ] Prepare additive migration, dry-run, compatibility, and same-cycle readback contracts.
- [ ] Classify legacy rows before additive backfill.
- [ ] Add compatibility tests for existing `brand|project|campaign|sandbox` workspace types.
- [ ] Avoid exposing SQL table names, credentials, authorization codes, raw state, or claim tokens outside infrastructure.

## Phase 4: Governed migration and persistence readiness

- [ ] Obtain separate governed migration authorization.
- [ ] Run non-mutating schema, base, checksum, statement-count, and compatibility preflight.
- [ ] Apply the additive ownership and authorization-state migration only after preflight passes.
- [ ] Record ledger evidence and same-cycle schema/data readback.
- [ ] Block OAuth, shadow, read, and write rollout until migration readback is verified.
- [ ] Preserve legacy adapters and prohibit destructive cleanup.

## Phase 5: Tenant provider consent

- [ ] Implement User-JWT-protected personal connection list, authorize, reconnect, and revoke use cases.
- [ ] Implement company-workspace connection list, authorize, reconnect, and revoke use cases.
- [ ] Implement brand connection list, authorize, reconnect, and revoke use cases.
- [ ] Derive user and tenant identity from authenticated context.
- [ ] Validate live workspace membership and brand-management authority.
- [ ] Implement signed, expiring, nonce-bound, redirect-allowlisted OAuth state.
- [ ] Atomically claim OAuth state before code exchange, provider calls, credential lookup, or credential mutation.
- [ ] Reject concurrent claim losers with `OAUTH_STATE_CLAIM_CONFLICT` and sequential replays with `OAUTH_STATE_REPLAYED`.
- [ ] Support safe claimed-callback resumption after worker handoff by requiring and verifying persisted claim evidence.
- [ ] Bind reconnect state to target connection, expected connection revision, and the durable expected provider-account reference or binding hash.
- [ ] Reject reconnect account mismatch before credential replacement.
- [ ] Re-read the target connection revision immediately before replacement and enforce the signed expected revision in the credential-write compare-and-set.
- [ ] Couple reconnect credential replacement and `claimed → consumed` state completion atomically; reject partial completion and require a new authorization attempt after conflict.
- [ ] Keep Google identity login separate from Google provider consent.
- [ ] Reconcile shared OAuth route changes with open callback PRs before runtime edits.

## Phase 6: Application use cases and API

- [ ] Implement context resolution.
- [ ] Implement exact connection and owner-scope resolution.
- [ ] Implement context pin create, read, and invalidate.
- [ ] Implement context switching.
- [ ] Implement plan compilation and validation before any required approval or credential-dependent readiness, including operations with no human approval.
- [ ] Implement approval acquisition and revalidation against the exact plan and context revision.
- [ ] Implement unknown-outcome reconciliation.
- [ ] Represent identity readiness, pre-credential readiness, credential materialization eligibility, and provider readiness independently.
- [ ] Add OpenAPI 3.1 personal, workspace, brand, and connection-resolution routes and schemas.
- [ ] Add structured errors, bounded pagination, idempotency, concurrency, and no-secret contracts.

## Phase 7: Authority, capability, readiness, and activation integration

- [ ] Integrate Effective Capability Envelope as a consumer of the exact connection and owner-scope decision.
- [ ] Integrate Effective Authority as a consumer of the exact connection and owner-scope decision.
- [ ] Run context, ownership, capability, authority, plan, approval, and non-secret readiness before credential loading.
- [ ] Materialize credentials only for the exact selected connection after the exact plan exists and any required approval is obtained and revalidated.
- [ ] Run credential validity, provider-account binding, provider-scope, reachability, quota, schema, and readback checks after guarded materialization.
- [ ] Integrate Tenant Activation readiness and typed remediation.
- [ ] Invalidate decisions, plans, approvals, and unconsumed authorization states on membership, owner, provider-account, scope, or revision movement.

## Phase 8: Shadow and read-only rollout

- [ ] Require verified migration readback before production shadow/read enablement.
- [ ] Integrate low-risk read routes in shadow mode.
- [ ] Integrate resource-first and brand-scoped flows.
- [ ] Compare exact owner-scope decisions and investigate every isolation, ambiguity, fallback, or readiness discrepancy.
- [ ] Keep cross-tenant, cross-user, and cross-brand isolation tests release blocking.
- [ ] Add release-blocking OAuth sequential replay, concurrent claim, worker-restart resume, missing/mismatched verifier, expiry, redirect, reconnect-account, durable-binding-after-expiry, reconnect-revision-race, atomic-completion, and context-mismatch tests.
- [ ] Add fault injection at every reconnect atomic-completion substep and prove all effects remain unapplied after each failure.
- [ ] Add release-blocking context-hash owner-scope substitution, ambiguity, unresolved-owner-scope omission, no-silent-fallback, approval-order, no-approval-plan, two-stage-readiness, and no-secret tests.
- [ ] Enable bounded low-risk reads only after parity and all gates pass.

## Phase 9: Governed writes, rollback, and closeout

- [ ] Enable tenant writes through governed approval with exact resource, connection, and owner-scope binding.
- [ ] Enable Admin writes after effective-subject evidence passes.
- [ ] Require same-cycle readback and reconciliation-before-retry.
- [ ] Remove legacy first-result and customer-default paths after compatibility evidence.
- [ ] Keep exact-owner isolation active during rollback; disable or fail closed affected provider operations when the guard is unavailable.
- [ ] Add rollback tests that reject restoration of owner-unsafe selectors.
- [ ] Verify production deployment against expected commit SHA.
- [ ] Run post-merge isolation, context-hash integrity, no-secret, OAuth concurrent-claim, worker-resume verifier, durable account-binding, reconnect-account, reconnect-revision-race, atomic-completion, readiness, migration, and rollback audit.
- [ ] Record all implementation PRs and closeout evidence in `completion.json`.

## Definition of done

- [ ] All acceptance scenarios pass.
- [ ] OpenAPI validates.
- [ ] No production hardcoding or unsafe selection findings remain.
- [ ] Existing operational workspace-type semantics remain unchanged.
- [ ] Cross-tenant, cross-user, and cross-brand isolation gates pass.
- [ ] Context hash changes on owner-scope or relevant revision movement and invalidates dependent state.
- [ ] Every connection retains a durable raw or privacy-preserving provider-account binding.
- [ ] Every claimed OAuth state retains mandatory state-bound verifier evidence until completion or terminal transition.
- [ ] OAuth atomic claim, replay, reconnect binding, reconnect-write concurrency, and no-silent-fallback gates pass.
- [ ] Reconnect credential replacement and authorization-state consumption commit together or remain unapplied under per-substep fault injection.
- [ ] Unresolved decisions omit selected connection and owner-scope fields.
- [ ] Migration readback precedes every dependent runtime rollout.
- [ ] Plan and approval precede guarded credential materialization and provider readiness.
- [ ] Operations without human approval still bind an exact plan before credential materialization.
- [ ] Two-stage readiness works without premature credential exposure.
- [ ] Rollback retains exact-owner isolation or fails closed.
- [ ] CI and security review pass.
- [ ] Migration, production verification, and post-merge audit evidence are recorded.
- [ ] Rollback and support runbooks are complete.
- [ ] No merge, migration, deployment, provider write, or credential mutation occurs without separate approval.