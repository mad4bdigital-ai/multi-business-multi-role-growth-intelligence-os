# Dynamic Layer Blueprint and Inheritance Model

## Decision status

**Approved product direction.**

The platform adopts a generic dynamic inheritance model that applies to organizational layers, principals, roles, AI agents, knowledge trees, and linked platform assets. Department inheritance from Business Type to Brand is the first concrete example, not a special-case implementation.

## 1. Core concept

A Business Type may define reusable blueprints:

```text
Business Type
└─ Layer Blueprints
   ├─ Department Blueprints
   │  ├─ Group Blueprints
   │  ├─ Role Blueprints
   │  ├─ Member/Principal Profiles
   │  ├─ AI Agent Profiles
   │  ├─ Knowledge Trees
   │  └─ Linked Shared Assets
   ├─ Business Activity Blueprints
   ├─ Workflow/Operating Model Blueprints
   └─ Governance/Policy Blueprints
```

When a Brand is linked to a compatible Business Type, it may inherit selected blueprints according to its inheritance settings:

```text
Business Type Blueprint
        ↓ select and resolve
Brand Inheritance Profile
        ↓ instantiate organizational nodes
Brand-scoped Layer Instances
        ↓ reference inherited assets
Effective Brand Operating Model
```

The model applies generically to:

- Departments and sub-departments;
- Groups and teams;
- Member/principal profiles;
- Roles and permission templates;
- AI agent profiles and agent-team assignments;
- Business activities;
- Knowledge trees and memory scopes;
- Skills;
- Workflows;
- Policies and rules;
- Apps, plugins, actions, and tools;
- Engines and logic;
- Graph nodes/edges and capability relationships;
- Dashboards, metrics, validators, prompts, and output templates;
- future registered layer/resource families.

## 2. Blueprint versus runtime instance

The architecture distinguishes two concepts.

### Blueprint

A reusable, versioned template owned by the Platform or a governed Business Type.

Examples:

- `travel_agency.marketing_department`;
- `ecommerce.customer_support_group`;
- `hospitality.revenue_manager_role`;
- `professional_services.lead_generation_agent_profile`.

A blueprint contains structure, defaults, bindings, compatibility, and inheritance metadata. It is not a live Brand Department, user membership, credential, or execution grant.

### Runtime instance

A Brand-scoped operational entity created or projected from a blueprint.

Examples:

- Dream Desert Marketing Department;
- Brand X SEO Group;
- Brand Y Revenue Manager Role;
- Brand Z AI Growth Analyst Agent assignment.

An instance has its own lifecycle, memberships, local settings, optional overrides, and effective authority while preserving provenance back to the blueprint.

## 3. Canonical hierarchy

```text
Tenant
└─ Brand
   ├─ inherited and local Business Activities
   ├─ Departments
   │  ├─ Sub-departments
   │  └─ Groups
   │     ├─ Human Members
   │     ├─ AI Agents
   │     └─ Service Principals
   ├─ Roles and Delegations
   ├─ Knowledge/Memory Trees
   └─ Shared Asset Bindings
```

Business Type remains a classification/template authority, not the operational owner of Brand Departments or members.

## 4. Hybrid data-model principle

The platform must not use one unrestricted EAV/JSON table for every layer. It uses:

1. **specialized canonical tables** for each domain entity;
2. **generic layer registries and graphs** for type discovery, hierarchy, inheritance, compatibility, and provenance.

Examples of specialized tables:

```text
business_activity_types
brands
principal_departments
principal_groups
role_templates / scoped roles
users / memberships
agents
service_principals
knowledge registries
workflows
policies
apps/plugins/actions/tools
logic and engine registries
```

Generic authorities connect them without replacing them.

## 5. Generic layer registry

### `platform_layer_type_registry`

Defines which layer types exist and how they behave.

Key fields:

- `layer_type_key` — department, group, role, principal_profile, agent_profile, knowledge_tree, skill_set, workflow_set, policy_set, app_set, tool_set, graph_fragment, and future values;
- canonical source table and key fields;
- `supports_blueprints`;
- `supports_runtime_instances`;
- `supports_hierarchy`;
- `supports_multi_parent`;
- allowed parent layer types;
- allowed child layer types;
- default inheritance strategy;
- allowed merge strategies;
- modifiable-path profile;
- risk class;
- version and status.

### `platform_layer_relationship_type_registry`

Defines relationships such as:

