# Research and Existing-System Fit

## Scope of review

The review used the live `auth.mad4b.com` checkout at commit `ea5585d9fcf7cb0b124bc6070e6309819cf96861` and the MySQL-primary registry. It was read-only and performed no provider call, credential payload read, runtime mutation, or external write.

## Existing primitives worth reusing

### Capability envelopes and approvals

`capability_resolution_envelope_ledger` already provides tenant, user, workspace, brand, capability, operation, risk, immutable JSON/hash, approval, expiry, audit, and readback gates. `approval_holds` provides decision identity and expiry. These surfaces should be extended or referenced for container overrides rather than replaced.

### Semantic capability resolution

The existing foundation already defines:

```text
principal
→ workspace
→ membership
→ semantic capability
→ provider binding
→ workspace-linked connection
→ action grant
→ resource authority
→ endpoint
→ certification
```

The container resolver should sit before provider binding and enrich this chain with multi-parent paths, classifications, role templates, dimension bindings, sharing, delegation, and override evidence.

### Resource authority

Existing resource-authority contracts establish that admin intent is not authority and that external writes require ownership, grants, credentials, policy, audit, and readback. The new model should produce the effective scoped evidence consumed by those gates.

### Platform Graph

The graph contains tenants, brands, activities, workflows, tools, skills, connections, actions, endpoints, policies, and knowledge surfaces, plus authority/evidence metadata. It is valuable as a projection and investigation surface, but not as canonical mutation authority because workspace hierarchy is absent, taxonomy drift is substantial, and graph context resolution does not produce an execution allow/deny decision.

### Memory scope registry

The dynamic memory scope registry proves registry-defined scopes are viable. It should not be reused as execution authority because it is memory-specific and its current hierarchy and live links do not match the desired execution model.

### Workspace and resource grants

`workspace_registry`, `workspace_resource_grants`, `workspace_app_links`, and `app_action_grants` remain valuable compatibility sources. They should be adapted during shadow mode rather than remain the generalized final schema.

## Current gaps confirmed

1. Generic endpoint execution does not require complete workspace, brand, activity, role, and resource authority before credential materialization.
2. Workspace membership is currently tenant-scoped.
3. Brand identity uses multiple namespaces.
4. Active connections exist while active workspace-connection links are absent.
5. Broad permission can currently defeat a narrower restriction.
6. Platform/admin handling permits an implicit target path.
7. Execution audit fields for workspace, brand, activity, workflow, tool, and skill are sparsely populated.
8. Profiles, skills, policies, connections, and tools each use different scope semantics.

## Alternatives considered

- **Platform Graph as mutation authority:** rejected; use as projection/read model.
- **Extend `workspace_registry` enums and JSON:** rejected; cannot safely model dynamic levels and multi-parent inheritance.
- **Reuse memory scopes:** rejected; memory visibility and execution authority have different invariants.
- **One generic edge table for all authority:** rejected as the canonical write model; critical fields need typed constraints and indexed queries.
- **Canonical container tables plus graph projection:** selected.

## Resolver convergence

```text
executionReadinessDryRun
capability-resolution-dry-run
tenantEffectiveCapabilityResolver
          ↓
resolveEffectiveContainerContext
```

During shadow mode, legacy outputs remain unchanged and the new result is attached as comparison evidence only.

## Compatibility strategy

- Project current tenants/workspaces into containers.
- Use `brands.target_key` as canonical brand identity.
- Adapt current grants, app links, skills, policies, and workflow bindings into dimensions.
- Preserve legacy dispatch until shadow criteria pass.
- Hold ambiguous mappings instead of guessing.
- Never expose secret payloads in projections.
