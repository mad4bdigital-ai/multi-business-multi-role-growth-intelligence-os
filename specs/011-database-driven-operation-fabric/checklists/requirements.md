# Requirements Checklist

## Specification completeness

- [x] Problem and user scenarios defined.
- [x] Functional and non-functional requirements defined.
- [x] Authority precedence defined.
- [x] Minimal registry model defined.
- [x] Dynamic binding and fallback defined.
- [x] Tool projection defined.
- [x] Real managed Git worker defined.
- [x] CI diagnosis and recovery defined.
- [x] Generated artifact policy defined.
- [x] Migration, rollout, rollback, and stop conditions defined.
- [x] Positive, negative, resilience, and security acceptance defined.
- [x] Design-only safety boundary stated.

## Implementation readiness

- [ ] Registry names and current-table reuse validated against latest schema.
- [ ] ADR or decision record approved.
- [ ] Additive migration reviewed with indexes and rollback/disable path.
- [ ] OpenAPI reconciled with existing operation routes.
- [ ] Admin and Tenant projection policy approved.
- [ ] Managed worker infrastructure and credential model approved.
- [ ] CI log access and redaction policy approved.
- [ ] Generated artifact registry seeded for existing generated files.
- [ ] Kill switches and fallback behavior approved.
- [ ] Test plan registered in test manifest.

## PR readiness

- [ ] Scope is one implementation slice.
- [ ] Tests cover happy path, invalid input, edge cases, and regressions.
- [ ] Security and Tenant isolation reviewed.
- [ ] Performance, capacity, and database query impact reviewed.
- [ ] Documentation and OpenAPI updated.
- [ ] Migration and rollback evidence included where applicable.
- [ ] CI successful on current head.
- [ ] Production deployment parity and post-merge audit planned.
