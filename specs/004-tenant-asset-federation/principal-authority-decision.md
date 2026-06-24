# Approved Decision: Configurable Federated Principal Authority

## Decision status

**Approved by product owner.**

The platform adopts a federated principal authority that preserves current canonical user and agent sources, places Departments under Brands and above Groups, and supports generic Business-Type Blueprint inheritance with bounded configuration through governed settings.

## 1. Organizational hierarchy

The canonical organizational hierarchy is:

```text
Tenant
└─ Brand
   └─ Department
      └─ Group
         └─ Principal
            ├─ User
            ├─ Agent
            └─ Service
```

Optional sub-departments are supported:

```text
Tenant
└─ Brand
   └─ Department
      └─ Sub-department
         └─ Group
            └─ Principal
```

A Department models a durable organizational unit inside one Brand, such as Marketing, Sales, Finance, Operations, Engineering, or a regional/business division. A Group models a working, permission, or collaboration cohort inside a Department, such as SEO Team, Publishers, Approvers, Analysts, or Campaign Operators.

The Tenant remains the isolation, ownership, billing, and top-level governance boundary. The Brand is the organizational operating boundary for Departments. Departments are not created directly under the Tenant in the normal case.

Departments and Groups are not interchangeable:

- Department owns organizational scope, leadership, cost center, default policies, and reporting boundaries.
- Group owns membership-based roles, scoped grants, collaboration, and operational assignment.
- Principal is the acting identity.

## 2. Federated sources of truth

Existing sources remain authoritative:

```text
User identity        → users
Tenant membership    → memberships
Agent identity       → agents
```

New authorities provide missing organizational identities:

```text
Business-Type Blueprints → platform_layer_blueprints
Brand inheritance        → layer_inheritance_profiles
Brand Departments        → brand_departments
Department hierarchy     → brand_department_relationships
Department membership    → brand_department_memberships
Brand Groups             → brand_groups
Group membership         → brand_group_memberships
Services                 → service_principals
Delegations              → principal_delegations
Safety conflicts         → separation_of_duties_rules
Settings                 → principal_authority_settings
Layer provenance         → brand_layer_instances
```

A unified Principal Resolver returns a `ResolvedPrincipal` without moving users or agents into a duplicate identity store.

## 3. Department semantics

A Department may own:

- display name and stable key;
- parent department;
- department head and backup head;
- cost center and commercial attribution key;
- default workspace, brand, business-activity, and region bindings;
- default composition profiles;
- role and group publication authority;
- approval routing and human-work queue;
- data classification, residency, and retention defaults within tenant/platform bounds;
- budget and quota envelope;
- managed connections allowed for the Department;
- lifecycle, effective dates, and status.

A Department does not own raw credentials or platform shared asset definitions.

## 4. Group semantics

Each normal Group belongs to exactly one Brand Department. Brand-wide Groups may be explicitly marked `brand_global` and require stronger Brand/Tenant administration. Tenant-wide operational Groups are not part of the default hierarchy; cross-Brand participation requires a separate explicit Tenant-governed construct and never merges Brand authority implicitly.

A Group may own:

- group members;
- role assignments;
- exact scoped grants;
- workflow/task assignments;
- approver or operator responsibilities;
- validity and recertification;
- optional child groups when enabled.

Groups cannot cross tenant boundaries.

Cross-Department Groups are disabled by default. When enabled by the Brand profile within Tenant and Platform bounds, they are represented as a Brand-global Group with explicit Department participation bindings rather than a Group silently belonging to multiple Departments. Cross-Brand Groups remain forbidden in the normal hierarchy.

## 5. Principal resolution

The resolver calculates:

```text
Direct principal identity
+ Tenant membership
+ Brand membership and authority
+ Active Brand-to-Business-Type bindings
+ Inheritance profile and Blueprint provenance
+ Direct Brand Department membership
+ Department ancestry inside the Brand
+ Group membership paths inside the Brand
+ Inherited/local Role and member/Agent profile assignments
+ Direct scoped grants
+ Delegation paths
− Revoked, expired, suspended, conflicting, stale, or forbidden paths
= Resolved Principal Authority
```

The Effective Runtime Manifest records:

