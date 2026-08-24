import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildHostBreakglassPlan, dispatchHostBreakglassPlan, publicHostBreakglassCatalog, readHostBreakglassRun, readHostBreakglassToolContract, __hostBreakglassTest } from "./hostBreakglassCatalog.js";
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
test("reconstruction graph binds all roles to explicit zero-table execution while nonempty rebuild stays denied", () => {
  const catalog = publicHostBreakglassCatalog();
  assert.equal(catalog.reconstruction_plan.mode, "plan_and_explicit_apply");
  assert.equal(catalog.reconstruction_plan.scope, "existing_zero_table_only");
  assert.equal(catalog.reconstruction_plan.execution_allowed, true);
  assert.equal(catalog.reconstruction_plan.steps.some((step) => step.key === "rebuild_runtime_persistence_schema" && step.executor_available === true && step.executor === "hostinger-runtime-bootstrap"), true);
  assert.equal(catalog.reconstruction_plan.complete, true);
  assert.equal(catalog.reconstruction_plan.destructive_nonempty_rebuild_allowed, false);
});
test("tool contract exposes governed platform capabilities with capsule-only raw exceptions", () => {
  const contract = readHostBreakglassToolContract();
  assert.equal(contract.tools["migration_contract.apply"].executor, "governedMigrationExecutionTool");
  assert.equal(contract.tools["migration_catalog.inspect"].mutation, false);
  assert.equal(contract.tools["database_role_topology.inspect"].mutation, false);
  assert.equal(contract.tools["schema_bundle.rebuild_empty"].requires.includes("zero_table_proof"), true);
  assert.equal(contract.tools["schema_bundle.rebuild_runtime_persistence"].requires.includes("same_cycle_postcondition_readback"), true);
  assert.equal(Object.hasOwn(contract.tools, "shell.execute"), false);
});
test("full migration discovery never expands the Production execution allowlist", () => {
  const catalog = publicHostBreakglassCatalog();
  assert.equal(catalog.migration_catalog.discovered_migration_count > catalog.migration_catalog.execution_allowlist_count, true);
  assert.equal(catalog.migration_catalog.execution_eligible_count <= catalog.migration_catalog.execution_allowlist_count, true);
  assert.equal(catalog.migration_catalog.discovery_grants_execution, false);
  assert.equal(catalog.migration_catalog.production_auto_apply_allowed, false);
  assert.equal(catalog.migration_catalog.required_database_roles.includes("runtime_persistence"), true);
  assert.equal(catalog.migration_catalog.missing_rebuild_role_executors.includes("runtime_persistence"), false);
  assert.equal(catalog.database_role_topology.runtime_persistence.rebuild_executor_available, true);
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
  assert.equal(plan.runbook_execution_graph.steps.some((step) => step.key === "schema_bundle.rebuild_empty.runtime_persistence"), true);
  assert.equal(plan.runbook_execution_graph.grants_included, false);
  assert.match(plan.runbook_execution_graph.graph_sha256, /^[0-9a-f]{64}$/u);
});
test("apply plans receive only runbook-scoped mutation capabilities", () => {
  const repair = buildHostBreakglassPlan({ operation_key: "database.repair", runbook_key: "database.schema_repair", action: "apply_migration", expected_sha: SHA, migration: MIGRATION, confirmation: `APPLY_HOSTINGER_RUNTIME_MIGRATION:${SHA}:production-runtime:${MIGRATION}` });
  assert.equal(repair.capability_grants.includes("migration_contract.apply"), true);
  assert.equal(repair.capability_grants.includes("grant_contract.apply"), false);
  assert.equal(repair.denied_capabilities.includes("credential.export"), true);
  assert.throws(() => buildHostBreakglassPlan({ operation_key: "database.inspect", runbook_key: "database.schema_repair", action: "plan", expected_sha: SHA }), /not allowed/u);
  assert.throws(() => buildHostBreakglassPlan({ operation_key: "database.repair", runbook_key: "database.schema_repair", action: "apply_grants", expected_sha: SHA, confirmation: `APPLY_HOSTINGER_RUNTIME_GRANTS:${SHA}:production-runtime:user:localhost` }), /does not grant/u);
});
test("empty rebuild exposes a hashed role-by-role execution graph without granting grants or arbitrary SQL", () => {
  const plan = buildHostBreakglassPlan({ operation_key: "database.rebuild_empty", action: "apply_migration", expected_sha: SHA, migration: MIGRATION, confirmation: `APPLY_HOSTINGER_RUNTIME_MIGRATION:${SHA}:production-runtime:${MIGRATION}` });
  const graph = plan.runbook_execution_graph;
  assert.equal(graph.execution_mode, "apply_runbook");
  assert.deepEqual(graph.steps.filter((step) => step.role).map((step) => step.role), ["runtime", "governance", "runtime_persistence"]);
  assert.equal(graph.steps.find((step) => step.role === "runtime_persistence").same_cycle_readback_required, true);
  assert.equal(graph.grants_included, false);
  assert.equal(graph.arbitrary_sql_allowed, false);
  assert.equal(plan.capability_grants.includes("grant_contract.apply"), false);
  assert.equal(plan.capability_grants.includes("schema_bundle.rebuild_runtime_persistence"), true);
});
test("runtime_env mutation and uncataloged migration fail closed", () => {
  assert.throws(() => buildHostBreakglassPlan({ operation_key: "database.repair", action: "apply_migration", expected_sha: SHA, target_source: "runtime_env", migration: MIGRATION }), /Target source is not allowed/u);
  assert.throws(() => buildHostBreakglassPlan({ operation_key: "database.repair", action: "dry_run", expected_sha: SHA, migration: "arbitrary.sql" }), /not present/u);
});

