import assert from "node:assert/strict";
import {
  GOVERNANCE_CONTROL_DB_BINDING,
  RUNTIME_PERSISTENCE_DB_BINDING,
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
assert.ok(synthetic.every((row) => row.db_binding === RUNTIME_PERSISTENCE_DB_BINDING));

const mixed = inventorySourceFile({
  file: "repositoryGovernanceV6.js",
  source: `
    import { getPool } from "./db.js";
    import { getGovernancePool } from "./governanceDb.js";
    async function exercise(writerPool) {
      await getPool().query(\`INSERT INTO audit_payload_evidence (evidence_id) VALUES (?)\`);
      const governanceWriterPool = writerPool || getGovernancePool();
      await governanceWriterPool.query(\`INSERT INTO platform_resource_authority_bindings (binding_id) VALUES (?)\`);
      await getPool().query(\`UPDATE repository_mutation_runs_v6 SET status='done' WHERE run_id=?\`);
    }
  `,
});
assert.equal(mixed.length, 3);
assert.equal(mixed[0].db_binding, RUNTIME_PERSISTENCE_DB_BINDING);
assert.equal(mixed[1].table, "platform_resource_authority_bindings");
assert.equal(mixed[1].db_binding, GOVERNANCE_CONTROL_DB_BINDING);
assert.equal(mixed[2].db_binding, RUNTIME_PERSISTENCE_DB_BINDING);
assert.ok(mixed.every((row) => row.classification === "governance/control-plane"));

const governanceOnly = inventorySourceFile({
  file: "platformResourceAuthorityGrantTool.js",
  source: `
    import { getGovernancePool } from "./governanceDb.js";
    const writerPool = getGovernancePool();
    await writerPool.query(\`INSERT INTO platform_resource_authority_bindings (binding_id) VALUES (?)\`);
  `,
});
assert.equal(governanceOnly.length, 1);
assert.equal(governanceOnly[0].db_binding, GOVERNANCE_CONTROL_DB_BINDING);
assert.equal(governanceOnly[0].classification, "governance/control-plane");

const report = await buildRuntimePersistenceWriteInventory();
assert.equal(report.contract, "mad4b.runtime-persistence-write-inventory.v1");
assert.equal(report.binding_contract, "mad4b.runtime-persistence-write-inventory-binding.v1");
assert.equal(report.secrets_included, false);
assert.ok(report.summary.mutation_surface_count > 0);
assert.ok(report.summary.file_count > 0);
assert.ok(report.summary.db_user_mutation_surface_count > 0);
assert.ok(report.summary.governance_db_mutation_surface_count > 0);
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
assert.ok(chunkRows.every((row) => row.db_binding === RUNTIME_PERSISTENCE_DB_BINDING));

const window2Rows = report.inventory.filter((row) => row.file === "platformResourceAuthorityGrantTool.js");
assert.ok(window2Rows.length > 0, "window-2 owned grant tool must remain visible in full inventory");
assert.ok(window2Rows.every((row) => row.classification === "governance/control-plane"));
assert.ok(window2Rows.every((row) => row.db_binding === GOVERNANCE_CONTROL_DB_BINDING));
assert.equal(
  report.db_user_inventory.some((row) => row.file === "platformResourceAuthorityGrantTool.js"),
  false,
  "getGovernancePool writes must not be required in the DB_USER write inventory",
);

const repositoryGovernanceRows = report.inventory.filter((row) => row.file === "repositoryGovernanceV6.js");
assert.ok(
  repositoryGovernanceRows.some((row) => row.db_binding === RUNTIME_PERSISTENCE_DB_BINDING),
  "repositoryGovernanceV6 runtime getPool writes must remain visible",
);
assert.ok(
  repositoryGovernanceRows.some((row) =>
    row.operation === "INSERT"
    && row.table === "platform_resource_authority_bindings"
    && row.db_binding === GOVERNANCE_CONTROL_DB_BINDING),
  "repositoryGovernanceV6 authority-binding insert must be governance-bound",
);
assert.equal(
  report.db_user_inventory.some((row) =>
    row.file === "repositoryGovernanceV6.js"
    && row.operation === "INSERT"
    && row.table === "platform_resource_authority_bindings"),
  false,
  "governance authority-binding insert must not be labeled DB_USER",
);

const migrationRows = report.inventory.filter((row) => row.classification === "migration/DDL/admin");
assert.ok(migrationRows.length > 0, "inventory must retain migration/DDL/admin write surfaces");

const allowedClasses = new Set(report.classification_values);
const allowedBindings = new Set(report.db_binding_values);
assert.ok(report.inventory.every((row) => allowedClasses.has(row.classification)), "every mutation surface must be classified");
assert.ok(report.inventory.every((row) => allowedBindings.has(row.db_binding)), "every mutation surface must have a DB binding");
assert.ok(report.db_user_inventory.every((row) => row.db_binding === RUNTIME_PERSISTENCE_DB_BINDING));

console.log(JSON.stringify({
  contract: report.contract,
  binding_contract: report.binding_contract,
  summary: report.summary,
  governed_response_chunk_operations: chunkRows.map(({ operation, table }) => ({ operation, table })),
  window2_surface_count: window2Rows.length,
  repository_governance_runtime_surface_count: repositoryGovernanceRows.filter((row) => row.db_binding === RUNTIME_PERSISTENCE_DB_BINDING).length,
  secrets_included: false,
}));