- initiating and acting Principals;
- Tenant and Brand;
- primary/secondary Business-Type bindings;
- inheritance profile, contributing Blueprints, and Brand layer-instance versions;
- primary and participating Brand Departments;
- resolved Brand Group paths;
- direct, Blueprint-inherited, local, and delegated authority;
- canonical shared-asset references and Brand-local profile/binding IDs;
- ignored, excluded, replaced, expired, conflicting, and blocked paths;
- principal-authority and inheritance-settings versions;
- authority/inheritance epoch vector and checksum.

## 6. Configurable settings hierarchy

Settings resolve in this order:

```text
Platform hard bounds
→ Platform defaults
→ Business Type Blueprint defaults
→ Tenant inheritance policy
→ Brand settings and inheritance profile
→ Department settings where allowed
→ Group settings where allowed
→ Workspace selection/binding where allowed
→ Principal preference for non-authority fields only
```

Departments are normally Brand-scoped. A Brand may acquire Department, Group, Role, member-profile, AI-Agent-profile, knowledge, and asset structures by inheriting registered Business Type Blueprints. Shared assets remain referenced; only Brand-scoped organizational instances, bindings, settings, memberships, and bounded variants are created.

A lower scope may choose only values within the parent scope's allowed range. Settings cannot weaken hard platform safety invariants.

### Proposed settings resource

```yaml
profile_key: dream_desert_principal_authority
scope_type: brand
scope_ref: dream_desert
inherits_from:
  business_types:
    - key: travel_agency
      role: primary
      priority: 100
settings:
  department_blueprint_inheritance_enabled: true
  inherit_required_department_blueprints: true
  inherit_recommended_department_blueprints: selected
  auto_adopt_new_optional_blueprints: false
  auto_adopt_security_revocations: true
  department_hierarchy_enabled: true
  max_department_depth: 3
  group_hierarchy_enabled: true
  max_group_depth: 5
  allow_cross_brand_groups: false
  allow_cross_department_groups: false
  allow_brand_global_groups: true
  require_primary_department_for_users: true
  allow_multi_department_membership: true
  direct_department_roles_enabled: true
  direct_group_grants_enabled: true
  direct_group_grants_require_expiry: true
  redelegation_enabled: false
  max_redelegation_depth: 0
  service_owner_required: true
  service_recertification_days: 90
  membership_recertification_days: 180
  break_glass_enabled: true
  break_glass_max_ttl_minutes: 60
  high_risk_separation_of_duties_required: true
  authority_cache_ttl_seconds: 60
```

## 7. Recommended defaults

```text
Business-Type Blueprint inheritance: enabled
Required Blueprint inheritance: enabled
Recommended Blueprint inheritance: selected by Brand profile
Automatic optional Blueprint adoption: disabled
Automatic security revocation adoption: enabled
Department hierarchy: enabled under Brand
Maximum Department depth: 3
Platform maximum Department depth: 8
Group hierarchy: enabled under Department
Maximum Group depth: 5
Platform maximum Group depth: 10
Cross-Brand Groups: disabled
Cross-Department Groups: disabled
Brand-global Groups: enabled with elevated Brand/Tenant administration
Primary Department required for human users per Brand: enabled
Multiple Department membership inside a Brand: enabled
Direct Department roles: enabled
Direct Group grants: enabled only for exact scoped exceptions
Direct Group grant expiry: required by default
Redelegation: disabled by default
Maximum redelegation depth when enabled: 1
Service owner: mandatory
Service recertification: 90 days
Membership recertification: 180 days
Break-glass maximum TTL: 60 minutes
High-risk separation of duties: mandatory
Missing identity or inheritance evidence: fail closed
```

## 8. Hard safety invariants

The following are not tenant-configurable:

- cross-tenant Department, Group, or membership links are forbidden;
- cycle detection is mandatory;
- Department and Group traversal limits cannot exceed platform maxima;
- a Service Principal must have an accountable active owner;
- a Principal cannot grant or delegate more authority than it currently holds;
- revoked or expired membership cannot be restored by cache or preference;
- high-risk operations cannot disable platform-mandated separation of duties;
- break-glass is exact-scope, expiring, audited, and post-reviewed;
- credentials are referenced, never stored in Department, Group, or Principal settings;
- unknown, ambiguous, or stale identity evidence fails closed for consequential execution.

## 9. Settings mutability and governance

### Platform governance may configure

- hard maxima;
- allowed setting keys and value ranges;
- mandatory separation-of-duties classes;
- allowed principal types;
- default recertification and break-glass bounds;
- settings schema/version and deprecation.

