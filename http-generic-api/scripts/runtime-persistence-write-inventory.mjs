#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const API_ROOT = path.resolve(path.dirname(__filename), "..");
const TARGET_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts"]);
const EXCLUDED_DIRS = new Set(["node_modules", "coverage", "dist", "build", ".next"]);

const MUTATION_PATTERN = /\b(INSERT(?:\s+IGNORE)?\s+INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+(?:TABLE|INDEX|VIEW|TRIGGER|DATABASE|USER)|ALTER\s+TABLE|DROP\s+(?:TABLE|INDEX|VIEW|TRIGGER|DATABASE|USER)|TRUNCATE\s+TABLE|RENAME\s+TABLE|GRANT|REVOKE)\s+([`"'${}A-Za-z0-9_.-]+)?/giu;
const DB_BINDING_PATTERN = /(?:from\s+["'][^"']*\/?db\.js["']|require\(\s*["'][^"']*\/?db\.js["']\s*\)|\bgetPool\s*\()/u;
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
  let token = String(raw || "").trim().replace(/^[`"']|[`"']$/gu, "");
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

export function classifyRuntimeSqlMutation({ file, operation }) {
  if (isDdlAdminOperation(operation) || MIGRATION_ADMIN_PATH_PATTERNS.some((pattern) => pattern.test(file))) {
    return {
      classification: "migration/DDL/admin",
      reason: isDdlAdminOperation(operation) ? "ddl_or_db_admin_operation" : "migration_or_admin_path",
    };
  }
  if (GOVERNANCE_CONTROL_PATH_PATTERNS.some((pattern) => pattern.test(file))) {
    return {
      classification: "governance/control-plane",
      reason: "governance_or_control_plane_path",
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
  if (!DB_BINDING_PATTERN.test(source) || TEST_FILE_PATTERN.test(file)) return [];
  const constants = collectStringConstants(source);
  const rows = [];
  for (const match of source.matchAll(MUTATION_PATTERN)) {
    const operation = normalizeOperation(match[1]);
    const table = normalizeTableToken(match[2], constants);
    const { classification, reason } = classifyRuntimeSqlMutation({ file, operation, table });
    rows.push({
      file,
      line: lineNumberAt(source, match.index || 0),
      operation,
      table,
      classification,
      classification_reason: reason,
      db_binding: "getPool/db.js",
      static_source_inventory: true,
    });
  }
  return rows;
}

function dedupeRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = `${row.file}:${row.line}:${row.operation}:${row.table}:${row.classification}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function summarize(rows) {
  const byClassification = {};
  const byOperation = {};
  const files = new Set();
  const tables = new Set();
  for (const row of rows) {
    files.add(row.file);
    tables.add(row.table);
    byClassification[row.classification] = (byClassification[row.classification] || 0) + 1;
    byOperation[row.operation] = (byOperation[row.operation] || 0) + 1;
  }
  return {
    mutation_surface_count: rows.length,
    file_count: files.size,
    table_token_count: tables.size,
    by_classification: byClassification,
    by_operation: byOperation,
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
  return {
    contract: "mad4b.runtime-persistence-write-inventory.v1",
    root: "http-generic-api",
    scope: "direct getPool()/db.js SQL mutation surfaces",
    classification_values: [
      "ordinary business/runtime persistence",
      "governance/control-plane",
      "migration/DDL/admin",
    ],
    summary: summarize(inventory),
    inventory,
    notes: [
      "Static inventory excludes test files and third-party/build directories.",
      "Dynamic table expressions are retained as dynamic tokens rather than guessed.",
      "platformResourceAuthorityGrantTool.js is inventoried/classified but this window does not modify it.",
      "The inventory is source evidence only; live grants, Production SQL, and secret mutation are outside this command.",
    ],
    secrets_included: false,
  };
}

function renderMarkdown(report) {
  const lines = [
    "# Runtime Persistence SQL Mutation Inventory",
    "",
    `Surfaces: ${report.summary.mutation_surface_count}; files: ${report.summary.file_count}; table tokens: ${report.summary.table_token_count}.`,
    "",
    "| File | Line | Operation | Table | Classification |",
    "|---|---:|---|---|---|",
  ];
  for (const row of report.inventory) {
    lines.push(`| \`${row.file}\` | ${row.line} | ${row.operation} | \`${row.table}\` | ${row.classification} |`);
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
