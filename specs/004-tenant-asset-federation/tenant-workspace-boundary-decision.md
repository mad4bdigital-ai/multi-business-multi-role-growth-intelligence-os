# Approved Decision: Tenant-Owned Operational Workspace Model

## Status

**Approved by product owner.**

This decision distinguishes the Tenant ownership/governance boundary from the Workspace operational/collaboration boundary and grants every verified global user the explicit right to create and own a Tenant, subject to configurable plan and policy limits.

Implementation remains unauthorized until the linked schemas, migrations, APIs, tests, entitlements, and rollout gates are separately approved.

## 1. Canonical distinction

### Tenant

A Tenant is the top-level boundary for:

- data isolation and ownership;
- memberships and ownership assignments;
- billing, plan, credits, quotas, and commercial accountability;
- Brands and Business-Type bindings;
- Tenant federation relationships;
- data-governance and residency policy;
- connection and credential-reference ownership;
- security floors and audit boundary;
- export, ownership transfer, offboarding, archive, and erasure;
- all Workspaces owned by that Tenant.

### Workspace

A Workspace is a Tenant-owned operational context for:

- projects, campaigns, operations, and collaboration;
- workflow and Agent execution context;
- tasks, artifacts, dashboards, metrics, and operational resources;
- scoped Brand, Department, Group, Business-Activity, Role, and resource bindings;
- exact user/Agent/service grants within the owning Tenant.

A Workspace is not a mini-Tenant. It does not independently own legal identity, billing, Brands, Tenant memberships, federation relationships, or credential values.

## 2. Approved structural model

```text
Global User Identity
├─ owns zero or more Tenants within plan/policy limits
│  └─ Tenant
│     ├─ Brands
│     │  └─ Departments
│     │     └─ Groups
│     └─ Workspaces
│        └─ explicit Brand / Department / Group / Activity / Resource bindings
└─ participates in other Tenants through memberships and scoped grants
```

Two axes coexist inside a Tenant:

```text
Organizational axis:
Brand → Department → Group → Principal

Operational axis:
Workspace → Projects / Campaigns / Tasks / Workflows / Agents / Artifacts
```

The axes are connected by typed bindings and grants rather than by forcing every Workspace to be a child of one Brand.

## 3. User right to create a Tenant

Every verified global user may explicitly initiate Tenant creation.

This right is distinct from automatic creation:

```text
Right to create: yes
Automatic creation on Google sign-in: no
Automatic creation on invitation acceptance: no
Automatic creation on first membership: no
```

A user who creates a Tenant becomes its initial owner after successful provisioning and ownership validation. Existing memberships in other Tenants remain unchanged.

A user may therefore simultaneously:

- own a personal-account Tenant;
- own one or more organization Tenants, subject to plan/verification;
- be a member or operator in other Tenants;
- switch among authorized contexts without data mixing.

## 4. Tenant types

Initial target types:

```text
personal_account
company
agency
partner_organization
managed_client_account
platform_owner
```

Tenant type affects templates, plans, verification, federation eligibility, and default setup. It does not weaken Tenant isolation.

## 5. Workspace types

Initial target types:

```text
personal
brand
project
campaign
operations
sandbox
```

### Personal Workspace

- exists only inside a `personal_account` Tenant;
- is optional and created explicitly or lazily;
- is private from company Tenant administrators;
- cannot receive company resources implicitly.

### Brand Workspace

- normally binds to one primary Brand;
- may bind to Departments, Groups, Activities, and resources within that Brand;
- does not own the Brand.

### Project Workspace

- organizes a project and may bind to one or multiple Brands when Tenant policy permits;
- remains inside one Tenant.

### Campaign Workspace

- normally binds to one Brand and one campaign/program context;
- can have time-bounded members, Agents, resources, and budgets.

### Operations Workspace

- supports Tenant-level operations such as finance, legal, onboarding, shared services, or managed operations;
- does not automatically grant access to every Brand.

### Sandbox Workspace

- provides preview, simulation, and non-production testing;
- cannot authorize production execution or materialize production credentials by default.

## 6. Workspace ownership and bindings

Every Workspace:

- belongs to exactly one Tenant;
- has one immutable `tenant_id` ownership boundary;
- may have zero or one primary Brand binding;
- may have additional Brand bindings only when `allow_multi_brand_workspaces=true`;
- may bind to Departments, Groups, Business Activities, Roles/profiles, Workflows, Agents, Assets, Apps, Sites, and future registered resource types;
- requires exact resource grants for access;
- never creates cross-Tenant access.

Recommended authorities:

```text
workspace_registry
workspace_brand_bindings
workspace_department_bindings
workspace_group_bindings
workspace_activity_bindings
workspace_resource_grants
workspace_context_policies
workspace_authority_epochs
```

## 7. Access model