### Tenant owner may configure

- which Business Types and Blueprint families may be inherited by Brands;
- tenant-wide hard bounds below Platform maxima;
- cross-Brand participation policy;
- delegation and redelegation policy within Platform bounds;
- tenant-wide recertification, break-glass, approval, and separation-of-duties defaults;
- who may publish Brand inheritance profiles.

### Brand administrator may configure

Within Platform and Tenant bounds:

- active primary and secondary Business-Type bindings;
- selected required/recommended/optional Blueprints;
- Brand Department and Group hierarchy;
- required primary Department for Brand members;
- multi-Department membership within the Brand;
- Brand-global and cross-Department group policy;
- direct grant and role-publication policy;
- Brand-local recertification, approver, queue, cost-center, and reporting defaults;
- Blueprint pin, upgrade, replacement, and bounded override behavior.

### Department administrator may configure

Only keys explicitly delegated by the Brand profile, such as:

- child Department usage within remaining depth;
- Group hierarchy within remaining depth;
- Department-local membership/role publication workflow;
- local recertification cadence stricter than Brand defaults;
- local approver and queue defaults;
- local cost center and reporting metadata;
- selection among Brand-approved inherited Agent, Role, Knowledge, Workflow, and Tool profiles.

A Department administrator cannot enable a capability disabled by Brand, Tenant, or Platform settings.

### Workspace administrator

May select or bind eligible Departments and Groups to a Workspace when delegated. A Workspace does not redefine organizational identity or bypass Department/Tenant policy.

## 10. Settings lifecycle

Settings use immutable versions:

```text
draft → active → superseded → archived
```

Publication requires:

1. schema validation;
2. parent-bound validation;
3. cycle/depth impact simulation;
4. affected membership, role, grant, and approval preview;
5. exact publisher authority;
6. optimistic version precondition;
7. authority epoch increment;
8. cache/manifest invalidation;
9. audit and same-cycle readback.

High-impact changes may require approval, including:

- enabling cross-Department Groups;
- increasing hierarchy depth;
- enabling redelegation;
- changing break-glass bounds;
- reducing recertification controls;
- changing high-risk separation-of-duties behavior within allowed bounds.

## 11. Proposed data model

### `brand_departments`

- `department_id`;
- `tenant_id` and `brand_key`;
- `department_key`;
- `display_name`;
- `department_type`;
- `status`;
- source mode: `inherited | local | imported | promoted`;
- source Blueprint ID/version and inheritance profile version;
- `primary_head_principal_id`;
- `backup_head_principal_id`;
- `cost_center_key`;
- `region_key`;
- `effective_from`, `effective_until`;
- `version`, checksum, timestamps.

### `brand_department_relationships`

- tenant, Brand, parent and child Department IDs;
- relationship type, initially `contains`;
- source Blueprint relationship reference where inherited;
- depth/closure evidence;
- validity, status, version;
- unique active parent policy as configured.

### `brand_department_closure`

- tenant and Brand;
- ancestor and descendant Department IDs;
- depth and path checksum;
- source relationship versions;
- rebuild/validation evidence.

### `brand_department_memberships`

- tenant, Brand, Department, and Principal;
- membership type: `primary | secondary | leader | administrator | observer`;
- role/profile references where appropriate;
- validity, status, source, recertification.

### `brand_groups`

- `group_id`, tenant, Brand, and Department;
- `group_scope_type`: `department | brand_global`;
- key, name, purpose, status;
- source Blueprint ID/version when inherited;
- optional parent Group;
- validity, version, checksum.

### `brand_group_relationships` and `brand_group_closure`

- tenant, Brand, parent/child or ancestor/descendant Group IDs;
- typed relationship, depth, source, validity, version, and checksum;
- cycle and path-limit evidence.

### `brand_group_memberships`

- tenant, Brand, Group, and Principal or child Group;
- membership type;
- validity, source, status, recertification.

### `principal_authority_settings`

- scope type/reference;
- profile key and immutable version;
- settings JSON validated by registered schema;
- parent profile/version;
- status, publisher, approval, timestamps, checksum.

### `principal_authority_epochs`

- tenant and Brand, with optional Department or Group scope;
- current epoch and parent epoch vector;
- affected layer types and instance IDs;
- reason, source event, changed-at;
- Blueprint/inheritance/profile versions that triggered invalidation.

## 12. API and settings surfaces

