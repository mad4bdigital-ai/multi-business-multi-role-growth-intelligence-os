# Research and Existing-System Fit

## Review scope

The design was compared against the SQL-primary registry, capability envelopes, approval holds, workspace/resource grants, semantic capability resolution, Platform Graph, memory scopes, execution readiness, and audit/readback surfaces. This package remains read-only and performs no provider call, credential payload read, migration, external write, deployment, or secret handling.

## Existing primitives to reuse

### Capability envelopes and approvals

`capability_resolution_envelope_ledger` already supplies tenant, user, workspace, brand, capability, operation, risk, immutable hash, approval, expiry, audit, and readback gates. `approval_holds` supplies decision identity and expiry. Container overrides should reference these surfaces rather than replace them.

### Semantic capability chain

```text
principal → workspace → membership → semantic capability
→ provider binding → workspace-linked connection → action grant
→ resource authority → endpoint → certification
```

The container resolver belongs before provider binding and enriches this chain with multi-parent paths, classifications, roles, resource dimensions, sharing, delegation, and override evidence.

### Platform Graph and legacy grants

Platform Graph is useful as a projection and investigation surface, not mutation authority. Existing workspace grants, app links, action grants, roles, skills, workflows, and policies remain compatibility inputs during shadow mode.

## Confirmed gaps

1. Execution does not always require complete workspace, brand, activity, role, and resource context before credential materialization.
2. Membership/role semantics are not generalized to arbitrary levels.
3. Brand identity uses multiple namespaces.
4. Active connections may lack active workspace links.
5. Broad permission can defeat narrower restriction.
6. Platform/admin behavior can select implicit targets.
7. Audit context fields are sparse.
8. Profiles, skills, policies, tools, workflows, and connections use different scope semantics.
9. Current hierarchy models lack deterministic multi-parent conflict resolution.

## Alternatives

- Platform Graph as authority: rejected; projection only.
- Extend workspace enums/JSON: rejected; insufficient for dynamic multi-parent scope.
- Reuse memory scopes: rejected; visibility and execution authority differ.
- One generic edge table only: rejected; critical fields need typed constraints/indexes.
- Canonical container tables plus graph projection: selected.

## Resolver convergence

```text
executionReadinessDryRun
capability-resolution-dry-run
tenantEffectiveCapabilityResolver
          ↓
resolveEffectiveContainerContext
```

Shadow mode preserves legacy dispatch and records comparison evidence only. Ambiguous mappings are held instead of guessed; secret payloads never enter projections.
