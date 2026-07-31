import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REGISTRY_PATH = path.join(
  SCRIPT_DIR,
  "..",
  "config",
  "governed-migration-dependencies.json",
);
const MIGRATION_PATTERN = /^[A-Za-z0-9._-]+\.sql$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const LEDGER_MODES = new Set(["apply", "record_only"]);

function dependencyError(code, message, status = 409, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = {
    ...details,
    read_only: true,
    applies_sql: false,
    database_mutation_executed: false,
    provider_call_executed: false,
    external_write_executed: false,
    secrets_included: false,
  };
  return error;
}

function normalizeMigration(value, field = "migration") {
  const migration = String(value || "").trim();
  if (!MIGRATION_PATTERN.test(migration) || path.basename(migration) !== migration) {
    throw dependencyError(
      "governed_migration_dependency_invalid_migration",
      `${field} must be one repository migration filename ending in .sql.`,
      400,
      { field },
    );
  }
  return migration;
}

function normalizeChecksum(value, field = "checksum_sha256") {
  const checksum = String(value || "").trim().toLowerCase();
  if (!SHA256_PATTERN.test(checksum)) {
    throw dependencyError(
      "governed_migration_dependency_invalid_checksum",
      `${field} must be a lowercase SHA-256 value.`,
      400,
      { field },
    );
  }
  return checksum;
}

function normalizeStatementCount(value, field = "statement_count") {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > 5000) {
    throw dependencyError(
      "governed_migration_dependency_invalid_statement_count",
      `${field} must be an integer from 1 to 5000.`,
      400,
      { field },
    );
  }
  return count;
}

function normalizeLedgerMode(value, field = "required_ledger_mode") {
  const mode = String(value || "apply").trim().toLowerCase();
  if (!LEDGER_MODES.has(mode)) {
    throw dependencyError(
      "governed_migration_dependency_invalid_ledger_mode",
      `${field} must be apply or record_only.`,
      400,
      { field },
    );
  }
  return mode;
}

function parsedValue(value) {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text || (!text.startsWith("{") && !text.startsWith("["))) return value;
  try { return JSON.parse(text); } catch { return value; }
}

function findObjectWithKey(value, key, seen = new Set()) {
  const parsed = parsedValue(value);
  if (!parsed || typeof parsed !== "object" || seen.has(parsed)) return null;
  seen.add(parsed);
  if (Object.prototype.hasOwnProperty.call(parsed, key)) return parsed;
  for (const child of Object.values(parsed)) {
    const found = findObjectWithKey(child, key, seen);
    if (found) return found;
  }
  return null;
}

function validateAcyclicDependencies(migrations) {
  const visiting = new Set();
  const visited = new Set();

  function visit(migration, trail = []) {
    if (visited.has(migration)) return;
    if (visiting.has(migration)) {
      throw dependencyError(
        "governed_migration_dependency_cycle",
        "Governed migration dependency registry contains a cycle.",
        409,
        { dependency_cycle: [...trail, migration] },
      );
    }
    visiting.add(migration);
    const dependencies = migrations[migration]?.dependencies || [];
    for (const dependency of dependencies) {
      if (migrations[dependency.migration]) visit(dependency.migration, [...trail, migration]);
    }
    visiting.delete(migration);
    visited.add(migration);
  }

  for (const migration of Object.keys(migrations)) visit(migration);
}

