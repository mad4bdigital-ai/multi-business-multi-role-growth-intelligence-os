import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const schema = fs.readFileSync(path.join(here, "schema.sql"), "utf8");
const migration = fs.readFileSync(
  path.join(here, "migrations", "20260924_execution_policies_stable_semantic_identity.sql"),
  "utf8",
);

const tableMatch = schema.match(
  /CREATE TABLE IF NOT EXISTS `execution_policies` \(([\s\S]*?)\) ENGINE=/u,
);
assert.ok(tableMatch, "execution_policies baseline table must exist");

const tableDefinition = tableMatch[1];
assert.match(
  tableDefinition,
  /UNIQUE KEY `uq_execution_policies_policy_identity`\s*\(`policy_group`, `policy_key`\)/u,
  "execution_policies baseline must expose the stable natural identity as a UNIQUE key",
);
assert.doesNotMatch(
  tableDefinition,
  /KEY `idx_policy_group_key` \(`policy_group`, `policy_key`\)/u,
  "legacy non-unique execution_policies identity index must not remain in the baseline",
);

assert.match(
  migration,
  /ALTER TABLE `execution_policies`[\s\S]*DROP INDEX IF EXISTS `idx_policy_group_key`[\s\S]*ADD UNIQUE KEY IF NOT EXISTS `uq_execution_policies_policy_identity`\s*\(`policy_group`, `policy_key`\);/u,
  "migration must idempotently replace the legacy index with the stable UNIQUE identity",
);

console.log(JSON.stringify({
  ok: true,
  table: "execution_policies",
  unique_index: "uq_execution_policies_policy_identity",
  columns: ["policy_group", "policy_key"],
  staging_database_mutated: false,
  production_mutated: false,
  secrets_included: false,
}));
