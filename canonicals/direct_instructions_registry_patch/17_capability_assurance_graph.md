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
