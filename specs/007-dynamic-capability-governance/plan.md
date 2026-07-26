# Implementation Plan: Dynamic Capability Governance and Universal Tool Projection

## Summary

Implement a registry-driven compiler and shared enforcement kernel over the existing Capability Assurance Graph and semantic capability foundations. The design uses additive storage, shadow parity, cohort rollout, and compatibility wrappers. The specification PR changes no runtime behavior.

## Reuse before new construction

The implementation MUST reuse:

- `platform_plugin_capabilities` and capability source links for canonical capability identity.
- `platform_semantic_capabilities` as a compatibility semantic source mapped to canonical identity.
- `platform_capability_provider_bindings`, `platform_tool_dispatch_bindings`, app bindings, and endpoint exports as binding inputs.
- `execution_policies` as transitional runtime policy authority and target policy registries as the future representation.
- capability envelopes, authority bindings, certifications, evidence events, debt, and closure threads.
- Admin/Tenant tool tables as projection targets only.

New storage is allowed only for compiled profiles/manifests, projection policy, readback contracts, and compilation evidence not already represented by existing canonical tables.

## Architecture impact

- **API:** Add bounded Admin compile/gap/reconcile APIs and Tenant effective capability list/preview APIs. Future execute facade remains feature-flagged and cohort-gated.
- **Application:** Add use cases for inventory collection, manifest compilation, projection reconciliation, decision preview, envelope creation, dispatch reservation, readback verification, and debt reconciliation.
- **Domain:** Add immutable capability manifest, effect/risk classification, requirement set, projection eligibility, adapter eligibility, readback contract, and stable reason codes.
- **Infrastructure:** Add SQL repositories, registry source adapters, provider adapter ports, certification/readback repositories, and outbox/evidence writers.
- **Database:** Additive manifest/profile/readback/projection-policy storage and views only after live census and naming review.
- **OpenAPI:** Add OpenAPI 3.1 contracts with strict schemas, pagination, stable errors, and separate Admin/Tenant security boundaries.
- **Canonicals:** Update capability assurance, semantic resolution, resource coverage, prompt routing, module loading, and knowledge guide only in implementation PRs that change behavior.

## Component sequence

1. Inventory collectors read current registries without mutation.
2. Normalizer converts source rows into canonical surface descriptors.
3. Identity resolver maps aliases to one canonical capability.
4. Classifier derives effect, risk, resource, and exposure.
5. Requirement compiler derives all mandatory gates.
6. Manifest writer persists version/hash and typed gaps.
7. Projection compiler derives Admin and Tenant candidates.
8. Shared enforcement kernel evaluates one invocation.
9. Adapter resolver selects a certified implementation.
10. Dispatch coordinator reserves idempotency and records evidence.
11. Readback verifier validates observed state.
12. Reconciler updates debt, drift, and operational alerts.

## Architecture boundaries

```text
routes/controllers
  -> application use cases
    -> deterministic domain services
      <- repository/adapter ports
        <- SQL and provider infrastructure
```

Controllers validate and map input only. Domain code has no SQL, HTTP, provider SDK, framework request, environment, or secret dependency. Provider adapters cannot authorize.

## Proposed logical resources

- `capability_governance_manifest`
- `capability_assurance_gap`
- `capability_projection`
- `capability_readback_contract`
- `capability_certification`
- `capability_invocation_decision`

Each resource receives descriptors for list, get, search, permissions, changes, revisions, and readback or explicit governed not-applicable states.

## Safety and rollout

- **Authorization:** Signed principal, membership, resource authority, and effective grants are mandatory.
- **Tenant isolation:** Tenant identity is server-derived; cross-tenant joins and caller overrides are blocked.
- **Secret redaction:** Hash/reference only; adapters resolve credentials server-side after authorization.
- **Concurrency:** Manifest revision, request hash, envelope version, and idempotency reservations use optimistic concurrency.
- **Lifecycle:** Disable/revoke/archive instead of hard delete. Evidence remains append-only.
- **Migrations:** Additive, guarded, authorized, and ledger-verified.
- **Rollback:** Per-capability/cohort feature flags and compatibility wrappers; no evidence deletion.
- **Observability:** Compilation gaps, shadow mismatches, projection drift, stale certification, dispatch denial, and readback mismatch metrics.

## Delivery phases

### Phase A — Inventory and compiler shadow

Read-only discovery, canonical mapping, effect/risk classification, requirement compilation, manifest hashes, and gap reports. No execution authority changes.

### Phase B — Projection shadow

Derive Admin/Tenant projection candidates and compare with current catalogs. Do not create callable exports automatically.

### Phase C — Enforcement shadow

Evaluate the shared decision alongside legacy preflights. Legacy remains execution authority except existing containment denials.

### Phase D — Generic certification and readback

Introduce versioned adapter/readback contracts and reconcile specialized certification sources into the generic graph.

### Phase E — Bounded cohorts

Migrate internal read-only, internal writes, provider reads, WordPress draft, and external writes in separate PRs and cohorts.

### Phase F — Closeout

Record migration, production parity, post-merge audit, residual debt, and deprecation plan.

## Validation

- **Unit tests:** classifier precedence, requirement derivation, reason codes, manifest hashing, projection rules.
- **Integration tests:** registry collection, authority/grant/connection/certification gates, compatibility wrappers, debt transitions.
- **Security tests:** tenant isolation, alias ambiguity, selector conflict, replay, stale state, secret redaction.
- **Contract tests:** OpenAPI 3.1, structured errors, generated schemas, bounded pagination.
- **Migration tests:** additive rerun, information-schema guards, backfill checkpoints, readback.
- **Parity tests:** legacy/adaptive decisions and projection comparison.
- **Performance tests:** compiler batch size, preview p95/p99, cache invalidation and revision refresh.
- **CI:** explicit test manifest, architecture drift, resource coverage, spec completion gate, generated canonical parity.
- **Release readiness:** typed gap count, no unsafe export, current certifications, migration ledger, runtime/deployment parity.