test("Production host-local full inspection allows omitted migration but remains read-only and host-side", async () => {
  const plan = buildHostBreakglassPlan({
    operation_key: "database.inspect",
    runbook_key: "database.full_inspection",
    action: "dry_run",
    expected_sha: SHA,
    target_source: "host_local_role_env",
    target_key: "production-runtime",
  });
  assert.equal(plan.migration, null);
  assert.equal(plan.migration_selected, false);
  assert.equal(plan.migration_selection, "full_inspection_catalog");
  assert.equal(plan.database_mutation_performed, false);
  let executorInput;
  const receipt = await dispatchHostBreakglassPlan(plan, {
    fetchImpl: async () => { throw new Error("host-local inspection must never call GitHub"); },
    tokenResolver: async () => { throw new Error("host-local inspection must not require a GitHub token"); },
    hostLocalExecutor: async (input) => {
      executorInput = input;
      return {
        ok: true,
        status: "host_local_inspection_complete",
        mode: "dry_run",
        operation: "read_only",
        target_source: "host_local_role_env",
        migration: null,
        migration_selected: false,
        migration_selection: "full_inspection_catalog",
        database_connection_performed: true,
        database_mutation_performed: false,
        migration_apply_performed: false,
        grant_mutation_performed: false,
        workflow_dispatch_performed: false,
        secrets_included: false,
      };
    },
  });
  assert.equal(receipt.status, "host_local_inspection_complete");
  assert.equal(receipt.separate_typed_confirmation_required, undefined);
  assert.equal(receipt.workflow_dispatch_performed, false);
  assert.equal(receipt.database_connection_performed, true);
  assert.equal(receipt.database_mutation_performed, false);
  assert.equal(receipt.migration_apply_performed, false);
  assert.equal(receipt.grant_mutation_performed, false);
  assert.equal(executorInput.target_source, "host_local_role_env");
  assert.equal(executorInput.operation_key, "database.inspect");
  assert.equal(executorInput.runbook_key, "database.full_inspection");
});

test("host-local role recovery plans retain independent migration and grant capability boundaries", async () => {
  const migrationPlan = buildHostBreakglassPlan({
    operation_key: "database.repair",
    runbook_key: "database.schema_repair",
    action: "apply_migration",
    expected_sha: SHA,
    target_source: "host_local_role_env",
    migration: MIGRATION,
    confirmation: `APPLY_HOSTINGER_RUNTIME_MIGRATION:${SHA}:production-runtime:${MIGRATION}`,
  });
  assert.equal(migrationPlan.capability_grants.includes("migration_contract.apply"), true);
  assert.equal(migrationPlan.capability_grants.includes("grant_contract.apply"), false);
  const migrationReceipt = await dispatchHostBreakglassPlan(migrationPlan, {
    fetchImpl: async () => { throw new Error("host-local recovery must never call GitHub"); },
    tokenResolver: async () => { throw new Error("host-local recovery must not require a GitHub token"); },
  });
  assert.equal(migrationReceipt.status, "host_local_execution_required");
  assert.equal(migrationReceipt.github_secrets_required, false);
  assert.equal(migrationReceipt.workflow_dispatch_performed, false);

  const grantPlan = buildHostBreakglassPlan({
    operation_key: "database.repair",
    runbook_key: "database.access_repair",
    action: "apply_grants",
    expected_sha: SHA,
    target_source: "host_local_role_env",
    migration: MIGRATION,
    confirmation: `APPLY_HOSTINGER_RUNTIME_GRANTS:${SHA}:production-runtime:user:localhost`,
  });
  assert.equal(grantPlan.capability_grants.includes("grant_contract.apply"), true);
  assert.equal(grantPlan.capability_grants.includes("migration_contract.apply"), false);
  const grantReceipt = await dispatchHostBreakglassPlan(grantPlan);
  assert.equal(grantReceipt.separate_typed_confirmation_required, true);
  assert.equal(grantReceipt.workflow_dispatch_performed, false);
  assert.doesNotMatch(JSON.stringify(grantReceipt), /PASSWORD|secret-for-test/i);
});


