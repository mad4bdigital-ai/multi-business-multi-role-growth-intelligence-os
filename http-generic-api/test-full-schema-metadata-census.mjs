import assert from "node:assert/strict";
import { classifySchemaMetadataTable, collectFullSchemaMetadataCensus } from "./fullSchemaMetadataCensus.js";

const queries = [];
const pool = {
  async query(sql) {
    queries.push(String(sql));
    if (sql.includes("information_schema.TABLES")) {
      return [[
        { TABLE_NAME: "workflow_registry", TABLE_TYPE: "BASE TABLE", ENGINE: "InnoDB", TABLE_ROWS: 12, DATA_LENGTH: 4096, INDEX_LENGTH: 2048 },
        { TABLE_NAME: "users", TABLE_TYPE: "BASE TABLE", ENGINE: "InnoDB", TABLE_ROWS: 3, DATA_LENGTH: 4096, INDEX_LENGTH: 2048 },
        { TABLE_NAME: "oauth_secrets", TABLE_TYPE: "BASE TABLE", ENGINE: "InnoDB", TABLE_ROWS: 1, DATA_LENGTH: 4096, INDEX_LENGTH: 0 },
      ]];
    }
    if (sql.includes("information_schema.COLUMNS")) {
      return [[
        { TABLE_NAME: "oauth_secrets", COLUMN_NAME: "access_token", ORDINAL_POSITION: 1, DATA_TYPE: "text", COLUMN_TYPE: "text", IS_NULLABLE: "NO", COLUMN_KEY: "", EXTRA: "" },
        { TABLE_NAME: "users", COLUMN_NAME: "user_id", ORDINAL_POSITION: 1, DATA_TYPE: "bigint", COLUMN_TYPE: "bigint", IS_NULLABLE: "NO", COLUMN_KEY: "PRI", EXTRA: "" },
        { TABLE_NAME: "workflow_registry", COLUMN_NAME: "workflow_id", ORDINAL_POSITION: 1, DATA_TYPE: "bigint", COLUMN_TYPE: "bigint", IS_NULLABLE: "NO", COLUMN_KEY: "PRI", EXTRA: "" },
      ]];
    }
    if (sql.includes("information_schema.KEY_COLUMN_USAGE")) return [[]];
    throw new Error("unexpected query");
  },
};

const result = await collectFullSchemaMetadataCensus(pool);
assert.equal(result.row_values_read, false);
assert.equal(result.exact_row_counts_performed, false);
assert.equal(result.database_mutation, false);
assert.equal(result.secrets_included, false);
assert.equal(result.summary.total_tables, 3);
assert.equal(result.tables.find((table) => table.table === "workflow_registry").candidate_classification, "copy_direct");
assert.equal(result.tables.find((table) => table.table === "users").candidate_classification, "synthetic_only");
assert.equal(result.tables.find((table) => table.table === "oauth_secrets").candidate_classification, "exclude_secret");
assert.deepEqual(classifySchemaMetadataTable("customer_profiles", [{ name: "email", data_type: "varchar" }]), {
  candidate_classification: "copy_sanitized",
  confidence: "medium",
  reason: "direct_pii_metadata_pattern",
});
assert.equal(queries.length, 3);
for (const sql of queries) {
  assert.match(sql, /information_schema\./);
  assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE)\b/i);
}
console.log("full schema metadata census contract: pass");
