# Implementation Plan: Policy-Driven Resource Surface Governance

## Architecture

- Pure policy evaluation is exported from `resourceApiCoverageService.js` and remains independent of HTTP routing.
- Live SQL discovery and finding persistence stay inside the existing Resource API coverage service boundary.
- Changed-scope discovery stays in `scripts/resource-api-coverage-audit.mjs`.
- SQL authority is introduced by migration 1025.
- No route, controller, or public OpenAPI behavior changes.

## Delivery mode

`multi_pr` is required because the feature includes a database migration, production verification, and a post-merge audit.

1. Implementation PR: code, migration, tests, canonicals, ADR, and in-progress Spec Kit.
2. Governed migration apply and production parity verification.
3. Final closeout PR: record CI, release readiness, merge, migration ledger, production parity, audit, and resolve every checklist item.

## Validation

- Resource API coverage tests.
- Changed-scope positive and negative gate behavior.
- Migration SQL preflight and statement count.
- Full repository CI.
- Release readiness.
- Production runtime verification.
- Persisted live Resource API audit.
