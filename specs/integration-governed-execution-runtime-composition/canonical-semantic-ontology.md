# Canonical Semantic Ontology and Boundary Contract

## Status and authority

This document extends the Governed Execution Runtime Composition Integration Kit. It is a cross-Spec convergence artifact only.

It does **not** create a new runtime authority, registry, permission source, workflow engine, execution surface, provider binding, or database authority. Functional ownership remains with Specs 011, 012, and 013, while Spec 015 remains the product/portfolio convergence parent.

```json
{
  "artifact_type": "cross_spec_semantic_convergence_contract",
  "runtime_authority": false,
  "functional_authority": false,
  "specification_only": true,
  "secrets_included": false
}
```

## 1. Problem

The repository contains several mature but overlapping vocabularies: capability, action, operation, tool, skill, workflow, activity pack, package, component, adapter, agent, policy, grant, envelope, execution capsule, manifest, receipt, evidence, and projection.

Each concept is individually useful. The long-term risk is semantic duplication: two registries or runtimes can accidentally represent the same idea under different names, or a projection can gradually become treated as authority.

The platform therefore freezes canonical semantic roles before broad product expansion.

## 2. Canonical rule

Every concept MUST have exactly one canonical semantic meaning, one owning authority family, zero or more compatibility aliases, and zero or more projections.

A projection, alias, package declaration, model interpretation, UI affordance, MCP tool, or Agent prompt MUST NOT create authority.

The canonical flow is:

```text
Intent
  -> business interpretation / recommendation
  -> capability requirement
  -> operation selection
  -> exact execution context
  -> governed plan
  -> approval/envelope where required
  -> provider adapter dispatch
  -> readback
  -> evidence
  -> external projections
```

## 3. Canonical vocabulary

### 3.1 Intent

**Meaning:** A user, workflow, Agent, or system goal that may require interpretation before an executable operation is known.

Examples:

```text
improve organic traffic
publish the approved article
inspect repository readiness
```

**Authority:** none. Intent is request input and discovery context.

**Invariant:** semantic matching of intent can discover candidates but never establish resource, tenant, connection, capability, approval, or provider authority.

### 3.2 Insight

**Meaning:** An evidence-backed observation derived from analysis.

**Authority:** domain/product registries such as Growth Intelligence.

**Invariant:** an insight never directly dispatches an external effect.

### 3.3 Recommendation

**Meaning:** A proposed business response to one or more insights.

**Authority:** product/domain layer.

**Invariant:** recommendation is advisory until converted into a bounded action/plan candidate.

### 3.4 Action

**Reserved canonical meaning:** A business-level proposed or approved unit of work, such as a Growth Intelligence backlog action.

Examples:

```text
publish a new Luxor family travel guide
refresh underperforming destination pages
reduce paid-media waste on campaign X
```

**Action is NOT the canonical name for an atomic provider invocation.** New execution primitives SHOULD use `operation`.

### 3.5 Capability

**Meaning:** A semantic statement of what the platform can potentially do, independently of a specific provider implementation.

Examples:

```text
web.search
knowledge.read
cms.content.publish
repository.change.apply
```

**Authority:** canonical capability authority owned by the existing platform/control-plane capability registries.

A capability MAY expose risk, effect, policy, compatibility, or requirement metadata, but visibility or registration never grants permission.

### 3.6 Operation

**Meaning:** A bounded callable invocation contract that exercises one capability with explicit schemas, effect, risk, idempotency, resource expectations, readback, and runtime handler semantics.

Examples:

```text
cms.content.create_draft
cms.content.publish_post
repository.apply_change_set
```

**Authority:** Spec 011 execution contract, with public descriptor/projection owned by Spec 013.

The operation is the canonical execution primitive. Provider-specific calls are adapter implementations of the operation.

### 3.7 Tool

**Meaning:** A client-facing or Agent-facing projection of a canonical operation/capability for discovery and invocation.

Examples:

```text
MCP tool
Custom GPT tool
Agent tool descriptor
UI action descriptor
```

**Authority:** projection/discovery only.

A tool MUST map back to an exact canonical operation or bounded intent surface. Tool visibility MUST NOT be interpreted as permission.

### 3.8 Skill

**Meaning:** A reusable procedural/cognitive package that describes how an Agent performs a class of reasoning or structured work.