```text
GET    /tenant/brands/{brandKey}/departments
POST   /tenant/brands/{brandKey}/departments
GET    /tenant/brands/{brandKey}/departments/{departmentId}
PATCH  /tenant/brands/{brandKey}/departments/{departmentId}
POST   /tenant/brands/{brandKey}/departments/{departmentId}/memberships
DELETE /tenant/brands/{brandKey}/departments/{departmentId}/memberships/{membershipId}

GET    /tenant/brands/{brandKey}/departments/{departmentId}/groups
POST   /tenant/brands/{brandKey}/departments/{departmentId}/groups
POST   /tenant/brands/{brandKey}/groups/{groupId}/memberships
DELETE /tenant/brands/{brandKey}/groups/{groupId}/memberships/{membershipId}

GET    /tenant/brands/{brandKey}/business-type-bindings
POST   /tenant/brands/{brandKey}/business-type-bindings
GET    /tenant/brands/{brandKey}/inheritance-profiles
POST   /tenant/brands/{brandKey}/inheritance-profiles
POST   /tenant/brands/{brandKey}/inheritance-profiles/{profileId}/preview-impact
POST   /tenant/brands/{brandKey}/inheritance-profiles/{profileId}/apply
POST   /tenant/brands/{brandKey}/inheritance-profiles/{profileId}/disable
GET    /tenant/brands/{brandKey}/inheritance-runs/{runId}
GET    /tenant/brands/{brandKey}/layer-instances
GET    /tenant/brands/{brandKey}/layer-instances/{layerInstanceId}/provenance

GET    /tenant/brands/{brandKey}/principal-authority-settings
POST   /tenant/brands/{brandKey}/principal-authority-settings
POST   /tenant/brands/{brandKey}/principal-authority-settings/{profileId}/preview-impact
POST   /tenant/brands/{brandKey}/principal-authority-settings/{profileId}/publish
POST   /tenant/brands/{brandKey}/principal-authority-settings/{profileId}/disable
GET    /tenant/brands/{brandKey}/principal-authority-settings/{profileId}/changes
GET    /tenant/brands/{brandKey}/principal-authority-settings/{profileId}/revisions
```

All mutations require object-level authorization, idempotency where retryable, optimistic version checks, stable errors, audit, and same-cycle readback.

## 13. Acceptance rules

- a Brand contains Departments; a Department contains Groups, not the reverse;
- a Business Type contributes Blueprints, not live Brand memberships, credentials, or execution grants;
- required, recommended, and optional Blueprints are resolved by a versioned Brand inheritance profile;
- applying inheritance creates Brand-scoped organizational/profile/binding records only and references shared assets without copying them;
- optional sub-Departments respect configured Brand/Tenant/Platform maximum depth;
- a normal Group belongs to one Brand Department;
- Brand-global Groups require explicit policy and elevated Brand/Tenant authority;
- cross-Brand and cross-Department participation is explicit and off by default;
- multi-Department users resolve all valid paths inside the Brand while retaining one primary Department when required;
- inherited Agent and Role profiles never grant more authority than current Brand/Tenant policy allows;
- conflicts between equal-ranked Blueprints or organizational paths block or require a registered resolution strategy;
- Department and Group settings cannot exceed Brand, Tenant, or Platform bounds;
- changing a Business-Type binding, inheritance profile, hierarchy, membership, role, or delegation advances the affected authority epoch and invalidates stale manifests;
- disabling hierarchy or removing a Blueprint requires an impact/disposition plan for members, agents, grants, approvals, schedules, variants, artifacts, and dependent layers;
- high-risk operations retain mandatory separation of duties regardless of local or inherited settings.

## 14. Final approved decision

The platform adopts:

> **Configurable Federated Principal Authority with Business-Type Blueprint inheritance and Brand-scoped Departments above Groups.** Existing users, agents, and shared assets remain in their canonical sources. Business Types define reusable Department, Group, Role, member-profile, AI-Agent-profile, knowledge, and asset Blueprints. Brands selectively inherit them into Brand-scoped operational instances and bindings. Departments, Groups, Services, Delegations, Separation of Duties, layer provenance, and authority epochs receive additive authorities. Behavior is configurable through versioned Platform, Business-Type, Tenant, Brand, Department, Group, Workspace, and non-authority Principal settings, while immutable safety and tenant-isolation bounds remain non-configurable.