Workspace access requires all applicable checks:

```text
valid global identity
+ active Tenant membership
+ active Brand/Department/Group/Role authority where required
+ exact Workspace grant
+ resource-specific grant or policy
+ current environment/readiness/commercial/approval evidence
= allowed
```

Owning another Tenant does not grant access.

Workspace grants cannot exceed:

- Tenant membership and policy;
- Brand and organizational authority;
- Role/delegation ceiling;
- data-governance and environment restrictions;
- plan, entitlement, quota, and cost policy;
- mandatory approvals and safety controls.

## 8. Tenant creation policy

Proposed configurable policy:

```yaml
tenant_creation:
  enabled_for_verified_users: true
  automatic_on_signup: false
  automatic_on_invitation_accept: false
  require_verified_email: true
  require_display_name: true
  require_tenant_type: true
  require_region_selection: true

  personal_tenant:
    enabled: true
    maximum_per_user: 1
    creation_mode: explicit_or_lazy

  organization_tenant:
    enabled: true
    maximum_by_plan:
      free: 1
      starter: 2
      business: 10
      enterprise: configurable
```

The exact numeric limits remain commercial configuration. The architectural right to request creation remains available to verified users unless Platform safety, legal, fraud, or entitlement policy blocks it.

## 9. Tenant provisioning flow

```text
verified global user
→ request Tenant creation
→ select Tenant type, name, region, and plan
→ accept owner responsibilities
→ validate entitlement, fraud/risk, and policy
→ provision Tenant
→ create owner assignment and initial membership
→ optional personal or organization Workspace
→ optional first Brand
→ optional Business-Type Blueprint preview
→ same-cycle readback and active-context option
```

Brand, Workspace, Department, Group, connection, or Blueprint creation is not silently forced. Setup templates may recommend them.

## 10. Initial ownership

Tenant ownership is represented explicitly rather than inferred from first membership order.

Recommended authority:

```text
tenant_owner_assignments
```

It records:

- Tenant and owner Principal;
- ownership type and status;
- effective dates;
- transfer source;
- verification/approval evidence;
- version and checksum.

The user also receives an active owner/admin membership, but the ownership assignment remains the canonical ownership record.

## 11. Personal account and company membership coexistence

A user may have:

```text
Personal Account Tenant
└─ Personal Workspace

Company Tenant A
└─ scoped member access

Agency Tenant B
└─ operator access

Owned Company Tenant C
└─ owner/admin access
```

Personal resources, connections, artifacts, and preferences are isolated. Company administrators have no authority over the personal Tenant.

Company resources cannot be copied to the personal Tenant unless an explicit export/copy policy, authorization, data-governance decision, and provenance record allow it.

## 12. Active context

The user authenticates once, then selects a current operational context.

A context may contain:

```text
tenant_id
brand_key
workspace_id
department_id
group_id
active_role_or_profile
environment
authority_epoch
```

The platform must not select the first membership as permanent authority.

Context switching:

- revalidates current membership and grants;
- creates a short-lived context/session version;
- keeps one Tenant boundary per context;
- invalidates stale contexts after membership, grant, Workspace, or authority-epoch change;
- never aggregates cross-Tenant data unless a separate governed aggregate view exists.

## 13. Multi-Brand Workspace

Multi-Brand Workspace is disabled by default.

When enabled, it requires:

- one owning Tenant;
- explicit Brand bindings;
- Brand-specific data/resource policies;
- exact per-Brand grants;
- conflict handling for policy, role, data, environment, and connection scopes;
- no credential sharing by implication;
- provenance and explainability in the Effective Runtime Manifest.

It does not permit cross-Tenant Brands.

## 14. Lifecycle rules

### Workspace lifecycle

```text
draft → active → restricted → archived → deleted
```

Workspace deletion:

- does not delete the Tenant or Brand;
- requires disposition of tasks, schedules, Agents, grants, artifacts, resource bindings, and active operations;
- preserves required audit evidence.

### Tenant lifecycle

Tenant lifecycle remains the broader staged process defined by DFR-002. Tenant offboarding includes all owned Workspaces.

## 15. Commercial and entitlement dependencies

Tenant creation and Workspace capabilities depend on:

- plan and subscription;
- Tenant creation entitlement;
- maximum owned Tenants;
- maximum active Workspaces;
- allowed Workspace types;
- allowed Brands, members, Agents, storage, and execution volume;
- regional availability and compliance;
- fraud/risk and verification status.

Commercial restriction must be explained as commercial, not disguised as security or authorization.

## 16. API direction

Planned Tenant creation surfaces:

```text
GET  /me/tenant-creation-capability
POST /me/tenant-provisioning-runs
GET  /me/tenant-provisioning-runs/{runId}
POST /me/tenant-provisioning-runs/{runId}/cancel
GET  /me/owned-tenants
```

