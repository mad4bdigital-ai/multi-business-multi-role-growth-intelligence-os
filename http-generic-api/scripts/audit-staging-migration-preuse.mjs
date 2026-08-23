import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { splitStatements } from "./staging-sql-parser.mjs";
import { compareMigrationFiles, isMigrationFilename } from "./migration-order.mjs";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = process.argv[2] ?? path.resolve(scriptRoot, "../..");
const schemaPath = path.join(repoRoot, "http-generic-api", "schema.sql");
const migrationsDir = path.join(repoRoot, "http-generic-api", "migrations");
const migrations = fs.readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort(compareMigrationFiles);
if (migrations.some((name) => !isMigrationFilename(name))) throw new Error("every SQL migration filename must begin with a numeric version prefix");
const bootstrapFlagIndex = process.argv.indexOf("--canonical-bootstrap");
const canonicalBootstrap = bootstrapFlagIndex === -1 ? [] : JSON.parse(Buffer.from(process.argv[bootstrapFlagIndex + 1], "base64").toString("utf8"));
const bootstrapByFile = new Map();
for (const entry of canonicalBootstrap) {
  if (!bootstrapByFile.has(entry.file)) bootstrapByFile.set(entry.file, []);
  bootstrapByFile.get(entry.file).push(entry);
}

