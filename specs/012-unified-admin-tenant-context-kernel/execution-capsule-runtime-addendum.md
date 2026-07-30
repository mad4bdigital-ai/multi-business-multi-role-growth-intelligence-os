# Spec 012 Addendum: Execution Capsule and Runtime Integration

## Status and ownership

This addendum extends `012-unified-admin-tenant-context-kernel`. Spec 012 remains authoritative for principal, effective subject, authorized scope, candidate selection, exact resource and connection binding, authority path, capability readiness, context hash, context revision, context pins, and invalidation.

It does not own the workflow scheduler, provider retry engine, projection worker, public tool catalog, or repository delivery lifecycle. Those remain under Spec 011 and Spec 013 as mapped by the cross-spec integration kit.

## Evidence for the extension

The existing architecture already requires one shared kernel across Admin, Tenant, service, and delegated-agent entry points and defines `ResolveExecutionContext`, `CompileExecutionPlan`, `ValidateExecutionContext`, `DispatchGovernedOperation`, and `ReconcileUnknownOutcome` as application use cases. It also defines a context hash over principal, subject, tenant, workspace, resource, connection, authority revision, capability revision, and registry revision, plus an invalidation graph.

Current delivery evidence shows that the domain kernel, registry read adapters, application services, API contracts, resource shadow integration, and security gates were intentionally introduced without runtime-authority replacement. The remaining functional gap is an explicit runtime artifact that carries a resolved context safely across a complete execution plan.

## Execution Capsule

An `ExecutionCapsule` is an immutable, no-secret application value created only from a resolved context decision.

Required fields:

```json
{
  "capsule_ref": "ctxc-...",
  "context_hash": "sha256-...",
  "context_revision": "...",
  "principal_type": "tenant_user",
  "principal_ref": "...",
  "effective_subject_ref": "...",
  "tenant_ref": "...",
  "workspace_ref": "...",
  "brand_ref": null,
  "resource_type": "repository",
  "resource_ref": "...",
  "connection_ref": "...",
  "authority_path_ref": "...",
  "capability_key": "...",
  "authority_revision": "...",
  "capability_revision": "...",
  "registry_revision": "...",
  "credential_readiness_revision": "...",
  "issued_at": "...",
  "expires_at": "...",
  "invalidation_dependencies": [],
  "secrets_included": false
}
```

The capsule contains references and revisions only. It never contains a credential, provider token, raw grant payload, raw JWT, provider response body, or unbounded evidence.

## New functional requirements

### Capsule creation and identity

- **FR-EC-001**: A capsule MUST be created only when context resolution status is `resolved` and exactly one execution candidate, resource, connection, authority path, and capability decision are selected.
- **FR-EC-002**: Capsule identity MUST be bound to the context hash and the revisions of every authority-bearing dependency.
- **FR-EC-003**: Capsule values MUST be immutable, sanitized, tenant-scoped, expiring, and safe for durable reference.
- **FR-EC-004**: A capsule MUST NOT authorize execution by itself. The execution plan, governance decision, approval, dynamic authority, and mutation boundary checks remain independently required.

### Revision-bound reuse

- **FR-EC-005**: The runtime MAY reuse candidate selection, exact connection selection, static authority-path projection, and static capability-binding projection only while their declared revisions remain unchanged.
- **FR-EC-006**: Reuse MUST be keyed by stable principal and context identity plus exact revision vector, not by TTL alone.
- **FR-EC-007**: A cache miss or revision mismatch MUST trigger canonical re-resolution; it MUST NOT fall back to stale context for a mutation.
- **FR-EC-008**: Low-risk reads MAY use a still-valid capsule while a background refresh is attempted only when policy explicitly allows stale-while-revalidate and the result cannot widen visibility or execution authority.

### Dynamic execution checks

- **FR-EC-009**: Before a mutation, the runtime MUST refresh all dynamic evidence declared by the operation contract, including approval state, capability-envelope state, owner grant or effective authority, resource version, provider version, connection status, and expected SHA where applicable.
- **FR-EC-010**: Dynamic refresh MAY validate the existing capsule; it MUST NOT silently choose a different tenant, workspace, resource, connection, authority path, or capability.
- **FR-EC-011**: When dynamic validation indicates that a different context would be required, execution MUST stop with `context_re_resolution_required` or `interpretation_required` rather than substitute a new target.

### Invalidation graph extension

