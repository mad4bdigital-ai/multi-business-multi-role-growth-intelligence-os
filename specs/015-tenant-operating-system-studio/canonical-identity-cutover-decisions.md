# Spec 015 Canonical Identity and Cutover Decision Register

## Status

```text
T006 = owner approved
cutover executed = false
runtime mutation = false
migration = false
```

Owner approval was recorded on `2026-09-06` for all seven semantic dispositions in this register. The approval resolves the identity/semantic decision task only; it does not authorize runtime cutover, physical rename, migration, provider effects, permission changes, deployment, or Production activation.

Machine-readable companion:

```text
canonical-identity-cutover-decisions.json
```

## 1. Numeric Spec numbers stop being authority identities

Canonical identity is:

```text
feature_key + canonical_role
```

Numeric values such as `011` and `014` remain historical labels only.

### 011 family

The approved roles are distinct:

```text
011-durable-governed-execution-and-agent-delegation
  -> governed execution owner

011-database-driven-operation-fabric
  -> operation-fabric subsystem below governed execution

011-tenant-gpt-effective-capability-envelope
  -> Tenant application component consuming existing authority

011-dynamic-multi-tenant-growth-control-plane
  -> Growth Control Plane domain authority
```

No one wins because its folder starts with `011`.

### 014 family

```text
Retail Commerce
  -> platform.reference.retail_commerce_operations

Hostinger Storage
  -> platform.reference.hostinger_storage_operations

Evidence Intelligence
  -> platform.reference.evidence_intelligence_operations
```

These are bounded product/service sources rather than alternative universal platform parents.

## 2. System Tool Catalog cluster

Current main already contains the merged Catalog V2 baseline:

```text
specs/013-system-tool-catalog-v2
http-generic-api/systemToolCatalogV2.js
```

The Runtime Composition Integration Kit records PR #3260 as the merged baseline.

Historical Drafts in the `013-system-tool-catalog-v2` cluster are reconstruction/history evidence, not independent authorities to merge blindly.

The Catalog owns discovery, principal-visible descriptors, exact lookup, bounded intent discovery, and client/tool projection. It does **not** own permission, resource authority, provider credentials, execution authority, or readback authority.

## 3. The `actions` table is not canonical Business Action

Current repository taxonomy already establishes:

```text
actions
  = provider capability groups
  + parent auth strategy

endpoints
  = exact provider operation contracts

platform_endpoint_tool_exports
  = curated tool exposure
```

Canonical terminology is approved as:

```text
Business Action
  -> domain/product backlog item

Provider Capability Group
  -> current actions row

Provider Operation Contract
  -> current endpoints row

Operation
  -> bounded callable execution identity

Tool
  -> curated client/agent projection
```

### Migration posture

Do **not** rename the SQL table in this PR. Keep `actions.action_key` and `endpoints.parent_action_key` as compatibility identifiers until callers, generated artifacts, policies, connectors and external contracts are inventoried. The first cutover is semantic, not physical.

## 4. Capability authority is in transition, not magically complete

Current main contains:

```text
canonical_capabilities
capability_aliases
capabilityRegistryRepository.js
```

The approved disposition is:

> `canonical_capabilities` is the target canonical semantic identity domain, but existence of the table does not prove universal runtime-enforcement cutover.

Before declaring canonical capability resolution globally authoritative:

1. every active legacy selector maps to exactly one canonical capability in the permitted surface;
2. shadow comparison shows zero unexplained capability, effect or permission mismatch;
3. state-changing paths preserve resource, credential, approval, idempotency and readback gates;
4. legacy rollback remains available during staged rollout;
5. usage evidence proves the old resolver can be retired.

This aligns with Runtime Composition X1/X2 and does not authorize a migration-only authority claim.

## 5. Package authority disposition

Current main already contains:

```text
platform_private_packages
platform_package_versions
platform_private_package_assets
tenant_package_installs
platform_package_variants
platform_variant_merge_runs
```

The approved Phase 1 posture is `reuse or bounded extension`, not creation of a complete parallel `solution_package_*` model. New persistence still requires a proven semantic gap and bounded schema review; T006 approval does not approve a concrete migration.

## 6. External protocol disposition

MCP, and any later agent-to-agent protocol, remain transport/projection adapters.

Canonical path:

```text
External client
  -> Tool / Operation projection
  -> Spec 012 Context Kernel
  -> Spec 011 governed execution
  -> provider
  -> readback/evidence
```

The existing split MCP routes are compatibility surfaces until Spec 016/017 conformance gates are met.

## 7. T006 closure boundary

T006 is now complete as an **owner decision task**. The approval confirms:

- the 011/014 semantic roles;
- current-main System Tool Catalog baseline as canonical target;
- semantic reclassification of legacy `actions`;
- canonical capability target and shadow-cutover gate;
- package reuse/extension posture;
- external protocol non-authority boundary.

The following remain explicitly unexecuted:

```text
physical table rename
capability runtime cutover
migration apply
provider write
permission mutation
deployment
Production activation
```

Any implementation of the approved dispositions must occur in separate bounded PRs with exact-head evidence and the declared cutover/readback gates.
