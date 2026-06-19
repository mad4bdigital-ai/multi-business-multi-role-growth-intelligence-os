# Requirements Quality Checklist

## Completeness

- [ ] Every identified security axis is represented in the specification.
- [ ] Every P0 issue maps to at least one functional requirement.
- [ ] Every functional requirement maps to an acceptance test.
- [ ] Actors and authorization boundaries are explicit.
- [ ] State-changing and read-only operations are distinguishable.
- [ ] Activation and readiness terms are defined separately.
- [ ] Out-of-scope items are documented.

## Clarity

- [ ] Requirements use MUST/SHOULD consistently.
- [ ] `dispatch_ready`, `will_execute`, and `execution_occurred` are distinct.
- [ ] `no_credentials_required` is not used as an authorization result.
- [ ] `not_evaluated` is distinguishable from `not_applicable`.
- [ ] Tenant/admin/device/system surfaces are defined.
- [ ] Canonical capability identity is unambiguous.

## Testability

- [ ] Every denial behavior has a stable reason code.
- [ ] Cross-tenant cases are testable without exposing foreign objects.
- [ ] Preview tests prove absence of side effects.
- [ ] Device stale/offline/foreign cases are covered.
- [ ] Credential pending/revoked/scope mismatch cases are covered.
- [ ] Approval expiry/replay/target mismatch cases are covered.
- [ ] Alias parity is testable across the complete inventory.

## No implementation leakage

- [ ] Product/security requirements do not depend on a specific framework.
- [ ] Unknown repository facts are marked for live resolution.
- [ ] Performance targets are measurable and will be ratified from baseline.
