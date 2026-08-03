import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildSpec012GovernedPolicyMigrationReadiness,
} from "./scripts/spec012-governed-policy-migration-readiness.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const closeout = JSON.parse(read(
  "specs/012-tenant-activation-lifecycle/implementation/pr-2h-policy-post-merge-and-t026-readiness.json",
));

assert.equal(closeout.status, "complete_on_main");
assert.equal(closeout.source_pull_request, 4181);
assert.equal(closeout.validated_head_sha, "163d798d02258c93e74a9efc40f1e16b7c19df98");
assert.equal(closeout.merge_sha, "78c497c5a0f71df297cac0e204acd2044374872c");
assert.equal(closeout.merge_is_main_ancestor, true);
assert.deepEqual(closeout.completed_tasks, [
  "T018",
  "T019",
  "T024B",
  "T025",
  "T029A",
  "T029B",
  "T029C",
]);
assert.equal(closeout.exact_head_verification.status, "pass");
assert.equal(closeout.exact_head_verification.unresolved_review_threads, 0);
assert.equal(closeout.t026.status, "readiness_required");
assert.equal(closeout.t026.authorization_registered, false);
assert.equal(closeout.t026.apply_authorized, false);
assert.equal(closeout.t026.migration_applied, false);
assert.equal(closeout.non_effects.database_mutation_performed, false);
assert.equal(closeout.non_effects.secrets_included, false);

const readiness = await buildSpec012GovernedPolicyMigrationReadiness({
  apiDir: path.join(root, "http-generic-api"),
});

assert.equal(readiness.status, "ready_for_governed_preflight");
assert.equal(readiness.ready, true);
assert.equal(readiness.task, "T026");
assert.equal(readiness.migrations.length, 2);
assert.equal(readiness.authorization_status, "not_authorized");
assert.equal(readiness.apply_allowed, false);
assert.equal(readiness.database_mutation_performed, false);
assert.equal(readiness.migration_ledger_write_performed, false);
assert.equal(readiness.secrets_included, false);

for (const migration of readiness.migrations) {
  assert.match(migration.checksum_sha256, /^[a-f0-9]{64}$/u);
  assert.ok(migration.statement_count > 0);
  assert.equal(migration.static_preflight.status, "pass");
  assert.deepEqual(migration.missing_expected_tables, []);
  assert.deepEqual(migration.destructive_findings, []);
  assert.equal(migration.seed_mutation_detected, false);
  assert.equal(migration.authorization_embedded, false);
  assert.equal(migration.ordering_contract_satisfied, true);
  assert.equal(migration.readiness_status, "ready_for_governed_preflight");
  assert.equal(migration.applies_sql, false);
  assert.equal(migration.records_ledger, false);
}

const tasks = read("specs/012-tenant-activation-lifecycle/tasks.md");
assert.match(tasks, /- \[ \] \*\*T026\*\*/u);

const contracts = read("http-generic-api/test-governed-policy-migration-and-contracts.mjs");
assert.match(contracts, /x-runtime-wired: false/u);
assert.match(contracts, /x-migration-authorized: false/u);

console.log("Spec 012 policy closeout and T026 readiness tests passed");
