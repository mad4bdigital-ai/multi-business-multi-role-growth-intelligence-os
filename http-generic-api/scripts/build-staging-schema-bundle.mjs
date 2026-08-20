import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { splitStatements } from "./staging-sql-parser.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(apiRoot, "..");
const manifestPath = path.join(apiRoot, "config", "staging-database-role-migration-manifest.json");
const migrationsDir = path.join(apiRoot, "migrations");
const baselineSchemaPath = path.join(apiRoot, "schema.sql");

const args = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : String(args[index + 1] ?? fallback);
};
const has = (name) => args.includes(name);
const expectedCommit = arg("--expected-commit");
const outputDir = path.resolve(repoRoot, arg("--output-dir", "autopilot-portable-staging/staging-db-dumps"));
const confirmation = arg("--confirm");
const planOnly = has("--plan");
const containerName = `mad4b-staging-schema-build-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
const buildDatabase = "staging_schema_build";
const rootPassword = crypto.randomBytes(24).toString("hex");

function fail(message) {
  const error = new Error(`FAIL-CLOSED: ${message}`);
  error.code = "STAGING_SCHEMA_BUNDLE_BUILD_BLOCKED";
  throw error;
}

function text(value) { return String(value ?? "").trim(); }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function run(command, commandArgs, { input = undefined, allowFailure = false, timeoutMs = 30000 } = {}) {
  const result = spawnSync(command, commandArgs, { input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs, killSignal: "SIGKILL" });
  if (result.error?.code === "ETIMEDOUT") fail(`${command} ${commandArgs.join(" ")} timed out after ${timeoutMs}ms`);
  if (result.error) fail(`${command} could not start: ${result.error.message}`);
  if (!allowFailure && result.status !== 0) {
    const stderr = text(result.stderr).slice(-4000);
    const stdout = text(result.stdout).slice(-2000);
    fail(`${command} ${commandArgs.join(" ")} failed${stderr ? `: ${stderr}` : stdout ? `: ${stdout}` : ""}`);
  }
  return { stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? ""), status: result.status };
}

function requireLocalDocker() {
  if (process.env.DOCKER_HOST || process.env.DOCKER_CONTEXT) fail("DOCKER_HOST and DOCKER_CONTEXT are forbidden");
  const context = text(run("docker", ["context", "show"], { timeoutMs: 10000 }).stdout);
  if (!new Set(["default", "desktop-linux"]).has(context)) fail(`Docker context must be local; received ${context}`);
  if (!text(run("docker", ["info", "--format", "{{.ServerVersion}}"], { timeoutMs: 15000 }).stdout)) fail("Docker daemon is unavailable");
  const image = run("docker", ["image", "inspect", "mariadb:11.4", "--format", "{{.Id}}"], { allowFailure: true, timeoutMs: 15000 });
  if (image.status !== 0 || !/^sha256:[0-9a-f]{64}$/i.test(text(image.stdout))) fail("Required local image mariadb:11.4 is unavailable; run docker pull mariadb:11.4 before schema build");
}

function assertRepositoryState() {
  if (!/^[0-9a-f]{40}$/i.test(expectedCommit || "")) fail("--expected-commit must be an exact 40-character SHA");
  const observed = text(run("git", ["-C", repoRoot, "rev-parse", "HEAD"]).stdout).toLowerCase();
  if (observed !== expectedCommit.toLowerCase()) fail(`checkout SHA mismatch: expected ${expectedCommit}, observed ${observed}`);
  const status = text(run("git", ["-C", repoRoot, "status", "--porcelain", "--untracked-files=all"]).stdout);
  if (status) fail("working tree is not clean; refusing schema build");
  const identity = text(run("git", ["-C", repoRoot, "config", "--get", "remote.origin.url"]).stdout);
  if (!identity.includes("mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os")) fail("repository origin identity mismatch");
}

function readManifest() {
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); }
  catch (error) { fail(`role migration manifest is unreadable: ${error.message}`); }
  if (manifest.contract !== "mad4b.staging.database-role-migration-manifest.v1") fail("unsupported role migration manifest contract");
  if (manifest.source?.production_access_forbidden !== true || manifest.safety?.schema_only !== true) fail("role manifest safety policy is incomplete");
  if (manifest.source?.baseline_foreign_key_policy !== "defer_baseline_fk_create_statements_until_after_migrations" || manifest.validation?.baseline_foreign_key_ordering_required !== true) fail("baseline foreign-key ordering policy is incomplete");
  const roles = manifest.roles || {};
  if (Object.keys(roles).sort().join(",") !== "governance,runtime,runtime_persistence") fail("role manifest must declare exactly three database roles");
  return manifest;
}

function migrationFiles() {
  const files = fs.readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
  if (!files.length) fail("no SQL migrations found");
  return files;
}

function baselineSchema(manifest) {
  if (!fs.existsSync(baselineSchemaPath)) fail(`canonical baseline schema is missing: ${baselineSchemaPath}`);
  const sql = fs.readFileSync(baselineSchemaPath, "utf8");
  migrationSafetyCheck("schema.sql", sql);
  const requiredActionColumns = manifest.validation?.required_actions_baseline_columns;
  const requiredEndpointColumns = manifest.validation?.required_endpoints_baseline_columns;
  const requiredValidationRepairColumns = manifest.validation?.required_validation_repair_baseline_columns;
  const requiredPlatformContractSurfacesColumns = manifest.validation?.required_platform_contract_surfaces_baseline_columns;
  const requiredTenantSecretsColumns = manifest.validation?.required_tenant_secrets_baseline_columns;
  const requiredPlatformSecretsColumns = manifest.validation?.required_platform_secrets_baseline_columns;
  if (!Array.isArray(requiredActionColumns) || requiredActionColumns.length === 0) fail("role manifest required_actions_baseline_columns contract is missing");
  if (!Array.isArray(requiredEndpointColumns) || requiredEndpointColumns.length === 0) fail("role manifest required_endpoints_baseline_columns contract is missing");
  if (!Array.isArray(requiredValidationRepairColumns) || requiredValidationRepairColumns.length === 0) fail("role manifest required_validation_repair_baseline_columns contract is missing");
  if (!Array.isArray(requiredPlatformContractSurfacesColumns) || requiredPlatformContractSurfacesColumns.length === 0) fail("role manifest required_platform_contract_surfaces_baseline_columns contract is missing");
  if (!Array.isArray(requiredTenantSecretsColumns) || requiredTenantSecretsColumns.length === 0) fail("role manifest required_tenant_secrets_baseline_columns contract is missing");
  if (!Array.isArray(requiredPlatformSecretsColumns) || requiredPlatformSecretsColumns.length === 0) fail("role manifest required_platform_secrets_baseline_columns contract is missing");
  const actionsBlock = sql.match(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+`actions`\s*\(([\s\S]*?)\)\s*ENGINE=/iu)?.[1] || "";
  const endpointsBlock = sql.match(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+`endpoints`\s*\(([\s\S]*?)\)\s*ENGINE=/iu)?.[1] || "";
  const validationRepairBlock = sql.match(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+`validation_repair`\s*\(([\s\S]*?)\)\s*ENGINE=/iu)?.[1] || "";
  const platformContractSurfacesBlock = sql.match(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+`platform_contract_surfaces`\s*\(([\s\S]*?)\)\s*ENGINE=/iu)?.[1] || "";
  const tenantSecretsBlock = sql.match(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+`tenant_secrets`\s*\(([\s\S]*?)\)\s*ENGINE=/iu)?.[1] || "";
  const platformSecretsBlock = sql.match(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+`platform_secrets`\s*\(([\s\S]*?)\)\s*ENGINE=/iu)?.[1] || "";
  if (!actionsBlock) fail("canonical baseline schema is missing the actions table definition");
  if (!endpointsBlock) fail("canonical baseline schema is missing the endpoints table definition");
  if (!validationRepairBlock) fail("canonical baseline schema is missing the validation_repair table definition");
  if (!platformContractSurfacesBlock) fail("canonical baseline schema is missing the platform_contract_surfaces table definition");
  if (!tenantSecretsBlock) fail("canonical baseline schema is missing the tenant_secrets table definition");
  if (!platformSecretsBlock) fail("canonical baseline schema is missing the platform_secrets table definition");
  const quote = String.fromCharCode(96);
  const missingActionColumns = requiredActionColumns.filter((column) => !actionsBlock.includes(`${quote}${column}${quote}`));
  const missingEndpointColumns = requiredEndpointColumns.filter((column) => !endpointsBlock.includes(`${quote}${column}${quote}`));
  const missingValidationRepairColumns = requiredValidationRepairColumns.filter((column) => !validationRepairBlock.includes(`${quote}${column}${quote}`));
  const missingPlatformContractSurfacesColumns = requiredPlatformContractSurfacesColumns.filter((column) => !platformContractSurfacesBlock.includes(`${quote}${column}${quote}`));
  const missingTenantSecretsColumns = requiredTenantSecretsColumns.filter((column) => !tenantSecretsBlock.includes(`${quote}${column}${quote}`));
  const missingPlatformSecretsColumns = requiredPlatformSecretsColumns.filter((column) => !platformSecretsBlock.includes(`${quote}${column}${quote}`));
  if (missingActionColumns.length) fail(`actions baseline column contract is incomplete: ${missingActionColumns.join(", ")}`);
  if (missingEndpointColumns.length) fail(`endpoints baseline column contract is incomplete: ${missingEndpointColumns.join(", ")}`);
  if (missingValidationRepairColumns.length) fail(`validation_repair baseline column contract is incomplete: ${missingValidationRepairColumns.join(", ")}`);
  if (missingPlatformContractSurfacesColumns.length) fail(`platform_contract_surfaces baseline column contract is incomplete: ${missingPlatformContractSurfacesColumns.join(", ")}`);
  if (missingTenantSecretsColumns.length) fail(`tenant_secrets baseline column contract is incomplete: ${missingTenantSecretsColumns.join(", ")}`);
  if (missingPlatformSecretsColumns.length) fail(`platform_secrets baseline column contract is incomplete: ${missingPlatformSecretsColumns.join(", ")}`);
  const statements = splitStatements(sql);
  if (!statements.length) fail("canonical baseline schema is empty");
  const immediate = [];
  const deferredForeignKey = [];
  for (const statement of statements) {
    if (/^\s*CREATE\s+TABLE[\s\S]*\bFOREIGN\s+KEY\b/imu.test(statement)) deferredForeignKey.push(statement);
    else immediate.push(statement);
  }
  const deferredForeignKeyTables = deferredForeignKey.map((statement) => statement.match(/CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+`([^`]+)`/iu)?.[1] || "unknown");
  return {
    file: "schema.sql",
    path: baselineSchemaPath,
    sha256: sha256(sql),
    statement_count: statements.length,
    bytes: Buffer.byteLength(sql),
    deferred_foreign_key_statement_count: deferredForeignKey.length,
    deferred_foreign_key_tables: deferredForeignKeyTables,
    required_actions_baseline_columns: requiredActionColumns,
    required_endpoints_baseline_columns: requiredEndpointColumns,
    required_validation_repair_baseline_columns: requiredValidationRepairColumns,
    required_platform_contract_surfaces_baseline_columns: requiredPlatformContractSurfacesColumns,
    required_tenant_secrets_baseline_columns: requiredTenantSecretsColumns,
    required_platform_secrets_baseline_columns: requiredPlatformSecretsColumns,
    immediate_sql: `${immediate.join(";\n")};\n`,
    deferred_foreign_key_sql: deferredForeignKey.length ? `${deferredForeignKey.join(";\n")};\n` : "",
  };
}