export async function loadGovernedMigrationDependencyRegistry(deps = {}) {
  const registryPath = deps.registryPath || DEFAULT_REGISTRY_PATH;
  const source = await (deps.readFile || fs.readFile)(registryPath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw dependencyError(
      "governed_migration_dependency_registry_invalid_json",
      "Governed migration dependency registry is not valid JSON.",
      500,
    );
  }
  if (parsed?.schema_version !== "governed_migration_dependencies.v1") {
    throw dependencyError(
      "governed_migration_dependency_registry_schema_mismatch",
      "Governed migration dependency registry schema_version is unsupported.",
      500,
      { schema_version: parsed?.schema_version || null },
    );
  }
  if (!parsed.migrations || typeof parsed.migrations !== "object" || Array.isArray(parsed.migrations)) {
    throw dependencyError(
      "governed_migration_dependency_registry_invalid",
      "Governed migration dependency registry must contain a migrations object.",
      500,
    );
  }

  const migrations = {};
  for (const [rawMigration, rawEntry] of Object.entries(parsed.migrations)) {
    const migration = normalizeMigration(rawMigration, "migrations key");
    const checksum = normalizeChecksum(rawEntry?.checksum_sha256, `${migration}.checksum_sha256`);
    const statementCount = normalizeStatementCount(rawEntry?.statement_count, `${migration}.statement_count`);
    const rawDependencies = rawEntry?.dependencies || [];
    if (!Array.isArray(rawDependencies)) {
      throw dependencyError(
        "governed_migration_dependency_registry_invalid",
        "Migration dependencies must be an array.",
        500,
        { migration },
      );
    }
    const seen = new Set();
    const dependencies = rawDependencies.map((rawDependency, index) => {
      const dependencyMigration = normalizeMigration(
        rawDependency?.migration,
        `${migration}.dependencies[${index}].migration`,
      );
      if (dependencyMigration === migration) {
        throw dependencyError(
          "governed_migration_dependency_self_reference",
          "A migration cannot depend on itself.",
          409,
          { migration },
        );
      }
      if (seen.has(dependencyMigration)) {
        throw dependencyError(
          "governed_migration_dependency_duplicate",
          "A migration dependency must be unique per target migration.",
          409,
          { migration, dependency_migration: dependencyMigration },
        );
      }
      seen.add(dependencyMigration);
      return {
        migration: dependencyMigration,
        checksum_sha256: normalizeChecksum(
          rawDependency?.checksum_sha256,
          `${migration}.dependencies[${index}].checksum_sha256`,
        ),
        statement_count: normalizeStatementCount(
          rawDependency?.statement_count,
          `${migration}.dependencies[${index}].statement_count`,
        ),
        required_ledger_mode: normalizeLedgerMode(
          rawDependency?.required_ledger_mode,
          `${migration}.dependencies[${index}].required_ledger_mode`,
        ),
      };
    });
    migrations[migration] = {
      checksum_sha256: checksum,
      statement_count: statementCount,
      dependencies,
    };
  }

  validateAcyclicDependencies(migrations);
  return {
    schema_version: parsed.schema_version,
    migrations,
    registry_path: registryPath,
    secrets_included: false,
  };
}

export async function resolveGovernedMigrationDependencyPlan(input = {}, deps = {}) {
  const migration = normalizeMigration(input.migration);
  const expectedChecksum = normalizeChecksum(
    input.expected_checksum_sha256,
    "expected_checksum_sha256",
  );
  const expectedStatementCount = normalizeStatementCount(
    input.expected_statement_count,
    "expected_statement_count",
  );
  const registry = deps.registry || await loadGovernedMigrationDependencyRegistry(deps);
  const entry = registry.migrations[migration] || null;

  if (!entry) {
    return {
      migration,
      migration_checksum_sha256: expectedChecksum,
      statement_count: expectedStatementCount,
      dependency_contract_declared: false,
      dependency_count: 0,
      dependencies: [],
      registry_schema_version: registry.schema_version,
      read_only: true,
      applies_sql: false,
      secrets_included: false,
    };
  }

  if (
    entry.checksum_sha256 !== expectedChecksum ||
    entry.statement_count !== expectedStatementCount
  ) {
    throw dependencyError(
      "governed_migration_dependency_registry_target_mismatch",
      "Target migration checksum or statement count does not match its dependency registry entry.",
      409,
      {
        migration,
        expected_checksum_sha256: expectedChecksum,
        registry_checksum_sha256: entry.checksum_sha256,
        expected_statement_count: expectedStatementCount,
        registry_statement_count: entry.statement_count,
      },
    );
  }

  return {
    migration,
    migration_checksum_sha256: expectedChecksum,
    statement_count: expectedStatementCount,
    dependency_contract_declared: true,
    dependency_count: entry.dependencies.length,
    dependencies: entry.dependencies.map((dependency) => ({ ...dependency })),
    registry_schema_version: registry.schema_version,
    read_only: true,
    applies_sql: false,
    secrets_included: false,
  };
}

