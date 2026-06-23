# Permissions and Responsibility Matrix

## 1. Independent decision planes

| Plane | Question | Canonical authority |
|---|---|---|
| Authentication | Who is the principal? | signed session/JWT and membership |
| Context | Where is the principal operating? | Dynamic Container Authority |
| Authorization | What may the principal use or execute? | roles, resource bindings, specialized grants, capability envelopes |
| Composition | How do applicable layers combine? | composition profiles constrained by dimension/policy registries |
| Preference | What does the user prefer among allowed results? | user runtime preference profile |
| Variant | Has an authorized scope customized an asset? | optional variant and patches |
| Readiness | Can the operation run now? | connection, installation, credential eligibility, certification, quota, approval |
| Adaptation | Should a change be proposed? | adaptive proposal and experiment authorities |

No plane silently substitutes for another.

## 2. Permission vocabulary

- `catalog.view`
- `asset.use`
- `asset.execute`
- `variant.create`
- `variant.edit`
- `variant.publish`
- `variant.manage_versions`
- `composition_profile.view`
- `composition_profile.select`
- `composition_profile.create`
- `composition_profile.publish`
- `preference.read_own`
- `preference.edit_own`
- `connection.configure`
- `grant.manage`
- `policy.manage`
- `adaptation.review`
- `experiment.manage`
- `platform_candidate.promote`

Permissions are explicit. `edit` does not imply `grant`; `select profile` does not imply `publish profile`; `configure connection` does not reveal credentials.

## 3. Shared asset operations

| Operation | Platform asset | Tenant/user effect | Required authority |
|---|---|---|---|
| View catalog | read canonical projection | none | visibility + membership |
| Use shared read asset | reference canonical asset | execution/session evidence only | asset/grant/context readiness |
| Execute shared write action | reference canonical action | provider/runtime effect | exact action + endpoint + resource + approval readiness |
| Customize asset | platform base unchanged | creates optional scoped variant | variant.create + modifiable-path policy |
| Update base | creates new platform version | variants receive upgrade state | platform governance only |
| Archive/revoke base | base status changes | dependent variants may block | platform governance only |

## 4. Composition profile permissions

### User

May:

- select platform templates;
- create personal profiles within allowed operators;
- preview exact impact;
- bind a personal profile to their own eligible contexts;
- reset to defaults.

May not:

- select an operator forbidden by the dimension registry;
- remove required layers mandated by tenant/workspace policy;
- publish a profile for another user, role, workspace, brand, activity, or tenant without delegated authority;
- weaken mandatory platform rules.

### Tenant/workspace/brand/activity administrator

May create or publish scoped profiles only within their governed scope and delegated authority. A child scope may tighten inherited policy; loosening requires exact approved override where allowed.

## 5. Preference permissions

A user can edit only their own preference profile unless explicit administrative support authority exists. Preferences may rank and narrow but never grant.

Allowed examples:

- preferred authorized agent;
- preferred workflow among eligible workflows;
- explanation depth;
- language and tone;
- notification cadence;
- dashboard layout;
- default composition template.

Forbidden examples:

- enabling an unauthorized action;
- selecting another tenant's connection;
- raising a quota;
- lowering approval or risk;
- disabling audit or certification;
- storing secrets.

## 6. Variant ownership scopes

| Owner scope | Who may create | Who may publish/use |
|---|---|---|
| User | the user or delegated assistant | owner user in authorized contexts |
| Role | role administrator | principals receiving the role |
| Workspace | workspace administrator | authorized workspace members |
| Brand | brand administrator | authorized brand contexts |
| Business activity | activity administrator | authorized activity contexts |
| Tenant | tenant owner/admin | authorized tenant contexts |

Every variant is tenant-bound even when user-owned.

## 7. Policy customization

Tenant or user customization may:

- add restrictions;
- add validators;
- increase review requirements;
- lower limits;
- change eligible preference fields;
- customize presentation and non-mandatory prompts;
- choose a stricter composition mode.

It may not:

- remove mandatory denies;
- lower approval severity;
- lower risk or sensitivity classification;
- raise quotas beyond inherited ceilings;
- bypass Brand Core, credentials, installation, certification, or readback;
- enable provider writes without exact authority.

## 8. Adaptive change permissions

| Proposal class | Example | Decision authority |
|---|---|---|
| A | language/layout preference | user confirmation or prior opt-in |
| B | preferred authorized workflow | user confirmation |
| C | composition profile change | user plus scoped policy rules; impact simulation |
| D | optional asset variant | variant publisher and required certification |
| E | grant, credential, spend, provider write, deployment | existing governed authority and approvals only |

An adaptive system never self-approves Class E.

## 9. Delegation rules

- Delegation names exact resource, operation, scope, validity, and delegator evidence.
- A delegate cannot exceed the delegator's effective authority.
- Wildcard write delegation is forbidden.
- Revocation invalidates future manifests and stale experiments.
- Credential eligibility can be delegated; credential values cannot.

## 10. Approval-sensitive grants

The UI and awareness model must distinguish:

- `approval_sensitive_active_grant` — a grant exists but invocation still requires approval;
- `pending_approval_request` — an actual open hold awaiting decision;
- `approved_for_exact_execution` — one bounded approved invocation;
- `approval_expired_or_consumed` — no longer usable.

## 11. Administrative support

Support or platform administrators receive no implicit cross-tenant edit or execution bypass. Any assisted action requires explicit support scope, tenant-visible audit, least privilege, and the same runtime safety gates.
