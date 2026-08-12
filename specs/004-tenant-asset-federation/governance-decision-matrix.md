# Governance and Decision Matrix

## 1. Purpose

The platform must make it obvious who may view, select, customize, publish, approve, execute, experiment, and promote each kind of change. This matrix separates product flexibility from authority.

## 2. Governance roles

Illustrative roles; canonical names remain registry-defined.

- **Platform governance:** owns mandatory safety, shared catalog classification, platform policy semantics, and platform releases.
- **Tenant owner:** owns tenant-level entitlement, delegated administration, and tenant-wide profiles/variants within platform limits.
- **Workspace administrator:** owns workspace membership, scoped profiles, and eligible integrations.
- **Brand administrator:** owns Brand Core, brand-scoped profiles/variants, and brand governance.
- **Business activity administrator:** owns activity-specific defaults, workflows, and outcome models.
- **Role administrator:** owns role templates/assignments where delegated.
- **Integration administrator:** configures tenant/workspace/user connections and validates installations.
- **Publisher/operator:** executes authorized workflows/actions and requests exact approvals.
- **User:** selects personal profiles/preferences and creates personal variants within allowed paths.
- **Reviewer/approver:** decides scoped holds or publications according to risk.
- **Experiment owner:** manages approved bounded experiments.
- **Platform release owner:** promotes certified candidates to shared platform versions.

No role has implicit cross-tenant bypass.

## 3. Decision matrix

| Decision | User | Role admin | Workspace admin | Brand/activity admin | Tenant owner | Platform governance |
|---|---|---|---|---|---|---|
| View shared catalog | yes if visible | yes if visible | yes | yes | yes | yes |
| Use authorized shared asset | yes | yes | yes | yes | yes | governed support only |
| Edit own preferences | yes | own only | own only | own only | own only | no implicit edit |
| Select own composition template | yes within bounds | yes | yes | yes | yes | defines templates/bounds |
| Create personal variant | yes if allowed | yes | yes | yes | yes | defines modifiable paths |
| Publish role variant/profile | no unless delegated | yes | if delegated | if delegated | yes | platform floor applies |
| Publish workspace variant/profile | no unless delegated | no unless delegated | yes | no unless delegated | yes | platform floor applies |
| Publish brand/activity variant/profile | no unless delegated | no unless delegated | if delegated | yes | yes | platform floor applies |
| Publish tenant variant/profile | no | no | no | no | yes | platform floor applies |
| Manage grants/delegations | no by preference | exact delegated scope | exact workspace scope | exact brand/activity scope | tenant scope | platform governance only for platform scope |
| Configure own connection | if policy permits | if delegated | if delegated | if delegated | yes | managed platform connections only |
| Configure tenant connection | no unless delegated | no unless delegated | if delegated | if delegated | yes | managed policy only |
| Approve consequential action | only when assigned approver | according to policy | according to policy | according to policy | according to policy | no implicit bypass |
| Start personal low-risk experiment | yes with consent | yes | yes | yes | yes | defines class policy |
| Start scoped composition/variant experiment | no unless delegated | role scope | workspace scope | brand/activity scope | tenant scope | may block/require review |
| Promote tenant improvement to platform candidate | nominate | nominate | nominate | nominate | nominate/approve export | certify/release |
| Publish shared platform asset/version | no | no | no | no | no | yes through release governance |

## 4. Change-class governance

### Class A — Presentation preference

Examples: language, layout, explanation depth.

- owner: user;
- approval: explicit user action or prior opt-in;
- simulation: optional preview;
- rollback: immediate reset;
- platform review: not normally required.

### Class B — Workflow/agent ranking

- owner: user;
- authority effect: none;
- approval: user;
- evidence: repeated authorized choices/outcomes or explicit preference;
- rollback: reset ranking.

### Class C — Context composition

- owner: user for own selection, administrator for wider scope;
- simulation: required for publication beyond personal scope;
- approval: scope owner and policy as configured;
- restrictions: cannot choose forbidden operator or remove mandatory layer;
- rollback: revert selection/profile version.

### Class D — Optional variant

- owner: declared scope;
- validation: modifiable paths and asset schema;
- certification: based on risk/runtime impact;
- approval: publisher/approver according to scope/risk;
- rollback: disable/reset to shared.

### Class E — Authority or consequential operation

Examples: grants, credentials, spend, provider writes, deployment, destructive actions.