A Skill MAY declare:

```text
input/output schema
required capabilities
knowledge requirements
model capability requirements
validators/evals
budget expectations
handoff rules
```

A Skill MUST NOT contain raw credentials or grant its required capabilities to itself.

### 3.9 Agent

**Meaning:** A reasoning/orchestration principal that uses Skills and governed Operations under delegated authority.

An Agent is not a permission role. Effective authority is task-scoped and is the intersection of principal authority, delegation, capability policy, resource authority, environment, effect, budget, and time.

### 3.10 Workflow

**Meaning:** A deterministic/versioned graph of capability/operation requirements, dependencies, approval checkpoints, verification checkpoints, joins, and compensation relationships.

The workflow definition is not execution state. Compiled plans and durable run state remain execution authority.

### 3.11 Activity Pack

**Meaning:** A reusable business-methodology package for an activity/domain. It defines domain semantics such as required capabilities, workflows, policies, KPIs, entities, knowledge profiles, and provider compatibility without containing tenant/Brand facts.

Examples:

```text
marketing.seo_content
retail_commerce.operations
```

### 3.12 Solution Package

**Meaning:** A versioned installable product definition composed by Spec 015. It may reference Activity Packs, components, workflows, forms, reports, AI use cases, roles, policy bindings, connector requirements, acceptance suites, migrations, and runbooks.

A Package declares **requirements**, not permissions.

### 3.13 Component

**Meaning:** A typed, versioned building block inside a Solution Package.

Components remain declarative and bounded. Tenant-authored components cannot contain arbitrary executable JavaScript, SQL, shell, unrestricted network calls, credentials, or hidden production effects.

### 3.14 Installation Revision

**Meaning:** The immutable resolved version of a Package installed at an exact Tenant/Workspace/Brand scope, including compatible component/configuration references and lineage.

Installation authority is separate from execution authority.

### 3.15 Policy

**Meaning:** A deterministic constraint/decision rule that can allow, deny, restrict, require approval, require evidence, impose limits, or select an eligible class.

Policy MUST remain separate from ordinary configuration/preferences.

Mandatory higher-level safety policy cannot be weakened by Tenant, Package, Agent, Skill, or client projection.

### 3.16 Grant

**Meaning:** A typed authority relationship between a principal and scope/capability/resource/effect.

A Grant is authoritative only through the owning authorization authority. Copies in manifests, prompts, UI, or caches are evidence/projections.

### 3.17 Delegation

**Meaning:** A bounded transfer of a subset of existing authority to another principal, normally for a task/session with expiry, resource/effect ceiling, and optional tool/budget limits.

Required invariant:

```text
child_delegated_authority subset_of parent_effective_authority
```

Delegation cannot broaden membership or ownership implicitly.

### 3.18 Provider Adapter

**Meaning:** An allowlisted code implementation that realizes one or more canonical operations against a provider/system.

Examples:

```text
WordPress REST adapter
GitHub adapter
SERP provider adapter
n8n execution adapter
```

A registry row may select/configure a registered adapter but cannot introduce arbitrary executable code or credentials.

### 3.19 Provider

**Meaning:** An external or separately deployed service/system used by an Adapter.

Provider health, readiness, eligibility, commercial availability, authority, and certification are distinct dimensions.

### 3.20 Projection

**Meaning:** A derived representation for clients, search, analytics, Drive, MCP, UI, notifications, or compatibility.

Projection may be rebuilt/reconciled and MUST NOT be primary authority unless an owner Spec explicitly says otherwise.

## 4. Reserved distinctions

The following distinctions are mandatory:

```text
Action != Operation
Capability != Operation
Operation != Tool
Tool != Permission
Skill != Capability Grant
Agent != User Authority
Workflow Definition != Execution Run
Package != Installation
Installation != Execution Authority
Policy != Configuration
Provider Health != Provider Eligibility
Model Quality != Model Readiness
Approval != Execution
Receipt != Readback
Evidence != Telemetry
Knowledge Index != Knowledge Authority
Projection != Authority
```

## 5. Canonical ownership by Spec family