async function runtimeSchemaReadback(dependency, deps = {}) {
  const runtimeBaseUrl = String(
    deps.runtimeBaseUrl || process.env.RUNTIME_BASE_URL || "https://auth.mad4b.com",
  ).replace(/\/+$/, "");
  const backendApiKey = String(
    deps.backendApiKey || process.env.BACKEND_API_KEY || "",
  ).trim();
  if (!backendApiKey) {
    throw dependencyError(
      "governed_migration_dependency_runtime_authority_required",
      "BACKEND_API_KEY is required for live governed migration dependency readback.",
      503,
    );
  }
  const response = await (deps.fetch || fetch)(`${runtimeBaseUrl}/gpt/tools/call`, {
    method: "POST",
    redirect: "error",
    headers: {
      Authorization: `Bearer ${backendApiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "governed_migration_schema_readback",
      tool_args: {
        migration: dependency.migration,
        expected_checksum_sha256: dependency.checksum_sha256,
        expected_statement_count: dependency.statement_count,
      },
    }),
    signal: AbortSignal.timeout(Number(deps.timeoutMs || 180000)),
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; }
  catch { payload = { raw_preview: String(text || "").slice(0, 500) }; }
  return {
    http_status: response.status,
    http_ok: response.ok,
    payload,
  };
}

function normalizeReadbackResult(value) {
  const payload = value?.payload ?? value;
  return findObjectWithKey(payload, "readback_status") || findObjectWithKey(payload, "ledger") || payload;
}

function verifyDependencyReadback(dependency, rawReadback) {
  const readback = normalizeReadbackResult(rawReadback);
  const ledger = readback?.ledger || {};
  const readbackChecksum = String(
    readback?.migration_checksum_sha256 || ledger?.migration_checksum_sha256 || "",
  ).toLowerCase();
  const readbackStatementCount = Number(
    readback?.statement_count ?? ledger?.statement_count ?? 0,
  );
  const ledgerMode = String(ledger?.mode || "").toLowerCase();
  const satisfied =
    readback?.readback_status === "pass" &&
    ledger?.found === true &&
    readbackChecksum === dependency.checksum_sha256 &&
    readbackStatementCount === dependency.statement_count &&
    ledgerMode === dependency.required_ledger_mode;

  if (!satisfied) {
    throw dependencyError(
      "governed_migration_dependency_unsatisfied",
      "A required governed migration dependency is not present in the exact successful ledger state.",
      409,
      {
        dependency_migration: dependency.migration,
        required_checksum_sha256: dependency.checksum_sha256,
        required_statement_count: dependency.statement_count,
        required_ledger_mode: dependency.required_ledger_mode,
        observed_readback_status: readback?.readback_status || null,
        observed_ledger_found: ledger?.found === true,
        observed_checksum_sha256: readbackChecksum || null,
        observed_statement_count: readbackStatementCount || null,
        observed_ledger_mode: ledgerMode || null,
      },
    );
  }

  return {
    migration: dependency.migration,
    migration_checksum_sha256: dependency.checksum_sha256,
    statement_count: dependency.statement_count,
    ledger_mode: ledgerMode,
    ledger_found: true,
    readback_status: "pass",
    satisfied: true,
    secrets_included: false,
  };
}

export async function checkGovernedMigrationDependencies(input = {}, deps = {}) {
  const plan = await resolveGovernedMigrationDependencyPlan(input, deps);
  const readback = deps.readback || ((dependency) => runtimeSchemaReadback(dependency, deps));
  const evidence = [];
  for (const dependency of plan.dependencies) {
    evidence.push(verifyDependencyReadback(dependency, await readback(dependency)));
  }
  return {
    ok: true,
    migration: plan.migration,
    migration_checksum_sha256: plan.migration_checksum_sha256,
    statement_count: plan.statement_count,
    dependency_contract_declared: plan.dependency_contract_declared,
    dependency_count: plan.dependency_count,
    all_dependencies_satisfied: true,
    dependencies: evidence,
    registry_schema_version: plan.registry_schema_version,
    read_only: true,
    applies_sql: false,
    database_mutation_executed: false,
    provider_call_executed: false,
    external_write_executed: false,
    secrets_included: false,
  };
}

const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  const input = {
    migration: process.env.MIGRATION || process.argv[2],
    expected_checksum_sha256: process.env.EXPECTED_CHECKSUM_SHA256 || process.argv[3],
    expected_statement_count: process.env.EXPECTED_STATEMENT_COUNT || process.argv[4],
  };
  try {
    console.log(JSON.stringify(await checkGovernedMigrationDependencies(input), null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error: {
        code: error?.code || "governed_migration_dependency_gate_failed",
        message: error?.message || "Governed migration dependency gate failed.",
        details: error?.details || { secrets_included: false },
      },
      read_only: true,
      applies_sql: false,
      database_mutation_executed: false,
      provider_call_executed: false,
      external_write_executed: false,
      secrets_included: false,
    }, null, 2));
    process.exitCode = 1;
  }
}