function baselineMetadata(baseline) {
  return {
    file: baseline.file,
    sha256: baseline.sha256,
    statement_count: baseline.statement_count,
    bytes: baseline.bytes,
    deferred_foreign_key_statement_count: baseline.deferred_foreign_key_statement_count,
    deferred_foreign_key_tables: baseline.deferred_foreign_key_tables,
    required_actions_baseline_columns: baseline.required_actions_baseline_columns,
    required_endpoints_baseline_columns: baseline.required_endpoints_baseline_columns,
    required_validation_repair_baseline_columns: baseline.required_validation_repair_baseline_columns,
    required_platform_contract_surfaces_baseline_columns: baseline.required_platform_contract_surfaces_baseline_columns,
    required_tenant_secrets_baseline_columns: baseline.required_tenant_secrets_baseline_columns,
    required_platform_secrets_baseline_columns: baseline.required_platform_secrets_baseline_columns,
  };
}

function migrationSafetyCheck(file, sql) {
  const normalizedSql = splitStatements(sql).join("\n");
  const forbidden = [
    /^\s*GRANT\b/imu,
    /^\s*REVOKE\b/imu,
    /^\s*CREATE\s+USER\b/imu,
    /^\s*ALTER\s+USER\b/imu,
    /^\s*DROP\s+DATABASE\b/imu,
    /^\s*CREATE\s+DATABASE\b/imu,
    /^\s*SELECT\b[\s\S]*\bINTO\s+(?:OUTFILE|DUMPFILE)\b/imu,
    /^\s*LOAD\s+DATA\b/imu,
  ];
  for (const pattern of forbidden) if (pattern.test(normalizedSql)) fail(`forbidden authority or external-data SQL in migration ${file}: ${pattern}`);
}

