# Package-to-Runtime Convergence Addendum

## Status

This addendum extends Spec 015 as the product/portfolio convergence parent. It does not create a new kernel, execution runtime, permission model, provider authority, or migration authority.

Its purpose is to freeze how Solution Packages, Activity Packs, Skills, Agents, knowledge, model decisions, and external projections consume the existing governed runtime.

```json
{
  "addendum_type": "spec015_product_runtime_convergence",
  "specification_only": true,
  "runtime_authority": false,
  "functional_authority": false,
  "secrets_included": false
}
```

## 1. Architectural decision

Spec 015 remains the product composition layer.

The governed execution integration kit coordinates runtime composition across Specs 011, 012, and 013. Spec 015 consumes that composition and MUST NOT recreate it inside Package or Installation semantics.

```text
Solution Package / Installation Revision
        |
        v
Package requirements and bounded components
        |
        v
Existing Context Kernel + Capability/Policy/Execution authorities
        |
        v
Governed Operation Plan
        |
        v
Provider Adapter / Readback / Evidence
```

## 2. Product/runtime boundary

### Spec 015 owns

```text
Solution Package identity/version
Component identity/version
Package-component graph
Package publication policy
Installation identity/revision
Sparse overrides and bounded extensions
Package compatibility
Package acceptance suites
Package upgrade/rollback/handover lifecycle
Package-facing requirement descriptors
```

### Spec 015 does not own

```text
principal authentication
Tenant/Workspace/Brand/resource authority
connection selection
capability permission
grant/delegation authority
provider credential resolution
operation execution
approval consumption
idempotency ledger
resource locks
provider dispatch
unknown-outcome reconciliation
readback authority
execution evidence authority
```

## 3. Requirements-not-permissions invariant

A Package can declare that it requires:

```text
capabilities
provider/connection classes
knowledge profiles
model capability profiles
roles
workflows
policies
budgets
file/data classifications
```

These declarations produce installation/readiness requirements only.

A Package MUST NOT create a grant merely because it references a Capability, Operation, Tool, Provider, Role, or Agent.

Example:

```yaml
requires:
  capabilities:
    - web.search
    - knowledge.read
    - cms.content.create_draft
optional_capabilities:
  - cms.content.publish
```

This means the Package cannot become `ready` or execute applicable workflows without compatible resolved authority. It does not grant any of those capabilities.

## 4. Installation Revision boundary

An Installation Revision answers:

> Which immutable Package/component/configuration composition is installed for this exact Tenant/Workspace/Brand target?

It MAY bind references such as:

```text
package version
activity pack versions
component versions
configuration snapshot
knowledge profile requirements
workflow versions
skill requirements
connector/provider requirement classes
acceptance evidence
```

It MUST NOT embed:

```text
raw credentials
OAuth tokens
approval tokens
mutable user grants
broad capability envelopes
provider secret payloads
arbitrary executable code
```

## 5. Effective execution path for installed packages

An installed Package uses the runtime through this conceptual sequence:

```text
User/Agent Intent
  -> Installation Revision resolution
  -> Package/Activity applicability
  -> Skill/Workflow selection
  -> Capability/Operation requirements
  -> Spec 012 exact Execution Capsule
  -> Spec 011 Governance Decision + Plan
  -> model/commercial/knowledge decisions when applicable
  -> Approval frontier when required
  -> short-lived execution Envelope
  -> Provider Adapter
  -> Readback
  -> Evidence
```

No Product-layer object may skip directly from Package/Skill/Workflow to provider credentials or state-changing provider calls.

## 6. Activity Pack boundary

Activity Packs define reusable domain methodology and MUST remain independent of Brand-specific facts.

A valid Activity Pack may reference:

```text
entity/schema requirements
knowledge profile types
KPIs
capabilities
workflow definitions
policy bindings
provider compatibility classes
quality/evaluation requirements
```

A Brand Activity Binding selects an applicable Activity Pack/version and scope, but execution still requires current authority and provider readiness.

## 7. Skill boundary

Skills are reusable procedural/cognitive assets.

A Skill SHOULD be versioned and may declare:

```text
purpose
input schema
output schema
required capabilities
required knowledge profiles
model capability requirements
budgets
validators
evaluation suites
allowed handoffs
```

A Skill MUST NOT:

- store credentials;
- hardcode a Tenant/Brand/resource as reusable authority;
- call a provider outside the governed Operation path;
- treat its prompt as security enforcement;
- grant itself required capabilities.

## 8. Agent boundary

Agents are task-scoped reasoning principals.

Installed Package configuration may declare eligible Agent/Skill roles or templates, but effective authority is resolved at runtime.

Required authority shape:

```text
requesting/effective principal authority
INTERSECT task delegation
INTERSECT Agent grant ceiling
INTERSECT package/activity eligibility
INTERSECT capability policy
INTERSECT resource authority
INTERSECT environment/effect rules
INTERSECT commercial/budget limits
INTERSECT temporal validity
```

Sub-Agent delegation can only narrow the effective set.

## 9. Knowledge boundary

Packages can declare **Knowledge Profile requirements**; they do not own external source credentials or treat vector indexes as truth.

The long-term Knowledge flow is:

```text
Canonical human/business knowledge source
  -> Knowledge Registry / provenance
  -> authorization + data-use + freshness filters
  -> retrieval index projection
  -> immutable Knowledge Snapshot
  -> Agent/Workflow context
```

The Knowledge Snapshot is execution evidence, not permission authority.

A future knowledge/provenance implementation MUST support correction/retraction lineage, sensitivity, license/rights, freshness, and scope-safe retrieval for high-value content workflows.

## 10. Model boundary

Package/Skill definitions may declare a **model capability requirement**, not a raw ungoverned model choice.

Examples:

```text
structured_output_required
long_context_required
vision_required
arabic_quality_floor
reasoning_class=analytical
risk_class=content_generation
```

Contextual Model Governance resolves eligible exact candidates under hard policy, data, region, quality, readiness, entitlement, and commercial constraints.

A Package-level `preferred_model` may only be a bounded preference when policy allows; it never creates eligibility.

## 11. Provider and connector boundary

Packages declare provider/connector requirement classes such as:

```text
serp_search_provider
web_content_fetch_provider
canonical_knowledge_source
cms_provider
analytics_provider
```

Installation readiness resolves whether an eligible connection/binding exists.

Runtime execution resolves the exact certified Adapter/Connection at the governed frontier.

n8n, Make, MCP, REST clients, and future agent protocols are adapters/projections; none becomes Product or execution authority merely because a Package uses them.

## 12. External projection boundary

Installed Package capabilities may be projected through:

```text
Tenant UI
Admin UI
REST/OpenAPI
System Tool Catalog
MCP
Agent tool surfaces
reports/search/analytics
```

Every projection MUST preserve this rule:

> discoverable or visible does not mean executable.

Invocation always returns to the current server-side Context/Capability/Policy/Execution authorities.

## 13. Reference-first runtime artifacts

Spec 015 consumes runtime artifacts by immutable references rather than copying full authority state into Installation records.

The Product layer should be able to correlate an execution with:

```text
installation_revision_ref
execution_capsule_ref
governance_decision_ref
plan_snapshot_ref
model_selection_ref
commercial_decision_ref
knowledge_snapshot_ref
approval_ref
envelope_ref
operation_receipt_ref
readback_ref
```

The Effective Runtime Manifest, when implemented, is a reference graph across these decisions rather than a broad permission document.

## 14. Upgrade and drift

Package upgrades use three-way resolution:

```text
installed origin version
+ target Package version
+ installation overrides/extensions
-> compatibility/conflict report
-> migration/acceptance plan
-> proposed Installation Revision
```

A Package upgrade MUST NOT preserve stale execution permission merely because the installation was previously active.

The next consequential execution revalidates current principal, resource, connection, capability, policy, approval, effect, commercial, model, and applicable knowledge freshness requirements.

## 15. Supply-chain requirements

Before shared/marketplace Package distribution, Package artifacts SHOULD converge on software-supply-chain-like evidence:

```text
verified publisher identity
source/provenance
immutable digest/signature
component inventory / PBOM
requested capability manifest
provider requirement manifest
license/reuse terms
security/no-secret scan
compatibility range
acceptance suite
release channel
revocation/deprecation state
```

