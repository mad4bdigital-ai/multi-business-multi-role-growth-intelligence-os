import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { STAGING_ROLE_GRANT_POLICIES } from "./databasePrivilegeContracts.js";
import { compareRolePrivilegeEvidence, inspectStagingPrivilegeDrift } from "./scripts/staging-role-privilege-drift-audit.mjs";

const NAMES = { runtime: "growth_runtime", governance: "governance_platform", runtime_persistence: "growth_persistence" };
const ACCOUNTS = { runtime: "runtime_app@%", governance: "governance_app@%", runtime_persistence: "persistence_app@%" };
function evidence(role, overrides = {}) {
  const spec = STAGING_ROLE_GRANT_POLICIES[role];
  const tables = [...spec.required_tables, ...spec.optional_tables];
  const tableRows = tables.map((TABLE_NAME) => ({ TABLE_NAME }));
  const tablePrivilegeRows = tables.flatMap((table) =>
    (spec.required_operations_by_table?.[table] || spec.required_operations).map((PRIVILEGE_TYPE) => ({
      TABLE_SCHEMA: NAMES[role], TABLE_NAME: table, PRIVILEGE_TYPE, IS_GRANTABLE: "NO",
    })),
  );
  return {
    role, expectedDatabase: NAMES[role],
    identityRows: [{ current_account: ACCOUNTS[role], current_database: NAMES[role] }],
    tableRows, tablePrivilegeRows, userPrivilegeRows: [{ PRIVILEGE_TYPE: "USAGE" }],
    schemaPrivilegeRows: [], columnPrivilegeRows: [], applicableRoleRows: [], ...overrides,
  };
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }

test("all three roles pass their exact required privileges with separate principals", () => {
  for (const role of Object.keys(NAMES)) {
    const actual = compareRolePrivilegeEvidence(evidence(role));
    assert.equal(actual.ready, true, JSON.stringify(actual.issues));
    assert.equal(actual.missing_required_grants.length, 0);
    assert.equal(actual.excessive_table_grants.length, 0);
  }
  const runtime = compareRolePrivilegeEvidence(evidence("runtime"));
  assert.deepEqual(runtime.local_manager_contract_differences.map((x) => x.table).sort(), [
    "connected_systems", "installations", "local_connector_device_aliases",
  ]);
});

test("runtime audit_log permits SELECT and INSERT but rejects UPDATE or DELETE", () => {
  const original = evidence("runtime");
  const withoutAudit = clone(original);
  withoutAudit.tablePrivilegeRows = withoutAudit.tablePrivilegeRows.filter((x) =>
    !(x.TABLE_NAME === "audit_log" && x.PRIVILEGE_TYPE === "INSERT"));
  const missing = compareRolePrivilegeEvidence(withoutAudit);
  assert.equal(missing.ready, false);
  assert.ok(missing.missing_required_grants.includes("audit_log:INSERT"));
  const withExtra = clone(original);
  withExtra.tablePrivilegeRows.push({
    TABLE_SCHEMA: NAMES.runtime, TABLE_NAME: "audit_log", PRIVILEGE_TYPE: "DELETE", IS_GRANTABLE: "NO",
  });
  const extra = compareRolePrivilegeEvidence(withExtra);
  assert.equal(extra.ready, false);
  assert.ok(extra.excessive_table_grants.includes("audit_log:DELETE"));
  assert.deepEqual(STAGING_ROLE_GRANT_POLICIES.runtime.required_operations_by_table.audit_log, ["SELECT", "INSERT"]);
});

