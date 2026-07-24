# Phase 3 Slice B — Delegation Grant Shadow

## Purpose

Add a read-only delegation contract layer over the existing `agent_delegations` table and the Phase 3 plan-bound session projection. The slice validates the Spec 011 delegation-grant schema before introducing persistence changes or mutation routes.

## Reused authorities

| Contract field | Existing authority |
|---|---|
| Delegating user, delegated Agent, intent, plan, status, and expiry | `agent_delegations` |
| Agent health and maximum delegation TTL | `agents` |
| Plan hash, resource snapshot hash, risk ceiling, session limits, and approval independence | `planBoundSessionShadow.js` |
| Explicit manual opt-in | `agentDelegationOptIn.js` |
| Canonical contract shape | `schemas/delegation-grant.schema.json` |
| Approval-mode policy | `approval-delegation-modes.md` |

No new table or migration is introduced.

## Supported shadow operations

### Preview

The preview validates a proposed canonical grant and returns either:

- `eligible_preview`; or
- `blocked` with canonical blockers.

It computes a deterministic grant ID and grant hash but does not insert or activate a delegation.

### Inspect

Inspection reads one legacy `agent_delegations` row using exact Admin or Tenant scope and projects it into the canonical contract shape.

Legacy rows remain dispatch-ineligible because the current table does not persist:

- approval mode;
- complete allowed and denied intent sets;
- risk ceiling;
- mutation, retry, and pull-request limits;
- readback policy; or
- stop-on-drift policy.

### Revoke and expire preview

Lifecycle previews evaluate whether an inspected grant is eligible to become `revoked` or `expired`. They never update the database.

## Preview gates

A canonical preview fails closed when it observes:

- missing manual API opt-in;
- unsupported approval mode;
- self-delegation;
- plan ID or plan-hash mismatch;
- resource-snapshot mismatch;
- plan intent outside the allowed set;
- allowed and denied intent overlap;
- risk above the proposed ceiling;
- blocked plan-bound session;
- inactive or mismatched Agent;
- TTL above the Agent limit or the 24-hour shadow maximum;
- active delegation already bound to the plan;
- missing readback or stop-on-drift policy;
- mutation authority in recommend-only or queue-for-approval modes; or
- a high-risk ceiling in `delegated_low_risk`.

## Lifecycle rules

- Tenant revocation preview requires the authenticated user to be the delegating user.
- Admin revocation preview may inspect any authorized delegation.
- Expiry preview becomes eligible only after the persisted expiry time.
- Completed, denied, exhausted, revoked, and expired grants are not revocable.
- No lifecycle preview consumes an approval, envelope, idempotency key, or mutation receipt.

## Security and isolation

Tenant reads require exact `delegation_id`, `tenant_id`, and `user_id` matches. Preview requires `delegated_by` to equal the authenticated Tenant user.

The service selects bounded fields only. It does not return Agent prompts, credentials, failure payloads, raw plan JSON, raw policy JSON, or secrets.

## Boundaries

- Shadow-only application service.
- No public route or OpenAPI promotion.
- No delegation insert, activation, renewal, revoke, or expiry write.
- No approval mutation.
- No database migration.
- No provider call, external send, or tool dispatch.
- No runtime-authority change.
- No deployment.

## Follow-up

1. Add additive persistence for canonical grant fields after MariaDB validation.
2. Add governed create, revoke, and expire mutations with receipts and readback.
3. Implement approval modes separately.
4. Prove renewal cannot widen plan, resources, intents, risk, limits, or expiry.
