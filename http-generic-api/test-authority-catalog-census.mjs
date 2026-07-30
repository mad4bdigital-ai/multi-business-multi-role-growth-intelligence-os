import assert from "node:assert/strict";

import {
  AUTHORITY_CATALOG_LIMITS,
  AuthorityCatalogCensusError,
  collectAuthorityCatalogCensus,
} from "./authorityCatalogCensus.js";

function result(rows) {
  return [rows, []];
}

function createPool({ oversizedObjects = false } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("SELECT DATABASE()")) {
        return result([{
          schema_name: "platform",
          version: "11.4.2-MariaDB",
          version_comment: "MariaDB Server",
          observed_at: "2030-01-01 00:00:00.000000",
        }]);
      }
      if (sql.includes("information_schema.TABLES")) {
        if (oversizedObjects) {
          return result(Array.from(
            { length: AUTHORITY_CATALOG_LIMITS.maxObjects + 1 },
            (_, index) => ({
              TABLE_NAME: `table_${index}`,
              TABLE_TYPE: "BASE TABLE",
              ENGINE: "InnoDB",
              TABLE_ROWS: 0,
            }),
          ));
        }
        return result([
          { TABLE_NAME: "user_scope_grants", TABLE_TYPE: "BASE TABLE", ENGINE: "InnoDB", TABLE_ROWS: 12 },
          { TABLE_NAME: "runtime_certifications", TABLE_TYPE: "BASE TABLE", ENGINE: "InnoDB", TABLE_ROWS: 7 },
          { TABLE_NAME: "misc_registry", TABLE_TYPE: "BASE TABLE", ENGINE: "InnoDB", TABLE_ROWS: 3 },
          { TABLE_NAME: "v_effective_user_scope_grants", TABLE_TYPE: "VIEW", ENGINE: null, TABLE_ROWS: null },
        ]);
      }
      if (sql.includes("information_schema.COLUMNS")) {
        return result([
          { TABLE_NAME: "user_scope_grants", COLUMN_NAME: "grant_id", ORDINAL_POSITION: 1, DATA_TYPE: "varchar", COLUMN_TYPE: "varchar(64)", IS_NULLABLE: "NO", COLUMN_KEY: "PRI", EXTRA: "", COLLATION_NAME: "utf8mb4_uca1400_ai_ci" },
          { TABLE_NAME: "user_scope_grants", COLUMN_NAME: "revision", ORDINAL_POSITION: 2, DATA_TYPE: "bigint", COLUMN_TYPE: "bigint unsigned", IS_NULLABLE: "NO", COLUMN_KEY: "", EXTRA: "", COLLATION_NAME: null },
          { TABLE_NAME: "user_scope_grants", COLUMN_NAME: "updated_at", ORDINAL_POSITION: 3, DATA_TYPE: "datetime", COLUMN_TYPE: "datetime(6)", IS_NULLABLE: "NO", COLUMN_KEY: "", EXTRA: "", COLLATION_NAME: null },
          { TABLE_NAME: "runtime_certifications", COLUMN_NAME: "certification_id", ORDINAL_POSITION: 1, DATA_TYPE: "varchar", COLUMN_TYPE: "varchar(64)", IS_NULLABLE: "NO", COLUMN_KEY: "PRI", EXTRA: "", COLLATION_NAME: "utf8mb4_uca1400_ai_ci" },
          { TABLE_NAME: "runtime_certifications", COLUMN_NAME: "updated_at", ORDINAL_POSITION: 2, DATA_TYPE: "datetime", COLUMN_TYPE: "datetime(6)", IS_NULLABLE: "NO", COLUMN_KEY: "", EXTRA: "", COLLATION_NAME: null },
          { TABLE_NAME: "misc_registry", COLUMN_NAME: "id", ORDINAL_POSITION: 1, DATA_TYPE: "bigint", COLUMN_TYPE: "bigint unsigned", IS_NULLABLE: "NO", COLUMN_KEY: "PRI", EXTRA: "auto_increment", COLLATION_NAME: null },
          { TABLE_NAME: "v_effective_user_scope_grants", COLUMN_NAME: "grant_id", ORDINAL_POSITION: 1, DATA_TYPE: "varchar", COLUMN_TYPE: "varchar(64)", IS_NULLABLE: "NO", COLUMN_KEY: "", EXTRA: "", COLLATION_NAME: "utf8mb4_uca1400_ai_ci" },
        ]);
      }
      if (sql.includes("information_schema.STATISTICS")) {
        return result([
          { TABLE_NAME: "user_scope_grants", INDEX_NAME: "PRIMARY", NON_UNIQUE: 0, SEQ_IN_INDEX: 1, COLUMN_NAME: "grant_id", SUB_PART: null, INDEX_TYPE: "BTREE" },
        ]);
      }
      if (sql.includes("information_schema.KEY_COLUMN_USAGE")) {
        return result([
          { CONSTRAINT_NAME: "fk_grant_user", TABLE_NAME: "user_scope_grants", COLUMN_NAME: "user_id", REFERENCED_TABLE_NAME: "users", REFERENCED_COLUMN_NAME: "user_id" },
        ]);
      }
      if (sql.includes("information_schema.VIEWS")) {
        return result([{
          TABLE_NAME: "v_effective_user_scope_grants",
          CHECK_OPTION: "NONE",
          IS_UPDATABLE: "NO",
          SECURITY_TYPE: "DEFINER",
          definition_sha256: "a".repeat(64),
        }]);
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

const pool = createPool();
const report = await collectAuthorityCatalogCensus({ pool });

assert.equal(report.ok, true);
assert.equal(report.status, "observed_unclassified");
assert.equal(report.mode, "read_only_authority_catalog_census");
assert.equal(report.read_only, true);
assert.equal(report.applies_sql, false);
assert.equal(report.schema_name, "platform");
assert.equal(report.closure_state.t002_complete, false);
assert.equal(report.closure_state.t021_authorized, false);
assert.equal(report.provider_calls, false);
assert.equal(report.credential_payload_read, false);
assert.equal(report.external_writes, false);
assert.equal(report.secrets_included, false);

assert.deepEqual(report.summary, {
  object_count: 4,
  base_table_count: 3,
  view_count: 1,
  column_count: 7,
  index_column_count: 1,
  foreign_key_count: 1,
  authority_source_candidate_count: 2,
  derived_projection_candidate_count: 1,
  evidence_ledger_candidate_count: 0,
  explicit_revision_table_count: 1,
  temporal_only_table_count: 1,
  absent_revision_table_count: 1,
});

assert.equal(
  report.objects.find((item) => item.object_name === "user_scope_grants")?.ownership_classification,
  "authority_source_candidate",
);
assert.equal(
  report.objects.find((item) => item.object_name === "v_effective_user_scope_grants")?.ownership_classification,
  "derived_projection_candidate",
);
assert.equal(
  report.revision_support.find((item) => item.object_name === "user_scope_grants")?.support,
  "explicit_revision",
);
assert.equal(
  report.revision_support.find((item) => item.object_name === "runtime_certifications")?.support,
  "temporal_freshness_only",
);
assert.equal(
  report.revision_support.find((item) => item.object_name === "misc_registry")?.support,
  "absent",
);
assert.deepEqual(
  report.unresolved_revision_candidates.map((item) => item.object_name),
  ["runtime_certifications"],
);
assert.equal(report.views[0].definition_sha256, "a".repeat(64));
assert.equal(report.views[0].raw_definition_included, false);
assert.equal(JSON.stringify(report).includes("VIEW_DEFINITION"), false);
assert.equal(Object.isFrozen(report), true);
assert.equal(Object.isFrozen(report.objects), true);
assert.equal(Object.isFrozen(report.objects[0]), true);

for (const call of pool.calls) {
  const normalizedSql = call.sql.trim().toUpperCase();
  assert.ok(normalizedSql.startsWith("SELECT"), normalizedSql);
  assert.equal(/\b(INSERT|UPDATE|DELETE|REPLACE|ALTER|CREATE|DROP|TRUNCATE|CALL)\b/.test(normalizedSql), false);
}
assert.deepEqual(report.queries_executed, [
  "database_identity",
  "schema_objects",
  "schema_columns",
  "schema_indexes",
  "schema_foreign_keys",
  "schema_views",
]);

await assert.rejects(
  () => collectAuthorityCatalogCensus({ pool: createPool({ oversizedObjects: true }) }),
  (error) => error instanceof AuthorityCatalogCensusError
    && error.code === "authority_catalog_limit_exceeded"
    && error.details.key === "schema_objects",
);

await assert.rejects(
  () => collectAuthorityCatalogCensus({ pool: {} }),
  /pool\.query must be a function/,
);

console.log("authority catalog census tests passed");