test("table not visible cannot be incorrectly called physically absent", () => {
  const v = evidence("governance");
  v.tableRows = v.tableRows.filter((x) => x.TABLE_NAME !== "deployment_attestations");
  const r = compareRolePrivilegeEvidence(v);
  assert.ok(r.issues.includes("REQUIRED_TABLE_MISSING_OR_INVISIBLE"));
  assert.ok(r.required_tables_missing_or_invisible.includes("deployment_attestations"));
  assert.ok(r.unassessed_required_grants_on_hidden_surfaces.includes("deployment_attestations:SELECT"));
  assert.ok(r.unassessed_required_grants_on_hidden_surfaces.includes("deployment_attestations:INSERT"));
  assert.ok(r.unassessed_required_grant_count > 0);
  assert.equal(r.missing_required_grants.some((grant) => grant.startsWith("deployment_attestations:")), false);
  assert.equal(r.expected_direct_grants_if_all_required_surfaces_exist,
    r.expected_direct_grants_on_visible_surfaces + r.unassessed_required_grant_count);
  const optional = evidence("runtime");
  optional.tableRows = optional.tableRows.filter((x) => x.TABLE_NAME !== "v_activation_pending_tasks");
  optional.tablePrivilegeRows = optional.tablePrivilegeRows.filter((x) => x.TABLE_NAME !== "v_activation_pending_tasks");
  const o = compareRolePrivilegeEvidence(optional);
  assert.equal(o.ready, true);
  assert.ok(o.optional_tables_missing_or_invisible.includes("v_activation_pending_tasks"));
});

test("eight hidden but physically extant runtime tables remain unassessed, not certified absent", () => {
  const hidden = new Set([
    "audit_log", "endpoints", "platform_endpoint_tool_exports",
    "remote_mcp_oauth_authorization_codes", "remote_mcp_oauth_clients",
    "remote_mcp_oauth_grants", "tenant_secrets", "user_app_connections",
  ]);
  const missingOps = new Set([
    "platform_runtime_config:INSERT", "platform_runtime_config:UPDATE",
    "platform_secrets:INSERT", "platform_secrets:UPDATE",
    "secret_references:INSERT", "secret_references:UPDATE",
  ]);
  const input = evidence("runtime");
  input.tableRows = input.tableRows.filter((r) => !hidden.has(r.TABLE_NAME));
  input.tablePrivilegeRows = input.tablePrivilegeRows.filter((r) =>
    !hidden.has(r.TABLE_NAME) && !missingOps.has(r.TABLE_NAME + ":" + r.PRIVILEGE_TYPE));
  const result = compareRolePrivilegeEvidence(input);
  assert.equal(result.ready, false);
  assert.deepEqual(result.required_tables_missing_or_invisible, [...hidden].sort());
  assert.deepEqual(result.missing_required_grants, [...missingOps].sort());
  assert.equal(result.unassessed_required_grant_count, 15);
  assert.equal(result.unassessed_required_grants_on_hidden_surfaces.length, 15);
  assert.ok(result.unassessed_required_grants_on_hidden_surfaces.includes("audit_log:SELECT"));
  assert.ok(result.unassessed_required_grants_on_hidden_surfaces.includes("audit_log:INSERT"));
  assert.equal(result.excessive_table_grants.length, 0);
  assert.equal(result.missing_required_grants.length + result.unassessed_required_grant_count, 21);
});

test("detect global/schema/column grants, GRANT OPTION, roles and cross-database leakage", () => {
  const v = evidence("runtime");
  v.userPrivilegeRows.push({ PRIVILEGE_TYPE: "CREATE" });
  v.schemaPrivilegeRows.push({ TABLE_SCHEMA: NAMES.runtime, PRIVILEGE_TYPE: "UPDATE" });
  v.columnPrivilegeRows.push({ TABLE_SCHEMA: NAMES.runtime, TABLE_NAME: "users", COLUMN_NAME: "email", PRIVILEGE_TYPE: "UPDATE" });
  v.applicableRoleRows.push({ ROLE_NAME: "unexpected_role" });
  v.tablePrivilegeRows.push({ TABLE_SCHEMA: "governance_platform", TABLE_NAME: "approval_holds", PRIVILEGE_TYPE: "SELECT", IS_GRANTABLE: "YES" });
  const result = compareRolePrivilegeEvidence(v);
  assert.equal(result.ready, false);
  for (const code of [
    "UNEXPECTED_GLOBAL_PRIVILEGES", "UNEXPECTED_SCHEMA_PRIVILEGES",
    "UNEXPECTED_COLUMN_PRIVILEGES", "GRANT_OPTION_PRESENT", "APPLICABLE_ROLES_PRESENT",
    "CROSS_DATABASE_TABLE_PRIVILEGES",
  ]) assert.ok(result.issues.includes(code), code);
});

