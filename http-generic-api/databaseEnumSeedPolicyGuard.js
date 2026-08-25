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

function quotedLiterals(source) {
  const literals = [];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== "'") continue;
    const start = index;
    let escaped = false;
    for (index += 1; index < source.length; index += 1) {
      const current = source[index];
      const next = source[index + 1] ?? "";
      if (escaped) { escaped = false; continue; }
      if (current === "\\") { escaped = true; continue; }
      if (current === "'") {
        if (next === "'") { index += 1; continue; }
        literals.push(source.slice(start, index + 1).slice(1, -1).replaceAll("''", "'").replaceAll("\\\\", "\\"));
        break;
      }
    }
  }
  return literals;
}

function enumValues(typeText) {
  const match = String(typeText ?? "").match(/\bENUM\s*\(/iu);
  if (!match) return null;
  const open = match.index + match[0].length - 1;
  const close = findMatchingParen(typeText, open);
  if (close < 0) return null;
  return quotedLiterals(typeText.slice(open + 1, close));
}

function columnFromDefinition(item) {
  const match = item.match(/^\s*(?:`([^`]+)`|([A-Za-z0-9_$]+))\s+/u);
  return match ? IDENTIFIER(match[1] || match[2]) : null;
}

function recordDefinition(state, table, column, values, file, statement, mode) {
  if (!table || !column || !values?.length) return;
  state.set(`${table}.${column}`, {
    table,
    column,
    values: new Set(values),
    file,
    statement: TEXT(statement).slice(0, 2000),
    mode,
  });
}

function projectCreate(statement, file, state, definitions) {
  const match = statement.match(/^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:`([^`]+)`|([A-Za-z0-9_$.-]+))/iu);
  if (!match) return;
  const table = IDENTIFIER(match[1] || match[2]);
  const open = statement.indexOf("(", match[0].length);
  const close = open >= 0 ? findMatchingParen(statement, open) : -1;
  if (open < 0 || close < 0) return;
  const ifNotExists = /\bIF\s+NOT\s+EXISTS\b/iu.test(match[0]);
  for (const item of splitTopLevel(statement.slice(open + 1, close))) {
    if (/^(?:CONSTRAINT|PRIMARY|UNIQUE|KEY|INDEX|FOREIGN|CHECK)\b/iu.test(item)) continue;
    const column = columnFromDefinition(item);
    const values = enumValues(item);
    if (!column || !values) continue;
    if (!ifNotExists || !state.has(`${table}.${column}`)) recordDefinition(state, table, column, values, file, statement, "CREATE TABLE");
    definitions.push({ table, column, values, file, mode: "CREATE TABLE" });
  }
}

function projectAlter(statement, file, state, definitions) {
  const tableMatch = statement.match(/^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:`([^`]+)`|([A-Za-z0-9_$.-]+))/iu);
  if (!tableMatch) return;
  const table = IDENTIFIER(tableMatch[1] || tableMatch[2]);
  const body = statement.slice(tableMatch[0].length).trim();
  for (const segment of splitTopLevel(body)) {
    const modify = segment.match(/^\s*MODIFY\s+(?:COLUMN\s+)?(?:`([^`]+)`|([A-Za-z0-9_$]+))\s+([\s\S]*)$/iu);
    const change = segment.match(/^\s*CHANGE\s+(?:COLUMN\s+)?(?:`([^`]+)`|([A-Za-z0-9_$]+))\s+(?:`([^`]+)`|([A-Za-z0-9_$]+))\s+([\s\S]*)$/iu);
    const add = segment.match(/^\s*ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(?:`([^`]+)`|([A-Za-z0-9_$]+))\s+([\s\S]*)$/iu);
    const column = modify ? IDENTIFIER(modify[1] || modify[2]) : change ? IDENTIFIER(change[3] || change[4]) : add ? IDENTIFIER(add[1] || add[2]) : null;
    const typeText = modify ? modify[3] : change ? change[5] : add ? add[3] : "";
    const values = enumValues(typeText);
    if (!column || !values) continue;
    recordDefinition(state, table, column, values, file, statement, "ALTER TABLE");
    definitions.push({ table, column, values, file, mode: "ALTER TABLE" });
  }
}

function decodeString(token) {
  const value = TEXT(token);
  if (!value.startsWith("'") || !value.endsWith("'")) return null;
  return value.slice(1, -1).replaceAll("''", "'").replaceAll("\\\\", "\\");
}

function isAcceptedNonLiteral(token) {
  const value = TEXT(token);
  return /^NULL$/iu.test(value) || /^DEFAULT$/iu.test(value)
    || /^(?:VALUES\s*\(|[A-Za-z_][A-Za-z0-9_]*\s*\(|CAST\s*\(|CONVERT\s*\()/iu.test(value);
}

function pushUnsupported(findings, definition, file, statementIndex, token, statement) {
  const value = decodeString(token);
  if (value === null || isAcceptedNonLiteral(token) || definition.values.has(value)) return;
  findings.push({
    code: "enum_seed_value_not_declared",
    category: "enum_seed_domain",
    severity: "blocker",
    file,
    statement_index: statementIndex,
    table: definition.table,
    column: definition.column,
    value,
    allowed_values: [...definition.values],
    definition_file: definition.file,
    definition_mode: definition.mode,
    statement: TEXT(statement).slice(0, 2000),
    applies_sql: false,
  });
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
  const valuesToken = rest.match(/^VALUES\b/iu);
  if (!valuesToken) return { table, columns, rows: [], duplicate: "", rest };
  const valuesSource = rest.slice(valuesToken[0].length).trimStart();
  const rows = [];
  let index = 0;
  while (index < valuesSource.length) {
    while (/\s|,/.test(valuesSource[index] ?? "")) index += 1;
    if (valuesSource[index] !== "(") break;
    const close = findMatchingParen(valuesSource, index);
    if (close < 0) break;
    rows.push(splitTopLevel(valuesSource.slice(index + 1, close)));
    index = close + 1;
  }
  return { table, columns, rows, duplicate: rest.slice(valuesToken[0].length).match(/\bON\s+DUPLICATE\s+KEY\s+UPDATE\b([\s\S]*)$/iu)?.[1] || "", rest };
}

function enumSeedExpressionLiterals(expression) {
  const value = TEXT(expression);
  if (decodeString(value) !== null) return [value];
  if (!/^CASE\b[\s\S]*\bEND$/iu.test(value)) return [];
  return [...value.matchAll(/\b(?:THEN|ELSE)\s+('(?:''|[^'])*')/giu)].map((match) => match[1]);
}

function inspectInsertSelectEnumLiterals(state, insert, file, statementIndex, findings, statement) {
  if (!insert.columns.length || !/^SELECT\b/iu.test(insert.rest)) return;
  const duplicateIndex = insert.rest.search(/\bON\s+DUPLICATE\s+KEY\s+UPDATE\b/iu);
  const selectSource = (duplicateIndex >= 0 ? insert.rest.slice(0, duplicateIndex) : insert.rest).trim();
  const selectBody = selectSource.replace(/^SELECT\s+/iu, "");
  const fromIndex = selectBody.search(/\s+FROM\b/iu);
  const expressions = splitTopLevel(fromIndex >= 0 ? selectBody.slice(0, fromIndex) : selectBody);
  for (const [index, column] of insert.columns.entries()) {
    const definition = state.get(`${insert.table}.${column}`);
    if (!definition || expressions[index] === undefined) continue;
    for (const literal of enumSeedExpressionLiterals(expressions[index])) {
      pushUnsupported(findings, definition, file, statementIndex, literal, statement);
    }
  }
}

function inspectAssignments(state, statement, file, statementIndex, findings) {
  const insert = insertInfo(statement);
  if (insert) {
    for (const row of insert.rows) {
      for (const [index, column] of insert.columns.entries()) {
        const definition = state.get(`${insert.table}.${column}`);
        if (definition && row[index] !== undefined) pushUnsupported(findings, definition, file, statementIndex, row[index], statement);
      }
    }
    if (!insert.rows.length) inspectInsertSelectEnumLiterals(state, insert, file, statementIndex, findings, statement);
    if (insert.duplicate) inspectAssignmentText(state, insert.table, insert.duplicate, file, statementIndex, findings, statement);
    return;
  }
  const update = statement.match(/^\s*UPDATE\s+(?:`([^`]+)`|([A-Za-z0-9_$.-]+))[\s\S]*?\bSET\b([\s\S]*?)(?:\bWHERE\b|$)/iu);
  if (update) inspectAssignmentText(state, IDENTIFIER(update[1] || update[2]), update[3], file, statementIndex, findings, statement);
}

