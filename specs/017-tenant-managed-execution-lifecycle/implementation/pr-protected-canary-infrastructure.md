# Spec 017 — Protected Managed Execution Canary Infrastructure

## Purpose

This change adds the governed mechanism required to validate Tenant Managed Execution against the protected runtime without treating synthetic tests as Production evidence.

It does **not** execute the protected canary while this pull request is under review.

## Why the canary cannot run from PR-head tooling

The protected canary needs the existing repository `BACKEND_API_KEY` only to call the admin-governed Platform JWT client and admin projection/approval surfaces. A workflow that checks out arbitrary pull-request code before exposing that secret would create a secret-exfiltration boundary.

The workflow therefore runs only from the trusted default branch after merge. Its trigger pins both:

- the exact trusted `main` SHA containing the canary runner; and
- the exact protected `Production` SHA observed before and after execution.

The workflow fails closed if either ref moves.

## Tenant identity

The canary does not store or require a long-lived `USER_JWT` secret.

It uses the existing `POST /auth/platform-jwt/issue` route with the repository admin/service key. The route must resolve an active user, verify active membership in the explicitly requested tenant, and mint a tenant-compatible token with a 600-second TTL. The token is held only in process memory and is cleared before the runner exits.

The tenant-path assertions never fall back to admin identity.

## Explicit fixture contract

The trigger requires explicit values for:

- `user_id`
- `tenant_id`
- `parent_ticket_id`
- `capability_key`
- `resource_type`
- `resource_ref`

The runner does not discover a random tenant, user, ticket, capability, or grant. Runtime authority remains responsible for proving that the user has the required effective resource grant and that the capability is active and executable.

For the state-change journey, the selected fixture must expose an active capability with `dispatch_allowed=true` and `apply_allowed=true`, and the user must have an effective `edit` or stronger grant for the exact resource or workspace.

## Protected assertions

The live canary is designed to prove:

1. a short-lived tenant JWT can be issued only for an active user/tenant membership;
2. cross-tenant scope is rejected before managed execution creation;
3. read-only lifecycle creation does not invent an approval hold;
4. run and step idempotency reuse the existing records;
5. tenant projections exclude raw authority/execution/idempotency/credential payloads;
6. admin projections remain role-safe and evidence-oriented;
7. reconciliation dry-run is contradiction-free and zero-action for a healthy run;
8. a local managed step can move `running -> failed`, then recover through bounded retry;
9. reassignment requires active tenant membership;
10. a state-change run creates an approval hold and cannot create a step while that hold is open;
11. an admin decision can approve the hold through the canonical route;
12. the state-change canary completes through local lifecycle writes only, without provider dispatch;
13. rollback creates and completes the canonical `__managed_rollback__` compensation step;
14. rollback finalization produces `cancelled + rolled_back` with zero linked-state contradictions;
15. final reconciliation dry-run returns zero contradictions and zero repair actions.

## Explicitly forbidden effects

The canary runner has no route for:

- provider dispatch;
- external business sends;
- credential payload reads;
- direct SQL;
- Migration Apply;
- deployment/restart/release activation;
- registry mutation;
- reconciliation Apply.

The static merge-blocking contract rejects these surfaces.

## Unknown provider outcome

This infrastructure does **not** claim to certify an unknown provider outcome. The current public Managed Execution API intentionally prevents creation of contradictory linked state through normal routes, and no governed fault-injection surface has been identified yet.

A future closeout step must either:

- use an existing official fault-injection/reconciliation surface if one is found; or
- add a separately governed, non-Production/provider-free fault-injection contract.

No direct database corruption is acceptable as a substitute.

## Post-merge execution

After this infrastructure is merged into trusted `main`:

1. open/use a closeout PR for Spec 017 metadata only;
2. pin the current `main` and `Production` SHAs;
3. run `Hostinger Production Runtime Readback R7` to prove exact deployed Production runtime parity;
4. invoke the Spec 017 protected canary on the closeout PR with the exact authorized fixture;
5. inspect the sanitized artifact;
6. update `tasks.md`, `completion.json`, and `e2e-phases.json` only from exact evidence;
7. keep #4449 open until unknown-outcome/reconciliation evidence and the final post-merge audit are complete.

Migration 1043 remains `already_applied_verified`; this workflow cannot execute or authorize another Apply.
