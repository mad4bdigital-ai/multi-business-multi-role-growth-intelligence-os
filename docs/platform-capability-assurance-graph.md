# Platform Capability Assurance Graph

## Status

Sprint 69 canonical assurance foundation. SQL remains the runtime authority. This layer is additive and preserves the existing capability compatibility views while introducing canonical registries and normalized evidence.

## Runtime chain

```text
Capability → Envelope → Evidence → Authority → Dispatch → Readback → Certification
```

A capability definition declares what authority is required. A capability invocation envelope records whether that authority was satisfied for one actor, tenant, workspace, resource, operation, policy version, and time window. Static capability maturity must not be treated as a live authorization decision.

## Evidence classes

The generic evidence ledger separates exposure evidence, invocation authority evidence, resource authority evidence, and execution/readback evidence. Evidence rows are immutable observations with freshness, revocation, supersession, payload hashes, and `secrets_included=false`. Raw credential values are forbidden.

## Canonical registries

The foundation adds `platform_plugins`, `platform_plugin_capabilities`, `platform_plugin_bindings`, `platform_plugin_capability_exports`, `platform_capability_source_links`, `platform_evidence_events`, `platform_capability_certifications`, `platform_capability_debt`, `platform_closure_threads`, and `platform_secret_movement_ledger`.

Compatibility views remain available during cutover. Migration 313 backfills the canonical graph from current live registries without deleting or rewriting legacy authority rows.

## Readiness vector

`v_platform_capability_readiness_vector` reports independent dimensions instead of one misleading score: discovery, registration, export, routing, authority-model readiness, resource-binding readiness, dispatch, apply, readback, certification, provenance, and evidence linkage. Hard gates remain independent of soft maturity.

## Typed gaps

`v_platform_capability_assurance_gaps` replaces overloaded static authority gaps with `dispatch_not_allowed`, `resource_binding_missing`, `active_export_missing`, `readback_evidence_missing`, `certification_missing`, and `provenance_missing`. Admin and tenant tools use invocation-scoped authorization and do not require a permanent external-resource binding merely because their HTTP method is POST.

## Reconciliation

`platform_capability_assurance_reconcile` is dry-run by default. Apply mode requires a fresh `ready_for_dispatch` capability envelope. It performs SQL registry/evidence/debt upserts only, performs no provider calls or external writes, and returns no secrets.

## Secret movement

`platform_secret_movement_ledger` stores metadata and hashes only. It records source reference, target reference, field, SHA-256, policy, actor, reason, and readback hash. It must never store or return plaintext secret material.

## Cutover policy

1. Keep legacy compatibility views active.
2. Reconcile canonical registries and source provenance.
3. Populate normalized evidence and certifications.
4. Resolve or accept persistent debt rows.
5. Certify readback and recovery paths.
6. Promote canonical registries only after parity evidence passes.