const tables = new Map();
const events = [];
const ignoredFalsePositives = [];
const normalize = (value) => String(value ?? "").replace(/^[`\"']|[`\"']$/g, "").trim().toLowerCase();
const tableName = (value) => normalize(value).replace(/^.*\./, "");
const columnName = (value) => normalize(value).replace(/^.*\./, "");
const addTable = (name, columns = []) => {
  const key = tableName(name);
  if (!key) return;
  tables.set(key, new Set(columns.map(columnName).filter(Boolean)));
};
const ensureTable = (name) => tables.get(tableName(name));
const addColumn = (name, column) => {
  const set = ensureTable(name);
  if (set && column) set.add(columnName(column));
};
const lineOf = (text, index) => text.slice(0, index).split(/\r?\n/).length;
const stripComments = (sql) => {
  let output = "";
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  for (let i = 0; i < sql.length; i += 1) {
    const c = sql[i];
    const n = sql[i + 1] ?? "";
    if (lineComment) {
      if (c === "\n") { lineComment = false; output += "\n"; } else output += " ";
      continue;
    }
    if (blockComment) {
      if (c === "*" && n === "/") { output += "  "; i += 1; blockComment = false; } else output += c === "\n" ? "\n" : " ";
      continue;
    }
    if (!quote && c === "-" && n === "-") { output += "  "; i += 1; lineComment = true; continue; }
    if (!quote && c === "/" && n === "*") { output += "  "; i += 1; blockComment = true; continue; }
    if (quote) {
      output += c;
      if (c === "\\") { output += n; i += 1; }
      else if (c === quote) {
        if (n === quote) { output += n; i += 1; } else quote = null;
      }
      continue;
    }
    if (["'", '"', "`"].includes(c)) quote = c;
    output += c;
  }
  return output;
};
const record = ({ kind, table, column, file, statement, line, detail, sameStatementPredecessor = false }) => {
  const item = { kind, table: tableName(table), column: column ? columnName(column) : undefined, file, line, detail };
  if (sameStatementPredecessor) ignoredFalsePositives.push(item);
  else events.push(item);
};
const splitTopLevel = (text) => {
  const parts = [];
  let buffer = "";
  let depth = 0;
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const n = text[i + 1] ?? "";
    if (quote) {
      buffer += c;
      if (c === "\\") { buffer += n; i += 1; }
      else if (c === quote) {
        if (n === quote) { buffer += n; i += 1; } else quote = null;
      }
      continue;
    }
    if (["'", '"', "`"].includes(c)) { quote = c; buffer += c; continue; }
    if (c === "(") depth += 1;
    if (c === ")") depth = Math.max(0, depth - 1);
    if (c === "," && depth === 0) { parts.push(buffer.trim()); buffer = ""; } else buffer += c;
  }
  if (buffer.trim()) parts.push(buffer.trim());
  return parts;
};
const parseColumnDefinitions = (body) => {
  const cols = [];
  const structural = /^(PRIMARY|UNIQUE|KEY|INDEX|CONSTRAINT|FOREIGN|CHECK|FULLTEXT|SPATIAL|PARTITION|PERIOD)\b/i;
  for (const part of splitTopLevel(body)) {
    if (!part || structural.test(part)) continue;
    const match = part.match(/^`([^`]+)`|^([A-Za-z_][A-Za-z0-9_$]*)/);
    if (match) cols.push(match[1] ?? match[2]);
  }
  return cols;
};
const parseCreate = (sql, file, line) => {
  const clean = stripComments(sql);
  const create = clean.match(/CREATE\s+(?:TEMPORARY\s+)?TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(?:`([^`]+)`|([A-Za-z0-9_$]+))\s*(?:LIKE\s+(?:`([^`]+)`|([A-Za-z0-9_$]+))|\((?<body>[\s\S]*)\))\s*(?:ENGINE|DEFAULT|COMMENT|$)/i);
  if (!create) return false;
  const target = create[2] ?? create[3];
  const like = create[4] ?? create[5];
  if (like) {
    const source = ensureTable(like);
    if (!source) record({ kind: "missing_table", table: like, file, line, statement: sql, detail: `CREATE TABLE ${target} LIKE ${like}` });
    if (!ensureTable(target)) addTable(target, source ? [...source] : []);
    return true;
  }
  const columns = parseColumnDefinitions(create.groups?.body ?? "");
  if (ensureTable(target) && !create[1]) {
    record({ kind: "table_already_exists", table: target, file, line, statement: sql, detail: "CREATE TABLE without IF NOT EXISTS while table is already present" });
  } else if (!ensureTable(target)) addTable(target, columns);
  return true;
};
const parseDrop = (sql) => {
  const clean = stripComments(sql);
  for (const match of clean.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:`([^`]+)`|([A-Za-z0-9_$]+))/ig)) tables.delete(tableName(match[1] ?? match[2]));
};
const parseAlter = (sql, file, line) => {
  const clean = stripComments(sql);
  const match = clean.match(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:`([^`]+)`|([A-Za-z0-9_$]+))/i);
  if (!match) return false;
  const target = match[1] ?? match[2];
  const state = ensureTable(target);
  if (!state) {
    record({ kind: "missing_table", table: target, file, line, statement: sql, detail: "ALTER TABLE target is absent before statement" });
    return true;
  }
  const sameStatementAdded = new Set();
  const clausePattern = /(?:ADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?|MODIFY\s+COLUMN|CHANGE\s+COLUMN|DROP\s+COLUMN)\s+(?:`([^`]+)`|([A-Za-z0-9_$]+))(?:\s+(?:`([^`]+)`|([A-Za-z0-9_$]+)))?/ig;
  const clauses = [...clean.matchAll(clausePattern)];
  for (let i = 0; i < clauses.length; i += 1) {
    const clause = clauses[i];
    const keyword = clause[0].toUpperCase();
    const first = clause[1] ?? clause[2];
    const second = clause[3] ?? clause[4];
    const end = clauses[i + 1]?.index ?? clean.length;
    const segment = clean.slice(clause.index, end);
    if (keyword.startsWith("ADD COLUMN")) {
      const after = segment.match(/\bAFTER\s+(?:`([^`]+)`|([A-Za-z0-9_$]+))/i);
      const predecessor = after ? (after[1] ?? after[2]) : null;
      if (predecessor && !state.has(columnName(predecessor)) && !sameStatementAdded.has(columnName(predecessor))) {
        record({ kind: "missing_column", table: target, column: predecessor, file, line, statement: sql, detail: `AFTER predecessor before ADD ${first}` });
      } else if (predecessor && sameStatementAdded.has(columnName(predecessor))) {
        record({ kind: "missing_column", table: target, column: predecessor, file, line, statement: sql, detail: `AFTER predecessor before ADD ${first}`, sameStatementPredecessor: true });
      }
      state.add(columnName(first));
      sameStatementAdded.add(columnName(first));
    } else if (keyword.startsWith("MODIFY COLUMN")) {
      if (!state.has(columnName(first)) && !sameStatementAdded.has(columnName(first))) record({ kind: "missing_column", table: target, column: first, file, line, statement: sql, detail: "MODIFY COLUMN target is absent before statement" });
      state.add(columnName(first));
    } else if (keyword.startsWith("CHANGE COLUMN")) {
      if (!state.has(columnName(first)) && !sameStatementAdded.has(columnName(first))) record({ kind: "missing_column", table: target, column: first, file, line, statement: sql, detail: `CHANGE COLUMN source is absent before ${second}` });
      state.delete(columnName(first));
      state.add(columnName(second));
    } else if (keyword.startsWith("DROP COLUMN")) {
      state.delete(columnName(first));
    }
  }
  return true;
};
const recordTableColumns = ({ table, columns, file, line, statement, detail }) => {
  const state = ensureTable(table);
  if (!state) {
    record({ kind: "missing_table", table, file, line, statement, detail });
    return;
  }
  for (const column of columns) if (!state.has(columnName(column))) record({ kind: "missing_column", table, column, file, line, statement, detail });
};
const parseInsert = (sql, file, line) => {
  const clean = stripStringLiterals(stripComments(sql));
  const match = clean.match(/INSERT\s+(?:IGNORE\s+)?INTO\s+(?:`([^`]+)`|([A-Za-z0-9_$]+))\s*\(([^)]*)\)/i);
  if (!match) return false;
  const table = match[1] ?? match[2];
  const columns = [...match[3].matchAll(/`([^`]+)`|\b([A-Za-z_][A-Za-z0-9_]*)\b/g)].map((m) => m[1] ?? m[2]).filter((c) => !["values"].includes(c.toLowerCase()));
  recordTableColumns({ table, columns, file, line, statement: sql, detail: "INSERT column list" });
  const duplicate = clean.match(/ON\s+DUPLICATE\s+KEY\s+UPDATE\s+([\s\S]*)$/i)?.[1] ?? "";
  const updates = [...duplicate.matchAll(/(?:^|,)\s*(?:`([^`]+)`|([A-Za-z_][A-Za-z0-9_]*))\s*=/g)].map((m) => m[1] ?? m[2]);
  recordTableColumns({ table, columns: updates, file, line, statement: sql, detail: "ON DUPLICATE KEY UPDATE target columns" });
  return true;
};
const parseUpdate = (sql, file, line) => {
  const clean = stripStringLiterals(stripComments(sql));
  const match = clean.match(/UPDATE\s+(?:LOW_PRIORITY\s+|IGNORE\s+)?(?:`([^`]+)`|([A-Za-z0-9_$]+))(?:\s+(?:AS\s+)?([A-Za-z0-9_$]+))?\s+SET\s+([\s\S]*?)(?=\s+WHERE\s|\s+ORDER\s+BY\s|\s+LIMIT\s|$)/i);
  if (!match) return false;
  const table = match[1] ?? match[2];
  const targetAlias = match[3] ?? table;
  const assignments = [...match[4].matchAll(/(?:^|,)\s*(?:(?:`[^`]+`|[A-Za-z0-9_$]+)\.)?(?:`([^`]+)`|([A-Za-z_][A-Za-z0-9_]*))\s*=/g)].map((m) => m[1] ?? m[2]);
  recordTableColumns({ table, columns: assignments, file, line, statement: sql, detail: "UPDATE SET target columns" });
  const qualified = [...clean.matchAll(new RegExp(`${targetAlias.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*\\.\\s*` + "([^`]+)" + "`|" + `${targetAlias.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*\\.\\s*([A-Za-z_][A-Za-z0-9_]*)`, "ig"))].map((m) => m[1] ?? m[2]);
  recordTableColumns({ table, columns: qualified, file, line, statement: sql, detail: "qualified UPDATE target references" });
  return true;
};
const parseDelete = (sql, file, line) => {
  const clean = stripComments(sql);
  const match = clean.match(/DELETE\s+FROM\s+(?:`([^`]+)`|([A-Za-z0-9_$]+))/i);
  if (!match) return false;
  const table = match[1] ?? match[2];
  if (!ensureTable(table)) record({ kind: "missing_table", table, file, line, statement: sql, detail: "DELETE target is absent" });
  return true;
};
const stripStringLiterals = (sql) => {
  let output = "";
  let quote = null;
  for (let i = 0; i < sql.length; i += 1) {
    const c = sql[i];
    const n = sql[i + 1] ?? "";
    if (quote) {
      if (c === "\\") { output += "  "; i += 1; }
      else if (c === quote) {
        if (n === quote) { output += "  "; i += 1; } else { output += " "; quote = null; }
      } else output += c === "\n" ? "\n" : " ";
      continue;
    }
    if (c === "'" || c === '"') { quote = c; output += " "; continue; }
    output += c;
  }
  return output;
};
const parseFromJoins = (sql, file, line) => {
  const clean = stripStringLiterals(stripComments(sql));
  const localSources = new Set([...clean.matchAll(/(?:\bWITH(?:\s+RECURSIVE)?|,)\s*(?:`([^`]+)`|([A-Za-z0-9_$]+))\s+AS\s*\(/ig)].map((match) => tableName(match[1] ?? match[2])));
  for (const match of clean.matchAll(/(?:FROM|JOIN)\s+(?:`([^`]+)`|([A-Za-z0-9_$]+))/ig)) {
    const table = match[1] ?? match[2];
    const normalized = tableName(table);
    if (localSources.has(normalized) || ["information_schema", "performance_schema", "mysql", "sys", "coalesce", "is"].includes(normalized)) continue;
    if (normalized === "tags" && /\bTRIM\s*\([^)]*$/iu.test(clean.slice(0, match.index))) continue;
    if (!ensureTable(table)) record({ kind: "missing_table", table, file, line, statement: sql, detail: "FROM/JOIN source is absent" });
  }
};
const processStatement = (sql, file, line) => {
  const clean = stripComments(sql);
  if (!clean.trim()) return;
  if (parseCreate(sql, file, line)) return;
  parseDrop(sql);
  if (parseAlter(sql, file, line)) return;
  if (parseInsert(sql, file, line)) { parseFromJoins(sql, file, line); return; }
  if (parseUpdate(sql, file, line)) { parseFromJoins(sql, file, line); return; }
  if (parseDelete(sql, file, line)) { parseFromJoins(sql, file, line); return; }
  if (/\b(?:CREATE|OR\s+REPLACE)\s+VIEW\b|\bSELECT\b/i.test(clean)) parseFromJoins(sql, file, line);
  const view = clean.match(/\bCREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:`([^`]+)`|([A-Za-z0-9_$]+))/iu);
  if (view) addTable(view[1] ?? view[2]);
  const temporary = clean.match(/\bCREATE\s+TEMPORARY\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:`([^`]+)`|([A-Za-z0-9_$]+))\s+AS\b/iu);
  if (temporary) addTable(temporary[1] ?? temporary[2]);
};

const baselineSql = fs.readFileSync(schemaPath, "utf8");
for (const statement of splitStatements(baselineSql)) processStatement(statement, "schema.sql", lineOf(baselineSql, baselineSql.indexOf(statement)));
for (const file of migrations) {
  for (const entry of bootstrapByFile.get(file) || []) {
    if (!migrations.includes(entry.source_file)) throw new Error(`canonical bootstrap source is outside the exact migration chain: ${entry.source_file}`);
    const sourceSql = fs.readFileSync(path.join(migrationsDir, entry.source_file), "utf8");
    const statement = splitStatements(sourceSql).find((candidate) => {
      const pattern = entry.object_type === "view"
        ? /^\s*CREATE\s+OR\s+REPLACE\s+VIEW\s+(?:`([^`]+)`|([A-Za-z0-9_$]+))\s+AS\b/iu
        : /^\s*CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(?:`([^`]+)`|([A-Za-z0-9_$]+))\s*\(/iu;
      const match = candidate.match(pattern);
      return match && (match[1] || match[2]).toLowerCase() === entry.table;
    });
    if (!statement) throw new Error(`canonical idempotent bootstrap definition is missing for ${entry.table}`);
    processStatement(statement, `canonical-bootstrap:${entry.source_file}`, lineOf(sourceSql, sourceSql.indexOf(statement)));
  }
  const relative = path.join("http-generic-api", "migrations", file);
  const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
  for (const statement of splitStatements(sql)) processStatement(statement, relative, lineOf(sql, sql.indexOf(statement)));
}

const firstByKey = new Map();
for (const event of events) {
  if (event.kind !== "missing_table" && event.kind !== "missing_column") continue;
  const key = `${event.kind}:${event.table}:${event.column ?? ""}`;
  if (!firstByKey.has(key)) firstByKey.set(key, event);
}
const unique = [...firstByKey.values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.table.localeCompare(b.table));
const counts = unique.reduce((acc, item) => { acc[item.kind] = (acc[item.kind] ?? 0) + 1; return acc; }, {});
const out = {
  repo_root: repoRoot,
  baseline_tables: tables.size,
  migration_files: migrations.length,
 unique_true_preuse_gaps: unique.length,
  counts,
  gaps: unique,
  same_statement_false_positives: ignoredFalsePositives.length,
  sample_false_positives: ignoredFalsePositives.slice(0, 20),
  final_tables: [...tables.entries()].map(([table, columns]) => ({ table, column_count: columns.size }))
};
process.stdout.write(JSON.stringify(out, null, 2));
