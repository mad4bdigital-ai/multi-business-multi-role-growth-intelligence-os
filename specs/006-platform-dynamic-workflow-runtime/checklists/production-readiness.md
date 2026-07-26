# Production Readiness Checklist

## Architecture and domain

- [ ] Platform Scope, Admin Workspace, and Platform Brand seed topology verified.
- [ ] Tenant workspaces are not owned by Admin Workspace.
- [ ] Graph cycle and ambiguity validators pass.
- [ ] Active versions are immutable.
- [ ] Fork lineage and mandatory policy inheritance verified.

## Security

- [ ] Authentication and authorization separated.
- [ ] Tenant/object authorization matrix passes.
- [ ] Platform-admin tenant access is explicitly granted and audited.
- [ ] Execution class and preferences grant no authority.
- [ ] Credentials are references only and least-privilege resolved.
- [ ] Approval holds bind all material hashes.
- [ ] Callback signature, nonce, expiry, and replay tests pass.
- [ ] SSRF, injection, unsafe deserialization, and secret exposure reviewed.

## Runtime correctness

- [ ] CAS transition and concurrent claim tests pass.
- [ ] Idempotency namespaces and request-hash conflicts verified.
- [ ] Transactional outbox atomicity verified.
- [ ] Unknown-outcome reconciliation tested.
- [ ] Retry limits, backoff, and rate-limit handling tested.
- [ ] Compensation and partial-failure semantics tested.
- [ ] Required readback prevents premature completion.

## Data and migration

- [ ] Additive migration and rollback scripts reviewed.
- [ ] Backfill ownership confidence and quarantine rules tested.
- [ ] Index and query plans reviewed.
- [ ] Retention and evidence reconstruction tested.
- [ ] No destructive change without explicit approval.

## Adapters

- [ ] Certification current.
- [ ] Readiness, dispatch, inspect, cancel, callback, readback, and normalization tested.
- [ ] Rate limits, payload limits, timeouts, and retries documented.
- [ ] Kill switch and degraded behavior tested.

## API and documentation

- [ ] OpenAPI 3.1 validates.
- [ ] Generated schemas and implementation match.
- [ ] Stable errors, examples, pagination, auth, and idempotency documented.
- [ ] Canonical architecture and runbooks updated.
- [ ] Backward compatibility reviewed.

## Operations

- [ ] Dashboards and critical alerts active.
- [ ] SLOs and error budgets approved.
- [ ] Dead-letter and reconciliation runbooks rehearsed.
- [ ] Pilot evidence meets gates.
- [ ] Rollback rehearsal passed.
- [ ] Explicit production approval recorded.
