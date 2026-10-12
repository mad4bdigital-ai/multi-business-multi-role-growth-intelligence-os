# Tasks and closure map — Feature 022

## Implemented in this candidate
- [x] Define provider-neutral Registry and bounded capability descriptors.
- [x] Create content-addressed Plan with exact resource+tenant+environment+source binding.
- [x] Implement Staging-only source engine with verified approval, atomic claim, durable intent and fence guard.
- [x] Implement UNKNOWN → independent reconciliation without automatic re-dispatch.
- [x] Mount authenticated admin-only GET capability discovery with no mutating route.
- [x] Add negative/synthetic tests for duplicate attempt, approval mismatch, stale source, forged readback and fail-closed paths.
- [x] Update E2E source scope and test authority registry.

## Blocked pending independent native evidence
- [ ] Native MariaDB durable store schema and transaction/CAS proof (includes unknown COMMIT ACK).
- [ ] Fencing across two processes / machines, failover and clock skew.
- [ ] Bind the server-managed Recovery Composition adapter authority; no request-controlled adapters.
- [ ] Implement signed/single-use issuer for consent, exact resource plans and revocation.
- [ ] Hostinger Account/Agency capability discovery and independent account-site-user grants readback (#8473).
- [ ] Runtime database and catalog repair proof (#8474).
- [ ] Windows nonce persistence and TPM attestation (#8477).
- [ ] Executable coverage and native cert for 60+8 cases (#8478).
- [ ] Compensating actions with immutable evidence; implement safe partial rollback per provider.
- [ ] Production Rulesets, exact-head owner acceptance, full 1,338-commit release cut analysis and native rollout rollback.
- [ ] Guided Admin UI with complete actor journey and accessible diagnostics.

## Release rule
P0 source completeness != Staging readiness != Production approval. Keep Draft until GitHub governance, regression tests and independent review pass. Never lift Production mutation prohibition by changing a boolean in code or a synthetic fixture.
