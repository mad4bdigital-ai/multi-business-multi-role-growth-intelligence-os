## Capability Assurance Direct Instructions

Before capability dispatch:
1. resolve the canonical capability and active export;
2. classify authority requirement type;
3. resolve a fresh invocation envelope;
4. resolve capability-specific effective resource bindings when the operation targets an external or governed resource;
5. enforce approval, quota, audit, readback, certification, and rollback requirements independently;
6. block dispatch when any hard gate fails;
7. write bounded evidence and read it back before completion.

Do not infer resource authority from HTTP method, Admin exposure, Tenant exposure, maturity score, tool registration, an unrelated resource binding, or a historical envelope.

Use `v_platform_capability_readiness_vector` for independent readiness dimensions and `v_platform_capability_assurance_gaps` for typed remediation. Do not use the legacy overloaded `authority_evidence_missing` label as the sole execution diagnosis.

Use `platform_evidence_events` for generic no-secret evidence, `platform_capability_certifications` for current certification, `platform_capability_debt` for persistent unresolved gaps, and `platform_closure_threads` for closure state.

Capability source claims require resolved provenance in `platform_capability_source_links`. SQL registry rows use `source_kind=mysql_registry`; repo-source rows must be backed by actual repository evidence.

`platform_capability_assurance_reconcile` must remain dry-run unless a fresh ready capability envelope explicitly authorizes apply. Reconciliation may update SQL registries and evidence only; it must not call providers or perform external writes.

Never store or return plaintext secrets in assurance evidence. Secret movement evidence is hash-and-reference only through `platform_secret_movement_ledger`.

## Dynamic Container Authority Direct Instructions

Treat container rows as descriptive authority inputs only until the shadow resolver is separately promoted. Do not infer execution authority from container existence, type, classification, ancestry, sharing, or role-template registration alone.

Before accepting a containment edge, validate both containers, tenant equality, active relationship type, allowed parent/child type pairs, child multi-parent support, traversal limits, and direct/transitive cycle absence. Sharing must remain read-only by default. A write requires a later explicit delegation and the normal capability, approval, quota, audit, and readback chain.

Use deterministic merge strategies declared by the dimension or classification registry. `deny_wins` overrides inherited allow; numeric ceilings use `minimum`; additive catalogs may use `union`; compatibility sets may use `intersection`; equal-precedence replacement conflicts block with `container_path_ambiguous`. Limit exhaustion blocks with `container_resolution_limit_exceeded` and must not return a partial allow.

Migration `319_sprint69_dynamic_container_authority_foundation.sql` must remain additive and no-execution. Do not wire `dynamicContainerAuthority.js` into provider dispatch, credential resolution, token minting, or client construction in the foundation phase.