test("Windows/Docker role recovery uses Staging-only grant and migration approval prefixes", async () => {
  const migration = buildHostBreakglassPlan({
    environment_key: "staging_local_windows_docker",
    operation_key: "database.repair",
    runbook_key: "database.schema_repair",
    action: "apply_migration",
    expected_sha: SHA,
    target_source: "staging_local_role_env",
    target_key: "staging-runtime",
    migration: MIGRATION,
    confirmation: `APPLY_STAGING_RUNTIME_MIGRATION:${SHA}:staging-runtime:${MIGRATION}`,
  });
  assert.equal(migration.execution_transport, "local_cli");
  assert.equal(migration.capability_grants.includes("grant_contract.apply"), false);
  const receipt = await dispatchHostBreakglassPlan(migration, {
    fetchImpl: async () => { throw new Error("Staging must never call GitHub"); },
    tokenResolver: async () => { throw new Error("Staging must never request GitHub credentials"); },
  });
  assert.equal(receipt.required_platform, "win32");
  assert.equal(receipt.required_runtime, "docker_compose");
  assert.equal(receipt.workflow_dispatch_performed, false);

  const grants = buildHostBreakglassPlan({
    environment_key: "staging_local_windows_docker",
    operation_key: "database.repair",
    runbook_key: "database.access_repair",
    action: "apply_grants",
    expected_sha: SHA,
    target_source: "staging_local_role_env",
    target_key: "staging-runtime",
    confirmation: `APPLY_STAGING_RUNTIME_GRANTS:${SHA}:staging-runtime:user:localhost`,
  });
  assert.equal(grants.capability_grants.includes("grant_contract.apply"), true);
  assert.equal(grants.capability_grants.includes("migration_contract.apply"), false);
});

