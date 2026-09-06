# Spec 015 Current-Main Authority and Reuse Matrix — 2026-09-06

## Scope

This artifact deepens Spec 015 Phase 0 tasks T002 and T003 against exact `main` SHA:

```text
0faee775cd0572b737fed8bc74e2580d9fca2878
```

It is repository-read-only evidence. It does not approve a migration, new table, runtime cutover, provider write, permission grant, external publication, or Production activation.

The machine-readable authority is:

```text
docs/spec-portfolio/spec015-current-main-authority-reuse-matrix-20260906.json
```

## Primary finding

The repository already contains more Package and installation substrate than the original Spec 015 draft matrix assumed.

Current-main includes, among other authorities:

```text
platform_private_packages
platform_package_versions
platform_private_package_assets
tenant_package_installs
platform_package_variants
platform_package_variant_patches
platform_variant_merge_runs
canonical_capabilities
capability_aliases
agents
agent_skills
workflows
agent_skill_grants
agent_workflow_bindings
growth_control_activity_pack_definitions
growth_control_activity_pack_versions
SystemToolCatalogV2
Context Kernel authorities
Governed execution authorities
```

Therefore the default implementation posture changes from:

```text
create solution_package_* tables
```

to:

```text
prove semantic gap
  -> reuse existing authority when exact
  -> extend existing authority when bounded
  -> use compatibility bridge when legacy shape is insufficient
  -> create new persistence only after owner approval for a proven gap
```

## Package definition

`platform_private_packages` and `platform_package_versions` already provide stable package/version identities, source provenance, manifest hashes, risk/certification and lifecycle-like status.

Exact or near-exact reuse exists for:

- package ID/key;
- package version identity;
- source commit/tree evidence;
- normalized manifest and hashes;
- package risk;
- certification state;
- status.

Unproven product-level gaps remain for:

- owner container and ownership class;
- broad Solution Package classification beyond the current intake-oriented enum;
- publication visibility/audience;
- support/lifecycle/license terms.

**Disposition:** do not create a second package definition/version authority until these gaps receive T006/T008 owner decisions.

## Components

The platform already stores canonical Agent, Skill, Workflow, Action, App, Plugin, Policy, Logic and other shared definitions. `platform_private_package_assets` additionally models imported package assets and provenance.

A generic Component registry may still be justified, but only as a typed **composition/identity layer**. It must not copy canonical payloads into a second source of truth.

Unproven gaps:

- cross-family component identity;
- generic component version contract;
- package-component typed bindings;
- dependency graph and compatibility contract.

## Installation

`tenant_package_installs` is a real current-main installation substrate with package/version, Tenant, install status, approval status, Brand/scope JSON and compatibility fields.

It must be treated as migration input or primary extension target rather than ignored.

However these fields are explicitly **compatibility-only** for the target architecture:

```text
enabled_scopes_json
brand_bindings_json
agent_grants_json
policy_overrides_json
```

Reason: the final system needs exact typed scope/authority references. A copied `agent_grants_json` or `policy_overrides_json` must never become an independent authorization authority.

Proven semantic gaps include:

- first-class Workspace/Brand/client/environment target;
- immutable installation revision;
- active revision pointer;
- typed resource/provider/role requirement bindings;
- version vector/context hash/lineage.

## Capability

`canonical_capabilities` and `capability_aliases` are implemented on current main and have a dedicated runtime repository.

No new Capability authority is justified.

A historical semantic conflict remains: older Spec 006 material referred to `platform_semantic_capabilities` as authority and explicitly warned against creating `canonical_capabilities`. Current main now contains the canonical capability domain. This is a T006 cutover/documentation reconciliation problem, not a reason to resurrect two authorities.

## Operation

The repository has multiple operation/plan/tool execution surfaces, while the Runtime Composition Integration Kit already assigns canonical execution ownership to Spec 011.

Target:

```text
Capability
  -> canonical bounded Operation
      -> certified Adapter
      -> Tool/UI/MCP projection
```

The remaining work is convergence of exact Operation identity and metadata, not a new runtime.

## Tool Catalog

`SystemToolCatalogV2` already has stable descriptor identity, source key, capability key, catalog level, aliases/tags, input schema, snapshot versioning and collision detection.

It is retained as discovery/projection.

The missing metadata—operation version, consequence/effect, idempotency, readback, durable support—must be projected from canonical Operation contracts. Tool visibility remains non-authoritative.

## Agent / Skill / Workflow

The platform already has shared definitions and bindings. A Package should reference these or package-owned compatible versions, not duplicate them.

Effective Agent authority is runtime/task scoped:

```text
requesting principal authority
INTERSECT task delegation
INTERSECT agent ceiling
INTERSECT capability policy
INTERSECT resource authority
INTERSECT environment/effect
INTERSECT budget/time
```

## Activity Packs

Growth Control Plane already implements Activity Pack definitions, versions and Brand/activity bindings. Spec 015 consumes those authorities; it does not create another Activity Pack registry.

## MCP

Current main still contains compatibility routes such as:

```text
POST /mcp/initialize
GET  /mcp/tools/list
POST /mcp/tools/call
```

These are protocol/transport compatibility surfaces, not a new execution authority. Spec 016/017 owns their staged external-protocol convergence while execution returns to Context Kernel and governed execution.

## Effective Runtime Manifest

The final Manifest remains a reference-first composition artifact:

```text
installation_revision_ref
execution_capsule_ref
governance_decision_ref
plan_snapshot_ref
model_selection_ref
commercial_decision_ref
knowledge_snapshot_ref
```

`effective_runtime_manifest_ledger` is present as a proposal in Spec 004 material, not proven by this audit as a deployed canonical runtime table. Persistence therefore remains an owner decision.

## Legacy `actions` semantic collision

The repository already has a shared `actions` table and Growth Intelligence business actions.

The new canonical ontology reserves:

```text
Action    = business-level proposed/approved work item
Operation = bounded callable technical execution
```

The legacy `actions` table cannot be blindly renamed or reclassified. T006 must classify row families and create compatibility mappings before any migration or retirement.

## T002 / T003 completion boundary

This artifact is sufficient to mark the **repository inventory/reuse evidence** portions of T002 and T003 complete for the exact current-main SHA above.

It is not sufficient to close:

```text
T006 canonical identity/cutover decisions
T008 architecture/product/security/privacy ownership approval
T010+ runtime implementation
```

No migration or runtime implementation is claimed.

## Next bounded implementation decisions

1. Decide whether `platform_private_packages` / `platform_package_versions` are extended directly or wrapped by a thin Product catalog projection.
2. Decide immutable installation revision persistence while preserving `tenant_package_installs` as migration input/authority.
3. Define generic Component identity only for the proven cross-family composition gap.
4. Classify legacy `actions` semantics and historical capability authority aliases.
5. Extend Spec 013 descriptors from canonical Operations, not independently.
6. Keep MCP external transport non-authoritative.
7. Only after these decisions begin T010–T018 Package foundation implementation.
