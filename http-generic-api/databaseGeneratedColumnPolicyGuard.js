import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const parserPath = path.join(__dirname, "scripts", "staging-sql-parser.mjs");
const { splitStatements } = await import(pathToFileURL(parserPath).href);

const TEXT = (value) => String(value ?? "").trim();
const IDENTIFIER = (value) => TEXT(value).replaceAll("`", "").split(".").at(-1).toLowerCase();

function stripSqlComments(value) {
  const source = String(value ?? "");
  let output = "";
  let quote = null;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1] ?? "";
    if (quote) {
      output += current;
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === quote) {
        if (next === quote) { output += next; index += 1; }
        else quote = null;
      }
      continue;
    }
    if (current === "'" || current === '"' || current === "`") { quote = current; output += current; continue; }
    if (current === "-" && next === "-") {
      while (index < source.length && source[index] !== "\n") index += 1;
      output += "\n";
      continue;
    }
    if (current === "#") {
      while (index < source.length && source[index] !== "\n") index += 1;
      output += "\n";
      continue;
    }
    if (current === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1;
      index += 1;
      output += " ";
      continue;
    }
    output += current;
  }
  return output;
}

function findMatchingParen(source, openIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = openIndex; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1] ?? "";
    if (quote) {
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === quote) {
        if (next === quote) index += 1;
        else quote = null;
      }
      continue;
    }
    if (current === "'" || current === '"' || current === "`") { quote = current; continue; }
    if (current === "(") depth += 1;
    else if (current === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function splitTopLevel(source, delimiter = ",") {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1] ?? "";
    if (quote) {
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === quote) {
        if (next === quote) index += 1;
        else quote = null;
      }
      continue;
    }
    if (current === "'" || current === '"' || current === "`") { quote = current; continue; }
    if (current === "(") depth += 1;
    else if (current === ")") depth -= 1;
    else if (current === delimiter && depth === 0) { parts.push(source.slice(start, index).trim()); start = index + 1; }
  }
  parts.push(source.slice(start).trim());
  return parts.filter(Boolean);
}

function columnFromDefinition(item) {
  const match = item.match(/^\s*(?:`([^`]+)`|([A-Za-z0-9_$]+))\s+/u);
  return match ? IDENTIFIER(match[1] || match[2]) : null;
}

function tableFromCreate(statement) {
  const match = statement.match(/^\s*CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(?:`([^`]+)`|([A-Za-z0-9_$.-]+))/iu);
  return match ? { table: IDENTIFIER(match[2] || match[3]), ifNotExists: Boolean(match[1]), match } : null;
}

function isGeneratedDefinition(item) {
  return /\bGENERATED\s+(?:ALWAYS\s+)?AS\s*\(/iu.test(item)
    || /\b(?:VIRTUAL|STORED)\s+GENERATED\s+AS\s*\(/iu.test(item);
}

function generatedDefinition(state, table, column, file, statement, mode, item) {
  state.set(`${table}.${column}`, {
    table,
    column,
    file,
    mode,
    definition: TEXT(item).slice(0, 2000),
    statement: TEXT(statement).slice(0, 2000),
  });
}

function removeDefinition(state, table, column) {
  state.delete(`${table}.${column}`);
}

function projectCreate(statement, file, state, tables, definitions) {
  const info = tableFromCreate(statement);
  if (!info) return;
  if (info.ifNotExists && tables.has(info.table)) return;
  tables.add(info.table);
  const open = statement.indexOf("(", info.match[0].length);
  const close = open >= 0 ? findMatchingParen(statement, open) : -1;
  if (open < 0 || close < 0) return;
  for (const item of splitTopLevel(statement.slice(open + 1, close))) {
    if (/^(?:CONSTRAINT|PRIMARY|UNIQUE|KEY|INDEX|FOREIGN|CHECK)/iu.test(item)) continue;
    const column = columnFromDefinition(item);
    if (!column) continue;
    if (isGeneratedDefinition(item)) {
      generatedDefinition(state, info.table, column, file, statement, "CREATE TABLE", item);
      definitions.push({ table: info.table, column, file, mode: "CREATE TABLE" });
    }
  }
}

function projectAlter(statement, file, state, tables, definitions) {
  const tableMatch = statement.match(/^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:`([^`]+)`|([A-Za-z0-9_$.-]+))/iu);
  if (!tableMatch) return;
  const table = IDENTIFIER(tableMatch[1] || tableMatch[2]);
  tables.add(table);
  const body = statement.slice(tableMatch[0].length).trim();
  for (const segment of splitTopLevel(body)) {
    const modify = segment.match(/^\s*MODIFY\s+(?:COLUMN\s+)?(?:`([^`]+)`|([A-Za-z0-9_$]+))\s+([\s\S]*)$/iu);
    const change = segment.match(/^\s*CHANGE\s+(?:COLUMN\s+)?(?:`([^`]+)`|([A-Za-z0-9_$]+))\s+(?:`([^`]+)`|([A-Za-z0-9_$]+))\s+([\s\S]*)$/iu);
    const add = segment.match(/^\s*ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(?:`([^`]+)`|([A-Za-z0-9_$]+))\s+([\s\S]*)$/iu);
    const drop = segment.match(/^\s*DROP\s+(?:COLUMN\s+)?(?:IF\s+EXISTS\s+)?(?:`([^`]+)`|([A-Za-z0-9_$]+))/iu);
    if (drop) {
      removeDefinition(state, table, IDENTIFIER(drop[1] || drop[2]));
      continue;
    }
    const oldColumn = modify ? IDENTIFIER(modify[1] || modify[2]) : change ? IDENTIFIER(change[1] || change[2]) : add ? IDENTIFIER(add[1] || add[2]) : null;
    const newColumn = change ? IDENTIFIER(change[3] || change[4]) : oldColumn;
    const typeText = modify ? modify[3] : change ? change[5] : add ? add[3] : "";
    if (!newColumn) continue;
    if (oldColumn && oldColumn !== newColumn) removeDefinition(state, table, oldColumn);
    if (isGeneratedDefinition(typeText)) {
      generatedDefinition(state, table, newColumn, file, statement, "ALTER TABLE", segment);
      definitions.push({ table, column: newColumn, file, mode: "ALTER TABLE" });
    } else if (modify || change || add) {
      removeDefinition(state, table, newColumn);
    }
  }
}

