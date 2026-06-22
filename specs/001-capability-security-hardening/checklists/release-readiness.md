# Release Readiness Checklist

## Scope and governance

- [ ] Constitution approved.
- [ ] Spec, plan, tasks, contracts, and acceptance matrix are synchronized.
- [ ] Owners assigned for security, API, database, device connector, credentials, and operations.
- [ ] P0 containment is active and verified.

## Implementation

- [ ] Canonical capability resolver is production-ready.
- [ ] Strict selector validation is active.
- [ ] Tenant/admin surface isolation is active.
- [ ] Credential decisions are separated.
- [ ] Secure tenant intake is isolated.
- [ ] Device trust and local consent are enforced.
- [ ] Mutation approval policies are complete.
- [ ] Activation/readiness projection is truthful.
- [ ] Structured decision traces are active.

## Contracts and data

- [ ] OpenAPI 3.1 validates.
- [ ] Error catalog matches implementation.
- [ ] Migrations are additive and reviewed.
- [ ] Rollback and backfill are documented.
- [ ] Registry alias migration is verified.
- [ ] Examples and client migration notes are updated.

## Tests

- [ ] Unit tests pass.
- [ ] Integration tests pass.
- [ ] Acceptance matrix passes in staging.
- [ ] Cross-tenant tests pass.
- [ ] Replay and stale-state tests pass.
- [ ] Secret-redaction tests pass.
- [ ] Performance budget passes.
- [ ] Failure/dependency-outage tests prove fail-closed behavior.
- [ ] Bounded mutation tests include readback and cleanup.

## Operations

- [ ] Feature flags and kill switches verified.
- [ ] Shadow comparison reviewed.
- [ ] Alerts configured.
- [ ] Dashboards show decision/gate metrics.
- [ ] Incident runbook updated.
- [ ] Rollback exercised.
- [ ] On-call owner identified.

## Approval

- [ ] Security approval.
- [ ] API/architecture approval.
- [ ] Database approval if applicable.
- [ ] Device/local connector approval.
- [ ] Release readiness approval.
- [ ] Explicit production promotion approval.
