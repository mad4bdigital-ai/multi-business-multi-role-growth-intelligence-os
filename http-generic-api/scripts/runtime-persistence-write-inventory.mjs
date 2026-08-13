#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const API_ROOT = path.resolve(path.dirname(__filename), "..");
const TARGET_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts"]);
const EXCLUDED_DIRS = new Set(["node_modules", "coverage", "dist", "build", ".next"]);

export const RUNTIME_PERSISTENCE_DB_BINDING = "DB_USER/getPool";
export const GOVERNANCE_CONTROL_DB_BINDING = "GOVERNANCE_DB_USER/getGovernancePool";
export const UNKNOWN_DB_BINDING = "unknown/db.js";

const MUTATION_PATTERN = /\b(INSERT(?:\s+IGNORE)?\s+INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+(?:TABLE|INDEX|VIEW|TRIGGER|DATABASE|USER)|ALTER\s+TABLE|DROP\s+(?:TABLE|INDEX|VIEW|TRIGGER|DATABASE|USER)|TRUNCATE\s+TABLE|RENAME\s+TABLE|GRANT|REVOKE)\s+([`"'${}A-Za-z0-9_.-]+)?/giu;
const SOURCE_DB_BINDING_PATTERN = /(?:from\s+["'][^"']*\/?(?:db|governanceDb)\.js["']|require\(\s*["'][^"']*\/?(?:db|governanceDb)\.js["']\s*\)|\bgetPool\s*\(|\bgetGovernancePool\s*\(|from\s+["'][^"']*\/runtimePersistenceWriteAuthority\.js["']|\bresolveRuntimePersistenceExecutor\s*\()/u;
const RUNTIME_SOURCE_BINDING_PATTERN = /(?:from\s+["'][^"']*\/?db\.js["']|require\(\s*["'][^"']*\/?db\.js["']\s*\)|\bgetPool\s*\(|from\s+["'][^"']*\/runtimePersistenceWriteAuthority\.js["']|\bresolveRuntimePersistenceExecutor\s*\()/u;
const GOVERNANCE_SOURCE_BINDING_PATTERN = /(?:from\s+["'][^"']*\/?governanceDb\.js["']|require\(\s*["'][^"']*\/?governanceDb\.js["']\s*\)|\bgetGovernancePool\s*\()/u;
const TEST_FILE_PATTERN = /(?:^|\/)test[^/]*\.(?:mjs|js|cjs|ts)$/u;

const MIGRATION_ADMIN_PATH_PATTERNS = [
  /(?:^|\/)migrations\//u,
  /scripts\/governed-migration-/u,
  /scripts\/create-admin\.mjs$/u,
  /databaseTableLifecycle\.js$/u,
  /schemaImportPipeline\.js$/u,
  /scripts\/backup-executor-/u,
  /scripts\/seed-/u,
];

const GOVERNANCE_CONTROL_PATH_PATTERNS = [
  /governance/iu,
  /authority/iu,
  /grant/iu,
  /approval/iu,
  /certification/iu,
  /repositoryAutomation/iu,
  /repositoryGovernance/iu,
  /releaseOperation/iu,
  /dynamicContainer/iu,
  /registryDataManagement/iu,
  /(?:^|\/)sqlAdapter\.js$/u,
  /scripts\/execution-enablement-/u,
  /platformPluginPromotion\.js$/u,
  /platformResourceRecipeCapability\.js$/u,
  /(?:^|\/)routes\/admin[^/]*Routes\.js$/u,
  /platformResourceAuthorityGrantTool\.js$/u,
];

function normalizePath(filePath) {
  return filePath.replaceAll(path.sep, "/");
}

function normalizeOperation(raw = "") {
  const value = String(raw).trim().replace(/\s+/gu, " ").toUpperCase();
  if (value.startsWith("INSERT") || value.startsWith("REPLACE")) return "INSERT";
  if (value === "UPDATE") return "UPDATE";
  if (value.startsWith("DELETE")) return "DELETE";
  if (value.startsWith("CREATE")) return "CREATE";
  if (value.startsWith("ALTER")) return "ALTER";
  if (value.startsWith("DROP")) return "DROP";
  if (value.startsWith("TRUNCATE")) return "TRUNCATE";
  if (value.startsWith("RENAME")) return "RENAME";
  if (value === "GRANT") return "GRANT";
  if (value === "REVOKE") return "REVOKE";
  return value || "UNKNOWN";
}

function isDdlAdminOperation(operation) {
  return ["CREATE", "ALTER", "DROP", "TRUNCATE", "RENAME", "GRANT", "REVOKE"].includes(operation);
}

function collectStringConstants(source = "") {
  const constants = new Map();
  const pattern = /\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*["']([A-Za-z0-9_.-]+)["']/gu;
  for (const match of source.matchAll(pattern)) constants.set(match[1], match[2]);
  return constants;
}

function normalizeTableToken(raw = "", constants = new Map()) {
  const token = String(raw || "").trim().replace(/^[`"']|[`"']$/gu, "");
  const interpolation = token.match(/^\$\{([A-Z][A-Z0-9_]*)\}$/u);
  if (interpolation && constants.has(interpolation[1])) return constants.get(interpolation[1]);
  if (!token) return "<dynamic_or_unknown>";
  if (/^[A-Za-z0-9_.-]+$/u.test(token)) return token;
  if (token.startsWith("${") || token.includes("$")) return `<dynamic:${token.slice(0, 80)}>`;
  return token.slice(0, 120);
}

function lineNumberAt(source, offset) {
  return source.slice(0, offset).split(/\r?\n/u).length;
}

function isOnDuplicateKeyUpdate(source, offset, operation) {
  if (operation !== "UPDATE") return false;
  const prefix = source.slice(Math.max(0, offset - 80), offset).toUpperCase();
  return /ON\s+DUPLICATE\s+KEY\s*$/u.test(prefix);
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function nearestSqlExecutor(source = "", offset = 0) {
  const start = Math.max(0, offset - 800);
  const prefix = source.slice(start, offset);
  const pattern = /((?:[A-Za-z_$][A-Za-z0-9_$]*\s*\([^)]*\))|[A-Za-z_$][A-Za-z0-9_$]*)\s*\.\s*(?:query|execute)\s*\(/gu;
  let last = null;
  for (const match of prefix.matchAll(pattern)) last = match;
  if (!last) return null;
  const absoluteIndex = start + (last.index || 0);
  const distance = offset - (absoluteIndex + last[0].length);
  if (distance < 0 || distance > 600) return null;
  return {
    token: String(last[1] || "").replace(/\s+/gu, ""),
    query_call_index: absoluteIndex,
    mutation_distance: distance,
  };
}

function lastNamedBindingIndex(source, executorName, calleeName, offset) {
  const prefix = source.slice(0, offset);
  const pattern = new RegExp(
    `\\b${escapeRegExp(executorName)}\\s*=\\s*[^;]{0,320}\\b${escapeRegExp(calleeName)}\\s*\\(`,
    "gu",
  );
  let last = -1;
  for (const match of prefix.matchAll(pattern)) last = match.index ?? last;
  return last;
}

export function classifyRuntimeSqlMutationBinding({ source = "", mutationOffset = 0 } = {}) {
  const executor = nearestSqlExecutor(source, mutationOffset);
  if (!executor) return null;

  const directName = executor.token.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\(/u)?.[1] || "";
  if (directName === "getGovernancePool") {
    return { db_binding: GOVERNANCE_CONTROL_DB_BINDING, reason: "direct_get_governance_pool_query" };
  }
  if (["getPool", "resolveRuntimePersistenceExecutor", "executor"].includes(directName)) {
    return { db_binding: RUNTIME_PERSISTENCE_DB_BINDING, reason: "direct_runtime_pool_query" };
  }

  if (!directName) {
    const governanceIndex = lastNamedBindingIndex(source, executor.token, "getGovernancePool", mutationOffset);
    const runtimeIndex = lastNamedBindingIndex(source, executor.token, "getPool", mutationOffset);
    if (governanceIndex >= 0 || runtimeIndex >= 0) {
      if (governanceIndex > runtimeIndex) {
        return { db_binding: GOVERNANCE_CONTROL_DB_BINDING, reason: "named_executor_bound_to_get_governance_pool" };
      }
      return { db_binding: RUNTIME_PERSISTENCE_DB_BINDING, reason: "named_executor_bound_to_get_pool" };
    }
    if (/governance/iu.test(executor.token)) {
      return { db_binding: GOVERNANCE_CONTROL_DB_BINDING, reason: "governance_named_executor" };
    }
  }

  const hasRuntimeBinding = RUNTIME_SOURCE_BINDING_PATTERN.test(source);
  const hasGovernanceBinding = GOVERNANCE_SOURCE_BINDING_PATTERN.test(source);
  if (hasRuntimeBinding && !hasGovernanceBinding) {
    return { db_binding: RUNTIME_PERSISTENCE_DB_BINDING, reason: "runtime_only_source_binding" };
  }
  if (hasGovernanceBinding && !hasRuntimeBinding) {
    return { db_binding: GOVERNANCE_CONTROL_DB_BINDING, reason: "governance_only_source_binding" };
  }
  return { db_binding: UNKNOWN_DB_BINDING, reason: "mixed_source_binding_unresolved_executor" };
}

export function classifyRuntimeSqlMutation({ file, operation }) {
  if (MIGRATION_ADMIN_PATH_PATTERNS.some((pattern) => pattern.test(file))) {
    return {
      classification: "migration/DDL/admin",
      reason: "migration_or_admin_path",
    };
  }
  if (GOVERNANCE_CONTROL_PATH_PATTERNS.some((pattern) => pattern.test(file))) {
    return {
      classification: "governance/control-plane",
      reason: "governance_or_control_plane_path",
    };
  }
  if (isDdlAdminOperation(operation)) {
    return {
      classification: "migration/DDL/admin",
      reason: "ddl_or_db_admin_operation",
    };
  }
  return {
    classification: "ordinary business/runtime persistence",
    reason: "default_runtime_persistence_path",
  };
}

async function walk(dir, out = []) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (TARGET_EXTENSIONS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

export function inventorySourceFile({ source, file }) {
  if (!SOURCE_DB_BINDING_PATTERN.test(source) || TEST_FILE_PATTERN.test(file)) return [];
  const constants = collectStringConstants(source);
  const rows = [];
  for (const match of source.matchAll(MUTATION_PATTERN)) {
    const operation = normalizeOperation(match[1]);
    if (isOnDuplicateKeyUpdate(source, match.index || 0, operation)) continue;
    const binding = classifyRuntimeSqlMutationBinding({ source, mutationOffset: match.index || 0 });
    if (!binding) continue;
    const table = normalizeTableToken(match[2], constants);
    const { classification, reason } = classifyRuntimeSqlMutation({ file, operation, table });
    rows.push({
      file,
      line: lineNumberAt(source, match.index || 0),
      operation,
      table,
      classification,
      classification_reason: reason,
      db_binding: binding.db_binding,
      db_binding_reason: binding.reason,
      db_user_inventory: binding.db_binding === RUNTIME_PERSISTENCE_DB_BINDING,
      static_source_inventory: true,
    });
  }
  return rows;
}

function dedupeRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = `${row.file}:${row.line}:${row.operation}:${row.table}:${row.classification}:${row.db_binding}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function summarize(rows) {
  const byClassification = {};
  const byOperation = {};
  const byDbBinding = {};
  const files = new Set();
  const tables = new Set();
  for (const row of rows) {
    files.add(row.file);
    tables.add(row.table);
    byClassification[row.classification] = (byClassification[row.classification] || 0) + 1;
    byOperation[row.operation] = (byOperation[row.operation] || 0) + 1;
    byDbBinding[row.db_binding] = (byDbBinding[row.db_binding] || 0) + 1;
  }
  return {
    mutation_surface_count: rows.length,
    file_count: files.size,
    table_token_count: tables.size,
    by_classification: byClassification,
    by_operation: byOperation,
    by_db_binding: byDbBinding,
  };
}

export async function buildRuntimePersistenceWriteInventory({ apiRoot = API_ROOT } = {}) {
  const files = await walk(apiRoot);
  const rows = [];
  for (const absolute of files) {
    const file = normalizePath(path.relative(apiRoot, absolute));
    const source = await readFile(absolute, "utf8").catch(() => "");
    rows.push(...inventorySourceFile({ source, file }));
  }
  const inventory = dedupeRows(rows).sort((a, b) =>
    a.file.localeCompare(b.file) || a.line - b.line || a.operation.localeCompare(b.operation));
  const dbUserInventory = inventory.filter((row) => row.db_binding === RUNTIME_PERSISTENCE_DB_BINDING);
  const governanceDbInventory = inventory.filter((row) => row.db_binding === GOVERNANCE_CONTROL_DB_BINDING);
  return {
    contract: "mad4b.runtime-persistence-write-inventory.v1",
    binding_contract: "mad4b.runtime-persistence-write-inventory-binding.v1",
    root: "http-generic-api",
    scope: "SQL mutation surfaces directly issued through db.js/getPool(), runtimePersistenceWriteAuthority, or governanceDb.js/getGovernancePool(); DB_USER inventory is the runtime-binding subset only",
    classification_values: [
      "ordinary business/runtime persistence",
      "governance/control-plane",
      "migration/DDL/admin",
    ],
    db_binding_values: [
      RUNTIME_PERSISTENCE_DB_BINDING,
      GOVERNANCE_CONTROL_DB_BINDING,
      UNKNOWN_DB_BINDING,
    ],
    summary: {
      ...summarize(inventory),
      db_user_mutation_surface_count: dbUserInventory.length,
      governance_db_mutation_surface_count: governanceDbInventory.length,
    },
    inventory,
    db_user_inventory: dbUserInventory,
    governance_db_inventory: governanceDbInventory,
    notes: [
      "Static inventory excludes test files and third-party/build directories.",
      "Each SQL mutation is bound to its nearest direct query/execute executor before DB_USER membership is decided.",
      "Dynamic table expressions are retained as dynamic tokens rather than guessed.",
      "Surfaces routed through runtimePersistenceWriteAuthority.js remain part of the DB_USER-backed inventory after refactoring away from direct getPool() calls.",
      "getGovernancePool()-backed writes remain visible as governance/control-plane evidence but are excluded from db_user_inventory.",
      "Known migration/admin paths take precedence, then governance/control-plane ownership paths, then SQL operation classification; semantic classification is independent from credential binding.",
      "ON DUPLICATE KEY UPDATE clauses are represented by their parent INSERT surface, not double-counted as standalone UPDATE tables.",
      "platformResourceAuthorityGrantTool.js remains visible in the full inventory but is not required in the DB_USER write inventory.",
      "The inventory is source evidence only; live grants, Production SQL, and secret mutation are outside this command.",
    ],
    secrets_included: false,
  };
}

function renderMarkdown(report) {
  const lines = [
    "# Runtime Persistence SQL Mutation Inventory",
    "",
    `Surfaces: ${report.summary.mutation_surface_count}; DB_USER: ${report.summary.db_user_mutation_surface_count}; governance DB: ${report.summary.governance_db_mutation_surface_count}; files: ${report.summary.file_count}; table tokens: ${report.summary.table_token_count}.`,
    "",
    "| File | Line | Operation | Table | Classification | DB binding |",
    "|---|---:|---|---|---|---|",
  ];
  for (const row of report.inventory) {
    lines.push(`| \`${row.file}\` | ${row.line} | ${row.operation} | \`${row.table}\` | ${row.classification} | \`${row.db_binding}\` |`);
  }
  lines.push("", "No live SQL or credential values are included.");
  return `${lines.join("\n")}\n`;
}

async function main(argv = process.argv.slice(2)) {
  const report = await buildRuntimePersistenceWriteInventory();
  if (argv.includes("--markdown")) process.stdout.write(renderMarkdown(report));
  else process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
