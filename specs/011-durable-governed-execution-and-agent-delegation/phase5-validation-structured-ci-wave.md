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

## Validation lab

The Phase 5 lab runs only against the disposable `spec011_delegation_cert_*` MariaDB target. It records:

- MariaDB-compatible engine family and exact version;
- SQL mode and strict-mode evidence;
- server character set and collation;
- CHECK constraint enforcement;
- transaction isolation readback;
- constraint and index inventories from `information_schema`;
- bounded schema-diff assessment;
- destructive-change detection;
- rollback assessment through disposable service destruction;
- no-production-authorization and no-secret boundaries.

The existing governed migration certification runs first. Phase 5 consumes its migration checksum, ledger/readback evidence, and lifecycle result rather than applying a second migration.

## Migration authorization gate

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

- `migration_engine_validation` — T180–T182;
- `contract_drift` — T184;
- `state_machine_model` — T185;
- `idempotency_unknown_outcome` — T186;
- `delegation_boundary_policy_drift` — T187;
- `semantic_file_mutation` — T188.

T183 is implemented by the diagnosis schema and reporter. T189 is implemented by workflow fallback generation, schema checks, complete gate coverage, and fail-closed artifact validation.

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
2. executes the existing disposable migration/lifecycle certification;
3. runs Phase 5 unit certification;
4. collects live engine and schema evidence;
5. evaluates all structured gates;
6. verifies migration apply authorization is evidence-backed;
7. validates that every gate emitted structured diagnosis;
8. uploads base certification and Phase 5 artifacts with `if: always()`.

If execution stops before the Phase 5 reporter can run, the workflow writes a bounded `pipeline_bootstrap` diagnosis before failing and uploading the artifact.

## Safety boundaries

- Disposable CI MariaDB only.
- No Production database write.
- No Production migration authorization.
- No runtime authority change.
- No provider dispatch.
- No deployment or public route.
- No automatic retry after unknown outcome.
- No secret inclusion.
