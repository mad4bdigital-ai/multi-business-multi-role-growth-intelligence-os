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
const viewNames = new Set();
let viewColumnReferencesChecked = 0;
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
const parenthesized = (text, offset) => {
  let index = offset;
  while (/\s/u.test(text[index] ?? "")) index += 1;
  if (text[index] !== "(") return null;
  const start = index + 1;
  let depth = 1;
  let quote = null;
  let escaped = false;
  for (index = start; index < text.length; index += 1) {
    const current = text[index];
    const next = text[index + 1] ?? "";
    if (quote) {
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === quote) {
        if (next === quote) index += 1;
        else quote = null;
      }
      continue;
    }
    if (["'", '"', "`"].includes(current)) quote = current;
    else if (current === "(") depth += 1;
    else if (current === ")") {
      depth -= 1;
      if (depth === 0) return { content: text.slice(start, index), end: index + 1 };
    }
  }
  return null;
};
const indexColumns = (body) => splitTopLevel(body).map((part) => {
  const token = part.trim().replace(/\s+(?:ASC|DESC)\s*$/i, "").replace(/\s*\(\s*\d+\s*\)\s*$/u, "").trim();
  const match = token.match(/^(?:`([^`]+)`|([A-Za-z_][A-Za-z0-9_$]*))$/u);
  return match ? (match[1] ?? match[2]) : null;
}).filter(Boolean);
const recordIndexDefinition = ({ table, columns, file, line, statement, detail }) => {
  if (!ensureTable(table)) {
    record({ kind: "missing_table", table, file, line, statement, detail: `${detail}: target table is absent before index operation` });
    return;
  }
  for (const column of indexColumns(columns)) {
    if (!ensureTable(table).has(columnName(column))) record({ kind: "missing_column", table, column, file, line, statement, detail: `${detail}: indexed column is absent before index operation` });
  }
};
const recordForeignKeyReferences = (sql, file, line) => {
  const clean = stripStringLiterals(stripComments(sql));
  for (const match of clean.matchAll(/\bREFERENCES\s+(?:`([^`]+)`|([A-Za-z0-9_$]+))\s*\(([^)]*)\)/ig)) {
    const table = match[1] ?? match[2];
    const state = ensureTable(table);
    if (!state) {
      record({ kind: "missing_table", table, file, line, statement: sql, detail: "FOREIGN KEY parent table is absent before reference" });
      continue;
    }
    for (const column of indexColumns(match[3])) if (!state.has(columnName(column))) record({ kind: "missing_column", table, column, file, line, statement: sql, detail: "FOREIGN KEY parent column is absent before reference" });
  }
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
  recordForeignKeyReferences(sql, file, line);
  return true;
};
const parseCreateIndex = (sql, file, line) => {
  const clean = stripComments(sql);
  const match = clean.match(/^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:`[^`]+`|[A-Za-z_][A-Za-z0-9_$]*)\s+ON\s+(?:`([^`]+)`|([A-Za-z0-9_$]+))\s*/i);
  if (!match) return false;
  const body = parenthesized(clean, match[0].length);
  if (!body) return true;
  recordIndexDefinition({ table: match[1] ?? match[2], columns: body.content, file, line, statement: sql, detail: "CREATE INDEX" });
  return true;
};
const parseCreateAsSelect = (sql, file, line) => {
  const clean = stripComments(sql);
  const match = clean.match(/^\s*CREATE\s+(?:TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:`([^`]+)`|([A-Za-z0-9_$]+))\s+AS\s+SELECT\b/i);
  if (!match) return false;
  const target = match[1] ?? match[2];
  if (!ensureTable(target)) addTable(target);
  parseFromJoins(sql, file, line);
  return true;
};
const sqlKeywords = new Set([
  "as", "on", "where", "group", "order", "limit", "union", "having", "left", "right", "inner", "outer", "cross", "full", "join",
]);
const viewSourceAliases = (sql) => {
  const clean = stripStringLiterals(stripComments(sql));
  const sources = new Map();
  const systemSchemas = new Set(["information_schema", "performance_schema", "mysql", "sys"]);
  const assign = (key, table) => {
    if (!key) return;
    if (!sources.has(key)) sources.set(key, table);
    else if (sources.get(key) !== table) sources.set(key, null);
  };
  for (const match of clean.matchAll(/(?:\bFROM|\bJOIN)\s+(?:(?:`([^`]+)`|([A-Za-z0-9_$]+))\s*\.\s*)?(?:`([^`]+)`|([A-Za-z0-9_$]+))(?:\s+(?:AS\s+)?(?:`([^`]+)`|([A-Za-z0-9_$]+)))?/ig)) {
    const schema = normalize(match[1] ?? match[2]);
    const table = tableName(match[3] ?? match[4]);
    if (!table || systemSchemas.has(schema)) continue;
    const aliasCandidate = normalize(match[5] ?? match[6]);
    const alias = aliasCandidate && !sqlKeywords.has(aliasCandidate) ? aliasCandidate : table;
    assign(alias, table);
    assign(table, table);
  }
  return sources;
};
const viewOutputColumns = (sql) => {
  const clean = stripStringLiterals(stripComments(sql));
  const outputs = new Set();
  for (const select of clean.matchAll(/\bSELECT\b([\s\S]*?)(?=\bFROM\b)/ig)) {
    for (const expression of splitTopLevel(select[1])) {
      const alias = expression.match(/\bAS\s+(?:`([^`]+)`|([A-Za-z_][A-Za-z0-9_$]*))\s*$/i);
      if (alias) {
        outputs.add(columnName(alias[1] ?? alias[2]));
        continue;
      }
      const direct = expression.trim().match(/(?:`[^`]+`|[A-Za-z_][A-Za-z0-9_$]*)\s*\.\s*(?:`([^`]+)`|([A-Za-z_][A-Za-z0-9_$]*))\s*$/i);
      if (direct) outputs.add(columnName(direct[1] ?? direct[2]));
    }
  }
  return [...outputs];
};
const recordViewColumnReferences = (sql, file, line) => {
  const sources = viewSourceAliases(sql);
  const clean = stripStringLiterals(stripComments(sql));
  for (const match of clean.matchAll(/(?:`([^`]+)`|([A-Za-z_][A-Za-z0-9_$]*))\s*\.\s*(?:`([^`]+)`|([A-Za-z_][A-Za-z0-9_$]*))/g)) {
    const alias = normalize(match[1] ?? match[2]);
    const column = match[3] ?? match[4];
    const table = sources.get(alias);
    if (!table || !column) continue;
    const state = ensureTable(table);
    if (!state || viewNames.has(tableName(table))) continue;
    viewColumnReferencesChecked += 1;
    if (!state.has(columnName(column))) {
      record({ kind: "missing_column", table, column, file, line, statement: sql, detail: "VIEW qualified column reference is absent before view operation" });
    }
  }
};
const parseCreateView = (sql, file, line) => {
  const clean = stripComments(sql);
  const match = clean.match(/^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:ALGORITHM\s*=\s*[^\s]+\s+)?(?:DEFINER\s*=\s*[^\s]+\s+)?(?:SQL\s+SECURITY\s+[^\s]+\s+)?VIEW\s+(?:`([^`]+)`|([A-Za-z0-9_$]+))\s+AS\s+SELECT\b/i);
  if (!match) return false;
  recordViewColumnReferences(sql, file, line);
  parseFromJoins(sql, file, line);
  const viewName = match[1] ?? match[2];
  viewNames.add(tableName(viewName));
  addTable(viewName, viewOutputColumns(sql));
  return true;
};
const parseDrop = (sql, file, line) => {
  const clean = stripComments(sql);
  for (const match of clean.matchAll(/DROP\s+TABLE\s+(IF\s+EXISTS\s+)?(?:`([^`]+)`|([A-Za-z0-9_$]+))/ig)) {
    const safe = Boolean(match[1]);
    const target = match[2] ?? match[3];
    if (!safe && !ensureTable(target)) record({ kind: "missing_table", table: target, file, line, statement: sql, detail: "DROP TABLE target is absent without IF EXISTS" });
    tables.delete(tableName(target));
    viewNames.delete(tableName(target));
  }
  for (const match of clean.matchAll(/DROP\s+VIEW\s+(IF\s+EXISTS\s+)?(?:`([^`]+)`|([A-Za-z0-9_$]+))/ig)) {
    const safe = Boolean(match[1]);
    const target = match[2] ?? match[3];
    if (!safe && !ensureTable(target)) record({ kind: "missing_table", table: target, file, line, statement: sql, detail: "DROP VIEW target is absent without IF EXISTS" });
    tables.delete(tableName(target));
    viewNames.delete(tableName(target));
  }
};
const parseDropIndex = (sql, file, line) => {
  const clean = stripComments(sql);
  for (const match of clean.matchAll(/DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?(?:`[^`]+`|[A-Za-z_][A-Za-z0-9_$]*)\s+ON\s+(?:`([^`]+)`|([A-Za-z0-9_$]+))/ig)) {
    const target = match[1] ?? match[2];
    if (!ensureTable(target)) record({ kind: "missing_table", table: target, file, line, statement: sql, detail: "DROP INDEX target table is absent" });
  }
};
const parseTruncate = (sql, file, line) => {
  const clean = stripComments(sql);
  for (const match of clean.matchAll(/TRUNCATE\s+TABLE\s+(?:`([^`]+)`|([A-Za-z0-9_$]+))/ig)) {
    const target = match[1] ?? match[2];
    if (!ensureTable(target)) record({ kind: "missing_table", table: target, file, line, statement: sql, detail: "TRUNCATE TABLE target is absent" });
  }
};
const parseRename = (sql, file, line) => {
  const clean = stripComments(sql);
  const match = clean.match(/^\s*RENAME\s+TABLE\s+(?:`([^`]+)`|([A-Za-z0-9_$]+))\s+TO\s+(?:`([^`]+)`|([A-Za-z0-9_$]+))/i);
  if (!match) return false;
  const source = match[1] ?? match[2];
  const target = match[3] ?? match[4];
  const state = ensureTable(source);
  if (!state) record({ kind: "missing_table", table: source, file, line, statement: sql, detail: "RENAME TABLE source is absent" });
  else {
    tables.delete(tableName(source));
    if (!ensureTable(target)) addTable(target, [...state]);
  }
  return true;
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
  const rename = clean.match(/\bRENAME\s+TO\s+(?:`([^`]+)`|([A-Za-z0-9_$]+))/i);
  if (rename) {
    const renamed = rename[1] ?? rename[2];
    tables.delete(tableName(target));
    addTable(renamed, [...state]);
    return true;
  }
  const sameStatementAdded = new Set();
  const clausePattern = /(?:ADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?|MODIFY\s+COLUMN|CHANGE\s+COLUMN|DROP\s+COLUMN)\s+(?:`([^`]+)`|([A-Za-z0-9_$]+))(?:\s+(?:`([^`]+)`|([A-Za-z0-9_$]+)))?/ig;
  const clauses = [...clean.matchAll(clausePattern)];
  const sameStatementColumnAdds = new Set(clauses.filter((clause) => clause[0].toUpperCase().startsWith("ADD COLUMN")).map((clause) => columnName(clause[1] ?? clause[2])));
  for (const indexMatch of clean.matchAll(/\bADD\s+(?:(?:UNIQUE|FULLTEXT|SPATIAL)\s+)?(?:INDEX|KEY)\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:`[^`]+`|[A-Za-z_][A-Za-z0-9_$]*)\s+)?\(/ig)) {
    const body = parenthesized(clean, indexMatch.index + indexMatch[0].length - 1);
    if (!body) continue;
    const indexed = indexColumns(body.content);
    const state = ensureTable(target);
    if (!state) {
      record({ kind: "missing_table", table: target, file, line, statement: sql, detail: "ALTER TABLE ADD INDEX: target table is absent before index operation" });
      continue;
    }
    for (const column of indexed) {
      if (state.has(columnName(column))) continue;
      if (sameStatementColumnAdds.has(columnName(column))) {
        ignoredFalsePositives.push({ kind: "missing_column", table: tableName(target), column: columnName(column), file, line, detail: "ALTER TABLE ADD INDEX: indexed column is added in the same ALTER TABLE statement" });
      } else {
        record({ kind: "missing_column", table: target, column, file, line, statement: sql, detail: "ALTER TABLE ADD INDEX: indexed column is absent before index operation" });
      }
    }
  }
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
  recordForeignKeyReferences(sql, file, line);
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
  if (parseCreateView(sql, file, line)) return;
  if (parseCreate(sql, file, line)) return;
  if (parseCreateIndex(sql, file, line)) return;
  if (parseCreateAsSelect(sql, file, line)) return;
  parseDrop(sql, file, line);
  parseDropIndex(sql, file, line);
  if (parseRename(sql, file, line)) return;
  parseTruncate(sql, file, line);
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
const baselineStatements = splitStatements(baselineSql);
const immediateBaselineStatements = baselineStatements.filter((statement) => !/^\s*CREATE\s+TABLE[\s\S]*\bFOREIGN\s+KEY\b/imu.test(statement));
const deferredBaselineStatements = baselineStatements.filter((statement) => /^\s*CREATE\s+TABLE[\s\S]*\bFOREIGN\s+KEY\b/imu.test(statement));
for (const statement of immediateBaselineStatements) processStatement(statement, "schema.sql", lineOf(baselineSql, baselineSql.indexOf(statement)));
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
for (const statement of deferredBaselineStatements) processStatement(statement, "schema.sql", lineOf(baselineSql, baselineSql.indexOf(statement)));

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
  view_column_references_checked: viewColumnReferencesChecked,
  sample_false_positives: ignoredFalsePositives.slice(0, 20),
  final_tables: [...tables.entries()].map(([table, columns]) => ({ table, column_count: columns.size }))
};
process.stdout.write(JSON.stringify(out, null, 2));
