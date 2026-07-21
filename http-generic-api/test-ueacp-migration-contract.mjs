import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { splitGovernedMigrationStatements } from "./governedMigrationExecutionTool.js";

const migrationUrl = new URL(
  "./migrations/20260721_ueacp_connector_inventory_read.sql",
  import.meta.url
);
const sql = readFileSync(migrationUrl, "utf8");
const checksum = createHash("sha256").update(sql, "utf8").digest("hex");
const statements = splitGovernedMigrationStatements(sql);

assert.equal(
  checksum,
  "4227bc9f3168200c9f55e3579ef036addad020bffeeed7de4b316569a085c046"
);
assert.equal(statements.length, 2);
assert.match(sql, /INSERT INTO platform_semantic_capabilities/i);
assert.match(sql, /'connector\.inventory\.read'/);
assert.match(sql, /ON DUPLICATE KEY UPDATE/i);
assert.match(sql, /START TRANSACTION;/i);
assert.match(sql, /COMMIT;/i);
assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE|DELETE)\b/i);
assert.doesNotMatch(sql, /\bALTER\s+TABLE\b/i);
assert.doesNotMatch(sql, /\bUPDATE\s+connected_systems\b/i);
assert.doesNotMatch(sql, /\bUPDATE\s+installations\b/i);

console.log("UEACP migration contract tests passed");
