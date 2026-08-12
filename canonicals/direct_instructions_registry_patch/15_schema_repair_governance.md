# Schema Repair Governance

## Safe additive repair over omission

When a platform registry update fails because a live database is missing a
column, table, or diagnostic view that can be added safely, the correct response
is to apply an idempotent additive repair and then continue the intended update.
Do not silently omit the update.

Safe additive repairs include:

- `ADD COLUMN IF NOT EXISTS` for nullable or defaulted audit columns
- `CREATE TABLE IF NOT EXISTS` for registry guard tables
- `CREATE OR REPLACE VIEW` for diagnostic/readiness views
- metadata-only policy or certification rows that do not expand runtime power

Blocked shortcuts:

- skipping a registry mutation because a required column is missing
- claiming readiness after the intended mutation was omitted
- using a permanent `BINARY` join workaround instead of fixing collation
- marking a surface recovered without same-cycle readback evidence

Required evidence:

1. Preflight the current schema.
2. Classify the change as additive or destructive.
3. Apply only additive repairs without data loss.
4. Read back the repaired schema and the intended registry mutation.
5. Record ledger and execution-log evidence.

## Database engine and collation policy authority

Database comparison authority is semantic and engine-aware. Platform semantics
MUST NOT be expressed as one globally hard-coded physical collation name.
Migration and schema code declare the comparison purpose; the observed database
engine resolves that purpose to an approved physical engine profile.

Canonical semantic purposes include:

- `human_text_default` for normal Unicode human text;
- `join_key_strict` for relational keys that are compared across tables;
- `opaque_identifier` for identifiers whose bytes/case are significant;
- `case_sensitive_text` for text where case changes meaning;
- `search_folded` for search-oriented text that is not a relational join key.

The current physical implementation profiles are governed configuration, not
platform semantics:

- MariaDB 10.10+ resolves human text and normal join keys to the approved
  UCA-1400 `utf8mb4` profile;
- MySQL 8+ resolves them to the approved 0900 `utf8mb4` profile;
- PostgreSQL 16+ resolves them through the approved ICU/locale profile.

An unknown engine MUST fail closed with `database_engine_profile_unresolved`.
A collation belonging to another engine family MUST be blocked before SQL
execution. Existing `utf8mb4_unicode_ci` schema may remain as a tracked legacy
compatible contract when it is not participating in an incompatible comparison;
legacy presence alone is a warning, not a mandate for mass conversion.

Cross-table comparison is stricter: both sides of a join/equality contract must
be proven compatible from live schema metadata or projected DDL. A legacy/new
mismatch such as `utf8mb4_unicode_ci` versus `utf8mb4_uca1400_ai_ci` on a join
key is blocking drift.

The authoritative runtime surfaces are:

- `http-generic-api/config/database-engine-collation-policy.json`;
- `http-generic-api/databaseCollationPolicyGuard.js`;
- the collation preflight in `scripts/governed-migration-runner.mjs`.

Engine detection and profile resolution do **not** authorize automatic schema
conversion. Any conversion remains a separately reviewed governed migration.

Legacy database collation registries and diagnostic views may continue to expose
observed drift, but they MUST NOT override the semantic engine profile authority.

## Automatic additive reconciliation

Automatic schema repair is permitted only through the governed migration reconciliation engine. The internal scheduler may invoke `governed-migration-reconciler.mjs` under a MySQL advisory lock, but every mutation still requires an exact active rule, DB-backed authorization, static preflight `pass`, typed runner confirmation, same-cycle ledger plus schema readback, and the engine-aware collation preflight.

The scheduler must fail closed when configuration is disabled, a rule or authorization is absent, preflight is not `pass`, the database engine profile is unresolved, a comparison contract is incompatible, or the migration is already recorded. It must not execute raw SQL, infer approval from a file name, widen a migration's resource pattern, retain raw output, or expose secrets. `information_schema`-guarded DDL remains mandatory for `ALTER TABLE ... MODIFY` reconciliation.

## Capability-vault skillpack runtime safety

Tenant-private draft installs expose package and skill catalog assets before any
runtime tool is enabled. Advisory routes must keep writes, shell, package
install, deploy, provider writes, secret reads, WebFetch, and other runtime tools
blocked unless an explicit approved grant exists.
