# Requirements Checklist

## Scope and architecture

- [x] Covers both Admin and Tenant User execution paths.
- [x] Provides high-level application operations instead of low-level tool composition.
- [x] Preserves interface, application, domain, and infrastructure boundaries.
- [x] Enforces early authentication, tenant membership, and resource-authority preflight.
- [x] Enforces tenant isolation, redaction, and bounded audit behavior.
- [x] Implements operation-scoped capability creation and renewal without automatic approval.
- [x] Implements managed Git execution independent of Local Connector.
- [x] Implements generated-artifact reconciliation.
- [x] Implements structured CI diagnosis and JSON-only upstream errors.
- [x] Implements bounded response modes and internal chunk aggregation.
- [x] Implements persistent operation state, resume, idempotency, and readback.
- [x] Implements execution budgets, observability, and resilience coverage.
- [x] Implements tenant-safe typed catalog projections.

## API contract

- [x] OpenAPI contracts use version 3.1.0.
- [x] Public operations use stable operation identifiers.
- [x] Error responses use structured envelopes.
- [x] Idempotency is required for unsafe retryable operations.
- [x] Authentication and authorization behavior is explicit.
- [x] `capability_envelope_id` is optional at operation intake so lifecycle code can create or renew it.
- [x] Newly created or renewed capability envelopes still require governed approval when policy requires it.
- [x] Runtime routes and OpenAPI contracts are synchronized for the implemented scope.

## Change boundaries

- [x] Runtime implementation is included.
- [x] Three additive database migrations are included.
- [x] Included migrations have not been applied.
- [x] No destructive migration or backfill is included.
- [x] No provider write is performed.
- [x] No production deployment is performed.
- [x] No force-push is performed.
- [x] No merge is performed by this change set.
- [x] No secrets or credentials are included.

## Validation and evidence

- [x] The implementation branch is synchronized with `main` before final validation.
- [x] Syntax Check passed on the reconciled implementation head.
- [x] Architecture Drift Detection passed on the reconciled implementation head.
- [x] Execution Resolver Gate passed on the reconciled implementation head.
- [x] Unit & Integration Tests passed on the reconciled implementation head.
- [x] Tenant ownership and cross-tenant denial behavior is covered.
- [x] Managed Git worker lease, pinning, isolation, cleanup, expiry, and readback behavior is covered.
- [x] Admin read-only pilot evidence is recorded.
- [x] Selected Tenant read-only pilot evidence is recorded.
- [x] Pilot evidence confirms no provider mutation and no secret/raw payload exposure.

## Remaining governed steps

- [ ] Required reviewer approval is recorded.
- [ ] Pull request is merged after all required checks remain green.
- [ ] Included migrations are applied through a separately approved production operation.
- [ ] Production deployment and verification are completed through release governance.
- [ ] Post-merge audit is recorded.