| Semantic area | Canonical owner | Notes |
|---|---|---|
| exact principal/scope/resource/connection context | Spec 012 | produces/validates Execution Capsule |
| capability/operation execution, plan, approvals, idempotency, ledger, readback | Spec 011 | execution authority |
| operation/tool discovery and public execution shell | Spec 013 | projection/transport metadata, not permission |
| external MCP transport/distribution | Spec 016 | adapter over platform authority |
| packages/components/installations/product lifecycle | Spec 015 | product composition, not execution authority |
| cross-Spec runtime composition | integration kit | no independent functional authority |

## 6. Capability -> Operation -> Adapter -> Tool model

Canonical mapping:

```text
Capability
  -> one or more bounded Operations
      -> one or more certified Provider Adapters

Operation
  -> zero or more client projections
      -> MCP Tool
      -> Agent Tool
      -> REST surface
      -> UI action
```

Provider-specific implementation details MUST NOT leak upward into generic Skill/Workflow definitions unless the workflow explicitly requires that provider as a business constraint.

## 7. Package -> Skill -> Capability model

```text
Solution Package
  -> declares Components / Activity Packs / AI use cases
      -> Skills
          -> require Capabilities
              -> resolve Operations
                  -> resolve eligible Adapters
```

No layer grants the next layer permission merely by referencing it.

## 8. Agent task authority model

Effective Agent authority MUST be bounded as:

```text
authenticated/requesting principal authority
INTERSECT task delegation
INTERSECT Agent grant ceiling
INTERSECT capability policy
INTERSECT resource authority
INTERSECT environment/effect policy
INTERSECT commercial/budget limits
INTERSECT temporal validity
```

Sub-Agent delegation MUST only narrow this set and MUST enforce a bounded delegation depth.

## 9. Compatibility and alias policy

Legacy terms may remain during migration only through an explicit compatibility mapping containing:

```text
legacy_identifier
canonical_identifier
semantic_equivalence_status
source_owner
target_owner
migration_state
deprecation_state
usage/readback evidence
```

Unknown or partially equivalent aliases fail closed for state-changing execution.

New schema/table/API names SHOULD use the canonical vocabulary unless an existing authoritative contract requires compatibility naming.

## 10. Semantic collision gate

A new registry, table, route, package component, tool, or Agent binding MUST be reviewed when its meaning overlaps a canonical concept.

Blocking collision examples:

- a new `actions` registry whose rows are actually executable operations;
- a Tool Catalog row used as a permission grant;
- a Package capability declaration treated as runtime authorization;
- a Skill manifest carrying provider credentials;
- an Agent prompt used as the only publication guard;
- a second receipt table that creates a second operation identity without an isolation requirement.

## 11. Required machine-readable mapping

Spec 015 maintains a portfolio-level concept/authority map. The runtime integration kit uses that map as convergence evidence, not as execution authority.

At minimum each canonical concept record identifies:

```text
concept_key
canonical_term
semantic_role
authority_owner
runtime_authority
allowed_projections
forbidden_authority_inference
compatibility_notes
```

## 12. Acceptance criteria

Semantic convergence is ready for implementation only when:

1. every callable Tool maps to a canonical Operation or explicitly bounded intent surface;
2. every state-changing Operation maps to exactly one execution authority path;
3. every Package capability reference is classified as requirement, never grant;
4. every Skill capability reference is classified as requirement, never grant;
5. every Agent execution path uses task/delegation authority rather than copied user permissions;
6. every legacy alias has an equivalence/cutover disposition;
7. no logical resource has two active primary authorities;
8. cross-Spec identifiers and ownership pass machine-readable parity tests;
9. external projections can be disabled without deleting canonical operational truth;
10. no runtime/provider/database/Production mutation is introduced by this semantic artifact itself.

## 13. Content Intelligence reference validation

The future Content Intelligence reference package is a required architecture fitness case. It should be expressible by adding Package/Activity-Pack/Skill/Workflow/Policy/Knowledge/Adapter requirements without modifying Context Kernel, execution authorization, ledger, or tenant isolation semantics.

Illustrative composition:

```text
Content Intelligence Package
  -> SEO Content Activity Pack
  -> research/planning/writing/review Skills
  -> web.search / knowledge.read / cms.content.* Capabilities
  -> SERP / scraper / Drive / WordPress adapter requirements
  -> governed Workflow plans
  -> exact Capsule / Policy / Approval / Envelope
  -> provider effect
  -> readback / evidence
```

If this package requires a new parallel execution authority, the convergence design is incomplete and MUST be revisited before implementation.