function migrationPlan(files) {
  return files.map((file) => {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    migrationSafetyCheck(file, sql);
    return { file, sha256: sha256(sql), statement_count: splitStatements(sql).length, bytes: Buffer.byteLength(sql) };
  });
}

function canonicalSeedPlan(manifest, files) {
  const lifecycle = manifest.canonical_seed_lifecycle || {};
  if (lifecycle.contract !== "mad4b.staging.canonical-seed-manifest.v1") fail("canonical seed lifecycle contract is missing or unsupported");
  if (lifecycle.target_role !== "runtime" || lifecycle.replay_mode !== "explicit_local_staging_only") fail("canonical seed lifecycle must target runtime with explicit local replay only");
  if (lifecycle.production_access_forbidden !== true || lifecycle.provider_access_forbidden !== true || lifecycle.readback_required !== true) fail("canonical seed lifecycle safety/readback policy is incomplete");
  const orderedFiles = Array.isArray(lifecycle.seed_files) ? lifecycle.seed_files : [];
  if (!orderedFiles.length) fail("canonical seed lifecycle declares no seed files");
  const available = new Set(files);
  const rows = orderedFiles.map((file) => {
    if (!available.has(file)) fail(`canonical seed file is not part of the exact migration chain: ${file}`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    migrationSafetyCheck(file, sql);
    if (!/\b(?:INSERT|UPDATE)\b/iu.test(sql)) fail(`canonical seed file contains no deterministic seed statements: ${file}`);
    return { file, sha256: sha256(sql), statement_count: splitStatements(sql).length, bytes: Buffer.byteLength(sql), target_role: lifecycle.target_role };
  });
  const requiredColumns = Array.isArray(lifecycle.mcp_catalog_required_columns) ? lifecycle.mcp_catalog_required_columns : [];
  if (requiredColumns.length !== 2 || !requiredColumns.includes("admin_platform_endpoint_tools.mcp_catalog_level") || !requiredColumns.includes("tenant_platform_endpoint_tools.mcp_catalog_level")) fail("canonical seed lifecycle MCP catalog column contract is incomplete");
  return { contract: lifecycle.contract, target_role: lifecycle.target_role, replay_mode: lifecycle.replay_mode, production_access_forbidden: true, provider_access_forbidden: true, readback_required: true, seed_files: rows, mcp_catalog_required_columns: requiredColumns };
}

function dockerExec(args, options = {}) {
  const stdinFlag = options.input === undefined ? [] : ["-i"];
  return run("docker", ["exec", ...stdinFlag, ...args], options);
}
function dbArgs(extra = []) { return ["--protocol=socket", "-uroot", `-p${rootPassword}`, "--database", buildDatabase, ...extra]; }

function startDatabase() {
  run("docker", ["run", "--pull=never", "--detach", "--rm", "--name", containerName, "-e", `MARIADB_ROOT_PASSWORD=${rootPassword}`, "-e", `MARIADB_DATABASE=${buildDatabase}`, "mariadb:11.4"], { timeoutMs: 30000 });
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const result = dockerExec([containerName, "mariadb-admin", "ping", "-h127.0.0.1", "-uroot", `-p${rootPassword}`, "--silent"], { allowFailure: true });
    if (result.status === 0) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  fail("disposable MariaDB did not become ready within 180 seconds");
}

function applySqlSource(label, sql) {
  const result = dockerExec([containerName, "mariadb", ...dbArgs(["--binary-mode"])], { input: sql, allowFailure: true });
  if (result.status !== 0) fail(`${label} failed in disposable schema database: ${text(result.stderr).slice(-4000)}`);
}
function applyMigrations(baseline, plan) {
  applySqlSource("canonical baseline schema pre-migration", baseline.immediate_sql);
  for (const item of plan) {
    const sql = fs.readFileSync(path.join(migrationsDir, item.file), "utf8");
    applySqlSource(`migration ${item.file}`, sql);
  }
  if (baseline.deferred_foreign_key_sql) applySqlSource("canonical baseline deferred foreign-key tables", baseline.deferred_foreign_key_sql);
}

function listTables() {
  const result = dockerExec([containerName, "mariadb", ...dbArgs(["--batch", "--skip-column-names", "-e", "SHOW FULL TABLES"])]);
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [name, type = "BASE TABLE"] = line.split("\t");
    return { name: text(name), type: text(type) || "BASE TABLE" };
  }).filter((row) => /^[A-Za-z0-9_]+$/.test(row.name));
}

