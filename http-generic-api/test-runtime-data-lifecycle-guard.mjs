import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const output = execFileSync(process.execPath, ["scripts/runtime-data-lifecycle-guard.mjs"], { cwd: new URL(".", import.meta.url), encoding: "utf8" });
const report = JSON.parse(output);
const selfTest = JSON.parse(execFileSync(process.execPath, ["scripts/runtime-data-lifecycle-guard.mjs", "--self-test"], { cwd: new URL(".", import.meta.url), encoding: "utf8" }));
const contract = JSON.parse(fs.readFileSync(new URL("config/runtime-data-lifecycle-contract.json", import.meta.url), "utf8"));

assert.equal(report.ok, true);
assert.equal(report.selection.mode, "git_diff");
assert.equal(selfTest.numeric_and_dated_migrations_selected, true);
assert.equal(report.safety.database_connection_performed, false);
assert.equal(report.safety.database_mutation_performed, false);
assert.equal(report.safety.provider_access_performed, false);
assert.equal(report.safety.production_access_performed, false);
assert.ok(report.inventory.some((item) => item.file === "20260920_platform_admin_workspace_canonical_seed.sql" && item.table === "workspace_registry"));
assert.equal(contract.datasets.workspace_registry.canonical_rows[0].cardinality, "exactly_one");
assert.equal(contract.datasets.memberships.reseed_forbidden, true);
assert.equal(contract.table_families[0].zero_rows_allowed, false);
assert.equal(contract.enforcement.legacy_exclusions.length, 0);
assert.equal(contract.datasets.remote_runtime_command_allowlists.canonical_rows[0].cardinality, "exactly_one");
assert.equal(contract.datasets.execution_policies.canonical_rows[0].cardinality, "exactly_one");

console.log("runtime data lifecycle guard tests passed");
