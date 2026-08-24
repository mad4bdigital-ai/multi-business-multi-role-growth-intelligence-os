import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildHostBreakglassPlan, publicHostBreakglassCatalog, readHostBreakglassRun, readHostBreakglassToolContract, __hostBreakglassTest } from "./hostBreakglassCatalog.js";
const SHA = "a".repeat(40);
const MIGRATION = "20260815_custom_gpt_mcp_catalog_levels.sql";
const REPO_ROOT = path.resolve(process.cwd(), "..");
const SQL_PATH = path.join(REPO_ROOT, ".github/breakglass/sql/test-host-breakglass.sql");
const SHELL_PATH = path.join(REPO_ROOT, ".github/breakglass/shell/test-host-breakglass.sh");
const BACKUP_PATH = path.join(REPO_ROOT, ".github/breakglass/evidence/backup.json");
const SQL = "SELECT 1;\n";
const SHELL = "set -eu\nprintf ok\n";
fs.mkdirSync(path.dirname(SQL_PATH), { recursive: true });
fs.mkdirSync(path.dirname(SHELL_PATH), { recursive: true });
fs.writeFileSync(SQL_PATH, SQL);
fs.writeFileSync(SHELL_PATH, SHELL);
fs.mkdirSync(path.dirname(BACKUP_PATH), { recursive: true });
fs.writeFileSync(BACKUP_PATH, JSON.stringify({ contract: "mad4b.host-breakglass-backup-evidence.v1", environment: "production", status: "verified", target_key: "production-runtime", source_sha: SHA, expires_at: new Date(Date.now() + 3600000).toISOString(), restore_test: { status: "pass" }, secrets_included: false }));
test("catalog is repository-owned and database independent", () => {
  const catalog = publicHostBreakglassCatalog();
  assert.equal(catalog.database_independent, true);
  assert.equal(catalog.destructive_nonempty_rebuild.supported, false);
  assert.equal(catalog.operations.some((item) => item.key === "database.rebuild_empty"), true);
  assert.equal(catalog.tool_contract.default_policy, "deny");
  assert.equal(catalog.tool_contract.denied_capabilities.includes("raw_sql.inline"), true);
});
test("tool contract exposes governed platform capabilities with capsule-only raw exceptions", () => {
  const contract = readHostBreakglassToolContract();
  assert.equal(contract.tools["migration_contract.apply"].executor, "governedMigrationExecutionTool");
  assert.equal(contract.tools["schema_bundle.rebuild_empty"].requires.includes("zero_table_proof"), true);
  assert.equal(Object.hasOwn(contract.tools, "shell.execute"), false);
});
test("empty database rebuild is exact-sha and repository-contract bound", () => {
  const plan = buildHostBreakglassPlan({ operation_key: "database.rebuild_empty", action: "dry_run", expected_sha: SHA, migration: MIGRATION });
  assert.equal(plan.requires_zero_table_database, true);
  assert.equal(plan.dispatch_ref, "main");
  assert.equal(plan.target_branch, "Production");
  assert.equal(plan.destructive_nonempty_rebuild_allowed, false);
  assert.equal(plan.runbook_key, "database.empty_rebuild");
  assert.equal(plan.capability_grants.includes("schema_bundle.rebuild_empty"), false);
  assert.equal(plan.capability_grants.includes("schema_bundle.inspect"), true);
});
test("apply plans receive only runbook-scoped mutation capabilities", () => {
  const repair = buildHostBreakglassPlan({ operation_key: "database.repair", runbook_key: "database.schema_repair", action: "apply_migration", expected_sha: SHA, migration: MIGRATION, confirmation: `APPLY_HOSTINGER_RUNTIME_MIGRATION:${SHA}:production-runtime:${MIGRATION}` });
  assert.equal(repair.capability_grants.includes("migration_contract.apply"), true);
  assert.equal(repair.capability_grants.includes("grant_contract.apply"), false);
  assert.equal(repair.denied_capabilities.includes("credential.export"), true);
  assert.throws(() => buildHostBreakglassPlan({ operation_key: "database.inspect", runbook_key: "database.schema_repair", action: "plan", expected_sha: SHA }), /not allowed/u);
  assert.throws(() => buildHostBreakglassPlan({ operation_key: "database.repair", runbook_key: "database.schema_repair", action: "apply_grants", expected_sha: SHA, confirmation: `APPLY_HOSTINGER_RUNTIME_GRANTS:${SHA}:production-runtime:user:localhost` }), /does not grant/u);
});
test("runtime_env mutation and uncataloged migration fail closed", () => {
  assert.throws(() => buildHostBreakglassPlan({ operation_key: "database.repair", action: "apply_migration", expected_sha: SHA, target_source: "runtime_env", migration: MIGRATION }), /Target source is not allowed/u);
  assert.throws(() => buildHostBreakglassPlan({ operation_key: "database.repair", action: "dry_run", expected_sha: SHA, migration: "arbitrary.sql" }), /not present/u);
});
test("empty rebuild and access repair remain separately approved lifecycles", () => {
  assert.throws(() => buildHostBreakglassPlan({ operation_key: "database.rebuild_empty", action: "apply_grants", expected_sha: SHA, confirmation: `APPLY_HOSTINGER_RUNTIME_GRANTS:${SHA}:production-runtime:user:localhost` }), /not allowed/u);
});
test("raw SQL and Docker shell are capsule-only exceptions", () => {
  const hash = createHash("sha256").update(SQL).digest("hex");
  const sql = buildHostBreakglassPlan({ operation_key: "host.command_capsule", runbook_key: "host.sql_capsule_exception", action: "execute_sql_capsule", expected_sha: SHA, capsule_path: ".github/breakglass/sql/test-host-breakglass.sql", capsule_sha256: hash, backup_evidence_path: ".github/breakglass/evidence/backup.json", confirmation: `EXECUTE_HOST_BREAKGLASS_CAPSULE:production_hostinger_autodeploy:${SHA}:${hash}` });
  assert.equal(sql.capability_grants.includes("raw_sql.execute_exception"), true);
  assert.equal(sql.denied_capabilities.includes("raw_sql.inline"), true);
  assert.throws(() => buildHostBreakglassPlan({ operation_key: "host.command_capsule", runbook_key: "host.sql_capsule_exception", action: "execute_sql_capsule", expected_sha: SHA, capsule_path: ".github/breakglass/sql/test-host-breakglass.sql", capsule_sha256: hash, backup_evidence_path: ".github/breakglass/evidence/backup.json", confirmation: "wrong" }), /confirmation/u);
  const shellHash = createHash("sha256").update(SHELL).digest("hex");
  const shell = buildHostBreakglassPlan({ operation_key: "host.command_capsule", runbook_key: "host.shell_capsule_exception", action: "execute_shell_capsule", expected_sha: SHA, capsule_path: ".github/breakglass/shell/test-host-breakglass.sh", capsule_sha256: shellHash, backup_evidence_path: ".github/breakglass/evidence/backup.json", confirmation: `EXECUTE_HOST_BREAKGLASS_CAPSULE:production_hostinger_autodeploy:${SHA}:${shellHash}` });
  assert.equal(shell.capability_grants.includes("shell.execute_exception"), true);
});
test("Staging Windows Docker and Production Hostinger authorities cannot cross", () => {
  const staging = buildHostBreakglassPlan({ environment_key: "staging_local_windows_docker", operation_key: "database.inspect", action: "plan", expected_sha: SHA });
  const production = buildHostBreakglassPlan({ environment_key: "production_hostinger_autodeploy", operation_key: "database.inspect", action: "plan", expected_sha: SHA });
  assert.equal(staging.execution_transport, "local_cli");
  assert.equal(staging.host, "local_windows");
  assert.equal(staging.dispatch_ref, null);
  assert.equal(production.execution_transport, "github_workflow");
  assert.equal(production.host, "hostinger_cloud_business");
  assert.equal(production.dispatch_ref, "main");
});
test("Production correlation status survives process-local receipt loss through GitHub run-name readback", async () => {
  const correlation = "durable-status-test";
  __hostBreakglassTest.RUNS.clear();
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ workflow_runs: [{ id: 77, head_branch: "main", display_title: `Host Breakglass ${correlation}`, status: "completed", conclusion: "success", created_at: new Date().toISOString() }] }) });
  const result = await readHostBreakglassRun(correlation, { fetchImpl, tokenResolver: async () => "token" });
  assert.equal(result.dispatch_status, "recovered_from_github");
  assert.equal(result.workflow_run_id, "77");
  assert.equal(result.durable_github_readback, true);
});
test.after(() => { __hostBreakglassTest.RUNS.clear(); fs.rmSync(SQL_PATH, { force: true }); fs.rmSync(SHELL_PATH, { force: true }); fs.rmSync(BACKUP_PATH, { force: true }); });
