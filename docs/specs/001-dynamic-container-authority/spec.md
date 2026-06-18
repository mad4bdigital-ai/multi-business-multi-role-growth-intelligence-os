# Dynamic Container Authority

- **Feature:** `001-dynamic-container-authority`
- **Status:** Design freeze candidate
- **Scope:** Domain and contract specification only
- **Runtime effect:** None
- **Provider calls / credential reads / external writes:** Forbidden by this package

## 1. Problem

The platform currently represents tenant membership, workspaces, brands, activities, workflows, connections, tools, skills, policies, profiles, resource grants, and capability envelopes across separate registries. Those surfaces can each be valid while the complete execution authority chain is incomplete or contradictory.

The platform needs a dynamic container model that can express hierarchical containment, multi-parent inheritance, sharing, delegation, classifications, scoped roles, and resource bindings without making provider adapters responsible for domain authorization.

## 2. Core model

The default path is:

```text
Platform
└── Tenant
    └── Workspace
        └── Brand
            ├── Activity
            └── Workflow
```

This is a default topology, not a fixed enum. Container types and their allowed parent/child relationships are registry-defined.

A container may have **multiple containment parents**. The containment graph is therefore a directed acyclic graph, not a tree. Sharing, delegation, references, and management relationships are separate edges and do not become containment implicitly.

## 3. Frozen decisions

1. Container types are dynamic.
2. Container classifications are dynamic and can influence resolution behavior without granting authority by themselves.
3. Multiple containment parents are allowed.
4. Cycles are forbidden across containment edges.
5. Sharing edges are independent from containment.
6. A child cannot loosen an inherited policy unless a valid override envelope explicitly authorizes the exact relaxation.
7. Roles support both composable role templates and explicit assignments to a principal at a container.
8. Activity and Workflow can both be container types.
9. `platform_owner` receives no implicit cross-container bypass.
10. `platform_owner` override must be explicit, scoped, expiring, hashed, approved, used by a matching execution, and audited.
11. Destructive, credential-touching, and deployment-affecting overrides require a second distinct approver.
12. Critical overrides expire after 15 minutes by default. Other overrides expire after 60 minutes by default.
13. Sharing is read-only by default. Write authority requires a separate explicit delegation.
14. Credentials are never inherited as values. Only connection eligibility or binding references may participate in resolution.
15. Authorization and context resolution must complete before credential materialization or provider-client creation.
16. Traversal must fail closed when configured graph, path, binding, or time limits are exceeded.
17. Effective-context snapshots are immutable, versioned, no-secret records and are invalidated by any contributing authority change.

## 4. Terminology

- **Container:** A governed scope that can contain, inherit, classify, bind, share, delegate, and receive role assignments.
- **Containment edge:** A parent-to-child edge contributing to inheritance and scope ancestry.
- **Sharing edge:** A non-containment edge that exposes a bounded resource or dimension, read-only by default.
- **Delegation edge:** A non-containment edge that grants a bounded operation or permission and must be explicit for writes.
- **Classification:** A typed value that gives a container operational character, such as maturity, risk posture, locale, or operating model.
- **Dimension:** A resource family resolved across containers, such as connections, tools, skills, rules, profiles, workflows, or budgets.
- **Effective context:** The immutable result of resolving all applicable paths, classifications, roles, bindings, policies, denies, delegations, and overrides.
- **Override:** A short-lived governed exception to a blocked or restricted decision.
- **Authority epoch:** A monotonically changing version or snapshot token covering all registry rows that contributed to a decision.

## 5. Functional requirements

### Container topology

- **FR-001:** The system must register container types without schema enum changes.
- **FR-002:** Each container must have a stable ID, tenant boundary, type, key, lifecycle status, and canonical subject reference.
- **FR-003:** A container may have zero, one, or multiple active containment parents, subject to type compatibility.
- **FR-004:** The system must reject direct and transitive containment cycles.
- **FR-005:** The system must maintain a queryable transitive closure or equivalent bounded ancestry projection.
- **FR-006:** Containment, sharing, delegation, reference, and management relationships must remain semantically distinct.
- **FR-007:** Cross-tenant containment must be rejected. Cross-tenant sharing requires an explicit future policy and is out of scope for the first implementation.

### Classifications

- **FR-008:** Classification types must declare value schema, cardinality, inheritance behavior, merge strategy, affected dimensions, and lifecycle status.
- **FR-009:** Classification assignment must be scoped to one container and auditable.
- **FR-010:** A classification may influence defaults and resolution but must not independently grant execution authority.
- **FR-011:** Unknown or invalid classification values must fail validation rather than be silently ignored.

### Roles and permissions

- **FR-012:** Role templates must be composable from named permission sets.
- **FR-013:** Principals may receive explicit role assignments at any eligible container.
- **FR-014:** A role assignment must include principal, container, template or inline role, validity period, issuer, and status.
- **FR-015:** Effective permission must never exceed the ceilings imposed by all applicable containment paths and policies.
- **FR-016:** A more specific deny or restriction must defeat an inherited allow.
- **FR-017:** Multiple-parent conflicts that cannot be deterministically merged must block with a typed ambiguity error.

### Resource dimensions