```text
contains
inherits_from
references
requires
conflicts_with
replaces
supersedes
compatible_with
managed_by
assigned_to
```

Each relationship type declares allowed source/target types, direction, transitivity, cardinality, and conflict semantics.

## 6. Blueprint authorities

### `platform_layer_blueprints`

- `blueprint_id`;
- `layer_type_key`;
- `blueprint_key`;
- owner scope: platform or Business Type;
- owner Business Type key when applicable;
- canonical template source reference;
- version and checksum;
- lifecycle status;
- compatibility conditions;
- default settings profile;
- customization policy;
- risk/certification metadata.

### `platform_layer_blueprint_relationships`

Defines Blueprint-to-Blueprint hierarchy and dependencies.

Examples:

```text
Marketing Department contains SEO Group
SEO Group references SEO Specialist Role
SEO Specialist Role recommends SEO Agent Profile
SEO Agent Profile requires SEO Skills
SEO Skills reference SEO Audit Workflow
SEO Audit Workflow requires Search Console App
```

### `platform_layer_blueprint_closure`

Materialized transitive closure for bounded hierarchy traversal, cycle detection, impact analysis, and fast inheritance preview.

### `platform_layer_blueprint_resource_bindings`

Links a blueprint to shared resources without copying them.

Key fields:

- blueprint;
- dimension/resource type;
- shared resource reference;
- binding purpose: required, recommended, allowed, default, denied, validator, fallback;
- effect and priority;
- inheritance behavior;
- conditions;
- version, validity, and provenance.

## 7. Business Type composition

A Business Type may include multiple Blueprint packages:

```text
Travel Agency
├─ Core organization blueprint
├─ Marketing and SEO blueprint
├─ Sales and reservations blueprint
├─ Customer support blueprint
├─ Finance and reconciliation blueprint
└─ Operations and supplier blueprint
```

A Business Type does not need to mandate every blueprint. Each Blueprint declares:

- required, recommended, or optional adoption;
- compatibility conditions;
- minimum plan/capabilities;
- regional/legal constraints;
- dependency blueprints;
- conflict groups;
- default inheritance mode.

## 8. Brand-to-Business-Type binding

### `brand_business_type_bindings`

A Brand may bind to one primary and zero or more secondary Business Types.

Key fields:

- tenant and Brand;
- Business Type;
- binding role: primary, secondary, specialization, seasonal, experimental;
- confidence and classification source;
- effective dates;
- status;
- inheritance profile;
- priority;
- approval and provenance.

The binding itself grants no execution authority. It makes compatible Blueprints eligible for inheritance.

## 9. Inheritance profiles

### `layer_inheritance_profiles`

Controls how one Brand inherits from one or more Business Types.

Example:

```yaml
profile_key: dream_desert_travel_structure
scope:
  tenant_id: tenant_123
  brand_key: dream_desert
business_types:
  - key: travel_agency
    role: primary
    priority: 100
  - key: ecommerce
    role: secondary
    priority: 30
settings:
  inherit_required_blueprints: true
  inherit_recommended_blueprints: selected
  instantiate_departments: true
  instantiate_groups: true
  instantiate_roles: true
  instantiate_agent_profiles: selected
  knowledge_mode: union
  skill_mode: union
  workflow_mode: union
  action_mode: intersection
  policy_mode: deny_wins
  conflict_mode: block
  local_override_mode: bounded_patch
  auto_adopt_new_optional_blueprints: false
  auto_adopt_security_updates: true
```

Profiles are versioned, previewable, and bounded by Platform/Tenant policy.

## 10. Inheritance selection

For every eligible Blueprint, the resolver determines:

1. Is the Business Type binding active?
2. Is the Blueprint required, recommended, or optional?
3. Are compatibility, entitlement, region, plan, and dependency conditions met?
4. Has the Brand selected, excluded, or replaced it?
5. Does another Business Type contribute an equivalent or conflicting Blueprint?
6. Does a local Brand instance already exist?
7. Is the Blueprint version compatible with local patches?
8. Should the result create an instance, reference a shared asset, or remain recommendation-only?

## 11. Runtime layer instances

### `brand_layer_instances`

A generic projection identifying instantiated layers while specialized tables retain their domain fields.

Key fields:

- `layer_instance_id`;
- tenant and Brand;
- `layer_type_key`;
- canonical runtime table/key;
- source mode: inherited, local, promoted, imported;
- source blueprint and version;
- inheritance profile/version;
- lifecycle state;
- effective settings checksum;
- local override/variant reference;
- authority epoch and timestamps.

