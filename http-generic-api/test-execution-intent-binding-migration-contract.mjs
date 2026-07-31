import assert from "node:assert/strict";
import fs from "node:fs";

const sql = fs.readFileSync(
  new URL("./migrations/20260730_spec011_execution_intent_contract_bindings.sql", import.meta.url),
  "utf8",
);

assert.match(sql, /CREATE TABLE IF NOT EXISTS execution_intent_contract_bindings/i);
for (const column of [
  "intent_key",
  "principal_scope",
  "tenant_binding_mode",
  "parent_action_key",
  "endpoint_key",
  "capability_key",
  "runtime_surface",
  "priority",
  "binding_revision",
  "valid_from",
  "expires_at",
]) {
  assert.match(sql, new RegExp(`\\b${column}\\b`, "i"), `missing intent binding column: ${column}`);
}
assert.match(sql, /UNIQUE KEY uq_execution_intent_binding_revision/i);
assert.match(sql, /KEY idx_execution_intent_binding_resolution/i);
assert.match(sql, /ENGINE=InnoDB/i);
assert.match(sql, /CHARSET=utf8mb4/i);
assert.doesNotMatch(sql, /\bINSERT\s+INTO\b/i, "migration contract must not seed tenant or customer bindings");
assert.doesNotMatch(sql, /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i, "migration must not contain fixed UUID identifiers");

console.log("execution intent binding migration contract tests passed");