function roleTableSets(manifest, tables) {
  const excludedRuntime = new Set(manifest.roles.runtime.excluded_tables);
  const governance = new Set(manifest.roles.governance.required_tables);
  const persistence = new Set(manifest.roles.runtime_persistence.required_tables);
  const known = new Set(tables.map((table) => table.name));
  for (const required of [...manifest.roles.runtime.required_tables, ...governance, ...persistence]) if (!known.has(required)) fail(`required schema table is missing after migration chain: ${required}`);
  const sets = {
    runtime: tables.filter((table) => !governance.has(table.name) && !persistence.has(table.name)),
    governance: tables.filter((table) => governance.has(table.name)),
    runtime_persistence: tables.filter((table) => persistence.has(table.name)),
  };
  const duplicates = new Set([...sets.runtime].filter((item) => governance.has(item.name) || persistence.has(item.name)).map((item) => item.name));
  if (duplicates.size) fail(`role table overlap detected: ${[...duplicates].join(",")}`);
  if (sets.runtime.some((item) => excludedRuntime.has(item.name))) fail("runtime bundle contains an explicitly excluded governance/persistence table");
  return sets;
}

function makeDump(role, tables, manifest) {
  const roleConfig = manifest.roles[role];
  if (!tables.length) fail(`${role} role has no tables after migration chain`);
  const names = tables.map((table) => table.name);
  const result = dockerExec([containerName, "mariadb-dump", "--no-data", "--skip-triggers", "--skip-add-locks", "--skip-lock-tables", buildDatabase, ...names]);
  const dump = Buffer.from(result.stdout, "utf8");
  if (/\b(?:INSERT|REPLACE|UPDATE|DELETE|LOAD\s+DATA)\b/iu.test(result.stdout)) fail(`${role} schema dump contains data mutation statements`);
  if (!dump.length) fail(`${role} schema dump is empty`);
  const gz = zlib.gzipSync(dump, { level: 9 });
  const output = path.join(outputDir, roleConfig.bundle_file);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(output, gz);
  return { file: roleConfig.bundle_file, sha256: sha256(gz), compressed_bytes: gz.length, table_count: tables.length, tables: names };
}

