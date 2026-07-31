# Activity Packs, Capabilities, and Workflow Graphs

## Activity Pack

An Activity Pack is a versioned industry/business-domain package. It defines reusable rules and structures but contains no tenant credentials or brand facts.

Required manifest sections:

```text
identity and version
entity schemas
knowledge profile pointers
KPI taxonomy
compatible semantic capabilities
workflow templates
policy bindings
provider compatibility
freshness and evidence rules
UI manifest references
test fixtures and compatibility declarations
```

Examples include `travel`, `ecommerce`, `real_estate`, `restaurant`, and `professional_services`.

## Brand activity binding

A brand activates an Activity Pack through an explicit binding containing:

- tenant/workspace/brand IDs;
- activity type and pack version;
- markets, locales, channels, and objectives;
- allowed capability subset;
- Brand Core version requirements;
- provider and resource compatibility;
- status and effective dates.

A brand with multiple activities has separate bindings and plan scopes. Ambiguous activity selection blocks.

## Capability contract

A semantic capability is provider-independent and declares:

```text
capability_key and version
input and output schemas
effect and risk class
compatible activities
required Brand Core assets
required knowledge and engines
required resources/providers
approval and typed-confirmation rules
idempotency and quota rules
readback and rollback contracts
Admin/Tenant exposure policy
```

Capabilities should be small and composable. Avoid broad operations such as `run_complete_campaign`.

## Workflow definition

A workflow version is an immutable directed acyclic graph:

```json
{
  "workflow_key": "organic_growth_plan",
  "version": 4,
  "nodes": [
    {"id": "intent", "capability": "intent_map_generate", "mode": "internal_draft"},
    {"id": "briefs", "capability": "content_brief_generate", "depends_on": ["intent"]},
    {"id": "measurement", "capability": "conversion_spec_generate", "depends_on": ["intent"]},
    {"id": "review", "capability": "internal_review_create", "depends_on": ["briefs", "measurement"]}
  ]
}
```

Provider nodes are explicit, for example `cms.page.create_draft`. Internal artifacts cannot silently become external writes.

## Compilation

The compiler:

1. resolves canonical capability identities;
2. validates node input/output compatibility;
3. validates activity, market, locale, channel, engine, and provider compatibility;
4. detects cycles and missing nodes;
5. applies bounded fan-out and concurrency limits;
6. compiles policy and approval requirements;
7. selects no adapter before readiness and certification evidence exists;
8. persists the graph, versions, requirements, and hash.

## Extension modes

- **Install:** reference the platform workflow version.
- **Override:** sparse schema-valid configuration change.
- **Extend:** add bounded nodes or edges through approved extension points.
- **Fork:** create independent structural lineage while retaining mandatory policy constraints.
- **Tenant-authored:** new draft using only tenant-eligible certified capabilities.

Forks and tenant-authored workflows never inherit credentials or authority.

## Pointer-first logic and knowledge

Workflow nodes reference canonical capability, logic pointer, and knowledge profile keys. Active pointer registries select the effective versions. Direct file paths, Drive IDs, or prompt bodies in a workflow definition are forbidden.

## Execution classes and environments

Execution class selects runtime tier; it does not grant authority. Environment/effect boundaries are explicit:

```text
analysis/read-only
internal_draft
staging_write
production_canary
production_write
```

Moving to a higher-effect boundary requires a new policy evaluation and approval.

## Reference cross-activity composition

A shared `intent_map_generate` capability may be compatible with travel and ecommerce through different entity schemas and knowledge profiles. Activity-specific capabilities remain distinct where semantics, evidence, or KPIs differ.

## Completion evidence

Compilation success is not execution success. A run is complete only after required output persistence, adapter readback, evidence, and terminal state transition are verified.
