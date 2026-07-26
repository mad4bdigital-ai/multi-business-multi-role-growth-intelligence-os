# Checklist: [CHECKLIST NAME]

**Spec**: `specs/[NNN-feature]/spec.md`  
**Reviewer**: [owner]  
**Status**: Draft

## Requirements quality

- [ ] Requirements are testable and use stable IDs.
- [ ] Current facts, inference, and proposed behavior are separated.
- [ ] Scope and non-goals are explicit.
- [ ] User-visible success requires authoritative readback.

## Operation paths

- [ ] Success, alternate, degraded, denial, timeout, retry, replay, and rollback paths are covered.
- [ ] Every mutation path includes authority, idempotency, unknown-outcome reconciliation, and readback.
- [ ] Lifecycle states are distinct and terminal-state behavior is defined.

## Security and privacy

- [ ] Authentication and authorization are separate.
- [ ] Tenant/user/resource identity cannot be caller-overridden.
- [ ] Cross-tenant, wrong-resource, replay, and privilege-expansion scenarios are covered.
- [ ] Tokens, codes, credentials, and raw secrets are absent from artifacts and logs.

## Contracts and data

- [ ] OpenAPI is 3.1 and structured schemas are explicit.
- [ ] Errors are stable, actionable, and include request IDs where available.
- [ ] Data ownership, retention, indexes, and migration/rollback are addressed.
- [ ] Generated-file authority is preserved.

## Testing and delivery

- [ ] Tests cover happy path, edge cases, invalid input, regression, and fault injection.
- [ ] PR, CI, merge freshness, deployment parity, smoke, and closeout evidence are defined.
- [ ] Unresolved gaps have owner, severity, and next action.
