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

function generatedExpression(item) {
  const marker = /\bGENERATED\s+(?:ALWAYS\s+)?AS\s*\(/iu.exec(String(item ?? ""));
  if (!marker) return null;
  const open = String(item).indexOf("(", marker.index);
  const close = open >= 0 ? findMatchingParen(String(item), open) : -1;
  return open >= 0 && close > open ? String(item).slice(open + 1, close).trim() : null;
}

function normalizeExpression(value) {
  return TEXT(value).replaceAll("`", "").replace(/\s+/gu, " ").trim().toLowerCase();
}

function functionCalls(expression) {
  const calls = [];
  const source = String(expression ?? "");
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
    if (!/[A-Za-z0-9_$]/u.test(current)) continue;
    const match = source.slice(index).match(/^([A-Za-z_][A-Za-z0-9_$]*)\s*\(/u);
    if (!match) continue;
    calls.push(match[1].toLowerCase());
    index += match[0].length - 1;
  }
  return [...new Set(calls)];
}

function generatedDefinition(state, table, column, file, statement, mode, item) {
  const expression = generatedExpression(item);
  const definition = {
    table,
    column,
    file,
    mode,
    expression,
    normalized_expression: normalizeExpression(expression),
    definition: TEXT(item).slice(0, 2000),
    statement: TEXT(statement).slice(0, 2000),
  };
  state.set(`${table}.${column}`, definition);
  return definition;
}

function collectGeneratedDefinitions(statement, file) {
  const entries = [];
  const create = tableFromCreate(statement);
  if (create) {
    const open = statement.indexOf("(", create.match[0].length);
    const close = open >= 0 ? findMatchingParen(statement, open) : -1;
    if (open >= 0 && close >= 0) {
      for (const item of splitTopLevel(statement.slice(open + 1, close))) {
        if (/^(?:CONSTRAINT|PRIMARY|UNIQUE|KEY|INDEX|FOREIGN|CHECK)\b/iu.test(item)) continue;
        const column = columnFromDefinition(item);
        if (column && isGeneratedDefinition(item)) entries.push({ table: create.table, column, file, mode: "CREATE TABLE", item, expression: generatedExpression(item) });
      }
    }
  }
  const tableMatch = statement.match(/^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:`([^`]+)`|([A-Za-z0-9_$.-]+))/iu);
  if (tableMatch) {
    const table = IDENTIFIER(tableMatch[1] || tableMatch[2]);
    const body = statement.slice(tableMatch[0].length).trim();
    for (const segment of splitTopLevel(body)) {
      const modify = segment.match(/^\s*MODIFY\s+(?:COLUMN\s+)?(?:`([^`]+)`|([A-Za-z0-9_$]+))\s+([\s\S]*)$/iu);
      const change = segment.match(/^\s*CHANGE\s+(?:COLUMN\s+)?(?:`([^`]+)`|([A-Za-z0-9_$]+))\s+(?:`([^`]+)`|([A-Za-z0-9_$]+))\s+([\s\S]*)$/iu);
      const add = segment.match(/^\s*ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(?:`([^`]+)`|([A-Za-z0-9_$]+))\s+([\s\S]*)$/iu);
      const column = change ? IDENTIFIER(change[3] || change[4]) : modify ? IDENTIFIER(modify[1] || modify[2]) : add ? IDENTIFIER(add[1] || add[2]) : null;
      const item = modify ? modify[3] : change ? change[5] : add ? add[3] : "";
      if (column && isGeneratedDefinition(item)) entries.push({ table, column, file, mode: "ALTER TABLE", item: segment, expression: generatedExpression(item) });
    }
  }
  return entries;
}

function compatibilityRules(contract) {
  const compatibility = contract.generated_expression_compatibility || {};
  return (compatibility.bridges || []).map((rule) => ({
    ...rule,
    table: IDENTIFIER(rule.table),
    column: IDENTIFIER(rule.column),
    source_file: path.basename(String(rule.source_file || "")),
    bridge_file: path.basename(String(rule.bridge_file || "")),
    post_bridge_file: path.basename(String(rule.post_bridge_file || "")),
    source_expression: normalizeExpression(rule.source_expression),
    replacement_expression: normalizeExpression(rule.replacement_expression),
    replacement_mode: TEXT(rule.replacement_mode || "generated_expression").toLowerCase(),
    replacement_column_type: TEXT(rule.replacement_column_type || ""),
    replacement_column_nullability: TEXT(rule.replacement_column_nullability || "").toUpperCase(),
    insert_omission_mode: TEXT(rule.insert_omission_mode || "").toLowerCase(),
    replacement_column_default: Object.prototype.hasOwnProperty.call(rule, "replacement_column_default")
      ? (rule.replacement_column_default === null ? null : TEXT(rule.replacement_column_default))
      : undefined,
    required_default_file: rule.required_default_file ? path.basename(String(rule.required_default_file)) : null,
    trigger_names: Array.isArray(rule.trigger_names) ? rule.trigger_names.map((name) => IDENTIFIER(name)) : [],
    trigger_events: Array.isArray(rule.trigger_events) ? rule.trigger_events.map((event) => TEXT(event).toUpperCase()) : [],
  }));
}

function escapeRegExp(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\[\]\\]/gu, "\\$&");
}

function ordinaryColumnTriggerBridgeEvidence(rule, bridgeSql) {
  const ddl = stripSqlComments(bridgeSql);
  const table = escapeRegExp(rule.table);
  const column = escapeRegExp(rule.column);
  const columnType = escapeRegExp(rule.replacement_column_type).replaceAll("\\\\ ", "\\\\s*");
  const columnNullability = escapeRegExp(rule.replacement_column_nullability).replaceAll("\\\\ ", "\\\\s*");
  const ordinaryColumn = new RegExp("(?:^|,)\\s*`?" + column + "`?\\s+" + columnType + "\\s+" + columnNullability + "\\b", "iu");
  if (!rule.replacement_column_type || !rule.replacement_column_nullability || !ordinaryColumn.test(ddl)) return false;
  if (rule.trigger_names.length !== 2 || rule.trigger_events.length !== 2 || !rule.replacement_expression) return false;
  return rule.trigger_names.every((name, index) => {
    const trigger = escapeRegExp(name);
    const event = escapeRegExp(rule.trigger_events[index]);
    const pattern = "CREATE\\s+OR\\s+REPLACE\\s+TRIGGER\\s+`?" + trigger + "`?\\s+BEFORE\\s+" + event + "\\s+ON\\s+`?" + table + "`?\\s+FOR\\s+EACH\\s+ROW\\s+SET\\s+NEW\\.`?" + column + "`?\\s*=\\s*([\\s\\S]*?)(?:;|$)";
    const match = new RegExp(pattern, "iu").exec(ddl);
    return Boolean(match && normalizeExpression(match[1]) === rule.replacement_expression);
  });
}

function requiredDefaultBridgeEvidence(rule, defaultSql) {
  if (!defaultSql || rule.insert_omission_mode !== "required_default_before_trigger" || !rule.replacement_column_default) return false;
  const ddl = stripSqlComments(defaultSql);
  const table = escapeRegExp(rule.table);
  const column = escapeRegExp(rule.column);
  const columnType = escapeRegExp(rule.replacement_column_type).replaceAll("\\\\ ", "\\\\s*");
  const columnNullability = escapeRegExp(rule.replacement_column_nullability).replaceAll("\\\\ ", "\\\\s*");
  const defaultValue = escapeRegExp(rule.replacement_column_default).replaceAll("\\\\ ", "\\\\s*");
  const pattern = new RegExp(
    "^\\s*ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?`?" + table + "`?\\s+MODIFY\\s+(?:COLUMN\\s+)?`?" + column + "`?\\s+" + columnType + "\\s+" + columnNullability + "\\s+DEFAULT\\s+" + defaultValue + "\\s*;?\\s*$",
    "iu",
  );
  return pattern.test(ddl);
}

function forbiddenGeneratedFunctions(contract) {
  return new Set((contract.generated_expression_compatibility?.forbidden_function_names || []).map((name) => TEXT(name).toLowerCase()).filter(Boolean));
}

function inspectGeneratedExpressionCompatibility({ state, contract, rules, forbiddenFunctions, sequence, file, statementIndex, candidate, findings, warnings, metrics, readFile }) {
  metrics.generated_expression_checks += 1;
  const calls = functionCalls(candidate.expression);
  const forbidden = calls.filter((name) => forbiddenFunctions.has(name));
  if (!forbidden.length) return;
  metrics.compatibility_bridge_candidates += 1;
  const sourceFile = path.basename(file);
  const rule = rules.find((entry) => entry.table === candidate.table
    && entry.column === candidate.column
    && entry.source_file === sourceFile
    && entry.source_expression === normalizeExpression(candidate.expression));
  const bridgeIndex = rule ? sequence.findIndex((entry) => path.basename(entry) === rule.bridge_file) : -1;
  const requiredDefaultIndex = rule?.required_default_file ? sequence.findIndex((entry) => path.basename(entry) === rule.required_default_file) : -1;
  const sourceIndex = sequence.findIndex((entry) => path.basename(entry) === sourceFile);
  const postBridgeIndex = rule?.post_bridge_file ? sequence.findIndex((entry) => path.basename(entry) === rule.post_bridge_file) : -1;
  const bridgeDefinition = rule ? state.get(`${candidate.table}.${candidate.column}`) : null;
  let bridgeSql = null;
  if (rule && bridgeIndex >= 0) {
    try { bridgeSql = readFile(sequence[bridgeIndex]); } catch { bridgeSql = null; }
  }
  let requiredDefaultSql = null;
  if (rule?.required_default_file && requiredDefaultIndex >= 0) {
    try { requiredDefaultSql = readFile(sequence[requiredDefaultIndex]); } catch { requiredDefaultSql = null; }
  }
  const defaultOrderingValid = rule?.insert_omission_mode === "required_default_before_trigger"
    ? Boolean(rule.required_default_file && requiredDefaultIndex > bridgeIndex && requiredDefaultIndex < sourceIndex)
    : Boolean(!rule?.required_default_file && rule?.replacement_column_default === null);
  const orderingValid = Boolean(rule
    && bridgeIndex >= 0
    && sourceIndex >= 0
    && bridgeIndex < sourceIndex
    && defaultOrderingValid
    && (!rule.post_bridge_file || (postBridgeIndex >= 0 && postBridgeIndex > sourceIndex)));
  const bridgeEvidence = rule?.replacement_mode === "ordinary_column_trigger"
    ? Boolean(bridgeSql && ordinaryColumnTriggerBridgeEvidence(rule, bridgeSql)
      && (rule.insert_omission_mode !== "required_default_before_trigger"
        || requiredDefaultBridgeEvidence(rule, requiredDefaultSql)))
    : Boolean(bridgeDefinition
      && path.basename(bridgeDefinition.file) === rule?.bridge_file
      && normalizeExpression(bridgeDefinition.expression) === rule?.replacement_expression);
  const bridgeApplied = orderingValid && bridgeEvidence;
  if (bridgeApplied) {
    metrics.allowed_compatibility_bridges += 1;
    if (rule.replacement_mode === "ordinary_column_trigger") metrics.ordinary_column_trigger_bridges += 1;
    warnings.push({
      code: "generated_column_expression_compatibility_bridge_applied",
      file,
      statement_index: statementIndex,
      table: candidate.table,
      column: candidate.column,
      forbidden_functions: forbidden,
      source_expression: candidate.expression,
      bridge_file: rule.bridge_file,
      replacement_mode: rule.replacement_mode,
      replacement_expression: rule.replacement_expression || null,
      trigger_names: rule.trigger_names,
      trigger_events: rule.trigger_events,
      required_default_file: rule.required_default_file,
      replacement_column_default: rule.replacement_column_default,
    });
    return;
  }
  metrics.unsupported_generated_expressions += 1;
  findings.push({
    code: "generated_column_unsupported_expression",
    category: "generated_column_expression_compatibility",
    severity: "blocker",
    file,
    statement_index: statementIndex,
    table: candidate.table,
    column: candidate.column,
    writer_mode: candidate.mode,
    reason: `generated expression uses MariaDB-incompatible function(s): ${forbidden.join(", ")}`,
    forbidden_functions: forbidden,
    expression: candidate.expression,
    definition: TEXT(candidate.item).slice(0, 2000),
    compatibility_bridge_file: rule?.bridge_file || null,
    replacement_mode: rule?.replacement_mode || null,
    applies_sql: false,
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

function inspectRequiredDefaultWriters({ rules, sequence, statement, file, statementIndex, findings, warnings, readFile }) {
  const insert = insertInfo(statement);
  if (!insert) return;
  for (const rule of rules) {
    if (rule.replacement_mode !== "ordinary_column_trigger" || rule.insert_omission_mode !== "required_default_before_trigger") continue;
    if (rule.table !== insert.table) continue;
    const omitted = !insert.hasColumns || !insert.columns.includes(rule.column);
    if (!omitted) continue;
    const writerIndex = sequence.findIndex((entry) => path.basename(entry) === path.basename(file));
    const defaultIndex = rule.required_default_file
      ? sequence.findIndex((entry) => path.basename(entry) === rule.required_default_file)
      : -1;
    let defaultSql = null;
    if (defaultIndex >= 0) {
      try { defaultSql = readFile(sequence[defaultIndex]); } catch { defaultSql = null; }
    }
    if (defaultIndex < 0 || writerIndex < 0 || defaultIndex >= writerIndex || !requiredDefaultBridgeEvidence(rule, defaultSql)) {
      findings.push({
        code: "generated_column_required_insert_default_missing",
        category: "generated_column_expression_compatibility",
        severity: "blocker",
        file,
        statement_index: statementIndex,
        table: rule.table,
        column: rule.column,
        writer_mode: "INSERT/REPLACE omitted required materialized column",
        reason: "writer omits a NOT NULL ordinary SHA2 materialized column before its exact default compatibility migration",
        required_default_file: rule.required_default_file || null,
        statement: TEXT(statement).slice(0, 2000),
        applies_sql: false,
      });
      continue;
    }
    warnings.push({
      code: "generated_column_required_insert_default_bridge_applied",
      file,
      statement_index: statementIndex,
      table: rule.table,
      column: rule.column,
      required_default_file: rule.required_default_file,
      replacement_column_default: rule.replacement_column_default,
    });
  }
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
  const compatibility = contract.generated_expression_compatibility || {};
  const requiredDefaultContract = compatibility.required_default_contract || {};
  const compatibilitySafe = compatibility.enabled === true
    && compatibility.static_only === true
    && compatibility.fail_on_unsupported_functions === true
    && compatibility.allow_declared_bridges === true
    && Array.isArray(compatibility.forbidden_function_names)
    && compatibility.forbidden_function_names.length > 0
    && Array.isArray(compatibility.bridges)
    && requiredDefaultContract.enabled === true
    && requiredDefaultContract.static_only === true
    && requiredDefaultContract.exact_literal_required === true
    && requiredDefaultContract.sentinel_overwritten_by_before_trigger === true
    && requiredDefaultContract.not_null_requires_default_migration === true;
  if (engine !== "mariadb") return blocked("unsupported_engine", "Generated-column inspection is currently defined for MariaDB staging only.", { engine });
  if (contract.enabled !== true || contract.static_only !== true || contract.database_connection_allowed !== false || contract.sql_mutation_allowed !== false || contract.provider_access_allowed !== false || contract.secrets_included !== false || contract.fail_on_generated_column_write !== true || compatibilitySafe !== true) {
    return blocked("generated_column_contract_invalid", "The generated-column contract must explicitly enable static-only fail-closed evaluation and expression compatibility checks.", { engine, policy_key: contract.policy_key || null });
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
  const warnings = [];
  const rules = compatibilityRules(contract);
  const forbiddenFunctions = forbiddenGeneratedFunctions(contract);
  const metrics = {
    generated_expression_checks: 0,
    compatibility_bridge_candidates: 0,
    unsupported_generated_expressions: 0,
    allowed_compatibility_bridges: 0,
    ordinary_column_trigger_bridges: 0,
  };
  for (const rule of rules) {
    const sourceIndex = sequence.findIndex((entry) => path.basename(entry) === rule.source_file);
    const bridgeIndex = sequence.findIndex((entry) => path.basename(entry) === rule.bridge_file);
    const requiredDefaultIndex = rule.required_default_file ? sequence.findIndex((entry) => path.basename(entry) === rule.required_default_file) : -1;
    const postBridgeIndex = rule.post_bridge_file ? sequence.findIndex((entry) => path.basename(entry) === rule.post_bridge_file) : -1;
    const defaultContractValid = rule.replacement_column_nullability === "NOT NULL"
      ? rule.insert_omission_mode === "required_default_before_trigger" && Boolean(rule.required_default_file) && Boolean(rule.replacement_column_default)
      : rule.insert_omission_mode === "nullable_trigger_recompute" && rule.replacement_column_default === null && !rule.required_default_file;
    if (!defaultContractValid) {
      findings.push({
        code: "generated_column_required_default_contract_invalid",
        category: "generated_column_expression_compatibility",
        severity: "blocker",
        file: rule.required_default_file || rule.bridge_file || "policy",
        statement_index: null,
        table: rule.table || null,
        column: rule.column || null,
        reason: "ordinary SHA2 bridge must declare an exact required-column default migration for NOT NULL materialized columns, or explicit nullable/no-default semantics",
        insert_omission_mode: rule.insert_omission_mode || null,
        required_default_file: rule.required_default_file || null,
        replacement_column_default: rule.replacement_column_default ?? null,
        applies_sql: false,
      });
    }
    if (!rule.table || !rule.column || !rule.source_file || !rule.bridge_file || !rule.source_expression || !rule.replacement_expression || sourceIndex < 0 || bridgeIndex < 0 || bridgeIndex >= sourceIndex || (rule.replacement_column_nullability === "NOT NULL" && (requiredDefaultIndex < 0 || requiredDefaultIndex <= bridgeIndex || requiredDefaultIndex >= sourceIndex)) || (rule.post_bridge_file && (postBridgeIndex < 0 || postBridgeIndex <= sourceIndex))) {
      findings.push({
        code: "generated_column_compatibility_bridge_order_invalid",
        category: "generated_column_expression_compatibility",
        severity: "blocker",
        file: rule.bridge_file || "policy",
        statement_index: null,
        table: rule.table || null,
        column: rule.column || null,
        reason: "declared generated-expression compatibility bridge is missing or not ordered before its immutable source definition/post-bridge",
        source_file: rule.source_file || null,
        bridge_file: rule.bridge_file || null,
        post_bridge_file: rule.post_bridge_file || null,
        applies_sql: false,
      });
      continue;
    }
    for (const bridgeName of [rule.bridge_file, rule.required_default_file, rule.post_bridge_file].filter(Boolean)) {
      const bridgePath = sequence.find((entry) => path.basename(entry) === bridgeName);
      let bridgeSql;
      try { bridgeSql = readFile(bridgePath); } catch (error) {
        findings.push({ code: "generated_column_compatibility_bridge_unreadable", category: "generated_column_expression_compatibility", severity: "blocker", file: bridgePath, statement_index: null, table: rule.table, column: rule.column, reason: error.message, applies_sql: false });
        continue;
      }
      for (const [statementIndex, original] of splitStatements(bridgeSql).entries()) {
        const statement = stripSqlComments(original).trim();
        if (/^(?:INSERT|REPLACE|UPDATE|DELETE|LOAD\s+DATA)\b/iu.test(statement)) {
          findings.push({ code: "generated_column_compatibility_bridge_contains_dml", category: "generated_column_expression_compatibility", severity: "blocker", file: bridgePath, statement_index: statementIndex, table: rule.table, column: rule.column, reason: "generated-expression compatibility bridge must be DDL-only", statement: TEXT(statement).slice(0, 2000), applies_sql: false });
        }
      }
    }
  }
  let statementsChecked = 0;
  for (const file of sequence) {
    for (const bootstrap of bootstrapEntries.filter((entry) => entry.file === file || entry.file === path.basename(file))) {
      const statement = stripSqlComments(bootstrap.statement).trim();
      if (!statement) continue;
      projectCreate(statement, file, state, tables, definitions);
      projectAlter(statement, file, state, tables, definitions);
      for (const candidate of collectGeneratedDefinitions(statement, file)) {
        inspectGeneratedExpressionCompatibility({ state, contract, rules, forbiddenFunctions, sequence, file, statementIndex: null, candidate, findings, warnings, metrics, readFile });
      }
    }
    const source = readFile(file);
    for (const [statementIndex, original] of splitStatements(source).entries()) {
      const statement = stripSqlComments(original).trim();
      if (!statement) continue;
      statementsChecked += 1;
      projectCreate(statement, file, state, tables, definitions);
      projectAlter(statement, file, state, tables, definitions);
      for (const candidate of collectGeneratedDefinitions(statement, file)) {
        inspectGeneratedExpressionCompatibility({ state, contract, rules, forbiddenFunctions, sequence, file, statementIndex, candidate, findings, warnings, metrics, readFile });
      }
      inspectWriters(state, tables, statement, file, statementIndex, findings);
      inspectRequiredDefaultWriters({ rules, sequence, statement, file, statementIndex, findings, warnings, readFile });
    }
  }
  if (compatibility.max_allowed_bridges !== undefined && metrics.allowed_compatibility_bridges > compatibility.max_allowed_bridges) {
    findings.push({
      code: "generated_column_compatibility_bridge_limit_exceeded",
      category: "generated_column_expression_compatibility",
      severity: "blocker",
      file: "policy",
      statement_index: null,
      table: null,
      column: null,
      reason: `allowed generated-expression compatibility bridges ${metrics.allowed_compatibility_bridges} exceed policy maximum ${compatibility.max_allowed_bridges}`,
      allowed_compatibility_bridges: metrics.allowed_compatibility_bridges,
      max_allowed_bridges: compatibility.max_allowed_bridges,
      applies_sql: false,
    });
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
    generated_expression_checks: metrics.generated_expression_checks,
    compatibility_bridge_candidates: metrics.compatibility_bridge_candidates,
    unsupported_generated_expressions: metrics.unsupported_generated_expressions,
    allowed_compatibility_bridges: metrics.allowed_compatibility_bridges,
    ordinary_column_trigger_bridges: metrics.ordinary_column_trigger_bridges,
    findings,
    warnings,
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
