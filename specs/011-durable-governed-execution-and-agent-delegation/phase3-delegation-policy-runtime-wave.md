# Phase 3 Delegation Policy Runtime Wave

## Scope

This integrated wave closes the runtime-policy portion of Spec 011 Phase 3 without enabling Production delegation persistence.

It reuses the existing canonical grant preview, lifecycle plan, repository mutation, MariaDB adapter, readiness collector, and default-off runtime binding. The new policy layer is inserted before sequential-plan step claim and provider dispatch.

## Covered tasks

- T142 `user_approval_only`
- T143 `agent_recommend_only`
- T144 `agent_queue_for_approval`
- T145 `delegated_low_risk`
- T146 `delegated_plan_bound`
- T147 human-on-drift pause and typed escalation
- T148 separation-of-duties foundation
- T149 renewal cannot widen authority or self-approve

T141 remains open until governed Production lifecycle mutation and same-cycle readback evidence are available.

## Runtime policy boundary

A delegated sequential-plan step is evaluated against:

- active and unexpired grant status;
- exact delegated Agent identity;
- plan ID and plan hash;
- resource snapshot hash;
- allowed and denied intents;
- risk ceiling;
- mutation, retry, and pull-request limits;
- readback availability;
- explicit approval identity and step fingerprint;
- reserved user-controlled intents;
- drift in plan, resource, SHAs, migration checksum, cost, risk, authority, or provider behavior;
- planner, reviewer, and executor separation when required.

The gate returns one deterministic decision:

- `dispatch_allowed`
- `user_approval_required`
- `queued_for_approval`
- `recommend_only`
- `paused_on_drift`
- `blocked`

No delegated step reaches provider dispatch unless the decision is `dispatch_allowed`.

## Approval identity

When a delegation policy requires user approval:

- the approval actor is derived from the authenticated approval path;
- the delegated Agent cannot approve its own execution;
- delegator-bound approval must be performed by `delegated_by`;
- the approval is bound to the exact step fingerprint;
- separation-of-duties review rejects planner/reviewer/executor identity collisions.

## Drift behavior

Any drift outside the signed grant boundary pauses execution before dispatch. The operation returns a typed `delegation_boundary_drift` escalation with bounded reason codes. Approval is not inherited after drift.

## Legacy compatibility boundary

The legacy `/agents/:id/delegate` route is retained for compatibility but its direct `agent_delegations` write is default-off. Without an explicit internal compatibility flag, it returns a structured `canonical_delegation_grant_required` response and directs the caller to the canonical grant preview/lifecycle flow.

## Renewal boundary

Renewal reuses the canonical no-widening evaluator. It additionally requires approval by the original delegator and rejects approval by the delegated Agent. Any expanded resource scope, intents, risk, limits, or expiry remains blocked.

## Safety state

- No Production migration apply.
- No Production database write.
- No runtime binding enablement.
- No `runtime_policy_ready` promotion.
- No provider call performed by the implementation or tests.
- No new public MariaDB mutation route.
- No secret or raw authorization payload is returned.
- T141 remains open pending governed Production activation evidence.
