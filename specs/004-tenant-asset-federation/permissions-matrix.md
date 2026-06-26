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
| Data governance | May this authorized data be processed for this exact purpose, audience, destination, provider/model, region, and retention context? | classification, purpose, lawful-basis/consent, residency/transfer, retention/legal-hold, lineage/disposition, provider/model, and data-use decision authorities |
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

## 4. Blueprint and inheritance permissions

### Platform governance

May:

- register layer and relationship types;
- publish Platform and Business-Type Blueprint versions;
- define required/recommended/optional adoption classes;
- define allowed merge, replacement, supersession, upgrade, and security-revocation behavior;
- certify Blueprint packages and shared-resource bindings;
- revoke unsafe Blueprint/resource versions;
- define Platform hard bounds and settings schemas.

May not silently create Brand memberships, credentials, or execution grants through Blueprint publication.

### Tenant owner

May:

- allow or deny Business Types and Blueprint families for Tenant Brands;
- set Tenant inheritance bounds below Platform maxima;
- delegate Brand inheritance publication authority;
- approve cross-Brand participation exceptions where Platform policy allows;
- review destructive removal/disposition and high-risk upgrade decisions.

### Brand administrator

May, within Tenant/Platform bounds:

- create and manage primary/secondary Business-Type bindings;
- select required/recommended/optional Blueprints;
- publish Brand inheritance profiles;
- preview/apply Brand-scoped Department, Group, Role, member-profile, Agent-profile, knowledge, and resource-binding instances;
- pin, replace, upgrade, disable, or locally patch eligible inherited layers;
- resolve non-safety inheritance conflicts;
- manage Brand Departments and Groups.

May not:

- modify another Brand;
- exclude mandatory Platform/Tenant controls;
- auto-create human users;
- duplicate or mutate canonical shared assets;
- inherit credential values;
- grant an Agent/Role more authority than current Brand/Tenant policy;
- remove active inherited layers without an approved disposition plan.

### Department administrator

May select and administer only Brand-approved inherited layers delegated to the Department, including local Groups, Role/member/Agent profile assignments, knowledge/workflow/tool selection, stricter settings, and local queues. It cannot publish a new Business-Type binding or exceed Brand bounds.

### User

May view inherited provenance and select eligible non-authority preferences. It cannot change Business-Type bindings, inheritance profiles, Department/Group structure, or inherited authority unless separately delegated.

## 5. Invitation, identity-link, and personal-context permissions

### Tenant/Brand inviter

May invite only when holding explicit invitation authority for the target Tenant and every included Brand, Workspace, Department, Group, Role/profile, and resource scope. The inviter cannot delegate a permission, environment, expiry, approval bypass, or redelegation capability beyond its current authority ceiling.

### Invitee

May:

- view a safe invitation preview;
- authenticate with the exact verified invited identity;
- accept or decline;
- review the exact resulting membership and scopes;
- create a separate personal account/workspace only through an explicit operation;
- switch among currently authorized contexts.

May not edit invitation scope, select another invitee identity without revalidation, access target resources before acceptance, or infer private Tenant contents from preview.

### Tenant owner/admin

May create, list, resend through approved delivery, revise with renewed disclosure, revoke, and audit invitations within delegated scope. It cannot read raw invitation tokens after delivery or access the invitee's personal workspace.

### Platform identity governance

May define identity-provider validation, link/recovery policy, token/session bounds, invitation security floors, personal-account limits, and context schema. It cannot grant Tenant access solely because an external identity or domain exists.

### Personal account owner

Owns the personal-account Tenant and personal Workspace within plan and Platform bounds. Company Tenant administrators have no authority over personal resources, and personal ownership grants no authority in company Tenants.

## 6. Tenant creation and Workspace permissions

### Verified global user

May:

- inspect Tenant-creation capability and limits;
- request creation of an allowed Tenant type;
- cancel a pending provisioning run where safe;
- create an optional personal account/workspace;
- retain memberships in other Tenants;
- switch among authorized contexts.

May not bypass plan, verification, region, risk, fraud, or legal policy; create a Tenant implicitly through sign-in/invitation; or gain authority in another Tenant because it owns one Tenant.

### Tenant owner

May, within Platform and plan bounds:

- create and administer Workspaces;
- publish Workspace context policies;
- bind same-Tenant Brands, Departments, Groups, Activities, Agents, and resources;
- grant Workspace access within its own authority ceiling;
- enable multi-Brand Workspaces when allowed;
- archive or request deletion with dependency disposition.

May not create cross-Tenant Workspace bindings, expose personal-account resources, store credential values in Workspace settings, or use a Workspace to bypass Tenant/Brand/Role authority.

### Workspace administrator

May manage delegated Workspace settings, members/grants, bindings, tasks, schedules, and operational resources. It cannot change Tenant ownership, billing owner, federation contracts, Brand ownership, Tenant security floors, or Workspace owning Tenant.

### Platform governance

May define Tenant/Workspace types, creation hard bounds, regional/plan availability, risk/verification, personal-account policy, multi-Brand constraints, and lifecycle schemas. It cannot silently create Tenants for users or treat commercial restrictions as security grants.

## 7. Composition profile permissions

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
