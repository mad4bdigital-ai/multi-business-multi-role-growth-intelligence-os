import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const evidencePath = new URL("../specs/011-durable-governed-execution-and-agent-delegation/schemas/phase7-authoritative-evidence.schema.json", import.meta.url);
const changeSetPath = new URL("../specs/011-durable-governed-execution-and-agent-delegation/schemas/phase7-closeout-change-set.schema.json", import.meta.url);

const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
const changeSet = JSON.parse(readFileSync(changeSetPath, "utf8"));

assert.equal(evidence.$schema, "https://json-schema.org/draft/2020-12/schema");
assert.equal(evidence.properties.version.const, "spec011-evidence-auto-closeout-v1");
assert.equal(evidence.properties.secrets_included.const, false);
assert.equal(evidence.$defs.observation.properties.authoritative.const, true);
assert.equal(evidence.$defs.observation.properties.immutable.const, true);
assert.equal(evidence.$defs.observation.properties.secrets_included.const, false);
for (const family of [
  "pull_request",
  "workflow_run",
  "workflow_artifact",
  "main_readback",
  "migration_ledger",
  "production_parity",
  "post_merge_audit",
]) assert(evidence.$defs.family.enum.includes(family), `missing evidence family ${family}`);

assert.equal(changeSet.$schema, "https://json-schema.org/draft/2020-12/schema");
assert.equal(changeSet.properties.version.const, "spec011-evidence-auto-closeout-v1");
assert.equal(changeSet.properties.force_push_allowed.const, false);
assert.equal(changeSet.properties.protected_branch_write_allowed.const, false);
assert.equal(changeSet.properties.secrets_included.const, false);
assert.equal(changeSet.properties.changes.maxItems, 5);
for (const kind of [
  "manifest_json",
  "completion_json",
  "checklist_markdown",
  "tasks_markdown",
  "delivery_state_json",
]) assert(changeSet.$defs.kind.enum.includes(kind), `missing closeout document kind ${kind}`);
for (const operation of [
  "json_pointer_set",
  "markdown_task_complete",
  "markdown_checklist_complete",
]) assert(changeSet.$defs.operation.properties.type.enum.includes(operation), `missing semantic operation ${operation}`);

console.log("Spec 011 evidence auto-closeout schema tests passed");
