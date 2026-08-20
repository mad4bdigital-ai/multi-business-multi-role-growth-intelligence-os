import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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
function run(command, commandArgs, { input = undefined, allowFailure = false } = {}) {
  const result = spawnSync(command, commandArgs, { input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
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
  const context = text(run("docker", ["context", "show"]).stdout);
  if (!new Set(["default", "desktop-linux"]).has(context)) fail(`Docker context must be local; received ${context}`);
  if (!text(run("docker", ["info", "--format", "{{.ServerVersion}}"]).stdout)) fail("Docker daemon is unavailable");
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
  const roles = manifest.roles || {};
  if (Object.keys(roles).sort().join(",") !== "governance,runtime,runtime_persistence") fail("role manifest must declare exactly three database roles");
  return manifest;
}

function migrationFiles() {
  const files = fs.readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
  if (!files.length) fail("no SQL migrations found");
  return files;
}

function baselineSchema() {
  if (!fs.existsSync(baselineSchemaPath)) fail(`canonical baseline schema is missing: ${baselineSchemaPath}`);
  const sql = fs.readFileSync(baselineSchemaPath, "utf8");
  migrationSafetyCheck("schema.sql", sql);
  const statementCount = splitStatements(sql).length;
  if (!statementCount) fail("canonical baseline schema is empty");
  return { file: "schema.sql", path: baselineSchemaPath, sha256: sha256(sql), statement_count: statementCount, bytes: Buffer.byteLength(sql) };
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

function splitStatements(sql) {
  return sql.split(";").map((statement) => statement.split(/\r?\n/).filter((line) => !line.trim().startsWith("--")).join("\n").trim()).filter(Boolean);
}

function migrationPlan(files) {
  return files.map((file) => {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    migrationSafetyCheck(file, sql);
    return { file, sha256: sha256(sql), statement_count: splitStatements(sql).length, bytes: Buffer.byteLength(sql) };
  });
}

function dockerExec(args, options = {}) {
  const stdinFlag = options.input === undefined ? [] : ["-i"];
  return run("docker", ["exec", ...stdinFlag, ...args], options);
}
function dbArgs(extra = []) { return ["--protocol=socket", "-uroot", `-p${rootPassword}`, "--database", buildDatabase, ...extra]; }

function startDatabase() {
  run("docker", ["run", "--detach", "--rm", "--name", containerName, "-e", `MARIADB_ROOT_PASSWORD=${rootPassword}`, "-e", `MARIADB_DATABASE=${buildDatabase}`, "mariadb:11.4"]);
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const result = dockerExec([containerName, "mariadb-admin", "ping", "-h127.0.0.1", "-uroot", `-p${rootPassword}`, "--silent"], { allowFailure: true });
    if (result.status === 0) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  fail("disposable MariaDB did not become ready within 180 seconds");
}

function applyMigrations(baseline, plan) {
  const sources = [baseline, ...plan];
  for (const item of sources) {
    const sourcePath = item.file === "schema.sql" ? baselineSchemaPath : path.join(migrationsDir, item.file);
    const sql = fs.readFileSync(sourcePath, "utf8");
    const result = dockerExec([containerName, "mariadb", ...dbArgs(["--binary-mode"])], { input: sql, allowFailure: true });
    if (result.status !== 0) fail(`${item.file === "schema.sql" ? "baseline schema" : "migration"} ${item.file} failed in disposable schema database: ${text(result.stderr).slice(-4000)}`);
  }
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

function writeOutput(manifest, expected, baseline, migrationPlanRows, tableSets, bundles) {
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
    baseline_schema: { file: baseline.file, sha256: baseline.sha256, statement_count: baseline.statement_count, bytes: baseline.bytes },
    migration_count: migrationPlanRows.length,
    migration_sha256_manifest: migrationPlanRows,
    roles: bundles,
    validation: {
      required_tables_checked: true,
      runtime_exclusions_checked: true,
      no_data_statements_checked: true,
      three_role_partition_checked: true,
    },
  };
  const outputPath = path.join(outputDir, "staging-schema-bundle-manifest.json");
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return outputPath;
}

function printPlan(manifest, baseline, files, rows) {
  console.log(JSON.stringify({
    contract: manifest.contract,
    expected_commit: expectedCommit?.toLowerCase() || null,
    output_dir: outputDir,
    baseline_schema: { file: baseline.file, sha256: baseline.sha256, statement_count: baseline.statement_count, bytes: baseline.bytes },
    migration_count: files.length,
    statement_count: rows.reduce((sum, row) => sum + row.statement_count, 0),
    required_bundle_files: manifest.validation.required_bundle_files,
    confirmation_required: manifest.safety.confirmation,
    production_access_forbidden: true,
    provider_access_forbidden: true,
    plan_only: true,
  }, null, 2));
}

const manifest = readManifest();
const baseline = baselineSchema();
const files = migrationFiles();
const rows = migrationPlan(files);
if (planOnly) {
  printPlan(manifest, baseline, files, rows);
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
  const outputPath = writeOutput(manifest, expectedCommit, baseline, rows, sets, bundles);
  console.log(JSON.stringify({ output_path: outputPath, source_commit: expectedCommit.toLowerCase(), roles: bundles, production_accessed: false, data_exported: false, secrets_included: false }, null, 2));
} finally {
  run("docker", ["rm", "--force", containerName], { allowFailure: true });
}