- owner: existing governed authority;
- adaptive system: may diagnose/propose only;
- approval: exact role/hold/capability envelope;
- execution: exact manifest and readback;
- no automatic promotion.

## 5. Policy ownership

| Policy type | Owner | Tenant can tighten | Tenant can loosen |
|---|---|---:|---:|
| Mandatory platform safety | platform | yes through additional restrictions | no |
| Tenant governance | tenant owner | yes | only within platform floor and approval |
| Workspace operating policy | workspace admin | yes | within tenant/platform bounds |
| Brand policy | brand admin | yes | within tenant/platform/Brand Core bounds |
| Activity policy | activity admin | yes | within higher-level bounds |
| Role policy | role admin | yes | within scope/delegation ceiling |
| User preference | user | may narrow/rank | cannot alter authority |
| Session/task selector | runtime/user request | temporary narrowing/selection | cannot bypass persistent authority |

## 6. Approval routing

Approval policy is based on consequence, not UI origin.

| Risk/consequence | Minimum route |
|---|---|
| Presentation only | user confirmation/opt-in |
| Read-only workflow ranking | user confirmation |
| Personal profile selection | user confirmation; simulation where configured |
| Wider-scope profile publication | scope administrator + policy validation |
| Runtime-affecting variant | publisher + certification; approver if medium/high |
| Write/provider action | exact action approval as policy requires |
| Credential-touching | integration authority; high-risk approval |
| Destructive/deployment | two distinct approvers where required |
| Platform shared promotion | platform review, tests, certification, release approval |

Approval records bind exact versions, scope, risk, operation, and expiry.

## 7. Delegation

Delegation must declare:

- delegator and effective authority evidence;
- delegate principal;
- tenant and exact context scope;
- resource family/asset/action;
- operations;
- validity and expiry;
- redelegation allowed or forbidden;
- approval requirement;
- revocation behavior.

The delegate cannot publish or execute beyond the delegator's current ceiling. Delegation becomes stale after epoch/authority changes and must be re-evaluated.

## 8. Conflict governance

### Technical conflict

Examples: equal-ranked policy values, variant patch conflict, ambiguous connection.

Default: block and require deterministic resolution.

### Product conflict

Example: user preference selects a workflow excluded by workspace focus profile.

Default: preserve authority/profile; explain preference could not apply.

### Organizational conflict

Example: workspace and brand administrators publish incompatible non-mandatory configurations.

Default: registered field operator resolves when possible; otherwise escalation to tenant owner or designated governance role.

### Safety conflict

Any conflict involving mandatory policy, cross-tenant access, credentials, or consequential approval blocks immediately and cannot be resolved by preference.

## 9. Governance evidence

Every publication/decision records:

- actor and authority source;
- tenant/context scope;
- current and proposed versions;
- diff and affected resources/users;
- risk class;
- validation/simulation results;
- approval decisions;
- effective/expiry timestamps;
- same-cycle readback;
- rollback reference.

## 10. Review cadences

- mandatory platform policy: change-driven plus scheduled security review;
- tenant/workspace/brand profiles: owner-defined review, with expiry for temporary rules;
- role assignments/delegations: periodic recertification;
- sensitive grants: periodic recertification and usage review;
- connections/installations: continuous expiry/health plus periodic scope review;
- variants: review on base update/conflict and inactivity;
- adaptive experiments: bounded measurement window;
- promotion candidates: release-cycle review;
- unresolved parity/adaptation debt: operational review until resolved.

## 11. Governance anti-patterns

Forbidden:

- one global admin role used for all tenant operations;
- user preference JSON storing hidden grants;
- permanent approval inferred from repeated approvals;
- tenant owner bypassing mandatory platform policy;
- automated promotion based only on engagement;
- platform reuse of tenant content without privacy review;
- variant ownership without tenant boundary;
- unclear responsibility for rollback;
- changing shared assets to satisfy one user when a personal variant suffices;
- creating a new repository branch to avoid safely repairable current-branch history.

## 12. Decision records

Significant decisions require ADRs or equivalent records, especially:

- new asset family semantics;
- new policy operator;
- new user-inferred signal;
- new cross-tenant aggregate use;
- new provider-write capability;
- changes to mandatory floors;
- cutover of a runtime authority family;
- retirement of a legacy authority;
- change to tenant isolation or credential materialization boundaries.