Examples:

- a Department instance points to `principal_departments`;
- a Group instance points to `principal_groups`;
- an Agent profile instance points to a scoped Agent assignment/profile authority;
- a Knowledge Tree instance points to a knowledge registry;
- an Asset Set instance may be virtual and represented through resource bindings.

### `brand_layer_instance_relationships`

Stores the operational Brand hierarchy and dependencies between instances.

### `brand_layer_instance_closure`

Stores transitive closure for deterministic and bounded traversal.

## 12. Department inheritance example

```text
Business Type: Travel Agency
└─ Blueprint: Marketing Department
   ├─ Group: SEO Team
   ├─ Group: Content Team
   ├─ Role: Marketing Manager
   ├─ Agent profile: SEO Growth Analyst
   ├─ Knowledge tree: Travel SEO
   ├─ Skills: keyword research, technical SEO, content planning
   ├─ Workflows: SEO audit, content calendar, landing-page optimization
   ├─ Policies: Brand Core required, publishing approval required
   ├─ Apps: Search Console, Analytics, WordPress
   ├─ Tools: keyword and crawling tools
   └─ Graph fragment: intent → capability → workflow → action dependencies
```

When Dream Desert inherits it:

```text
Dream Desert Brand
└─ Marketing Department instance
   ├─ SEO Team instance
   ├─ Content Team instance
   ├─ Marketing Manager role instance/profile
   ├─ SEO Growth Analyst Agent assignment/profile
   └─ references shared knowledge/assets through inherited bindings
```

Shared Skills, Workflows, Policies, Apps, Tools, and Graph definitions are referenced. They are not copied per Brand. Only Brand-specific organizational instances, selections, bindings, settings, memberships, and optional variants are created.

## 13. Generalization to members and AI agents

### Member/principal profile blueprint

May define:

- recommended role(s);
- Department/Group eligibility;
- required onboarding and recertification;
- allowed activity types;
- default composition profile;
- approval responsibilities;
- knowledge access profile;
- mandatory training/verification.

It does not create a human user. It configures a profile that an existing or invited member may be assigned to.

### AI Agent profile blueprint

May define:

- base shared Agent reference;
- Department and Group placement;
- role/delegation ceiling;
- required Skills/Workflows/Tools;
- model policy;
- memory/knowledge scope;
- autonomy and approval bounds;
- evaluation suites;
- cost/quota envelope;
- fallback and human handoff.

It does not duplicate the base Agent. It creates a Brand-scoped Agent assignment/profile referencing the shared Agent.

### Role blueprint

May define:

- permission/capability templates;
- eligible Departments/Groups;
- approval and separation-of-duties rules;
- resource scopes;
- delegation bounds;
- recertification requirements.

The Brand may instantiate, tighten, rename, or selectively publish the role within allowed paths.

## 14. Multiple Business Types

A Brand may inherit from multiple Business Types. Resolution is per layer family, not one global rule.

Recommended defaults:

```text
Departments/Groups: union with equivalence and conflict detection
Roles: union, but permission effect resolves through authority intersection/deny-wins
Knowledge/Skills/Workflows/Tools: guarded union
Actions/Endpoints/Engines: strict intersection for execution
Policies/Rules: deny-wins and typed field semantics
Apps/Connections: union for catalog; exact eligibility for runtime
Agent profiles: union with capability/equivalence de-duplication
Graph fragments: union with typed edge conflicts and cycle detection
Quotas/Budgets: minimum
Risk/Sensitivity/Approval: maximum
Scalar defaults: priority or nearest replacement
```

Conflicts between primary and secondary Business Types are resolved using:

1. mandatory Platform/Tenant safety;
2. explicit Brand exclusion or selection where allowed;
3. Business Type binding role and priority;
4. Blueprint equivalence/supersession metadata;
5. registered layer merge strategy;
6. block on equal-ranked non-mergeable conflict.

## 15. Inheritance is selective and configurable

A Brand may choose:

- inherit all required Blueprints;
- inherit selected recommended Blueprints;
- ignore optional Blueprints;
- instantiate organization but not activate runtime assets;
- reference knowledge/workflows without creating Departments;
- inherit Agent profiles in recommendation-only mode;
- tighten inherited policies;
- create bounded local patches;
- replace one Blueprint with an approved equivalent;
- pin a Blueprint version;
- preview or schedule an upgrade.

