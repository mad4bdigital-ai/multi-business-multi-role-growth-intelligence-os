# Phase 3 Slice A — Plan-Bound Session Shadow

## Purpose

Project existing execution-plan, connected-session, delegation, and approval authorities into a bounded read-only session contract. This slice proves the binding rules before any delegation activation or persistence change.

## Reused authorities

| Contract field | Existing authority |
|---|---|
| Plan identity and access decision | `execution_plans` |
| Durable operation projection | `durableExecutionShadowService.js` |
| Session lifecycle, policies, checkpoints, and round limits | `connected_execution_sessions` |
| Agent, intent, plan, and expiry binding | `agent_delegations` |
| Independent approval evidence | `approval_holds` |

No new table or migration is introduced.

## Projection

The shadow response contains:

- stable plan-definition hash;
- durable-operation hash from Phase 1;
- sanitized resource snapshot and hash;
- conservative risk ceiling derived from the persisted access decision;
- connected-session mode, state, expiry, and round limits;
- policy hashes instead of raw policy JSON;
- one active delegation, when present;
- independent approval counts and self-approval detection;
- canonical blockers and `next_action`.

## Fail-closed rules

The projection blocks when it observes:

- denied or terminal plans;
- missing, terminal, expired, or unbounded connected sessions;
- exhausted round limits;
- missing required delegation;
- expired, mismatched, or ambiguous delegation;
- pending approval;
- missing independent approval for review-gated plans;
- requester self-approval;
- requester self-assignment;
- agent self-approval;
- malformed plan JSON;
- stale expected plan or resource hashes.

## Expiry and limits

The effective session expiry is the earlier of:

1. the bounded shadow TTL, from 1 to 1,440 minutes; and
2. the active delegation expiry, when a delegation exists.

The projection never persists this value. It is advisory evidence only.

## Security and isolation

Tenant reads require exact `plan_id`, `tenant_id`, and `user_id` matches. Session and delegation reads reuse the same Tenant and user scope. Approval reads are limited to the selected connected run and Tenant.

Raw execution context, steps, preview, resume policy, budget policy, checkpoint policy, cursor, checkpoint, and next-action JSON are never returned. Only stable SHA-256 fingerprints are exposed.

## Boundaries

- No public route or OpenAPI promotion.
- No database write or migration.
- No delegation create, activate, revoke, or renew.
- No approval decision or hold mutation.
- No provider call, external send, or tool dispatch.
- No capability-envelope mutation.
- No runtime-authority change.
- No deployment.

## Follow-up

1. Persist plan-bound session hash, resource snapshot hash, risk ceiling, expiry, and limits after migration design.
2. Add delegation preview/create/inspect/revoke/expire contracts.
3. Implement approval modes separately.
4. Prove that renewal cannot widen authority or self-approve.

## Phase 3 Slice A closeout evidence

- Implementation PR: #3042.
- Merge SHA: `d2dd51d7cb588e467620f8349cbb135102503a0a`.
- Final CI head: `e3c927bee291a425ada8e939bf3485a1e0762f02`.
- Final CI base: `d3cdf2e249d2c2fd62d52fbff0b83c3c4a6fbb6b`.
- Required checks passed: Syntax Check, Architecture Drift Detection, Execution Resolver Gate, and Unit & Integration Tests.
- Runtime readback observed deployed SHA `b342eadd093464811157e9c0fcac1d82a8fa09c4`.
- The deployed runtime was seven commits ahead of the Phase 3 merge and zero commits behind.
- Runtime verification reference: `e2a51673-8bb4-4864-a1c2-1606d1fcc5e8`.

A release reconciliation was prepared after an earlier readback showed runtime lag. Dry-run passed and a short-lived exact-SHA gate was opened. Before execution, `main` advanced, so the gate was hard-disabled and Release Operation `2cca7984-3d93-40eb-bcc3-78f6319e87ff` was cancelled with classification `superseded_before_execution`. No provider dispatch, live deployment, retry, or rollback occurred.

A later readback proved that runtime already contained Phase 3 at a newer descendant. The only remaining difference from `main` was one generated work-map documentation commit affecting three Markdown files. No additional deployment was required.

Phase 3 Slice A is `complete_on_main`. Delegation grant persistence, approval modes, delegated execution, renewal, revocation, and drift escalation remain outside this slice.

The overall Spec 011 status remains `in_progress`.
