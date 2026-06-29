import assert from "node:assert/strict";
import {
  classifyAdminControlDbSql,
  evaluateGptToolDispatchPreflight,
  resolveGptToolInvocationMutationRequirement,
} from "./governedExecutionPreflight.js";
import { readActivationRunArchive } from "./activationSessionLifecycleService.js";

const emptyPolicyDeps = {
  skipSurfaceAuthority: true,
  pool: {
    async query(sql) {
      const text = String(sql || "");
      if (text.includes("FROM `execution_policies`")) return [[]];
      if (text.includes("FROM platform_engine_policy_rules")) return [[]];
      throw new Error(`Unexpected SQL in test policy resolver: ${text.slice(0, 120)}`);
    },
  },
};

for (const sql of [
  "SELECT session_id FROM activation_runs WHERE run_id = ? LIMIT 1",
  "-- bounded read\nSELECT session_id FROM activation_runs",
  "WITH latest AS (SELECT session_id FROM activation_runs) SELECT * FROM latest",
  "SHOW COLUMNS FROM activation_runs",
  "EXPLAIN SELECT * FROM activation_runs",
]) {
  assert.equal(classifyAdminControlDbSql(sql).mutation_required, false, sql);
  assert.equal(resolveGptToolInvocationMutationRequirement({
    toolKey: "admin_control",
    method: "POST",
    tags: ["admin"],
    args: { tool: "db", sql },
  }), false, sql);
}

for (const sql of [
  "UPDATE activation_runs SET run_status = 'done' WHERE run_id = ?",
  "WITH target AS (SELECT run_id FROM activation_runs) UPDATE activation_runs SET run_status='done'",
  "SELECT 1; UPDATE activation_runs SET run_status='done'",
  "ALTER TABLE activation_runs ADD COLUMN unsafe_example INT",
]) {
  assert.equal(classifyAdminControlDbSql(sql).mutation_required, true, sql);
}

const selectPreflight = await evaluateGptToolDispatchPreflight({
  callerType: "admin",
  toolKey: "admin_control",
  method: "POST",
  tags: ["admin"],
  args: { tool: "db", sql: "SELECT session_id FROM activation_runs WHERE run_id = ? LIMIT 1", params: ["run-1"] },
}, emptyPolicyDeps);
assert.equal(selectPreflight.ok, true);
assert.equal(selectPreflight.classification, "allow");
assert.equal(selectPreflight.evidence.invocation_mutation_required, false);

const expectedRow = {
  run_id: "run-1",
  session_id: "session-1",
  tenant_id: "tenant-1",
  user_id: "user-1",
  drive_export_url: "https://drive.example/archive",
};
const calls = [];
const pool = {
  async query(sql, params) {
    calls.push({ sql: String(sql), params });
    return [[expectedRow]];
  },
};

const adminResult = await readActivationRunArchive(pool, {
  runId: "run-1",
  subject: { is_admin: true },
});
assert.equal(adminResult.found, true);
assert.equal(adminResult.archive.session_id, "session-1");
assert.deepEqual(calls[0].params, ["run-1"]);
assert.doesNotMatch(calls[0].sql, /r\.tenant_id = \?/);

const tenantResult = await readActivationRunArchive(pool, {
  runId: "run-1",
  subject: { is_admin: false, tenant_id: "tenant-1", user_id: "user-1" },
});
assert.equal(tenantResult.authorization.scope, "tenant_user_owner");
assert.deepEqual(calls[1].params, ["run-1", "tenant-1", "user-1"]);
assert.match(calls[1].sql, /r\.tenant_id = \? AND r\.user_id = \?/);

await assert.rejects(
  () => readActivationRunArchive(pool, { runId: "run-1", subject: { is_admin: false, tenant_id: "tenant-1" } }),
  (error) => error.code === "activation_run_archive_subject_required",
);

console.log("activation run archive lookup and admin control SELECT tests passed");
