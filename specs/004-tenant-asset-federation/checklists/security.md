# Security Checklist

## Identity and isolation

- [x] Signed principal is the tenant/user authority.
- [x] Client-supplied tenant override is forbidden.
- [x] Every tenant-owned profile, variant, proposal, experiment, and connection binding carries tenant scope.
- [x] Cross-tenant asset-variant, profile, connection, or experiment references are rejected.
- [x] Support/admin actions receive no implicit tenant bypass.

## Policy and authority

- [x] Preferences cannot grant authority.
- [x] Union cannot bypass denies or mandatory requirements.
- [x] Intersection fails closed on missing required layers.
- [x] Mandatory policy fields are non-modifiable.
- [x] Risk takes the strongest value and ceilings take the most restrictive value.
- [x] Equal-ranked non-mergeable conflicts block.
- [x] Delegation cannot exceed delegator authority.
- [x] Wildcard write delegation is forbidden.
- [x] Existing grants and policies remain authoritative until certified cutover.

## Variants

- [x] Variants are explicit and sparse.
- [x] Patch paths are allowlisted and schema validated.
- [x] Authority, credential, audit, approval, and certification fields cannot be patched.
- [x] Stale/revoked base versions can block variants.
- [x] Variant conflicts never silently overwrite.
- [x] Variant publish and upgrade mutations are versioned, idempotent, and read back.

## Credentials and providers

- [x] Raw credentials are forbidden in assets, profiles, variants, proposals, experiments, manifests, logs, and responses.
- [x] Secret-like keys are rejected at boundaries.
- [x] Authorization resolves before credential materialization or provider client creation.
- [x] Catalog, preview, simulation, and shadow perform no provider writes.
- [x] Connection selection is exact, tenant-scoped, and ambiguity-blocking.
- [x] Revocation invalidates future manifests and canaries.

## Adaptive growth

- [x] Signals are evidence, not authority.
- [x] Every proposal has scope, objective, evidence, risk, expiry, rollback, and guardrails.
- [x] Class E changes cannot self-approve.
- [x] Experiments have immutable cohorts and baselines.
- [x] Safety regression triggers rollback.
- [x] Cross-tenant/platform promotion requires privacy review and separate release governance.
- [x] Dark patterns, approval avoidance, and risk under-reporting are forbidden.

## Runtime integrity

- [x] Effective manifests bind authority epoch, profile versions, base/variant checksums, and resolver version.
- [x] Epoch/version drift invalidates stale decisions.
- [x] Graph traversal and candidate counts are bounded.
- [x] Cache invalidation is event-driven with bounded TTL fallback.
- [x] No partial allow is returned after limit exhaustion or dependency failure.
- [x] Same-cycle readback is required for state-changing operations.

## API and implementation

- [x] All external input is validated.
- [x] Object-level authorization is required on every tenant resource.
- [x] Stable structured errors do not expose internals or secrets.
- [x] Cursor pagination and bounded limits protect high-cardinality surfaces.
- [x] Domain policy algebra is independent from transport and provider adapters.
- [ ] Threat model reviewed before implementation.
- [ ] Abuse-case tests and security review completed.
- [ ] Migration and rollback security review completed.
