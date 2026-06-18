# Dynamic Container Authority

- **Feature:** `001-dynamic-container-authority`
- **Status:** Design freeze candidate
- **Scope:** Domain and contract specification only
- **Runtime effect:** None
- **Provider calls / credential reads / external writes:** Forbidden by this package

## 1. Problem

The platform represents tenant membership, workspaces, brands, activities, workflows, connections, tools, skills, policies, profiles, resource grants, and capability envelopes across separate registries. Those surfaces can each be valid while the complete execution authority chain is incomplete or contradictory.

The platform needs a dynamic container model that can express hierarchical containment, multi-parent inheritance, sharing, delegation, classifications, scoped roles, and resource bindings without making provider adapters responsible for domain authorization.

## 2. Core model

```text
Platform
└── Tenant
    └── Workspace
        └── Brand
            ├── Activity
            └── Workflow
```

This is a default topology, not a fixed enum. Container types and allowed parent/child relationships are registry-defined. A container may have multiple containment parents, so containment is a directed acyclic graph. Sharing, delegation, reference, and management edges remain separate.

## 3. Frozen decisions

1. Container types and classifications are dynamic.
2. Multiple containment parents are allowed; cycles are forbidden.
3. Sharing is independent from containment and read-only by default.
4. A child cannot loosen inherited policy without an exact approved override.
5. Roles support composable templates and direct assignments.
6. Activity and Workflow can both be container types.
7. `platform_owner` receives no implicit bypass.
8. Overrides are explicit, scoped, expiring, hashed, approved, consumed by one matching execution, and audited.
9. Destructive, credential-touching, and deployment-affecting overrides require two distinct approvers.
10. Critical overrides expire after 15 minutes; other overrides after 60 minutes by default.
11. Credentials are never inherited as values; only eligibility or binding references participate.
12. Authorization completes before credential materialization or provider-client creation.
13. Traversal fails closed when graph, path, binding, or time limits are exceeded.
14. Effective-context snapshots are immutable, versioned, no-secret records and are invalidated by contributing authority changes.

## 4. Terminology

- **Container:** Governed scope that can contain, inherit, classify, bind, share, delegate, and receive role assignments.
- **Containment edge:** Parent-to-child edge contributing to ancestry and inheritance.
- **Sharing edge:** Non-containment edge exposing a bounded resource or dimension, read-only by default.
- **Delegation edge:** Non-containment edge granting a bounded operation and requiring explicit write authority.
- **Classification:** Typed value influencing defaults or restrictions without granting authority by itself.
- **Dimension:** Registry-defined resource family such as connections, tools, skills, rules, profiles, workflows, or budgets.
- **Effective context:** Immutable result of resolving paths, classifications, roles, bindings, policies, denies, delegations, and overrides.
- **Authority epoch:** Monotonic tenant-scoped version covering authority-changing registry mutations.

## 5. Functional requirements

### Container topology

- **FR-001:** Register container types without schema enum changes.
- **FR-002:** Each container has stable ID, tenant boundary, type, key, status, version, and canonical subject reference.
- **FR-003:** A container may have zero, one, or multiple active containment parents subject to type compatibility.
- **FR-004:** Reject direct and transitive containment cycles.
- **FR-005:** Maintain queryable bounded ancestry/closure evidence.
- **FR-006:** Keep containment, sharing, delegation, reference, and management semantics distinct.
- **FR-007:** Reject cross-tenant containment.

### Classifications

- **FR-008:** Classification types declare value schema, cardinality, inheritance, merge strategy, affected dimensions, and status.
- **FR-009:** Classification assignments are container-scoped, versioned, and auditable.
- **FR-010:** Classification never independently grants execution authority.
- **FR-011:** Unknown or invalid values fail validation.

### Roles and dimensions

- **FR-012:** Role templates compose named permission sets.
- **FR-013:** Principals may receive explicit assignments at eligible containers.
- **FR-014:** Assignment includes principal, container, template or inline role, validity, issuer, version, and status.
- **FR-015:** Effective permission never exceeds ceilings imposed by all applicable paths and policies.
- **FR-016:** Deny/restrict defeats inherited allow.
- **FR-017:** Unresolvable multi-parent conflicts block with typed ambiguity.
- **FR-018:** Resource dimensions are registry-defined.
- **FR-019:** Each dimension declares merge, inheritance, sharing, delegation, and override behavior.
- **FR-020:** Bindings support `allow`, `deny`, `restrict`, `require`, `share`, and `delegate`.
- **FR-021:** Write delegation names exact operations or capabilities.
- **FR-022:** Connection bindings expose identity/eligibility, never credential payloads.
- **FR-023:** Credentials materialize only after exact action and endpoint authorization.

