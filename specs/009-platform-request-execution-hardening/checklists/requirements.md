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

- [x] Runtime implementation is included and merged through PR #2551.
- [x] Three additive database migrations are included.
- [x] All three migrations were applied through the governed migration runner.
- [x] No destructive migration or backfill was included.
- [x] No provider write was performed.
- [x] Production deployment occurred through release governance rather than direct repository execution.
- [x] No force-push was performed.
- [x] Repair changes were reviewed and merged through PRs #2900 and #2907.
- [x] No secrets or credentials were included.

## Validation and evidence

- [x] The implementation branch was synchronized with `main` before final validation.
- [x] Syntax Check passed on the reconciled implementation and repair heads.
- [x] Architecture Drift Detection passed on the reconciled implementation and repair heads.
- [x] Execution Resolver Gate passed on the reconciled implementation and repair heads.
- [x] Unit & Integration Tests passed on the reconciled implementation and repair heads.
- [x] Tenant ownership and cross-tenant denial behavior is covered.
- [x] Managed Git worker lease, pinning, isolation, cleanup, expiry, and readback behavior is covered.
- [x] MariaDB compatibility for active worker lease uniqueness is covered by regression tests.
- [x] Admin read-only pilot evidence is recorded.
- [x] Selected Tenant read-only pilot evidence is recorded.
- [x] Pilot evidence confirms no provider mutation and no secret/raw payload exposure.

## Governed closeout

- [x] Required review and CI evidence was recorded before each merge.
- [x] PR #2551 was merged and its implementation is present on `main`.
- [x] Repair PRs #2900 and #2907 were merged after all required checks passed.
- [x] Included migrations were applied through separately approved production operations.
- [x] Production deployment and parity verification completed through release governance.
- [x] Schema and migration-ledger readback verified all three database objects.
- [x] Post-merge audit evidence is recorded in `completion.json`.
