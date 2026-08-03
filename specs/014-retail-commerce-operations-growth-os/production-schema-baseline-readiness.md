# T004 — Production Schema and Migration Baseline Readiness

## Status

- Task: `T004`.
- State: `ready_for_authoritative_collection`.
- Task checklist: remains unchecked until a Production Artifact is collected and reviewed.
- Tooling source base: `main@38542d7b62324bcea26743fc01e8116e3ee66c7b`.
- Runtime implementation authority: not granted.
- Migration authority: not granted.
- Secrets included: `false`.

## Purpose

T004 requires authoritative Production database evidence separately from repository presence. A migration file in Git proves only that the file exists in the repository. It does not prove that its tables, columns, indexes, or migration-ledger entry exist in Production.

The bounded collector added for this gate is:

- `http-generic-api/scripts/retail-commerce-production-schema-baseline.mjs`;
- `http-generic-api/test-retail-commerce-production-schema-baseline.mjs`;
- `.github/workflows/retail-commerce-production-schema-baseline.yml`.

## Production execution contract

The Workflow:

1. can run only through `workflow_dispatch` from `main`;
2. requires the exact current `main` SHA and the literal confirmation `READ_ONLY_RETAIL_COMMERCE_SCHEMA_BASELINE`;
3. uses the protected `Production` GitHub environment;
4. checks that protected `main` did not move before opening the database connection;
5. consumes masked `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` environment secrets;
6. runs the fixture-backed SELECT-only contract test before connecting to Production;
7. executes the collector and uploads one bounded JSON Artifact even when parity gaps are detected;
8. fails closed when the connection or report collection fails.

## Query boundary

The collector has a fixed internal query set. It accepts no SQL input and no table name input from the dispatcher.

Allowed reads:

- `SELECT DATABASE()` only to hash the database identity; the raw name is not returned;
- `INFORMATION_SCHEMA.TABLES` for an allowlist derived from the two repository migrations;
- `INFORMATION_SCHEMA.COLUMNS` for those tables;
- `INFORMATION_SCHEMA.STATISTICS` for those tables;
- metadata fields from `governed_migration_ledger` for the two fixed migration filenames.

Target migrations:

- `029_sprint32_tenant_commercials.sql`;
- `319_sprint69_dynamic_container_authority_foundation.sql`.

Forbidden:

- freeform SQL;
- `SELECT *`;
- business row-data reads;
- `INSERT`, `UPDATE`, `DELETE`, `ALTER`, `DROP`, `CREATE`, `REPLACE`, `TRUNCATE`, `CALL`, `GRANT`, `REVOKE`, `LOCK`, `UNLOCK`, or `SET`;
- migration dry-run or Apply;
- database mutation;
- provider calls;
- credential values in output;
- external sends.

The collector does execute bounded SQL `SELECT` statements. Report fields distinguish `select_only: true` and `database_mutation: false`; the query audit includes statement templates and parameter counts, never credential values.

## Artifact classification

The Artifact contract is:

`mad4b.retail-commerce-production-schema-baseline.v1`

It records:

- hashed database identity;
- exact repository SHA;
- repository migration checksums and statement counts;
- expected and present table names;
- column metadata without row values;
- index metadata;
- latest governed migration-ledger metadata where present;
- checksum and statement-count comparisons;
- explicit gaps;
- safety assertions.

Possible `parity_status` values:

- `pass` — all migration-derived tables are present and matching ledger evidence exists;
- `gaps_detected` — authoritative collection succeeded but schema or ledger gaps exist;
- `collection_failed` — no authoritative baseline was collected.

A `gaps_detected` Artifact may satisfy the baseline-recording part of T004 only after review, because T004 records reality; it does not require pretending parity exists. Any gap remains a blocker for later migration design or runtime enablement.

## T004 completion rule

T004 may be marked complete only when all of the following are true:

1. the Workflow is merged to protected `main`;
2. the Workflow is dispatched using the exact current `main` SHA;
3. the Production database connection succeeds;
4. the JSON Artifact has `baseline_collected: true`;
5. the Artifact safety block proves SELECT-only, no row data, no freeform SQL, no migration Apply, no database mutation, and no secrets;
6. the Artifact is read back and its schema/ledger gaps are documented without alteration;
7. `tasks.md` is updated in a separate evidence-bound commit.

Until then, T004 remains unchecked and Phase 1 runtime implementation must not start.