- **FR-EC-012**: Principal change invalidates the capsule and every dependent plan, approval, governance decision, envelope, and idempotency binding.
- **FR-EC-013**: Tenant change invalidates workspace, brand, resource, connection, authority, capability, plan, approval, and operation descendants.
- **FR-EC-014**: Workspace change invalidates brand, resource, connection, plan, approval, and execution-envelope descendants.
- **FR-EC-015**: Resource change invalidates connection suitability, authority, capability readiness, expected version, plan, and approval descendants.
- **FR-EC-016**: Connection or credential-readiness revision change invalidates provider-dispatch readiness and plan validation but does not silently select another connection.
- **FR-EC-017**: Registry, authority, or capability revision changes invalidate only capsules whose dependency vector references the changed revision domain.
- **FR-EC-018**: Plan content change invalidates plan hash, approval bundle, governance decision, idempotency scope, and lane assignment.

### Runtime composition ports

- **FR-EC-019**: Spec 012 MUST expose a framework-independent `resolveExecutionCapsule` application port.
- **FR-EC-020**: Spec 012 MUST expose a `validateExecutionCapsule` port that returns valid, expired, revision mismatch, context mismatch, dynamic refresh required, interpretation required, or blocked outcomes.
- **FR-EC-021**: Spec 012 MUST expose explicit pin and switch operations; callers cannot mutate capsule fields directly.
- **FR-EC-022**: The Spec 011 dispatcher MUST consume these ports rather than duplicate tenant, workspace, resource, connection, or authority resolution.
- **FR-EC-023**: API routes, Custom GPT adapters, agents, and internal workers MUST pass authenticated principal evidence to the same application ports.

### Persistence and privacy

- **FR-EC-024**: Durable storage MAY retain capsule references, hashes, revision vectors, expiry, and bounded selected-target metadata.
- **FR-EC-025**: Raw credentials, access tokens, raw principal assertions, provider payloads, and raw evidence MUST NOT be retained in the capsule or public projections.
- **FR-EC-026**: Tenant and Admin projections MUST use separate allowlists over the same canonical capsule result.

## Functional outcomes

1. Context is resolved once per valid revision vector rather than reconstructed by each route, tool, agent, and workflow step.
2. Broad Admin visibility remains separate from one exact tenant-scoped execution set.
3. A long-running plan can safely retain context identity while refreshing only dynamic mutation evidence.
4. A changed connection, branch SHA, authority grant, or capability readiness state stops execution without silently choosing a replacement.
5. Runtime components can share one context contract without importing SQL table names or provider SDK details into domain/application code.

## Acceptance scenarios

- **AC-EC-001**: Admin and Tenant entry points resolving the same explicitly authorized target produce the same context hash and selected execution set, with different safe projections only.
- **AC-EC-002**: Repeated steps under an unchanged revision vector reuse the capsule and do not repeat full candidate enumeration.
- **AC-EC-003**: Changing an unrelated tenant registry revision does not invalidate a capsule whose dependency vector does not reference that tenant.
- **AC-EC-004**: Revoking the selected authority grant invalidates mutation execution before provider dispatch.
- **AC-EC-005**: Expiring the selected connection blocks execution and does not select another active connection automatically.
- **AC-EC-006**: Changing the plan after approval invalidates approval, idempotency, and lane assignment while preserving audit history.
- **AC-EC-007**: A stale capsule used for a permitted low-risk read cannot expose a resource outside the original visibility and candidate sets.
- **AC-EC-008**: Capsule serialization contains no secret-like key or value and is safe under Tenant and Admin projections.

## Delivery slices

1. **EC0 contract and tests**: immutable capsule schema, revision vector, sanitization, and invalidation unit tests.
2. **EC1 shadow adapter**: build capsules beside current runtime resolution without affecting dispatch.
3. **EC2 selected read pilot**: one Tenant and one Admin read path consume the capsule under parity comparison.
4. **EC3 Spec 011 integration**: unified dispatcher consumes capsule validation ports for read-only operations.
5. **EC4 mutation validation pilot**: one reversible mutation refreshes dynamic evidence while retaining exact context identity.
6. **EC5 rollout and legacy retirement**: remove duplicate resolver code only after coverage, parity, performance, and rollback gates pass.

## Performance gates

- repeated context-resolution stage median improves by at least 40 percent for unchanged revision vectors;
- full candidate enumeration count decreases by at least 60 percent in a representative multi-step plan;
- zero increase in ambiguity suppression, cross-tenant access, connection substitution, or stale authority acceptance;
- invalidation propagation completes before the next governed mutation on the affected context.