test("Staging and Production reject each other's role-bound source and typed approval", () => {
  assert.throws(() => buildHostBreakglassPlan({
    environment_key: "staging_local_windows_docker", operation_key: "database.repair", action: "dry_run", expected_sha: SHA, target_source: "host_local_role_env", migration: MIGRATION,
  }), (error) => error.code === "host_breakglass_role_source_environment_mismatch");
  assert.throws(() => buildHostBreakglassPlan({
    environment_key: "production_hostinger_autodeploy", operation_key: "database.repair", action: "dry_run", expected_sha: SHA, target_source: "staging_local_role_env", migration: MIGRATION,
  }), (error) => error.code === "host_breakglass_role_source_environment_mismatch");
  assert.throws(() => buildHostBreakglassPlan({
    environment_key: "staging_local_windows_docker", operation_key: "database.repair", runbook_key: "database.access_repair", action: "apply_grants", expected_sha: SHA, target_source: "staging_local_role_env", target_key: "staging-runtime", confirmation: `APPLY_HOSTINGER_RUNTIME_GRANTS:${SHA}:staging-runtime:user:localhost`,
  }), (error) => error.code === "host_breakglass_confirmation_required");
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
  assert.equal(staging.migration_governance.environment_key, "staging_local_windows_docker");
  assert.equal(production.migration_governance.environment_key, "production_hostinger_autodeploy");
  assert.throws(() => buildHostBreakglassPlan({ environment_key: "staging_local_windows_docker", operation_key: "database.inspect", action: "plan", expected_sha: SHA, target_key: "production-runtime" }), /does not belong/u);
  assert.throws(() => buildHostBreakglassPlan({ environment_key: "production_hostinger_autodeploy", operation_key: "database.inspect", action: "plan", expected_sha: SHA, target_key: "staging-runtime" }), /does not belong/u);
});
test("Production dispatch reuses an exact GitHub run after process-local receipt loss", async () => {
  const correlation = "durable-dispatch-test";
  const plan = buildHostBreakglassPlan({ operation_key: "database.repair", runbook_key: "database.schema_repair", action: "dry_run", expected_sha: SHA, migration: MIGRATION, correlation_id: correlation });
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET" });
    if (String(url).includes("/actions/workflows/production-runtime-parity-evidence.yml/runs?")) {
      return new Response(JSON.stringify({ workflow_runs: [{ id: 88, path: "production-runtime-parity-evidence.yml", event: "workflow_dispatch", head_branch: "main", display_title: `runtime-breakglass-${plan.correlation_id}-${plan.expected_sha}-${plan.plan_sha256}`, status: "completed", conclusion: "success", created_at: new Date().toISOString() }] }), { status: 200 });
    }
    throw new Error(`unexpected URL: ${url}`);
  };
  const env = { RUNTIME_BREAKGLASS_GITHUB_TOKEN: "server-side-test-token" };
  const first = await dispatchHostBreakglassPlan(plan, { env, fetchImpl, tokenResolver: async () => { throw new Error("GitHub App must not be used when dedicated token is present"); } });
  assert.equal(first.idempotent_reuse, true);
  assert.equal(first.workflow_dispatch_performed, false);
  assert.equal(first.workflow_run_id, "88");
  __hostBreakglassTest.RUNS.clear();
  const second = await dispatchHostBreakglassPlan(plan, { env, fetchImpl, tokenResolver: async () => { throw new Error("GitHub App must not be used when dedicated token is present"); } });
  assert.equal(second.idempotent_reuse, true);
  assert.equal(calls.filter((call) => call.method === "POST").length, 0);
});
test("Production correlation status survives process-local receipt loss through GitHub run-name readback", async () => {
  const correlation = "durable-status-test";
  __hostBreakglassTest.RUNS.clear();
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ workflow_runs: [{ id: 77, path: "production-runtime-parity-evidence.yml", event: "workflow_dispatch", head_branch: "main", display_title: `runtime-breakglass-${correlation}-${SHA}-${"c".repeat(64)}`, status: "completed", conclusion: "success", created_at: new Date().toISOString() }] }) });
  const result = await readHostBreakglassRun(correlation, { fetchImpl, env: { RUNTIME_BREAKGLASS_GITHUB_TOKEN: "server-side-test-token" }, tokenResolver: async () => { throw new Error("GitHub App must not be used when dedicated token is present"); } });
  assert.equal(result.dispatch_status, "recovered_from_github");
  assert.equal(result.workflow_run_id, "77");
  assert.equal(result.durable_github_readback, true);
});
test("Production dispatch recovers an existing exact-correlation GitHub run after process restart without a second POST", async () => {
  const correlation = "durable-dispatch-test";
  __hostBreakglassTest.RUNS.clear();
  const plan = buildHostBreakglassPlan({ operation_key: "database.inspect", action: "dry_run", expected_sha: SHA, migration: MIGRATION, correlation_id: correlation });
  let postCount = 0;
  const fetchImpl = async (_url, options = {}) => {
    if (options.method === "POST") postCount += 1;
    return { ok: true, status: 200, json: async () => ({ workflow_runs: [{ id: 91, path: "production-runtime-parity-evidence.yml", event: "workflow_dispatch", head_branch: "main", display_title: `runtime-breakglass-${correlation}-${plan.expected_sha}-${plan.plan_sha256}`, created_at: new Date().toISOString() }] }) };
  };
  const receipt = await dispatchHostBreakglassPlan(plan, { fetchImpl, tokenResolver: async () => "token" });
  assert.equal(postCount, 0);
  assert.equal(receipt.replayed, true);
  assert.equal(receipt.workflow_run_id, "91");
  assert.equal(receipt.workflow_dispatch_performed, false);
  assert.equal(receipt.durable_github_readback, true);
});
test("Production dispatch rejects ambiguous durable correlation matches without another dispatch", async () => {
  const correlation = "ambiguous-dispatch-test";
  __hostBreakglassTest.RUNS.clear();
  const plan = buildHostBreakglassPlan({ operation_key: "database.inspect", action: "dry_run", expected_sha: SHA, migration: MIGRATION, correlation_id: correlation });
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ workflow_runs: [1, 2].map((id) => ({ id, path: "production-runtime-parity-evidence.yml", event: "workflow_dispatch", head_branch: "main", display_title: `runtime-breakglass-${correlation}-${plan.expected_sha}-${plan.plan_sha256}` })) }) });
  await assert.rejects(dispatchHostBreakglassPlan(plan, { fetchImpl, tokenResolver: async () => "token" }), (error) => error.code === "host_breakglass_idempotency_ambiguous");
});
test.after(() => { __hostBreakglassTest.RUNS.clear(); __hostBreakglassTest.MIGRATION_DISCOVERY_CACHE.clear(); fs.rmSync(SQL_PATH, { force: true }); fs.rmSync(SHELL_PATH, { force: true }); fs.rmSync(BACKUP_PATH, { force: true }); });
