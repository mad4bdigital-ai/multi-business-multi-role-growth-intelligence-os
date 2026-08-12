# Current State: Code and Database Evidence

## 1. Shared asset registries

The current database already follows a shared-base pattern for most definitions. Approximate live row counts observed during this design review:

| Surface | Rows | Tenant column on base definition |
|---|---:|---|
| `agents` | 18 | No |
| `agent_skills` | 21 | No |
| `workflows` | 230 | No |
| `actions` | 37 | No |
| `app_integrations` | 31 | No |
| `plugins` | 5 | No |
| `execution_policies` | 1,194 | No |
| `platform_engine_policy_registry` | 1,080 | Scope fields exist, but base rows are platform registry rows |
| `platform_engine_policy_rules` | 1,109 | Linked to platform policy keys |

Conclusion: automatic tenant copies would duplicate an architecture that is already shared by default.

## 2. Specialized grant and binding authorities

| Surface | Current scope | Important gap |
|---|---|---|
| `agent_skill_grants` | agent + skill + optional tenant + optional brand | no workspace/activity/role composition |
| `agent_workflow_bindings` | agent + workflow | no tenant/workspace/brand/activity/role scope |
| `app_action_grants` | connection + optional workspace + optional agent | no unified brand/activity/role composition |
| `workspace_resource_grants` | tenant + user + typed resource | access grant, not policy algebra or personalization |
| `role_assignments` | tenant + user + role | not bound to a specific container graph path |
| `connections` / `installations` | tenant/provider runtime evidence | independent from shared asset definition |

These remain runtime authority until a contextual bridge proves parity.

## 3. Current runtime policy code

`runtimePolicyLoader.js` loads active rows from `execution_policies` and matches text fields:

- `policy_group`
- `policy_key`
- `execution_scope`
- `affects_layer`

`runtimePolicyResolver.js` also loads target rows from `platform_engine_policy_rules`, but returns:

- `enforcement_source = execution_policies`
- `cutover_enabled = false`
- target rules as evidence/future authority

The current resolver does not resolve tenant, workspace, brand, business activity, role, or user-specific policy layers. `platform_engine_policy_registry.scope_type` and `scope_id` are not used by the current matching algorithm.

Live policy registry distribution is predominantly global. Most active target policies are `global / diagnose_only`; there are no active workspace, brand, activity, role, or user policy rows in the observed distribution.

## 4. Dynamic Container Authority

The database and code contain a substantial reusable foundation:

- `containers`
- `container_relationships`
- `container_closure`
- `container_classifications`
- `container_role_assignments`
- `container_resource_bindings`
- `container_effective_context_ledger`
- `container_shadow_comparisons`
- `container_authority_epochs`
- type, relationship, role-template, classification, dimension, override, and rollout registries

Registered container types:

```text
platform, tenant, workspace, brand, activity, workflow
```

Registered relationships:

```text
contains, shares, delegates, manages, references
```

Registered resource dimensions include actions, agents, assets, connections, credentials, endpoints, engines, knowledge, logic, policies, profiles, quotas, roles, rules, skills, tools, and workflows.

Default strategies already include:

- `union`: assets, knowledge, skills, tools, workflows;
- `intersection`: actions, agents, endpoints, engines, logic, roles;
- `deny_wins`: policies and rules;
- `minimum`: budgets and quotas;
- `maximum`: risk and sensitivity classifications;
- `nearest_replace`: connections, credentials, profiles, and selected classifications.

### Current operational state

The registries are seeded, but the live operational rows observed were:

| Surface | Total rows |
|---|---:|
| `containers` | 0 |
| `container_relationships` | 0 |
| `container_role_assignments` | 0 |
| `container_resource_bindings` | 0 |
| `container_classifications` | 0 |
| `container_effective_context_ledger` | 0 |
| `container_shadow_comparisons` | 0 |

The rollout policy is active in `shadow` mode with:

```text
enforcement_enabled = false
provider_writes_enabled = false
minimum_sample_count = 100
p95 budget = 150ms
p99 budget = 400ms
```

### Current code behavior

`resolveContainerDimensionCandidates()` supports `union` and `intersection` for generic candidate values. However, the current resource authorization path in `dynamicContainerAuthorityResolver.js` resolves resource bindings with `deny_wins` regardless of the dimension's declared default merge strategy. The declared strategy is preserved as evidence but does not yet drive effective authorization.

This is safe but incomplete for the requested contextual composition model.

## 5. Existing optional variant and preference foundations

Existing variant-related tables include:

- `platform_private_packages`
- `platform_package_versions`
- `platform_package_variants`
- `platform_package_variant_assets`
- `platform_package_variant_patches`
- `platform_variant_edit_sessions`
- `platform_variant_merge_runs`
- `tenant_package_installs`

`platform_package_variants` supports platform, tenant, brand, business type, and user scopes. It does not currently model workspace, role, or generic non-package shared assets.

`platform_package_variant_patches` already supports override, append, remove, disable, reorder, and policy-change patches with risk, approval, and certification fields.

Existing user/context foundations include:

- `user_agent_surface_preferences`
- `activation_user_dashboard_preferences`
- `tenant_dynamic_dashboard_preferences`
- `memory_scope_links`
- `platform_variant_edit_sessions`

`memory_scope_links` already contains tenant, user, workspace, brand, activity, role, workflow, action, logic, and engine context fields. It is memory linkage authority, not runtime policy authority.

## 6. Existing adaptation and growth telemetry

Reusable evidence sources include:

- `adaptation_records`: tenant logic adaptations with pending/approved/rejected/reverted lifecycle;
- `tenant_growth_recommendation_events`: shown/opened/accepted/dismissed/executed/failed/result-observed events;
- `intent_resolutions`: resolved intent, route, workflow, agent, confidence, and context;
- `execution_log`, `step_runs`, `workflow_runs`, `output_artifacts`, readiness and telemetry surfaces;
- platform evolution and proposal registries.

The current gap is not signal collection. It is a unified, governed path from signals to scoped composition or variant proposals with simulation and measurable promotion criteria.

## 7. Relationship integrity observations

Many legacy authority relationships use textual IDs and application-level validation rather than database foreign keys. The Dynamic Container Authority adds versioning, hashes, epochs, and resolver validation, but its live graph has not yet been populated.

Implementation must therefore:

1. project canonical subjects into containers without replacing canonical tables;
2. create deterministic relationship and binding bridges;
3. run shadow comparisons against existing authorities;
4. preserve legacy enforcement until parity and rollout gates pass.

## 8. Recommended reuse versus new work

### Reuse

- shared canonical asset tables;
- Dynamic Container Authority graph, role, binding, epoch, override, and ledger services;
- package variant patch and merge concepts;
- existing connections, installations, credential intake, grants, approvals, quotas, certifications;
- recommendation, intent, execution, and result telemetry.

### Extend

- dimension-level composition profile selection;
- typed policy-field algebra;
- generic optional variants for non-package assets;
- user experience/adaptation profiles;
- effective runtime manifest beyond authorization-only evidence;
- adaptive proposal, simulation, experiment, and promotion lifecycle;
- shadow bridge from current policy/grant authorities.

### Do not duplicate

- one asset instance per tenant;
- another credential store;
- another independent role system;
- another provider dispatch path;
- another unrestricted JSON policy merge engine.
