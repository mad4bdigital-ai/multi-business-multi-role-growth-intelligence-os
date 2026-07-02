import assert from "node:assert/strict";
import { classifyAdminControlDbSql, evaluateGptToolDispatchPreflight, resolveGptToolInvocationMutationRequirement } from "./governedExecutionPreflight.js";
import { readActivationRunArchive } from "./activationSessionLifecycleService.js";
import { resolveDynamicResourceAuthority } from "./dynamicResourceAuthority.js";

const emptyPolicyDeps = {
  skipSurfaceAuthority: true,
  pool: {
    async query(sql) {
      const value = String(sql || "");
      if (value.includes("FROM `execution_policies`")) return [[]];
      if (value.includes("FROM platform_engine_policy_rules")) return [[]];
      throw new Error(`Unexpected SQL in test policy resolver: ${value.slice(0, 120)}`);
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
  assert.equal(resolveGptToolInvocationMutationRequirement({ toolKey: "admin_control", method: "POST", tags: ["admin"], args: { tool: "db", sql } }), false, sql);
}

for (const sql of [
  "SELECT * FROM activation_runs FOR UPDATE",
  "SELECT * FROM activation_runs INTO OUTFILE '/tmp/archive.csv'",
  "SELECT COUNT(*) INTO @archive_count FROM activation_runs",
  "UPDATE activation_runs SET run_status = 'done' WHERE run_id = ?",
  "WITH target AS (SELECT run_id FROM activation_runs) UPDATE activation_runs SET run_status='done'",
  "SELECT 1; UPDATE activation_runs SET run_status='done'",
  "ALTER TABLE activation_runs ADD COLUMN unsafe_example INT",
]) assert.equal(classifyAdminControlDbSql(sql).mutation_required, true, sql);

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

const expectedRow = { run_id: "run-1", session_id: "session-1", tenant_id: "tenant-1", user_id: "user-1", drive_export_url: "https://drive.example/archive" };
const calls = [];
const pool = { async query(sql, params) { calls.push({ sql: String(sql), params }); return [[expectedRow]]; } };
const adminResult = await readActivationRunArchive(pool, { runId: "run-1", subject: { is_admin: true } });
assert.equal(adminResult.found, true);
assert.equal(adminResult.archive.session_id, "session-1");
assert.deepEqual(calls[0].params, ["run-1"]);
assert.doesNotMatch(calls[0].sql, /r\.tenant_id = \?/);
const tenantResult = await readActivationRunArchive(pool, { runId: "run-1", subject: { is_admin: false, tenant_id: "tenant-1", user_id: "user-1" } });
assert.equal(tenantResult.authorization.scope, "tenant_user_owner");
assert.deepEqual(calls[1].params, ["run-1", "tenant-1", "user-1"]);
assert.match(calls[1].sql, /r\.tenant_id = BINARY \? AND BINARY r\.user_id = BINARY \?/);
await assert.rejects(
  () => readActivationRunArchive(pool, { runId: "run-1", subject: { is_admin: false, tenant_id: "tenant-1" } }),
  (error) => error.code === "activation_run_archive_subject_required",
);

const authorityQueries = [];
const authorityPool = {
  async query(sql, params) {
    authorityQueries.push({ sql: String(sql), params });
    if (String(sql).includes("FROM platform_resource_authority_bindings")) return [[{
      binding_id: "binding-1", tenant_id: "tenant-1", workspace_id: "workspace-1", user_id: null,
      permission_level: "edit",
      allowed_modes_json: JSON.stringify(["select", "update"]), authority_source: "workspace_owner_grant",
      source_system_id: "system-1", source_installation_id: "installation-1",
      source_system_status: "active", source_system_tenant_id: "tenant-1",
      source_installation_status: "active", source_installation_tenant_id: "tenant-1", source_installation_expires_at: null,
    }]];
    if (String(sql).includes("FROM v_workspace_resource_grant_effective")) return [[{
      grant_id: "grant-1", resource_type: "workspace", resource_ref: "workspace-1", permission: "owner",
    }]];
    throw new Error(`Unexpected authority SQL: ${String(sql).slice(0, 120)}`);
  },
};
const authorityResult = await resolveDynamicResourceAuthority({
  callerType: "tenant",
  principal: { tenant_id: "tenant-1", user_id: "user-1" },
  toolKey: "admin_control",
  args: { tool: "db", authority_context: {
    tenant_id: "tenant-1", user_id: "user-1", workspace_id: "workspace-1", brand_key: "brand-1",
    resource_type: "sql_runtime_resource", resource_uri: "sql://tenant-1/runtime-primary", operation_mode: "select",
    source_system_id: "system-1", source_installation_id: "installation-1",
  } },
  mutationRequired: false,
  pool: authorityPool,
});
assert.equal(authorityResult.ok, true);
assert.equal(authorityResult.binding_id, "binding-1");
assert.equal(authorityResult.owner_grant_id, "grant-1");
assert.equal(authorityQueries.length, 2);

async function resolvePermissionCase({ bindingPermission, grantPermission, mutationRequired }) {
  const permissionPool = {
    async query(sql) {
      const value = String(sql);
      if (value.includes("FROM platform_resource_authority_bindings")) return [[{
        binding_id: "binding-permission", tenant_id: "tenant-1", workspace_id: "workspace-1", user_id: null,
        permission_level: bindingPermission,
        allowed_modes_json: JSON.stringify(["select", "update"]), authority_source: "workspace_owner_grant",
        source_system_id: "system-1", source_installation_id: "installation-1",
        source_system_status: "active", source_system_tenant_id: "tenant-1",
        source_installation_status: "active", source_installation_tenant_id: "tenant-1", source_installation_expires_at: null,
      }]];
      if (value.includes("FROM v_workspace_resource_grant_effective")) return [[{
        grant_id: "grant-permission", resource_type: "workspace", resource_ref: "workspace-1", permission: grantPermission,
      }]];
      throw new Error(`Unexpected permission SQL: ${value.slice(0, 120)}`);
    },
  };
  return resolveDynamicResourceAuthority({
    callerType: "tenant",
    principal: { tenant_id: "tenant-1", user_id: "user-1" },
    toolKey: "admin_control",
    args: { tool: "db", authority_context: {
      tenant_id: "tenant-1", user_id: "user-1", workspace_id: "workspace-1",
      resource_type: "sql_runtime_resource", resource_uri: "sql://tenant-1/runtime-primary",
      operation_mode: mutationRequired ? "update" : "select",
      source_system_id: "system-1", source_installation_id: "installation-1",
    } },
    mutationRequired,
    pool: permissionPool,
  });
}

assert.equal((await resolvePermissionCase({ bindingPermission: "view", grantPermission: "view", mutationRequired: false })).ok, true);
assert.equal((await resolvePermissionCase({ bindingPermission: "edit", grantPermission: "view", mutationRequired: true })).ok, false);
assert.equal((await resolvePermissionCase({ bindingPermission: "edit", grantPermission: "comment", mutationRequired: true })).ok, false);
assert.equal((await resolvePermissionCase({ bindingPermission: "edit", grantPermission: "edit", mutationRequired: true })).ok, true);
assert.equal((await resolvePermissionCase({ bindingPermission: "view", grantPermission: "owner", mutationRequired: true })).ok, false);
assert.equal((await resolvePermissionCase({ bindingPermission: "unknown", grantPermission: "owner", mutationRequired: false })).ok, false);

const tenantOverride = await resolveDynamicResourceAuthority({
  callerType: "tenant",
  principal: { tenant_id: "tenant-1", user_id: "user-1" },
  toolKey: "admin_control",
  args: { tool: "db", authority_context: { tenant_id: "tenant-2" } },
  mutationRequired: true,
  pool: authorityPool,
});
assert.equal(tenantOverride.ok, false);
assert.equal(tenantOverride.reason_code, "resource_authority_tenant_override_forbidden");

console.log("activation run archive lookup, admin_control SELECT, and dynamic resource authority tests passed");
