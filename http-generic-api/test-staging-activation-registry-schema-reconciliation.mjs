import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { splitMigrationSqlStatements } from "./migrationSqlStatements.js";
import {
  publicStagingReadinessRemediationContract,
  readStagingRuntimeBootstrapContract,
} from "./stagingRuntimeBootstrapContract.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION =
  "20261003_staging_activation_registry_schema_reconciliation.sql";
const SHA256 =
  "43f6ce96bfd575d71225ff68f1c5bad74625535cfdacb8059e3c734ab6708b6c";

const EXPECTED_POSTCONDITIONS = [
  ["activation_dynamic_tab_registry", "tab_key"],
  ["activation_dynamic_tab_section_registry", "section_key"],
  ["activation_dynamic_tab_discovery_rule_registry", "rule_key"],
  ["activation_section_action_registry", "action_ref_key"],
  ["activation_attention_rule_registry", "rule_key"],
  ["activation_freshness_policy_registry", "policy_key"],
  ["activation_signal_subscription_registry", "subscription_key"],
  ["activation_connector_pack_registry", "pack_key"],
];

test("Staging catalogs the Activation registry schema-only repair", () => {
  const contract = readStagingRuntimeBootstrapContract();
  const spec = contract.migrations[MIGRATION];

  assert.ok(spec);
  assert.equal(spec.sha256, SHA256);
  assert.equal(spec.statement_count, 8);
  assert.equal(spec.role, "runtime");
  assert.deepEqual(spec.requires_tables, []);
  assert.deepEqual(spec.allowed_modes, ["dry_run", "apply_migration"]);

  const postconditions = contract.postconditions[MIGRATION];
  assert.equal(postconditions.length, 8);

  assert.deepEqual(
    postconditions.map(({ type, table, column }) => [type, table, column]),
    EXPECTED_POSTCONDITIONS.map(([table, column]) => [
      "column",
      table,
      column,
    ]),
  );
});

test("Activation registry reconciliation remains pinned and schema-only", () => {
  const migrationPath = path.join(HERE, "migrations", MIGRATION);
  const sql = fs.readFileSync(migrationPath, "utf8");

  assert.equal(
    crypto.createHash("sha256").update(sql).digest("hex"),
    SHA256,
  );

  assert.equal(splitMigrationSqlStatements(sql).length, 8);

  assert.doesNotMatch(
    sql,
    /^\s*(?:INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|DROP\s+|TRUNCATE\s+|GRANT\s+|REVOKE\s+)/imu,
  );

  for (const [table] of EXPECTED_POSTCONDITIONS) {
    assert.match(
      sql,
      new RegExp(
        `CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+\`?${table}\`?`,
        "iu",
      ),
    );
  }
});

test("public Staging repair catalog exposes the Activation registry repair", () => {
  const entry =
    publicStagingReadinessRemediationContract()
      .schema_repair_migrations
      .find(({ file }) => file === MIGRATION);

  assert.ok(entry);
  assert.equal(entry.sha256, SHA256);
  assert.equal(entry.statement_count, 8);
  assert.equal(entry.role, "runtime");
  assert.deepEqual(entry.allowed_modes, ["dry_run", "apply_migration"]);
});