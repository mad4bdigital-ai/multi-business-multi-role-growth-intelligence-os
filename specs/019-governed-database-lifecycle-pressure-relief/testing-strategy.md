# Testing Strategy — Spec 019 Governed Database Lifecycle and Pressure Relief

## Contract Tests

The contract guard verifies that the Spec Kit names the required phases, domains, error taxonomy, safety prohibitions, and delivery decomposition. It also verifies that no public contract accepts raw SQL, arbitrary table names, arbitrary predicates, or wildcard authority.

## Unit Matrix

Policy eligibility, immutable cutoff handling, supersession ordering, tie-breaks, fingerprint canonicalization, batch limits, authority resolution, typed approval binding, error mapping, logical/physical result separation, and unknown-outcome state transitions.

## Integration Matrix

Plan-to-approval-to-execution-to-receipt-to-readback; missing authority; missing approval; stale fingerprint; cutoff mismatch; row changed after plan; newer row appearing; partial batch failure; disconnect after dispatch; reconciliation and safe retry.

## Domain Assertions

Response chunks: expired rows may be eligible, non-expired and post-plan rows are untouched, and no automatic compaction occurs. Repo audit: latest file observation survives, terminal parent survives, and non-terminal runs remain untouched. Engine runs: no mutation occurs while retention policy is missing.

## Security and Performance

Tests must cover injection, object scope, replay, path traversal, secret exposure, least privilege, lock duration, batch duration, concurrent writers, and bounded query behavior. Production access is never required for the contract-only PR.
