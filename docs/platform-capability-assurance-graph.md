# Platform Capability Assurance Graph

## Status

Sprint 69 canonical assurance foundation. SQL remains the runtime authority. This layer is additive and preserves the existing capability compatibility views while introducing canonical registries and normalized evidence.

## Runtime chain

```text
Capability → Envelope → Evidence → Authority → Dispatch → Readback → Certification
```

A capability definition declares what authority is required. A capability invocation envelope records whether that authority was satisfied for one actor, tenant, workspace, resource, operation, policy version, and time window. Static capability maturity must not be treated as a live authorization decision.

## Evidence classes

The generic evidence ledger separates:

- exposure evidence: whether a capability may be shown on an admin, tenant, or internal surface;
- invocation authority evidence: actor, tenant, role, policy, and scope checks;
- resource authority evidence: an explicit capability-envelope-to-resource-binding link, permission, mode, and expiry;
- execution evidence: provider-call metadata, mutation status, readback, audit, and rollback references.

Evidence rows are immutable observations with freshness, revocation, supersession, payload hashes, and `secrets_included=false`. Raw credential values are forbidden.

## Canonical registries

The foundation adds:

- `platform_plugins`
- `platform_plugin_capabilities`
- `platform_plugin_bindings`
- `platform_plugin_capability_exports`
- `platform_capability_source_links`
- `platform_evidence_events`
- `platform_capability_certifications`
- `platform_capability_debt`
- `platform_closure_threads`
- `platform_secret_movement_ledger`

Compatibility views remain available during cutover. Migration 314 backfills the canonical graph from current live registries without deleting or rewriting legacy authority rows.

## Virtual governed tools

Migrations `20260717_virtual_tool_capability_projection.sql` and `20260717_virtual_tool_readback_readiness.sql` project active `platform_tool_dispatch_bindings` into the canonical assurance graph. Tool names and aliases are provenance and export descriptors only; they never create authority.

The projection resolves one canonical capability identity, operation class, risk class, and exposure scope per virtual tool. Missing or conflicting identity, scope, operation semantics, readback policy, or source ownership becomes persistent typed debt and fails closed. Virtual Admin and Admin CLI surfaces cannot be projected to Tenant scope.

State-changing virtual capabilities require resource authority, audit evidence, and an explicit readback contract. Shadow readback readiness is separate from generic certification, and every projected capability remains `apply_allowed=0` until certification plus shadow/canary evidence authorize promotion.

Bounded mutation atomicity modes must classify consistently before aliases are aggregated into a canonical capability. `single_file_mutation`, `atomic_change_set`, `compound_mutation`, and `transactional_guarded` are state-changing. Unclassified or conflicting mutation semantics remain fail-closed debt. Tool-catalog tags accept arrays, JSON-array strings, and legacy CSV only after deterministic normalization.

Capability-export aliases derived from virtual-tool bindings remain `shadow` until the canonical capability is certified and explicitly promoted. Runtime Admin tool catalogs and dispatch bindings are separate authorities and remain unchanged. Projection preview must report no active Admin capability export while the canonical manifest is blocked, and Tenant exports must remain absent.

`platformVirtualToolCapabilityReconciler.js` maintains the projection, source links, shadow readback contracts, and debt inside the existing capability-assurance transaction. It performs no provider call, credential payload read, external write, or secret return.

## Readiness vector

`v_platform_capability_readiness_vector` reports independent dimensions instead of a single misleading score:

- discoverable and registered;
- exported and routable;
- authority model ready;
- resource binding ready;
- dispatchable and applyable;
- readback contract ready;
- certified;
- provenance ready;
- evidence linked.

Hard execution gates are independent of soft maturity. A high maturity score never overrides a failed resource, approval, credential, quota, or readback gate. A resource binding satisfies a capability only through a capability-specific envelope/binding link or explicit legacy authority evidence; the existence of an unrelated binding is never sufficient.

## Typed gaps

`v_platform_capability_assurance_gaps` replaces the overloaded static `authority_evidence_missing` interpretation with typed actionable gaps:

- `dispatch_not_allowed`
- `resource_binding_missing`
- `active_export_missing`
- `readback_evidence_missing`
- `certification_missing`
- `provenance_missing`

Admin and tenant tools use invocation-scoped authorization. They do not require a permanent external-resource binding merely because their HTTP method is POST.

## Source provenance

`platform_capability_source_links` is the canonical source-resolution surface for live capabilities. SQL registry rows use `source_kind=mysql_registry`; repo and uploaded candidates keep their specialized source tables. The platform must not misclassify SQL registry projections as GitHub repositories merely to populate a legacy counter.

## Reconciliation

`platform_capability_assurance_reconcile` is dry-run by default. Apply mode requires a fresh `ready_for_dispatch` capability envelope. It performs only SQL registry/evidence/certification/debt upserts, performs no provider calls, performs no external writes, and returns no secrets. Gaps no longer present in the typed assurance view are resolved rather than left permanently open.

## Secret movement

`platform_secret_movement_ledger` stores metadata and hashes only. It records source reference, target reference, target field, value SHA-256, policy, actor, reason, and readback hash. It must never store or return plaintext secrets.

## Cutover policy

1. Keep legacy compatibility views active.
2. Reconcile canonical registries and source provenance.
3. Populate normalized evidence and certifications.
4. Resolve or accept persistent debt rows.
5. Certify readback and recovery paths.
6. Promote canonical registries to primary authority only after parity evidence passes.