function insertInfo(statement) {
  const match = statement.match(/^\s*(?:INSERT|REPLACE)\s+(?:IGNORE\s+)?INTO\s+(?:`([^`]+)`|([A-Za-z0-9_$.-]+))([\s\S]*)$/iu);
  if (!match) return null;
  const table = IDENTIFIER(match[1] || match[2]);
  let rest = match[3].trimStart();
  let columns = [];
  if (rest.startsWith("(")) {
    const close = findMatchingParen(rest, 0);
    if (close < 0) return null;
    columns = splitTopLevel(rest.slice(1, close)).map(IDENTIFIER);
    rest = rest.slice(close + 1).trimStart();
  }
  return {
    table,
    columns,
    hasColumns: columns.length > 0,
    rest,
    duplicate: rest.match(/\bON\s+DUPLICATE\s+KEY\s+UPDATE\b([\s\S]*)$/iu)?.[1] || "",
    set: rest.match(/^SET\s+([\s\S]*)$/iu)?.[1] || "",
  };
}

function assignmentColumns(text) {
  return splitTopLevel(text).map((assignment) => assignment.match(/^\s*(?:`([^`]+)`|([A-Za-z0-9_$]+))\s*=/u)).filter(Boolean).map((match) => IDENTIFIER(match[1] || match[2]));
}

function finding(state, findings, table, column, file, statementIndex, statement, mode, reason) {
  const definition = state.get(`${table}.${column}`);
  if (!definition) return;
  findings.push({
    code: "generated_column_write",
    category: "generated_column_domain",
    severity: "blocker",
    file,
    statement_index: statementIndex,
    table,
    column,
    writer_mode: mode,
    reason,
    definition_file: definition.file,
    definition_mode: definition.mode,
    statement: TEXT(statement).slice(0, 2000),
    applies_sql: false,
  });
}