- **FR-018:** Resource dimensions must be registry-defined.
- **FR-019:** Each dimension must declare its merge strategy and whether containment inheritance, sharing, delegation, and local override are supported.
- **FR-020:** Resource bindings must support `allow`, `deny`, `restrict`, `require`, `share`, and `delegate` effects.
- **FR-021:** Write delegation must identify the exact operations or capability keys authorized.
- **FR-022:** Connection bindings may expose connection identity and eligibility but must not expose credential payloads.
- **FR-023:** Provider credentials may be materialized only after an effective-context decision allows the exact action and endpoint.

### Multi-parent resolution

- **FR-024:** Effective resolution must evaluate every active containment path from the target container to its eligible roots within configured limits.
- **FR-025:** Security and policy dimensions use `deny_wins` across paths.
- **FR-026:** Additive catalogs may use union, but execution still requires an applicable grant.
- **FR-027:** Numeric ceilings such as budget and quota use the most restrictive applicable ceiling.
- **FR-028:** Replacement values use nearest-ancestor precedence; an equal-distance conflict without explicit priority must block.
- **FR-029:** Resolution results must include the contributing paths and source bindings.
- **FR-030:** Resolution must bind to one registry snapshot or authority epoch and must not combine rows from incompatible versions.
- **FR-031:** Traversal-limit exhaustion must return a typed blocking error rather than a partial allow.

### Sharing and delegation

- **FR-032:** Sharing grants read-only visibility unless the dimension explicitly defines a narrower read mode.
- **FR-033:** Sharing must not imply containment, role inheritance, credential ownership, or write permission.
- **FR-034:** Write authority requires a delegation edge or local binding with exact operation scope.
- **FR-035:** Revoking a share or delegation must invalidate future effective-context snapshots that depend on it.
- **FR-036:** Delegation must not exceed the delegator's own effective authority ceiling.

### Overrides

- **FR-037:** `platform_owner` must first undergo normal resolution and receive the original allow, restrict, or deny decision.
- **FR-038:** An override request must bind principal, target container, full container-path hash, dimension, resource, operation, risk, reason, and original decision.
- **FR-039:** Critical overrides default to a 15-minute TTL; non-critical overrides default to 60 minutes.
- **FR-040:** Destructive, credential-touching, and deployment-affecting overrides require two distinct approving principals.
- **FR-041:** An approver cannot satisfy both approval slots or approve their own request where policy forbids self-approval.
- **FR-042:** An override cannot use wildcard resource or operation scope.
- **FR-043:** A change to role, classification, relationship, policy, or resource binding that affected the decision must invalidate an unused override through snapshot/hash mismatch.
- **FR-044:** Every override use must be linked to one execution trace and same-cycle readback.
- **FR-045:** Override consumption must be atomic and idempotent so a one-time override cannot authorize two executions.

### Runtime and audit

- **FR-046:** Preview and shadow resolution may read only non-secret registry metadata.
- **FR-047:** Preview must not decrypt credentials, mint or refresh tokens, create authenticated provider clients, call providers, or perform external writes.
- **FR-048:** Every live execution must reference an effective-context snapshot or equivalent immutable decision hash.
- **FR-049:** Audit evidence must include tenant, all selected container paths, effective classifications, roles, bindings, denies, delegations, override IDs, action, endpoint, credential binding reference, and result.
- **FR-050:** Audit evidence must never include raw credentials, tokens, or secret values.
- **FR-051:** Platform Graph may project effective authority evidence but must not be the canonical mutation authority.
- **FR-052:** A decision must be reconstructable from persisted row versions, path evidence, merge-strategy versions, and request context.

## 6. Non-functional requirements

- **NFR-001:** Initial schema changes are additive and reversible by disabling new consumers.
- **NFR-002:** Shadow resolution must not change current dispatch decisions.
- **NFR-003:** Resolution must be deterministic for the same versioned input and registry state.
- **NFR-004:** The resolver must return structured, stable, machine-readable errors.
- **NFR-005:** Multi-parent traversal must be bounded, indexed, and protected against path explosion.
- **NFR-006:** No new dependency is required unless separately justified.
- **NFR-007:** Existing clients remain compatible until an explicit canary or active cutover.
- **NFR-008:** The initial safety profile proposes maximum depth 16, maximum 256 containment paths, maximum 2,048 visited containers, maximum 4,096 traversed relationships, and maximum 5,000 candidate bindings per request; benchmark review may lower these limits before enforcement.
- **NFR-009:** Resolver caches must be keyed by tenant, target container, principal, requested dimensions/operations, authority epoch, and resolver-version hash.
- **NFR-010:** Cache invalidation must be event-driven where possible and TTL-bounded as a fallback; stale cache entries must never grant authority after a deny, revocation, or expiry.

## 7. Required error taxonomy

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

1. A target container with multiple parents resolves deterministically or blocks with explicit conflict evidence.
2. A workspace-level allow cannot override a brand- or activity-level restriction.
3. A shared connection is visible but unusable for writes without explicit delegation and action grant.
4. A `platform_owner` receives no bypass without a matching approved override.
5. A destructive override cannot become ready with only one approver.
6. Preview resolves full context without credential payload reads or provider calls.
7. Every enforced execution can be reconstructed from immutable audit evidence.
8. Resolver-limit exhaustion, authority-version drift, revocation, and stale override reuse all fail closed.

See `resolution-algorithm.md` for deterministic evaluation and `threat-model.md` for abuse cases and mitigations.