No Package payload may install executable code unless that component type has a separately certified platform execution model.

## 16. Portability and ownership

Package IP, installation ownership, client data, files, credentials, external connections, and deliverable ownership are independent dimensions.

A governed export may include:

```text
Package/component refs and exportable payloads
Installation configuration/lineage
Tenant-owned data/file inventory
knowledge/artifact provenance
provider requirement descriptors
schema/migration versions
hashes and portability findings
```

It MUST NOT export credentials, approval tokens, another Tenant's data, or non-transferable platform secret state.

## 17. Content Intelligence reference package fitness case

Spec 015 registers the following candidate architecture fitness case:

```text
platform.reference.content_intelligence_operations
```

This is a candidate specification target, not an activated Package.

Expected composition:

```text
Content Intelligence Solution Package
|
+-- Activity Pack: marketing.seo_content
|
+-- Entities/Components
|   +-- content_job
|   +-- keyword_opportunity
|   +-- research_pack
|   +-- competitor_page
|   +-- information_gain_plan
|   +-- content_blueprint
|   +-- fact_ledger
|   +-- media_asset
|   +-- publish_manifest
|
+-- Skills
|   +-- keyword_research
|   +-- serp_analysis
|   +-- competitor_analysis
|   +-- knowledge_dispatch
|   +-- information_gain
|   +-- content_planning
|   +-- section_writing
|   +-- fact_review
|   +-- editorial_review
|
+-- Workflows
|   +-- article_create
|   +-- article_refresh
|   +-- knowledge_reindex
|   +-- media_prepare
|   +-- performance_review
|
+-- Policies
|   +-- source_authority
|   +-- fact_quality
|   +-- media_rights
|   +-- publishing
|   +-- research_budget
|
+-- Provider requirements
    +-- SERP
    +-- scraper/browser
    +-- canonical knowledge/Drive
    +-- CMS/WordPress
```

## 18. Content Intelligence staged activation

The fitness case SHOULD prove the platform progressively:

```text
Stage CI-0: research + knowledge + blueprint + internal draft only
Stage CI-1: WordPress draft creation with readback
Stage CI-2: approved/scheduled publish
Stage CI-3: bounded low-risk auto-publish after quality/evidence certification
Stage CI-4: performance feedback -> improvement proposal, never direct self-modifying Production
```

Each stage remains independently feature-flagged/certified.

## 19. Phase 0 convergence requirements

Before Spec 015 Package runtime implementation advances beyond convergence, current-main evidence MUST establish:

1. canonical terminology for Capability, Operation, Tool, Action, Skill, Agent, Workflow, Activity Pack, Package, Installation, Policy, Grant, Envelope, Receipt, Readback, Evidence, and Projection;
2. one primary authority owner per logical resource;
3. field-level reuse mapping before new tables are approved;
4. compatibility/alias disposition for duplicate concepts;
5. reference-first boundary between Installation Revision and runtime authority artifacts;
6. explicit package-requirements-not-permissions invariant;
7. task-scoped Agent delegation rule;
8. knowledge/model/commercial decisions treated as separate composable authorities;
9. Content Intelligence expressible as a reference Package without kernel modification;
10. machine-readable parity tests before any broad runtime cutover.

## 20. Acceptance criteria

This addendum is satisfied when:

- Spec 015 can add a new vertical Package without adding a new permission/execution system;
- Package/component manifests contain no credentials or implicit grants;
- every Package capability/connector/model/knowledge declaration is classified as requirement/preference, not authority;
- every consequential Package operation resolves exact context and governed execution server-side;
- an installed Package can be upgraded/rolled back without losing lineage or silently widening authority;
- Content Intelligence can reach governed WordPress Draft/Publish through existing Operation/Adapter/Readback primitives;
- external projections can change protocol/client without changing the Product or Kernel authority model.

## 21. Non-authority boundary

This addendum authorizes no runtime route, migration, SQL mutation, provider call, credential access, Package publication, installation activation, MCP publication, Production rollout, merge, or protected-branch write.