A Brand cannot exclude mandatory Platform/Tenant controls or required Business Type controls that its classification/contract declares non-optional.

## 16. Update and rebase lifecycle

When a Blueprint changes:

```text
new Blueprint version
→ impact analysis
→ compare inherited instance and local overrides
→ classify auto-safe / review / conflict / blocked
→ preview effective tree and assets
→ approve when required
→ rebase or pin
→ increment Brand authority/configuration epoch
→ invalidate affected manifests
```

Security revocation can block an old Blueprint immediately. Ordinary functional upgrades follow configured adoption policy.

## 17. Provenance and explainability

Every inherited instance or resource binding records:

- contributing Business Type;
- Blueprint and version;
- Brand inheritance profile and version;
- creation/resolution mode;
- local overrides;
- equivalent/conflicting Blueprints considered;
- final merge operator;
- source shared asset versions;
- effective authority epoch;
- upgrade/rebase status.

The platform can answer:

```text
Why does this Brand have this Department?
Why is this AI Agent assigned to it?
Which Skills and Workflows came from the Business Type?
Which Policies are mandatory or locally tightened?
Which assets are shared references versus Brand-local instances?
What changes if the Business Type Blueprint upgrades?
```

## 18. Dynamic settings

Settings resolve through:

```text
Platform hard bounds
→ Platform layer defaults
→ Business Type Blueprint defaults
→ Tenant inheritance policy
→ Brand inheritance profile
→ Department/Group/local layer settings where allowed
→ Principal preference for non-authority fields only
```

Lower layers may only operate within parent bounds. All settings are versioned, schema-validated, previewable, auditable, and read back.

## 19. Hard invariants

- Tenant isolation is never inherited away.
- A Business Type Blueprint is not a live execution grant.
- Brand instances remain Brand-scoped.
- Human users are invited/linked, never auto-created from a Blueprint.
- Base Agents and shared assets remain shared and canonical.
- Credentials are never inherited as values; only connection requirements or eligible binding profiles are inherited.
- Group/Department/Graph cycles are blocked.
- Unknown layer types or merge strategies block publication/resolution.
- Mandatory Platform/Tenant policy cannot be excluded.
- Runtime execution revalidates authority, readiness, environment, model, commercial, and approval planes.
- Local overrides are sparse, bounded, and provenance-preserving.
- Removing a Blueprint requires impact and disposition of existing memberships, grants, schedules, variants, and artifacts.

## 20. Proposed generic tables

```text
platform_layer_type_registry
platform_layer_relationship_type_registry
platform_layer_blueprints
platform_layer_blueprint_relationships
platform_layer_blueprint_closure
platform_layer_blueprint_resource_bindings
brand_business_type_bindings
layer_inheritance_profiles
layer_inheritance_profile_rules
layer_inheritance_runs
layer_inheritance_conflicts
brand_layer_instances
brand_layer_instance_relationships
brand_layer_instance_closure
brand_layer_resource_bindings
brand_layer_override_patches
layer_inheritance_upgrade_runs
```

Specialized tables remain authoritative for their domain entities.

## 21. Acceptance examples

- linking a Brand to Travel Agency makes required Department Blueprints eligible but performs no hidden provider write;
- preview shows Departments, Groups, Roles, Agents, knowledge, and assets that would be inherited;
- applying inheritance creates only Brand-scoped organization/profile/binding records, not copies of shared assets;
- a secondary Ecommerce Business Type contributes compatible ecommerce workflows without weakening Travel policies;
- duplicate equivalent Department Blueprints de-duplicate by registered equivalence or block if ambiguous;
- removing a Business Type binding cannot orphan active members, agents, approvals, schedules, or artifacts without a disposition plan;
- a Blueprint upgrade with no local conflict can be previewed and adopted;
- conflicting local patch requires review;
- user preferences may rank inherited eligible assets but cannot change inherited authority or mandatory policies;
- every inherited result is explainable and reversible.

## 22. Final design decision

The platform adopts:

> **A generic, registry-driven, versioned Blueprint and Inheritance Engine.** Business Types define reusable organizational and capability Blueprints. Brands selectively inherit them into Brand-scoped operational layer instances. Departments, Groups, member profiles, roles, AI Agent profiles, knowledge trees, and linked shared assets all use the same inheritance/provenance framework while retaining specialized canonical tables. Shared assets remain references, not duplicated copies.