### Resolution

- **FR-024:** Evaluate every active containment path within configured limits.
- **FR-025:** Security and policy dimensions use `deny_wins`.
- **FR-026:** Additive catalogs may union, but execution still requires a grant.
- **FR-027:** Numeric ceilings use the most restrictive value.
- **FR-028:** Replacement values use nearest ancestor then explicit priority; equal-precedence conflicts block.
- **FR-029:** Results include contributing paths and source bindings.
- **FR-030:** Resolution binds to one authority epoch and registry snapshot.
- **FR-031:** Limit exhaustion returns a typed blocking error, never a partial allow.

### Sharing, delegation, and overrides

- **FR-032:** Sharing grants read-only visibility unless a dimension is narrower.
- **FR-033:** Sharing does not imply containment, role inheritance, credential ownership, or write permission.
- **FR-034:** Writes require exact delegation or local binding.
- **FR-035:** Revocation invalidates dependent future snapshots.
- **FR-036:** Delegation cannot exceed the delegator's effective authority.
- **FR-037:** `platform_owner` undergoes normal resolution first.
- **FR-038:** Override binds principal, target, path hash, snapshot, dimension, resource, operation, risk, reason, and original decision.
- **FR-039:** Critical TTL is 15 minutes; other TTL is 60 minutes by default.
- **FR-040:** Destructive, credential, and deployment classes require two distinct approvers.
- **FR-041:** Policy may prohibit self-approval; one principal cannot satisfy both slots.
- **FR-042:** Wildcard resource or operation override is forbidden.
- **FR-043:** Authority change invalidates unused overrides through epoch/hash mismatch.
- **FR-044:** Every override use links to one execution and same-cycle readback.
- **FR-045:** Override consumption is atomic and idempotent.

### Runtime and audit

- **FR-046:** Preview/shadow reads only non-secret registry metadata.
- **FR-047:** Preview never decrypts credentials, mints tokens, creates authenticated clients, calls providers, or writes externally.
- **FR-048:** Live execution references an immutable effective-context snapshot/hash.
- **FR-049:** Audit includes paths, classifications, roles, bindings, denies, delegations, override, action, endpoint, binding reference, and result.
- **FR-050:** Audit never contains raw credentials, tokens, or secret values.
- **FR-051:** Platform Graph is a projection, not canonical mutation authority.
- **FR-052:** Decisions are reconstructable from row versions, path evidence, strategy versions, and request context.

## 6. Non-functional requirements

- **NFR-001:** Schema changes are additive and reversible by disabling consumers.
- **NFR-002:** Shadow resolution does not change current dispatch.
- **NFR-003:** Same versioned input and registry state produce the same decision/hash.
- **NFR-004:** Errors are structured and stable.
- **NFR-005:** Traversal is bounded, indexed, and protected against path explosion.
- **NFR-006:** No dependency is added without separate justification.
- **NFR-007:** Existing clients remain compatible until explicit cutover.
- **NFR-008:** Initial safety profile proposes depth 16, paths 256, visited containers 2,048, traversed relationships 4,096, and candidate bindings 5,000; benchmarks may lower them before enforcement.
- **NFR-009:** Cache keys include tenant, principal, target, normalized requests, authority epoch, and resolver version.
- **NFR-010:** Revocation and deny invalidation are event-driven with bounded TTL fallback; stale cache never grants authority.

## 7. Required errors

```text
container_not_found
container_type_not_registered
container_relationship_not_allowed
container_cycle_detected
container_cross_tenant_boundary
container_path_ambiguous
container_resolution_limit_exceeded
container_authority_epoch_changed
classification_invalid
classification_conflict
role_assignment_missing
role_permission_insufficient
resource_binding_missing
resource_binding_conflict
inherited_policy_restriction
sharing_write_not_delegated
delegation_exceeds_delegator_authority
connection_not_bound_to_effective_context
business_activity_context_required
brand_core_not_ready
effective_context_blocked
override_required
override_second_approver_required
override_scope_mismatch
override_snapshot_stale
override_expired
override_already_consumed
```

## 8. Success criteria

1. Multi-parent targets resolve deterministically or block with explicit conflict evidence.
2. Broad allow cannot override a narrower restriction.
3. Shared connections are unusable for writes without delegation and grant.
4. `platform_owner` has no bypass without matching approval.
5. Critical override cannot become ready with one approver.
6. Preview resolves without credentials or provider calls.
7. Enforced execution is reconstructable from immutable evidence.
8. Limit exhaustion, epoch drift, revocation, and replay fail closed.

See `resolution-algorithm.md` and `threat-model.md`.
