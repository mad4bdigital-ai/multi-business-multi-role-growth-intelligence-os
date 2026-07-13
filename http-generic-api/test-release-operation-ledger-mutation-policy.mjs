import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasDeclaredMutationPolicy } from "./governedExecutionPreflight.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migration = fs.readFileSync(
  path.join(__dirname, "migrations", "20260713_release_operation_ledger_mutation_policy.sql"),
  "utf8",
);

for (const toolKey of [
  "release_operation_create",
  "release_operation_step_append",
  "release_operation_evidence_append",
  "release_operation_gate_event_append",
  "release_operation_finalize",
]) {
  assert.match(migration, new RegExp(toolKey));
}

assert.match(migration, /same_cycle_readback/);
assert.match(migration, /release_operation_internal_persistence_policy_v1/);
assert.match(migration, /provider_write_allowed', FALSE/);
assert.match(migration, /external_mutation_allowed', FALSE/);
assert.doesNotMatch(migration, /DROP\s+|DELETE\s+FROM|TRUNCATE\s+/i);

assert.equal(hasDeclaredMutationPolicy({ tags: ["internal_persistence", "readback", "same_cycle_readback"] }), true);
assert.equal(hasDeclaredMutationPolicy({ tags: ["internal_persistence", "no_provider_write"] }), false);

console.log("release operation ledger mutation policy tests passed");