test("read-only orchestrator queries all three DBs and never changes source privileges", async () => {
  const queries = [];
  const released = [];
  const pools = Object.fromEntries(Object.keys(NAMES).map((role) => [role, () => ({
    async getConnection() {
      const data = evidence(role);
      return {
        release() { released.push(role); },
        async query(sql, args = []) {
          queries.push({ role, sql, args });
          if (sql.startsWith("SELECT CURRENT_USER()")) return [data.identityRows];
          if (sql.includes("information_schema.TABLES")) return [data.tableRows];
          if (sql.includes("information_schema.TABLE_PRIVILEGES")) return [data.tablePrivilegeRows];
          if (sql.includes("information_schema.USER_PRIVILEGES")) return [data.userPrivilegeRows];
          if (sql.includes("information_schema.SCHEMA_PRIVILEGES")) return [data.schemaPrivilegeRows];
          if (sql.includes("information_schema.COLUMN_PRIVILEGES")) return [data.columnPrivilegeRows];
          if (sql.includes("information_schema.APPLICABLE_ROLES")) return [data.applicableRoleRows];
          throw new Error("UNKNOWN_READ_QUERY");
        },
      };
    },
  })]));
  const result = await inspectStagingPrivilegeDrift({
    env: { NODE_ENV: "staging", DEPLOYMENT_ENVIRONMENT: "staging_local_windows_docker", DB_NAME: NAMES.runtime, GOVERNANCE_DB_NAME: NAMES.governance, RUNTIME_PERSISTENCE_DB_NAME: NAMES.runtime_persistence },
    pools,
  });
  assert.equal(result.ready, true, JSON.stringify(result.errors));
  assert.equal(result.results.length, 3);
  assert.equal(queries.length, 21);
  assert.deepEqual(released.sort(), Object.keys(NAMES).sort());
  assert.ok(queries.every((q) => /^SELECT\s/i.test(q.sql)));
  assert.ok(!JSON.stringify(result).includes("runtime_app"));
  assert.ok(!JSON.stringify(result).includes("governance_app"));
  assert.equal(result.secrets_included, false);
});

test("Production or unknown environment is blocked before any DB connection", async () => {
  let calls = 0;
  const output = await inspectStagingPrivilegeDrift({
    env: { NODE_ENV: "production", DEPLOYMENT_ENVIRONMENT: "production_hostinger" },
    pools: { runtime: () => { calls += 1; throw new Error("should not connect"); } },
  });
  assert.equal(output.ready, false);
  assert.equal(output.errors[0].code, "NON_STAGING_ENVIRONMENT_BLOCKED");
  assert.equal(calls, 0);
});

test("unavailable DB makes the entire audit fail closed", async () => {
  const r = await inspectStagingPrivilegeDrift({
    env: { NODE_ENV: "staging", DEPLOYMENT_ENVIRONMENT: "staging_local_windows_docker", DB_NAME: NAMES.runtime, GOVERNANCE_DB_NAME: NAMES.governance, RUNTIME_PERSISTENCE_DB_NAME: NAMES.runtime_persistence },
    pools: { runtime: () => { throw Object.assign(new Error("network failure"), { code: "ECONNREFUSED" }); },
      governance: () => { throw Object.assign(new Error("network failure"), { code: "ECONNREFUSED" }); },
      runtime_persistence: () => { throw Object.assign(new Error("network failure"), { code: "ECONNREFUSED" }); } },
  });
  assert.equal(r.ready, false);
  assert.equal(r.all_roles_read, false);
  assert.equal(r.errors.length, 3);
  assert.ok(!JSON.stringify(r).includes("network failure"));
});

// Defense in depth: a read-only inventory must not transitively introduce any write SQL.
const auditorSource = readFileSync(new URL("./scripts/staging-role-privilege-drift-audit.mjs", import.meta.url), "utf8");
assert.doesNotMatch(auditorSource, /connection\.query\(["'`]\s*(?:GRANT|REVOKE|INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/i);
