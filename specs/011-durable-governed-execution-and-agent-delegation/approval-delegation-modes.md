# Approval Delegation Modes

## Principle

Delegation grants an Agent bounded execution authority. It does not make the Agent the user, does not transfer account ownership, and does not permit the Agent to expand or approve its own authority.

Every decision records:

- delegating user;
- delegated Agent or Agent class;
- grant ID;
- plan ID and plan hash;
- resource and snapshot hash;
- intent and mode;
- risk tier;
- policy rule;
- decision reason;
- mutation receipt and readback.

## Mode matrix

| Mode | Plan | Approval | Execution | Pause condition |
|---|---|---|---|---|
| `user_approval_only` | Agent may prepare | User approves each mutation | Agent executes approved step | Every mutation |
| `agent_recommend_only` | Agent prepares and scores | No Agent approval | No mutation | Always |
| `agent_queue_for_approval` | Agent bundles compatible steps | User approves bundle | Agent executes exact bundle | Bundle drift |
| `delegated_low_risk` | Plan or policy template | Grant permits allowlisted low-risk steps | Automatic within limits | Risk or scope drift |
| `delegated_plan_bound` | Exact user-approved plan | Grant covers listed steps | Automatic within plan | Hash, resource, mode, risk, or limit drift |
| `human_on_exception` | Certified template and run plan | User delegates normal path | Automatic normal path | Exception, anomaly, or policy drift |
| `multi_agent_approval` | Planner creates | Independent reviewer approves | Separate executor acts | Reviewer conflict or drift |
| `break_glass` | Emergency plan | Explicit emergency grant | Bounded emergency action | Expiry, limit, recovery, or audit failure |

## Initial supported modes

The first implementation supports:

1. `user_approval_only`
2. `agent_recommend_only`
3. `agent_queue_for_approval`
4. `delegated_low_risk`
5. `delegated_plan_bound`

`human_on_exception` may be enabled only after certified low-risk pilots. `multi_agent_approval` and `break_glass` require separate design and certification phases.

## Delegation grant fields

```yaml
grant_id: uuid
delegated_by: user-id
delegated_to: agent-id-or-agent-class
approval_mode: delegated_plan_bound
plan_id: uuid
plan_hash: sha256
resource_scope:
  - resource_uri: github://owner/repo
    snapshot_hash: sha256
allowed_intents:
  - repo.patch.apply
  - repo.pr.create
  - repo.branch.update
  - ci.rerun
  - ci.low_risk_repair
denied_intents:
  - repo.pr.merge
  - production.deploy
  - database.migration.apply
  - credential.write
max_risk_tier: low
max_mutations: 12
max_retries: 3
max_pull_requests: 1
expires_at: timestamp
require_readback: true
stop_on_drift: true
status: active
```

## Default low-risk candidates

Subject to policy and resource authority:

- readback and reconciliation;
- bounded retries for read-only calls;
- branch synchronization without force push;
- CI rerun;
- documentation-only semantic patches;
- generated artifact regeneration through authoritative generator;
- low-risk contract repair with deterministic tests;
- closeout evidence generation without merge.

## Default user-controlled actions

- protected branch merge;
- production deployment;
- production migration apply;
- destructive or data-changing SQL;
- credential, secret, authentication, or permission mutation;
- financial, billing, budget, or campaign mutation;
- external send or publish;
- deletion of production resources;
- branch-protection or CI bypass;
- any action outside a verified rollback boundary.

A future policy may delegate a specific high-risk action, but only with exact plan, resource, mode, checksum or SHA, typed confirmation, short expiry, risk acceptance, rollback, and same-cycle readback. There is no global high-risk delegation.

## Drift rules

The platform pauses and requests the user when any of the following changes:

- plan hash;
- resource identity or resource snapshot;
- head or base SHA;
- migration checksum or statement count;
- operation mode;
- affected files beyond the plan;
- risk classification;
- cost or budget;
- required permission;
- provider binding or endpoint identity;
- validation result;
- rollback readiness;
- mutation or retry limit.

## Revocation and expiry

Revocation and expiry are checked before every dispatch, not only at session start. A revoked grant blocks pending steps and prevents child-envelope renewal. Already dispatched mutations proceed to reconciliation and evidence; they are not silently retried.

## Separation of duties

For `multi_agent_approval`:

- planner, reviewer, and executor are distinct principals or execution roles;
- the reviewer receives bounded evidence, not secret payloads;
- any plan change invalidates review;
- the executor cannot alter the approved plan;
- the policy engine remains final authority.
