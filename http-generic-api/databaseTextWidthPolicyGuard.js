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

function quotedLiteral(token) {
  const value = TEXT(token);
  if (!value.startsWith("'") || !value.endsWith("'")) return null;
  return value.slice(1, -1).replaceAll("''", "'").replaceAll("\\\\", "\\");
}
function acceptedNonLiteral(token) {
  const value = TEXT(token);
  return /^NULL$/iu.test(value) || /^DEFAULT$/iu.test(value)
    || /^(?:VALUES\s*\(|[A-Za-z_][A-Za-z0-9_]*\s*\(|CAST\s*\(|CONVERT\s*\()/iu.test(value);
}
function columnFromDefinition(item) {
  const match = item.match(/^\s*(?:`([^`]+)`|([A-Za-z0-9_$]+))\s+/u);
  return match ? IDENTIFIER(match[1] || match[2]) : null;
}
function textDomain(typeText) {
  const value = TEXT(typeText);
  const bounded = value.match(/\b(VARCHAR|CHAR|NCHAR|NVARCHAR)\s*\(\s*(\d+)\s*\)/iu);
  if (bounded) return { bounded: true, max_length: Number(bounded[2]), type: bounded[1].toUpperCase() };
  if (/\b(?:TINYTEXT|TEXT|MEDIUMTEXT|LONGTEXT|CLOB)\b/iu.test(value)) return { bounded: false, max_length: null, type: "TEXT" };
  return null;
}
function recordDomain(state, table, column, domain, file, statement, mode, definitions) {
  if (!table || !column || !domain) return;
  state.set(`${table}.${column}`, { table, column, ...domain, file, statement: TEXT(statement).slice(0, 2400), mode });
  definitions.push({ table, column, ...domain, file, mode });
}
function projectView(statement, file, views) {
  const match = statement.match(/^\s*CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:`([^`]+)`|([A-Za-z0-9_$.-]+))\s+AS\s+([\s\S]*)$/iu);
  if (!match) return;
  const view = IDENTIFIER(match[1] || match[2]);
  views.set(view, { view, file, statement: match[3].trim() });
}
function splitTopLevelKeyword(source, keywordPattern) {
  const parts = [];
  const pattern = new RegExp(`^${keywordPattern}(?=\\s|$)`, "iu");
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
    if (depth === 0) {
      const candidate = source.slice(index).match(pattern);
      if (candidate) {
        parts.push(source.slice(start, index).trim());
        index += candidate[0].length - 1;
        start = index + 1;
      }
    }
  }
  parts.push(source.slice(start).trim());
  return parts.filter(Boolean);
}
const SQL_SOURCE_KEYWORDS = new Set(["WHERE", "JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "CROSS", "ON", "GROUP", "ORDER", "HAVING", "LIMIT", "UNION", "EXCEPT", "INTERSECT"]);
function parseViewSources(fromClause) {
  const sources = new Map();
  const pattern = /\b(?:FROM|JOIN)\s+(?:`([^`]+)`|([A-Za-z0-9_$.-]+))(?:\s+(?:AS\s+)?(?:`([^`]+)`|([A-Za-z0-9_$]+)))?/giu;
  for (const match of String(fromClause ?? "").matchAll(pattern)) {
    const table = IDENTIFIER(match[1] || match[2]);
    if (!table) continue;
    const candidate = IDENTIFIER(match[3] || match[4]);
    const alias = candidate && !SQL_SOURCE_KEYWORDS.has(candidate.toUpperCase()) ? candidate : table;
    sources.set(alias, table);
    sources.set(table, table);
  }
  return sources;
}
function expressionAlias(expression) {
  const match = TEXT(expression).match(/^(.*?)(?:\s+AS\s+(?:`([^`]+)`|([A-Za-z0-9_$]+)))$/iu);
  return match ? { expression: match[1].trim(), alias: IDENTIFIER(match[2] || match[3]) } : { expression: TEXT(expression), alias: null };
}
function mergeSourceDomains(domains) {
  if (!domains.length || domains.some((domain) => !domain)) return null;
  const sourceFile = domains.find((domain) => domain.file)?.file || domains.find((domain) => domain.source_file)?.source_file || null;
  const knownExact = domains.every((domain) => domain.known_exact === true);
  if (domains.some((domain) => domain.bounded === false)) return { bounded: false, max_length: null, type: "TEXT", source_file: sourceFile, known_exact: knownExact };
  return { bounded: true, max_length: Math.max(...domains.map((domain) => Number(domain.max_length) || 0)), type: "VARCHAR", source_file: sourceFile, known_exact: knownExact };
}
function sourceColumnDomain(state, views, sources, reference, viewStack = []) {
  const value = TEXT(reference).replaceAll("`", "");
  const match = value.match(/^([A-Za-z0-9_$-]+)(?:\.([A-Za-z0-9_$-]+))?$/u);
  if (!match) return null;
  const qualifier = match[2] ? match[1].toLowerCase() : null;
  const column = IDENTIFIER(match[2] || match[1]);
  const table = qualifier ? sources.get(qualifier) : sources.size === 1 ? [...sources.values()][0] : null;
  if (!table) return null;
  const direct = state.get(`${table}.${column}`);
  if (direct) return direct;
  return resolveViewColumnDomain(state, views, table, column, viewStack);
}
function sourceExpressionDomain(state, views, expression, sources, viewStack = []) {
  const value = TEXT(expression);
  const literal = quotedLiteral(value);
  if (literal !== null) return { bounded: true, max_length: literal.length, type: "LITERAL", known_exact: true };
  const direct = sourceColumnDomain(state, views, sources, value, viewStack);
  if (direct) return direct;
  const cast = value.match(/^CAST\s*\(([\s\S]*?)\s+AS\s+(?:CHAR|NCHAR|VARCHAR)\s*\(\s*(\d+)\s*\)\)$/iu);
  if (cast) return { bounded: true, max_length: Number(cast[2]), type: "CAST", known_exact: false };
  const wrapper = value.match(/^(?:LOWER|UPPER|TRIM|LTRIM|RTRIM|COALESCE|IFNULL|NULLIF)\s*\(([\s\S]*)\)$/iu);
  if (wrapper) return mergeSourceDomains(splitTopLevel(wrapper[1]).map((item) => sourceExpressionDomain(state, views, item, sources, viewStack)));
  const concat = value.match(/^CONCAT(?:_WS)?\s*\(([\s\S]*)\)$/iu);
  if (concat) {
    const args = splitTopLevel(concat[1]);
    const separator = /^CONCAT_WS/iu.test(value) ? quotedLiteral(args.shift() || "") : "";
    if (separator === null) return null;
    const domains = args.map((item) => sourceExpressionDomain(state, views, item, sources, viewStack));
    if (domains.some((domain) => !domain)) return null;
    if (domains.some((domain) => domain.bounded === false)) return { bounded: false, max_length: null, type: "TEXT", source_file: domains.find((domain) => domain?.file)?.file || null, known_exact: domains.every((domain) => domain.known_exact === true) };
    return { bounded: true, max_length: domains.reduce((sum, domain) => sum + (Number(domain.max_length) || 0), separator.length * Math.max(0, args.length - 1)), type: "VARCHAR", known_exact: domains.every((domain) => domain.known_exact === true) };

  }
  if (/^CASE\b/iu.test(value)) {
    const literals = [...value.matchAll(/'(?:''|[^'])*'/gu)].map((item) => quotedLiteral(item[0])).filter((item) => item !== null);
    if (literals.length) return { bounded: true, max_length: Math.max(...literals.map((item) => item.length)), type: "CASE", known_exact: true };
  }
  return null;
}
function resolveViewColumnDomain(state, views, viewName, column, viewStack = []) {
  const view = views.get(IDENTIFIER(viewName));
  if (!view) return null;
  const stackKey = `${view.view}.${IDENTIFIER(column)}`;
  if (viewStack.includes(stackKey)) return null;
  const branches = splitTopLevelKeyword(view.statement, "UNION\\s+ALL");
  const parsed = branches.map((branch) => {
    const match = branch.match(/^\s*SELECT\s+([\s\S]*?)\s+FROM\s+([\s\S]*)$/iu);
    if (!match) return null;
    return { expressions: splitTopLevel(match[1]).map(expressionAlias), sources: parseViewSources(`FROM ${match[2]}`) };
  });
  if (!parsed.length || parsed.some((branch) => !branch)) return null;
  const index = parsed[0].expressions.findIndex((item) => item.alias === IDENTIFIER(column));
  if (index < 0) return null;
  const domains = parsed.map((branch) => sourceExpressionDomain(state, views, branch.expressions[index].expression, branch.sources, [...viewStack, stackKey]));
  return mergeSourceDomains(domains);
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
    if (/^(?:CONSTRAINT|PRIMARY|UNIQUE|KEY|INDEX|FOREIGN|CHECK|FULLTEXT|SPATIAL)\b/iu.test(item)) continue;
    const column = columnFromDefinition(item);
    const domain = textDomain(item);
    if (!column || !domain) continue;
    if (!ifNotExists || !state.has(`${table}.${column}`)) recordDomain(state, table, column, domain, file, statement, "CREATE TABLE", definitions);
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
    const domain = textDomain(typeText);
    if (!column || !domain) continue;
    recordDomain(state, table, column, domain, file, statement, "ALTER TABLE", definitions);
  }
}
function insertInfo(statement) {
  const match = statement.match(/^\s*(?:INSERT|REPLACE)\s+(?:IGNORE\s+)?INTO\s+(?:`([^`]+)`|([A-Za-z0-9_$.-]+))([\s\S]*)$/iu);
  if (!match) return null;
  const table = IDENTIFIER(match[1] || match[2]);
  let rest = match[3].trimStart();
  let columns = [];
  if (rest.startsWith("(")) {
    const close = findMatchingParen(rest, 0); if (close < 0) return null;
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
    const close = findMatchingParen(valuesSource, index); if (close < 0) break;
    rows.push(splitTopLevel(valuesSource.slice(index + 1, close)));
    index = close + 1;
  }
  return { table, columns, rows, duplicate: rest.slice(valuesToken[0].length).match(/\bON\s+DUPLICATE\s+KEY\s+UPDATE\b([\s\S]*)$/iu)?.[1] || "", rest };
}
function assignmentList(text) { return splitTopLevel(text); }
function targetColumnReference(token, column) {
  const value = TEXT(token).replaceAll("`", "");
  return IDENTIFIER(value) === column && /^[A-Za-z0-9_$]+(?:\.[A-Za-z0-9_$]+)?$/u.test(value);
}
function targetColumnExpression(token, column) {
  const value = TEXT(token);
  if (targetColumnReference(value, column)) return true;
  const wrapper = value.match(/^(?:COALESCE|IFNULL|NULLIF)\s*\(([\s\S]*)\)$/iu);
  if (!wrapper) return false;
  return targetColumnReference(splitTopLevel(wrapper[1])[0], column);
}
function staticConcatValue(token, column) {
  const value = TEXT(token);
  const match = value.match(/^(CONCAT|CONCAT_WS)\s*\(([\s\S]*)\)$/iu);
  if (!match) return null;
  const args = splitTopLevel(match[2]);
  if (args.length < 1) return null;
  const functionName = match[1].toUpperCase();
  if (functionName === "CONCAT") {
    const literals = args.map(quotedLiteral);
    if (literals.every((item) => item !== null)) return { literal: literals.join(""), target_count: 0, append_length: null };
    const targetIndexes = args.map((item, index) => targetColumnExpression(item, column) ? index : -1).filter((index) => index >= 0);
    if (!targetIndexes.length || literals.some((item, index) => !targetIndexes.includes(index) && item === null)) return null;
    return { literal: null, target_count: targetIndexes.length, append_length: literals.reduce((sum, item) => sum + (item || "").length, 0) };
  }
  const separator = quotedLiteral(args[0]);
  if (separator === null || args.length < 2) return null;
  const valueArgs = args.slice(1);
  const literals = valueArgs.map(quotedLiteral);
  if (literals.every((item) => item !== null)) return { literal: literals.join(separator), target_count: 0, append_length: null };
  const targetIndexes = valueArgs.map((item, index) => targetColumnExpression(item, column) ? index : -1).filter((index) => index >= 0);
  if (!targetIndexes.length || literals.some((item, index) => !targetIndexes.includes(index) && item === null)) return null;
  return {
    literal: null,
    target_count: targetIndexes.length,
    append_length: literals.reduce((sum, item) => sum + (item || "").length, 0) + separator.length * Math.max(0, valueArgs.length - 1),
  };
}
function inspectLiteral(state, table, column, token, file, statementIndex, findings, statement, mode) {
  const domain = state.get(`${table}.${column}`);
  if (!domain || !domain.bounded) return;
  const literal = quotedLiteral(token);
  const concat = literal === null ? staticConcatValue(token, column) : null;
  if (literal === null && concat === null) return;
  const length = literal !== null ? literal.length : concat.literal !== null ? concat.literal.length : domain.max_length * concat.target_count + concat.append_length;
  if (length <= domain.max_length) return;
  findings.push({
    code: literal !== null ? "text_width_literal_overflow" : "text_width_concat_overflow",
    category: "text_width_domain",
    severity: "blocker",
    mode,
    file,
    statement_index: statementIndex,
    table,
    column,
    length,
    max_length: domain.max_length,
    value: literal ?? TEXT(token),
    definition_file: domain.file,
    definition_mode: domain.mode,
    statement: TEXT(statement).slice(0, 2400),
    applies_sql: false,
  });
}
function inspectInsertSelect(state, views, insert, file, statementIndex, findings, statement, metrics) {
  if (!insert.columns.length || !/^SELECT\b/iu.test(insert.rest)) return;
  const duplicateIndex = insert.rest.search(/\bON\s+DUPLICATE\s+KEY\s+UPDATE\b/iu);
  const selectSource = (duplicateIndex >= 0 ? insert.rest.slice(0, duplicateIndex) : insert.rest).trim();
  const match = selectSource.match(/^SELECT\s+([\s\S]*?)\s+FROM\s+([\s\S]*)$/iu);
  if (!match) return;
  const expressions = splitTopLevel(match[1]);
  const sources = parseViewSources(`FROM ${match[2]}`);
  for (const [index, column] of insert.columns.entries()) {
    const targetDomain = state.get(`${insert.table}.${column}`);
    if (!targetDomain || !targetDomain.bounded || expressions[index] === undefined) continue;
    const sourceDomain = sourceExpressionDomain(state, views, expressions[index], sources);
    if (!sourceDomain) continue;
    metrics.insert_select_source_domain_checks += 1;
    const sourceMax = sourceDomain.bounded ? Number(sourceDomain.max_length) : null;
    if (sourceDomain.bounded && (!sourceDomain.known_exact || sourceMax <= targetDomain.max_length)) continue;
    metrics.insert_select_source_domain_overflows += 1;
    findings.push({
      code: "text_width_source_domain_overflow",
      category: "text_width_domain",
      severity: "blocker",
      mode: "INSERT/SELECT",
      file,
      statement_index: statementIndex,
      table: insert.table,
      column,
      length: sourceMax,
      max_length: targetDomain.max_length,
      value: TEXT(expressions[index]),
      source_domain: sourceDomain,
      definition_file: targetDomain.file,
      definition_mode: targetDomain.mode,
      statement: TEXT(statement).slice(0, 2400),
      applies_sql: false,
    });
  }
}
function inspectAssignments(state, views, statement, file, statementIndex, findings, metrics) {
  const insert = insertInfo(statement);
  if (insert) {
    for (const row of insert.rows) for (const [index, column] of insert.columns.entries()) if (row[index] !== undefined) inspectLiteral(state, insert.table, column, row[index], file, statementIndex, findings, statement, "INSERT/REPLACE");
    if (!insert.rows.length) inspectInsertSelect(state, views, insert, file, statementIndex, findings, statement, metrics);
    if (insert.duplicate) inspectAssignmentText(state, insert.table, insert.duplicate, file, statementIndex, findings, statement);
    return;
  }
  const update = statement.match(/^\s*UPDATE\s+(?:`([^`]+)`|([A-Za-z0-9_$.-]+))[\s\S]*?\bSET\b([\s\S]*?)(?:\bWHERE\b|$)/iu);
  if (update) inspectAssignmentText(state, IDENTIFIER(update[1] || update[2]), update[3], file, statementIndex, findings, statement);
}
function inspectAssignmentText(state, table, text, file, statementIndex, findings, statement) {
  for (const assignment of assignmentList(text)) {
    const match = assignment.match(/^\s*(?:`([^`]+)`|([A-Za-z0-9_$]+))\s*=\s*([\s\S]*)$/u);
    if (!match) continue;
    inspectLiteral(state, table, IDENTIFIER(match[1] || match[2]), match[3], file, statementIndex, findings, statement, "UPDATE");
  }
}
function blocked(reason, message, details = {}) {
  return { contract: "mad4b.mariadb-text-width-ordered-chain.v1", ok: false, ready: false, blocked_reason: reason, reason_code: reason, message, findings: [], warnings: [], database_connection_performed: false, sql_mutation_performed: false, provider_mutation_performed: false, credential_access_performed: false, data_export_performed: false, runtime_mutation_performed: false, secrets_included: false, ...details };
}

export function inspectOrderedMigrationChainTextWidths({ files = [], baselineFile = "http-generic-api/schema.sql", engine = "mariadb", policy = {}, readFile = (file) => fs.readFileSync(path.resolve(REPO_ROOT, file), "utf8") } = {}) {
  const contract = policy.text_width_chain_contract || {};
  if (engine !== "mariadb") return blocked("unsupported_engine", "Ordered text-width inspection is currently defined for MariaDB staging only.", { engine });
  if (contract.enabled !== true || contract.static_only !== true || contract.database_connection_allowed !== false || contract.sql_mutation_allowed !== false || contract.provider_access_allowed !== false || contract.credential_access_allowed !== false || contract.data_export_allowed !== false || contract.runtime_mutation_allowed !== false || contract.secrets_included !== false) return blocked("text_width_contract_invalid", "The ordered text-width contract must explicitly enable static-only fail-closed evaluation.", { engine, policy_key: contract.policy_key || null });
  const migrations = files.filter((file) => /^http-generic-api\/migrations\/.*\.sql$/u.test(String(file).replaceAll("\\", "/"))).slice().sort((left, right) => {
    const leftName = path.basename(String(left)); const rightName = path.basename(String(right));
    const leftVersion = BigInt(leftName.match(/^\d+/u)?.[0] || 0); const rightVersion = BigInt(rightName.match(/^\d+/u)?.[0] || 0);
    return leftVersion < rightVersion ? -1 : leftVersion > rightVersion ? 1 : leftName.localeCompare(rightName);
  });
  const sequence = [baselineFile, ...migrations];
  const state = new Map(); const views = new Map(); const definitions = []; const findings = []; const metrics = { insert_select_source_domain_checks: 0, insert_select_source_domain_overflows: 0 }; let statementsChecked = 0;
  for (const file of sequence) {
    for (const [statementIndex, original] of splitStatements(readFile(file)).entries()) {
      const statement = stripSqlComments(original).trim(); if (!statement) continue;
      statementsChecked += 1;
      projectCreate(statement, file, state, definitions);
      projectAlter(statement, file, state, definitions);
      projectView(statement, file, views);
      inspectAssignments(state, views, statement, file, statementIndex, findings, metrics);
    }
  }
  return { contract: "mad4b.mariadb-text-width-ordered-chain.v1", engine, policy_key: contract.policy_key || null, baseline_file: baselineFile, files_checked: sequence.length, migration_files_checked: migrations.length, statements_checked: statementsChecked, bounded_text_columns: [...state.values()].filter((item) => item.bounded).length, definitions_applied: definitions.length, ...metrics, findings, warnings: [], ok: findings.length === 0, ready: findings.length === 0, database_connection_performed: false, sql_mutation_performed: false, provider_mutation_performed: false, credential_access_performed: false, data_export_performed: false, runtime_mutation_performed: false, secrets_included: false };
}

export function loadTextWidthPolicyContract(policyPath) { return JSON.parse(fs.readFileSync(policyPath, "utf8")).text_width_chain_contract || null; }
