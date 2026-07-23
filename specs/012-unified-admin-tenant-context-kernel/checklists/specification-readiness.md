# Specification Readiness Checklist

## Specification coverage

- [x] The problem statement and goals define one shared Admin and Tenant context kernel.
- [x] The authenticated principal and effective subject are modeled separately.
- [x] Tenant, workspace, optional brand, resource, exact connection, authority, capability, planning, approval, dispatch, and readback stages are specified.
- [x] Visibility, candidate, and execution sets are separated.
- [x] Ambiguous high-risk requests fail closed.
- [x] Context switching invalidates dependent plans, approvals, and execution envelopes.
- [x] Cross-tenant isolation and customer-safe projection requirements are documented.
- [x] Production hardcoding of tenant, user, workspace, brand, connection, and provider-account identifiers is prohibited.
- [x] Threat model, testing strategy, rollout, rollback, traceability, acceptance scenarios, and OpenAPI 3.1 draft are included.

## Implementation and validation work

- [ ] Implement the shared domain and application kernel.
- [ ] Add registry-backed infrastructure adapters.
- [ ] Validate the OpenAPI 3.1 document.
- [ ] Add and run the hardcoded-customer-identifier scanner.
- [ ] Add and run cross-tenant isolation tests.
- [ ] Add unit, property, integration, security, and contract tests.
- [ ] Complete backward-compatibility and security review.
- [ ] Complete governed rollout and rollback readiness review.

## Scope controls

- [x] This specification PR does not deploy runtime code.
- [x] This specification PR does not apply a database migration.
- [x] This specification PR does not perform a provider write.
- [x] This specification PR does not mutate a protected branch.
- [x] Completion status remains `in_progress` while implementation and validation items are unresolved.
