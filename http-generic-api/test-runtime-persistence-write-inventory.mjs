import assert from "node:assert/strict";
import {
  buildRuntimePersistenceWriteInventory,
  inventorySourceFile,
} from "./scripts/runtime-persistence-write-inventory.mjs";

const synthetic = inventorySourceFile({
  file: "governedToolResponseChunkStore.js",
  source: `
    import { getPool } from "./db.js";
    const GOVERNED_RESPONSE_CHUNK_TABLE = "governed_tool_response_chunks";
    const pool = getPool();
    await pool.query(\`INSERT INTO \${GOVERNED_RESPONSE_CHUNK_TABLE} (chunk_id) VALUES (?) ON DUPLICATE KEY UPDATE chunk_id = chunk_id\`);
    await pool.query(\`UPDATE \${GOVERNED_RESPONSE_CHUNK_TABLE} SET expires_at = ? WHERE chunk_id = ?\`);
    await pool.query(\`DELETE FROM \${GOVERNED_RESPONSE_CHUNK_TABLE} WHERE expires_at <= CURRENT_TIMESTAMP\`);
  `,
});
assert.deepEqual(
  synthetic.map(({ operation, table }) => [operation, table]),
  [
    ["INSERT", "governed_tool_response_chunks"],
    ["UPDATE", "governed_tool_response_chunks"],
    ["DELETE", "governed_tool_response_chunks"],
  ],
  "duplicate-key clauses must not be double-counted as standalone UPDATE surfaces",
);
assert.ok(synthetic.every((row) => row.classification === "ordinary business/runtime persistence"));

const report = await buildRuntimePersistenceWriteInventory();
assert.equal(report.contract, "mad4b.runtime-persistence-write-inventory.v1");
assert.equal(report.secrets_included, false);
assert.ok(report.summary.mutation_surface_count > 0);
assert.ok(report.summary.file_count > 0);
assert.deepEqual(new Set(report.classification_values), new Set([
  "ordinary business/runtime persistence",
  "governance/control-plane",
  "migration/DDL/admin",
]));

const chunkRows = report.inventory.filter((row) => row.file === "governedToolResponseChunkStore.js");
assert.ok(chunkRows.some((row) => row.operation === "INSERT" && row.table === "governed_tool_response_chunks"));
assert.ok(chunkRows.some((row) => row.operation === "UPDATE" && row.table === "governed_tool_response_chunks"));
assert.ok(chunkRows.some((row) => row.operation === "DELETE" && row.table === "governed_tool_response_chunks"));
assert.ok(chunkRows.every((row) => row.classification === "ordinary business/runtime persistence"));

const window2Rows = report.inventory.filter((row) => row.file === "platformResourceAuthorityGrantTool.js");
assert.ok(window2Rows.length > 0, "window-2 owned grant tool must remain visible in inventory");
assert.ok(window2Rows.every((row) => row.classification === "governance/control-plane"));

const migrationRows = report.inventory.filter((row) => row.classification === "migration/DDL/admin");
assert.ok(migrationRows.length > 0, "inventory must retain migration/DDL/admin write surfaces");

const allowedClasses = new Set(report.classification_values);
assert.ok(report.inventory.every((row) => allowedClasses.has(row.classification)), "every mutation surface must be classified");
assert.ok(report.inventory.every((row) => row.db_binding === "getPool/db.js"));

console.log(JSON.stringify({
  contract: report.contract,
  summary: report.summary,
  governed_response_chunk_operations: chunkRows.map(({ operation, table }) => ({ operation, table })),
  window2_surface_count: window2Rows.length,
  secrets_included: false,
}));