function writeOutput(manifest, expected, baseline, migrationPlanRows, canonicalSeeds, tableSets, bundles) {
  const output = {
    contract: "mad4b.staging.schema-bundle-output.v1",
    source_commit: expected.toLowerCase(),
    source_repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    source_kind: "exact_local_git_checkout",
    generated_at: new Date().toISOString(),
    schema_only: true,
    production_accessed: false,
    provider_accessed: false,
    data_exported: false,
    secrets_included: false,
    baseline_schema: baselineMetadata(baseline),
    migration_count: migrationPlanRows.length,
    migration_sha256_manifest: migrationPlanRows,
    canonical_seed_lifecycle: canonicalSeeds,
    roles: bundles,
    validation: {
      required_tables_checked: true,
      required_runtime_table_census: manifest.validation.required_runtime_table_census,
      runtime_exclusions_checked: true,
      no_data_statements_checked: true,
      three_role_partition_checked: true,
    },
  };
  const outputPath = path.join(outputDir, "staging-schema-bundle-manifest.json");
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return outputPath;
}

function printPlan(manifest, baseline, files, rows, canonicalSeeds) {
  console.log(JSON.stringify({
    contract: manifest.contract,
    expected_commit: expectedCommit?.toLowerCase() || null,
    output_dir: outputDir,
    baseline_schema: baselineMetadata(baseline),
    migration_count: files.length,
    statement_count: rows.reduce((sum, row) => sum + row.statement_count, 0),
    canonical_seed_lifecycle: canonicalSeeds,
    required_bundle_files: manifest.validation.required_bundle_files,
    confirmation_required: manifest.safety.confirmation,
    production_access_forbidden: true,
    provider_access_forbidden: true,
    plan_only: true,
  }, null, 2));
}