Planned Workspace surfaces:

```text
GET    /tenant/workspaces
POST   /tenant/workspaces
GET    /tenant/workspaces/{workspaceId}
PATCH  /tenant/workspaces/{workspaceId}
POST   /tenant/workspaces/{workspaceId}/brand-bindings
POST   /tenant/workspaces/{workspaceId}/department-bindings
POST   /tenant/workspaces/{workspaceId}/group-bindings
POST   /tenant/workspaces/{workspaceId}/activity-bindings
POST   /tenant/workspaces/{workspaceId}/resource-grants
POST   /tenant/workspaces/{workspaceId}/archive
POST   /tenant/workspaces/{workspaceId}/deletion-runs
```

Provisioning is asynchronous and uses `202 Accepted`, idempotency, status resources, audit, and readback.

## 17. Dependencies

### Data-model dependencies

- explicit Tenant type registry/enum;
- explicit Workspace type registry/enum;
- Tenant owner assignments;
- Tenant creation policies and entitlements;
- Tenant provisioning runs;
- Workspace bindings and context policies;
- personal-account profiles;
- active user contexts and authority epochs.

### Identity dependencies

- global user identity;
- verified email/provider identity;
- multi-Tenant memberships;
- explicit active-context selection;
- invitation onboarding decision DFR-002A.

### Organizational dependencies

- Brand-scoped Departments and Groups;
- Role/member/Agent profiles;
- Business-Type Blueprint inheritance;
- exact grants and delegation ceilings.

### Commercial dependencies

- plan/entitlement checks;
- Tenant/Workspace quotas;
- cost attribution and billing ownership;
- trial, grace, past-due, and suspension behavior.

### Runtime dependencies

- context compiler support for Tenant and Workspace bindings;
- authority/cache invalidation;
- environment separation;
- Workspace-scoped execution, artifacts, schedules, Agents, and operations;
- exact provider/connection readiness.

### Data-governance dependencies

- Tenant ownership and processing purpose;
- personal/company data separation;
- region/residency selection;
- export, retention, legal hold, and deletion disposition.

### UX dependencies

- Create Tenant entry point;
- plan/limit explanation;
- provisioning progress;
- context switcher;
- Tenant/Workspace/Brand hierarchy navigation;
- clear indication of ownership versus membership versus Workspace access.

### Migration dependencies

- preserve existing Tenants and Workspaces;
- classify current Workspace rows into target types;
- stop treating first membership as canonical active context;
- preserve existing workspace grants during compatibility period;
- add personal-account and owner-assignment projections without duplicate Tenants.

## 18. Hard invariants

- every Workspace belongs to exactly one Tenant;
- no cross-Tenant Workspace exists;
- Tenant ownership grants no authority in another Tenant;
- invitation acceptance never creates a Tenant automatically;
- Google sign-in never creates a Tenant automatically;
- creating a Tenant never changes other memberships;
- personal resources remain isolated from company Tenants;
- Workspace binding is not an authority grant;
- Workspace grants cannot exceed Tenant/Brand/Role policy;
- Workspace does not own credential values;
- multi-Brand Workspaces remain within one Tenant;
- sandbox context cannot authorize production execution;
- deleting a Workspace does not delete its Tenant or Brands;
- deleting/offboarding a Tenant processes all Workspaces through staged disposition;
- unknown or stale Tenant/Workspace authority fails closed.

## 19. Acceptance examples

- verified user creates a company Tenant and becomes owner without losing membership in another Tenant;
- invited user joins a company Tenant without creating any new Tenant;
- personal Tenant is created only after explicit user action;
- company administrator cannot view the user's personal Workspace;
- Workspace is bound to a Brand but Brand ownership remains at Tenant/Brand authority;
- multi-Brand Workspace remains disabled until Tenant policy enables it;
- user with Tenant membership but no Workspace grant cannot access Workspace resources;
- user with Workspace grant but revoked Tenant membership cannot access the Workspace;
- deleting a Project Workspace preserves its Brand and Tenant;
- Tenant offboarding includes all Workspaces, bindings, grants, schedules, Agents, and artifacts;
- plan limit blocks additional Tenant creation with a commercial explanation and upgrade/request path;
- switching Tenant/Workspace context revalidates authority and prevents mixed data.

## 20. Final approved decision

The platform adopts:

> **Tenant-Owned Operational Workspace Model.** Every verified global user may explicitly create and own a Tenant within configurable plan, policy, verification, and risk limits while retaining memberships in other Tenants. A Tenant is the ownership, isolation, billing, governance, and lifecycle boundary. A Workspace is an operational context owned by exactly one Tenant and connected to Brands, Departments, Groups, Activities, Roles, Agents, and resources through explicit bindings and grants. It is never a mini-Tenant and never creates cross-Tenant authority.