function inspectWriters(state, tables, statement, file, statementIndex, findings) {
  const insert = insertInfo(statement);
  if (insert) {
    const generatedColumns = [...state.values()].filter((definition) => definition.table === insert.table).map((definition) => definition.column);
    if (!insert.hasColumns && generatedColumns.length) {
      findings.push({
        code: "generated_column_implicit_insert",
        category: "generated_column_domain",
        severity: "blocker",
        file,
        statement_index: statementIndex,
        table: insert.table,
        column: null,
        writer_mode: "INSERT/REPLACE implicit column list",
        reason: "writer omits an explicit column list for a table with generated columns",
        generated_columns: generatedColumns,
        statement: TEXT(statement).slice(0, 2000),
        applies_sql: false,
      });
    }
    for (const column of insert.columns) finding(state, findings, insert.table, column, file, statementIndex, statement, "INSERT/REPLACE column list", "generated column appears in INSERT/REPLACE column list");
    for (const column of assignmentColumns(insert.duplicate)) finding(state, findings, insert.table, column, file, statementIndex, statement, "ON DUPLICATE KEY UPDATE", "generated column appears in duplicate-key assignment");
    for (const column of assignmentColumns(insert.set)) finding(state, findings, insert.table, column, file, statementIndex, statement, "INSERT/REPLACE SET", "generated column appears in SET assignment");
    return;
  }
  const update = statement.match(/^\s*UPDATE\s+(?:`([^`]+)`|([A-Za-z0-9_$.-]+))[\s\S]*?\bSET\b([\s\S]*?)(?:\bWHERE\b|$)/iu);
  if (update) {
    const table = IDENTIFIER(update[1] || update[2]);
    for (const column of assignmentColumns(update[3])) finding(state, findings, table, column, file, statementIndex, statement, "UPDATE SET", "generated column appears in UPDATE assignment");
  }
}

function blocked(reason, message, details = {}) {
  return {
    contract: "mad4b.mariadb-generated-column-ordered-chain.v1",
    ok: false,
    ready: false,
    blocked_reason: reason,
    reason_code: reason,
    message,
    findings: [],
    warnings: [],
    database_connection_performed: false,
    sql_mutation_performed: false,
    provider_mutation_performed: false,
    credential_access_performed: false,
    data_export_performed: false,
    runtime_mutation_performed: false,
    secrets_included: false,
    ...details,
  };
}

export function inspectOrderedMigrationChainGeneratedColumns({
  files = [],
  baselineFile = "http-generic-api/schema.sql",
  engine = "mariadb",
  policy = {},
  bootstrapEntries = [],
  readFile = (file) => fs.readFileSync(path.resolve(REPO_ROOT, file), "utf8"),
} = {}) {
  const contract = policy.generated_column_chain_contract || {};
  if (engine !== "mariadb") return blocked("unsupported_engine", "Generated-column inspection is currently defined for MariaDB staging only.", { engine });
  if (contract.enabled !== true || contract.static_only !== true || contract.database_connection_allowed !== false || contract.sql_mutation_allowed !== false || contract.provider_access_allowed !== false || contract.secrets_included !== false || contract.fail_on_generated_column_write !== true) {
    return blocked("generated_column_contract_invalid", "The generated-column contract must explicitly enable static-only fail-closed evaluation.", { engine, policy_key: contract.policy_key || null });
  }
  const migrations = files.filter((file) => /^http-generic-api\/migrations\/.*\.sql$/u.test(String(file).replaceAll("\\", "/"))).slice().sort((left, right) => {
    const leftName = path.basename(String(left));
    const rightName = path.basename(String(right));
    const leftVersion = BigInt(leftName.match(/^\d+/u)?.[0] || 0);
    const rightVersion = BigInt(rightName.match(/^\d+/u)?.[0] || 0);
    return leftVersion < rightVersion ? -1 : leftVersion > rightVersion ? 1 : leftName.localeCompare(rightName);
  });
  const sequence = [baselineFile, ...migrations];
  const state = new Map();
  const tables = new Set();
  const definitions = [];
  const findings = [];
  let statementsChecked = 0;
  for (const file of sequence) {
    for (const bootstrap of bootstrapEntries.filter((entry) => entry.file === file || entry.file === path.basename(file))) {
      const statement = stripSqlComments(bootstrap.statement).trim();
      if (!statement) continue;
      projectCreate(statement, file, state, tables, definitions);
      projectAlter(statement, file, state, tables, definitions);
    }
    const source = readFile(file);
    for (const [statementIndex, original] of splitStatements(source).entries()) {
      const statement = stripSqlComments(original).trim();
      if (!statement) continue;
      statementsChecked += 1;
      projectCreate(statement, file, state, tables, definitions);
      projectAlter(statement, file, state, tables, definitions);
      inspectWriters(state, tables, statement, file, statementIndex, findings);
    }
  }
  return {
    contract: "mad4b.mariadb-generated-column-ordered-chain.v1",
    engine,
    policy_key: contract.policy_key || null,
    baseline_file: baselineFile,
    files_checked: sequence.length,
    migration_files_checked: migrations.length,
    statements_checked: statementsChecked,
    generated_columns: state.size,
    definitions_applied: definitions.length,
    writer_checks: statementsChecked,
    findings,
    warnings: [],
    ok: findings.length === 0,
    ready: findings.length === 0,
    database_connection_performed: false,
    sql_mutation_performed: false,
    provider_mutation_performed: false,
    credential_access_performed: false,
    data_export_performed: false,
    runtime_mutation_performed: false,
    secrets_included: false,
  };
}

export function loadGeneratedColumnPolicyContract(policyPath) {
  return JSON.parse(fs.readFileSync(policyPath, "utf8")).generated_column_chain_contract || null;
}

export { stripSqlComments };

// Keep the public helper names available for focused regression tests without exposing mutable state.
export const generatedColumnPolicyInternals = Object.freeze({ splitTopLevel, findMatchingParen, insertInfo, assignmentColumns });