const manifest = readManifest();
const baseline = baselineSchema(manifest);
const files = migrationFiles();
const rows = migrationPlan(files);
const canonicalSeeds = canonicalSeedPlan(manifest, files);
if (planOnly) {
  printPlan(manifest, baseline, files, rows, canonicalSeeds);
  process.exit(0);
}
if (confirmation !== manifest.safety.confirmation) fail(`explicit confirmation is required: --confirm ${manifest.safety.confirmation}`);
assertRepositoryState();
requireLocalDocker();
let tables = [];
try {
  startDatabase();
  applyMigrations(baseline, rows);
  tables = listTables();
  const sets = roleTableSets(manifest, tables);
      const bundles = {
      runtime: makeDump("runtime", sets.runtime, manifest),
      governance: makeDump("governance", sets.governance, manifest),
      runtime_persistence: makeDump("runtime_persistence", sets.runtime_persistence, manifest),
    };
    const outputPath = writeOutput(manifest, expectedCommit, baseline, rows, canonicalSeeds, sets, bundles);

  console.log(JSON.stringify({ output_path: outputPath, source_commit: expectedCommit.toLowerCase(), roles: bundles, production_accessed: false, data_exported: false, secrets_included: false }, null, 2));
} finally {
  run("docker", ["rm", "--force", containerName], { allowFailure: true });
}
