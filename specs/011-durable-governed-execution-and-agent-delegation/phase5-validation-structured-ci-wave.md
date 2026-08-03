# Phase 5 — Validation Lab and Structured CI

## Scope

This integrated wave implements Spec 011 tasks T180–T189 by composing the repository's existing disposable MariaDB certification and canonical test paths instead of introducing a second migration runner or database lifecycle.

## Reused authority

- `.github/workflows/spec-011-delegation-mariadb-certification.yml`
- `http-generic-api/scripts/delegation-mariadb-disposable-certification.mjs`
- `http-generic-api/delegationGrantMariaDbValidationService.js`
- `http-generic-api/scripts/governed-migration-runner.mjs`
- `http-generic-api/test-shared-reconciliation-engine.mjs`
- Existing contract, lifecycle, delegation, idempotency, OpenAPI, and Spec Kit CI checks.

## Pre-apply engine gate

Before the governed migration certifier is permitted to run, Phase 5 executes `spec011-phase5-migration-preflight.mjs` against the disposable MariaDB service.

The preflight verifies:

- MariaDB/MySQL-compatible engine identity and exact version;
- strict SQL mode;
- `utf8mb4` character set and collation;
- JSON support;
- CHECK constraint enforcement;
- transaction isolation readback;
- disposable database identity;
- `production_authorized: false`;
- `secrets_included: false`.

A passing preflight produces a SHA-256 evidence fingerprint. `authorizeMigrationApply` remains blocked unless that fingerprint and its artifact reference are present. The workflow validates this artifact before invoking the existing migration certifier. Therefore migration apply cannot begin when engine validation is absent, stale, blocked, or malformed.

## Post-apply validation lab

After the preflight-authorized disposable migration and lifecycle certification, the Phase 5 lab records:

- engine family and exact version;
- SQL mode and strict-mode evidence;
- server character set and collation;
- CHECK constraint enforcement;
- transaction isolation readback;
- constraint and index inventories from `information_schema`;
- bounded schema-diff assessment;
- destructive-change detection;
- rollback assessment through disposable service destruction;
- no-production-authorization and no-secret boundaries.

The existing governed migration certification remains the only migration executor. Phase 5 consumes its migration checksum, ledger/readback evidence, and lifecycle result rather than applying a second migration.

## Migration authorization contract

`authorizeMigrationApply` is fail-closed. Apply authorization requires all of the following in the same evidence bundle:

1. validation status `pass`;
2. a SHA-256 validation fingerprint;
3. an authoritative evidence reference.

Dry-run or non-apply requests remain non-authorized without being treated as apply failures. Production authorization is never inferred from disposable certification.

## Structured diagnosis contract

Every Phase 5 gate emits `spec011-structured-ci-diagnosis-v1` with:

- stable gate identifier and code;
- `pass`, `fail`, or `blocked` status;
- bounded summary;
- blockers;
- evidence references;
- remediation for every non-pass result;
- bounded metadata;
- observation timestamp;
- `secrets_included: false`.

The JSON Schema is located at:

`schemas/phase5-structured-ci-diagnosis.schema.json`

Secret-like metadata fields are rejected recursively. Missing, malformed, or incomplete diagnosis output is itself a CI failure.

## Structured gates

The unified Phase 5 report contains one diagnosis for each required gate:

- `migration_engine_validation` — T180–T182 post-apply certification;
- `contract_drift` — T184;
- `state_machine_model` — T185;
- `idempotency_unknown_outcome` — T186;
- `delegation_boundary_policy_drift` — T187;
- `semantic_file_mutation` — T188.

The separate `migration_engine_preflight` diagnosis proves the T182 pre-apply boundary. T183 is implemented by the diagnosis schema and reporter. T189 is implemented by workflow fallback generation, schema checks, complete gate coverage, and fail-closed artifact validation.

## Semantic mutation gate

The semantic gate requires bounded evidence for all four formats:

- JSON;
- YAML;
- OpenAPI;
- completion contract.

Plain text replacement is not accepted as semantic evidence. Completion mutations require an explicit completion-contract-valid result.

## Workflow behavior

The existing Spec 011 MariaDB certification workflow now:

1. runs the existing focused delegation and MariaDB tests;
2. runs pre-apply engine validation;
3. requires a valid preflight diagnosis, fingerprint, and apply authorization artifact;
4. executes the existing disposable migration/lifecycle certification;
5. runs the post-apply Phase 5 validation lab;
6. evaluates all structured gates;
7. verifies post-apply authorization remains evidence-backed;
8. validates that every gate emitted structured diagnosis;
9. uploads preflight, base certification, and Phase 5 artifacts with `if: always()`.

If execution stops before either reporter can run, the workflow writes a bounded fallback diagnosis before failing and uploading the artifact.

## Safety boundaries

- Disposable CI MariaDB only.
- No Production database write.
- No Production migration authorization.
- No runtime authority change.
- No provider dispatch.
- No deployment or public route.
- No automatic retry after unknown outcome.
- No secret inclusion.