function inspectAssignmentText(state, table, text, file, statementIndex, findings, statement) {
  for (const assignment of splitTopLevel(text)) {
    const match = assignment.match(/^\s*(?:`([^`]+)`|([A-Za-z0-9_$]+))\s*=\s*([\s\S]*)$/u);
    if (!match) continue;
    const definition = state.get(`${table}.${IDENTIFIER(match[1] || match[2])}`);
    if (definition) pushUnsupported(findings, definition, file, statementIndex, match[3], statement);
  }
}

function blocked(reason, message, details = {}) {
  return {
    contract: "mad4b.mariadb-enum-seed-ordered-chain.v1",
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

export function inspectOrderedMigrationChainEnumSeeds({
  files = [],
  baselineFile = "http-generic-api/schema.sql",
  engine = "mariadb",
  policy = {},
  readFile = (file) => fs.readFileSync(path.resolve(REPO_ROOT, file), "utf8"),
} = {}) {
  const contract = policy.enum_seed_chain_contract || {};
  if (engine !== "mariadb") return blocked("unsupported_engine", "Ordered enum-seed inspection is currently defined for MariaDB staging only.", { engine });
  if (contract.enabled !== true || contract.static_only !== true || contract.database_connection_allowed !== false || contract.sql_mutation_allowed !== false || contract.provider_access_allowed !== false || contract.secrets_included !== false) {
    return blocked("enum_seed_contract_invalid", "The ordered enum-seed contract must explicitly enable static-only fail-closed evaluation.", { engine, policy_key: contract.policy_key || null });
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
  const definitions = [];
  const findings = [];
  let statementsChecked = 0;
  for (const file of sequence) {
    const source = readFile(file);
    for (const [statementIndex, original] of splitStatements(source).entries()) {
      const statement = stripSqlComments(original).trim();
      if (!statement) continue;
      statementsChecked += 1;
      projectCreate(statement, file, state, definitions);
      projectAlter(statement, file, state, definitions);
      inspectAssignments(state, statement, file, statementIndex, findings);
    }
  }
  return {
    contract: "mad4b.mariadb-enum-seed-ordered-chain.v1",
    engine,
    policy_key: contract.policy_key || null,
    baseline_file: baselineFile,
    files_checked: sequence.length,
    migration_files_checked: migrations.length,
    statements_checked: statementsChecked,
    enum_columns: state.size,
    definitions_applied: definitions.length,
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

export function loadEnumSeedPolicyContract(policyPath) {
  return JSON.parse(fs.readFileSync(policyPath, "utf8")).enum_seed_chain_contract || null;
}
