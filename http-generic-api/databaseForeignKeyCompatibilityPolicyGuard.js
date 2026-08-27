import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { splitStatements } from "./scripts/staging-sql-parser.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const TEXT = (value) => String(value ?? "").trim();
const IDENTIFIER = (value) => TEXT(value).replaceAll("`", "").replaceAll('"', "").split(".").at(-1).toLowerCase();
const RELATIVE = (value) => TEXT(value).replaceAll("\\", "/").replace(/^\.\//u, "");
const escapeRegExp = (value) => String(value ?? "").replace(/[.*+?^${}()|[\[\]\\]/gu, "\\$&");

function stripComments(value) {
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

function splitTopLevel(source) {
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
    else if (current === ")") depth = Math.max(0, depth - 1);
    else if (current === "," && depth === 0) { parts.push(source.slice(start, index).trim()); start = index + 1; }
  }
  parts.push(source.slice(start).trim());
  return parts.filter(Boolean);
}

function parenthesized(text, offset) {
  let index = offset;
  while (/\s/u.test(text[index] ?? "")) index += 1;
  if (text[index] !== "(") return null;
  const close = findMatchingParen(text, index);
  return close > index ? { content: text.slice(index + 1, close), end: close + 1 } : null;
}

function tableCreate(statement) {
  const match = statement.match(/^\s*CREATE\s+(?:TEMPORARY\s+)?TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(?:`([^`]+)`|([A-Za-z0-9_$.-]+))/iu);
  return match ? { table: IDENTIFIER(match[2] || match[3]), ifNotExists: Boolean(match[1]), match } : null;
}

function alterTable(statement) {
  const match = statement.match(/^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:`([^`]+)`|([A-Za-z0-9_$.-]+))/iu);
  return match ? { table: IDENTIFIER(match[1] || match[2]), match } : null;
}

function columnName(item) {
  const match = String(item ?? "").match(/^\s*(?:`([^`]+)`|([A-Za-z_][A-Za-z0-9_$]*))\s+/u);
  return match ? IDENTIFIER(match[1] || match[2]) : null;
}

function sqlType(item, tableDefaults = {}) {
  const source = TEXT(item).replace(/\/\*[\s\S]*?\*\//gu, " ");
  const match = source.match(/^\s*(?:`[^`]+`|[A-Za-z_][A-Za-z0-9_$]*)\s+(.+)$/u);
  if (!match) return null;
  const rest = match[1].trim();
  const typeMatch = rest.match(/^([A-Za-z_][A-Za-z0-9_$]*(?:\s*\([^)]*\))?(?:\s+UNSIGNED)?(?:\s+ZEROFILL)?)/iu);
  if (!typeMatch) return null;
  const base = typeMatch[1].replace(/\s+/gu, " ").trim().toLowerCase();
  const charset = rest.match(/\bCHARACTER\s+SET\s+([A-Za-z0-9_]+)/iu)?.[1]?.toLowerCase() || tableDefaults.charset || null;
  const collation = rest.match(/\bCOLLATE\s+([A-Za-z0-9_]+)/iu)?.[1]?.toLowerCase() || tableDefaults.collation || null;
  return { base, charset, collation, signature: `${base}|charset=${charset || ""}|collation=${collation || ""}` };
}

function tableDefaults(statement) {
  const charset = statement.match(/\b(?:DEFAULT\s+)?CHARSET\s*=\s*([A-Za-z0-9_]+)/iu)?.[1]?.toLowerCase() || null;
  const explicitCollation = statement.match(/\bCOLLATE\s*=\s*([A-Za-z0-9_]+)/iu)?.[1]?.toLowerCase() || null;
  // MariaDB 11.4 uses the compiled-in utf8mb4_general_ci default when a table
  // names DEFAULT CHARSET=utf8mb4 without an explicit COLLATE clause.
  const collation = explicitCollation || (charset === "utf8mb4" ? "utf8mb4_general_ci" : null);
  return { charset, collation };
}

function indexColumns(value) {
  return splitTopLevel(value).map((item) => item.trim().replace(/\s+(?:ASC|DESC)\s*$/iu, "").replace(/\s*\(\s*\d+\s*\)\s*$/u, "").trim()).map((item) => {
    const match = item.match(/^(?:`([^`]+)`|([A-Za-z_][A-Za-z0-9_$]*))$/u);
    return match ? IDENTIFIER(match[1] || match[2]) : null;
  }).filter(Boolean);
}

function indexDefinition(item) {
  const source = TEXT(item);
  let kind = null;
  if (/^PRIMARY\s+KEY\b/iu.test(source)) kind = "primary";
  else if (/^UNIQUE(?:\s+KEY|\s+INDEX)?\b/iu.test(source)) kind = "unique";
  else if (/^(?:KEY|INDEX)\b/iu.test(source)) kind = "index";
  if (!kind) return null;
  const open = source.indexOf("(");
  const body = open >= 0 ? parenthesized(source, open) : null;
  if (!body) return null;
  return { kind, columns: indexColumns(body.content) };
}

function foreignKeyDefinition(item) {
  const match = TEXT(item).match(/\bFOREIGN\s+KEY(?:\s+(?:`[^`]+`|[A-Za-z0-9_$]+))?\s*\(([^)]*)\)\s*REFERENCES\s+(?:`([^`]+)`|([A-Za-z0-9_$.-]+))\s*\(([^)]*)\)/iu);
  if (!match) return null;
  const columns = indexColumns(match[1]);
  const parentColumns = indexColumns(match[4]);
  const parent = IDENTIFIER(match[2] || match[3]);
  if (!parent || !columns.length || columns.length !== parentColumns.length) return null;
  return { columns, parent, parentColumns };
}

function emptyTable(table, file) {
  return { table, source_file: file, columns: new Map(), indexes: [], foreign_keys: [] };
}

function createTableDefinition(statement, file, includeForeignKeys = true) {
  const create = tableCreate(statement);
  if (!create) return null;
  const clean = stripComments(statement);
  const open = clean.indexOf("(", create.match[0].length);
  const close = open >= 0 ? findMatchingParen(clean, open) : -1;
  if (open < 0 || close < 0) return null;
  const defaults = tableDefaults(clean.slice(close + 1));
  const table = emptyTable(create.table, file);
  table.defaults = defaults;
  for (const item of splitTopLevel(clean.slice(open + 1, close))) {
    const column = columnName(item);
    if (column && !/^(?:CONSTRAINT|PRIMARY|UNIQUE|KEY|INDEX|FOREIGN|CHECK|FULLTEXT|SPATIAL|PARTITION|PERIOD)\b/iu.test(item)) {
      table.columns.set(column, sqlType(item, defaults));
      if (/\bPRIMARY\s+KEY\b/iu.test(item)) table.indexes.push({ kind: "primary", columns: [column] });
      else if (/\bUNIQUE(?:\s+KEY|\s+INDEX)?\b/iu.test(item)) table.indexes.push({ kind: "unique", columns: [column] });
      continue;
    }
    const index = indexDefinition(item);
    if (index) table.indexes.push(index);
    if (includeForeignKeys) {
      const foreignKey = foreignKeyDefinition(item);
      if (foreignKey) table.foreign_keys.push(foreignKey);
    }
  }
  return table;
}

function cloneTable(source, table, file) {
  return {
    table,
    source_file: file,
    defaults: { ...(source?.defaults || {}) },
    columns: new Map(source ? [...source.columns.entries()].map(([key, value]) => [key, value && { ...value }]) : []),
    indexes: source ? source.indexes.map((index) => ({ ...index, columns: [...index.columns] })) : [],
    foreign_keys: source ? source.foreign_keys.map((fk) => ({ ...fk, columns: [...fk.columns], parentColumns: [...fk.parentColumns] })) : [],
  };
}

function prefixIndex(table, columns) {
  return table?.indexes.some((index) => columns.every((column, offset) => index.columns[offset] === column)) || false;
}

function parseBridgeRules(policy) {
  const contract = policy?.foreign_key_compatibility_chain_contract || {};
  const bridges = Array.isArray(contract.bridges) ? contract.bridges : [];
  return bridges.map((bridge) => ({
    ...bridge,
    table: IDENTIFIER(bridge.table),
    bridge_file: RELATIVE(bridge.bridge_file),
    source_file: RELATIVE(bridge.source_file),
    columns: Array.isArray(bridge.columns) ? bridge.columns.map((item) => ({
      ...item,
      column: IDENTIFIER(item.column),
      parent_table: IDENTIFIER(item.parent_table),
      parent_column: IDENTIFIER(item.parent_column),
      source_type: TEXT(item.source_type).toLowerCase(),
      replacement_type: TEXT(item.replacement_type).toLowerCase(),
    })) : [],
  }));
}

function bridgeEdgeKey(table, fk) {
  return `${table}.${fk.columns.join(",")}->${fk.parent}.${fk.parentColumns.join(",")}`;
}

function expectedBridgeEdges(rule) {
  return rule.columns.map((item) => `${rule.table}.${item.column}->${item.parent_table}.${item.parent_column}`);
}

function sourceCreateForTable(sql, table) {
  return splitStatements(sql).map((statement) => createTableDefinition(statement, "source", true)).find((definition) => definition?.table === table) || null;
}

function validateBridge(rule, files, readFile, findings) {
  const bridgePath = rule.bridge_file.startsWith("http-generic-api/") ? rule.bridge_file : `http-generic-api/migrations/${path.basename(rule.bridge_file)}`;
  const sourcePath = rule.source_file.startsWith("http-generic-api/") ? rule.source_file : `http-generic-api/migrations/${path.basename(rule.source_file)}`;
  const bridgeIndex = files.indexOf(bridgePath);
  const sourceIndex = files.indexOf(sourcePath);
  const baselineAlter = rule.bridge_mode === "baseline_alter_column_shape";
  if (bridgeIndex < 0 || (!baselineAlter && (sourceIndex < 0 || bridgeIndex >= sourceIndex))) {
    findings.push({ code: "bridge_order", table: rule.table, bridge_file: rule.bridge_file, source_file: rule.source_file, detail: baselineAlter ? "baseline ALTER bridge must be in the ordered migration chain" : "declared FK bridge must precede its historical source migration" });
    return false;
  }
  const bridgeSql = readFile(bridgePath);
  const sourceSql = readFile(sourcePath);
  const sourceDefinition = sourceCreateForTable(sourceSql, rule.table);
  if (!sourceDefinition) {
    findings.push({ code: "bridge_definition", table: rule.table, bridge_file: rule.bridge_file, source_file: rule.source_file, detail: "historical source must contain the target CREATE TABLE" });
    return false;
  }
  const sourceFks = sourceDefinition.foreign_keys.map((fk) => bridgeEdgeKey(rule.table, fk));
  const expectedEdges = expectedBridgeEdges(rule);
  if (expectedEdges.some((edge) => !sourceFks.includes(edge))) {
    findings.push({ code: "bridge_edges", table: rule.table, bridge_file: rule.bridge_file, source_file: rule.source_file, detail: "declared bridge edges must match historical FK edges exactly" });
    return false;
  }
  if (baselineAlter) {
    const bridgeStatements = splitStatements(bridgeSql).map((statement) => stripComments(statement).trim());
    for (const item of rule.columns) {
      const sourceType = sourceDefinition.columns.get(item.column)?.base || "";
      const expectedAlter = new RegExp(`^\\s*ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?\`?${escapeRegExp(rule.table)}\`?\\s+MODIFY\\s+(?:COLUMN\\s+)?\`?${escapeRegExp(item.column)}\`?\\s+${escapeRegExp(item.replacement_type).replaceAll("\\\\ ", "\\\\s*")}\\s+CHARACTER\\s+SET\\s+${escapeRegExp(item.replacement_charset)}\\s+COLLATE\\s+${escapeRegExp(item.replacement_collation)}\\s+NOT\\s+NULL\\s*$`, "iu");
      if (sourceType !== item.source_type || !bridgeStatements.some((statement) => expectedAlter.test(statement))) {
        findings.push({ code: "bridge_shape", table: rule.table, column: item.column, bridge_file: rule.bridge_file, source_file: rule.source_file, expected_source_type: item.source_type, observed_source_type: sourceType, expected_replacement_type: item.replacement_type, expected_replacement_charset: item.replacement_charset, expected_replacement_collation: item.replacement_collation, detail: "baseline ALTER bridge does not match the exact source type and replacement collation contract" });
        return false;
      }
    }
    return true;
  }
  const bridgeDefinition = sourceCreateForTable(bridgeSql, rule.table);
  if (!bridgeDefinition) {
    findings.push({ code: "bridge_definition", table: rule.table, bridge_file: rule.bridge_file, source_file: rule.source_file, detail: "declared FK precreate bridge must contain the target CREATE TABLE" });
    return false;
  }
  if (!/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/iu.test(stripComments(bridgeSql))) {
    findings.push({ code: "bridge_idempotence", table: rule.table, bridge_file: rule.bridge_file, detail: "FK compatibility bridge must use CREATE TABLE IF NOT EXISTS" });
    return false;
  }
  const bridgeFks = bridgeDefinition.foreign_keys.map((fk) => bridgeEdgeKey(rule.table, fk));
  if (expectedEdges.some((edge) => !bridgeFks.includes(edge))) {
    findings.push({ code: "bridge_edges", table: rule.table, bridge_file: rule.bridge_file, source_file: rule.source_file, detail: "declared bridge edges must match historical FK edges exactly" });
    return false;
  }
  for (const item of rule.columns) {
    const sourceColumn = sourceDefinition.columns.get(item.column);
    const replacementColumn = bridgeDefinition.columns.get(item.column);
    if (!sourceColumn || !replacementColumn || sourceColumn.base !== item.source_type || replacementColumn.base !== item.replacement_type || (item.replacement_charset && replacementColumn.charset !== item.replacement_charset.toLowerCase()) || (item.replacement_collation && replacementColumn.collation !== item.replacement_collation.toLowerCase())) {
      findings.push({ code: "bridge_shape", table: rule.table, column: item.column, bridge_file: rule.bridge_file, source_file: rule.source_file, expected_source_type: item.source_type, observed_source_type: sourceColumn?.base || "", expected_replacement_type: item.replacement_type, observed_replacement_type: replacementColumn?.base || "", expected_replacement_charset: item.replacement_charset || null, observed_replacement_charset: replacementColumn?.charset || null, expected_replacement_collation: item.replacement_collation || null, observed_replacement_collation: replacementColumn?.collation || null, detail: "declared bridge type/charset/collation contract does not match source or additive replacement" });
      return false;
    }
  }
  return true;
}

export function inspectOrderedMigrationChainForeignKeys({ files, baselineFile = "http-generic-api/schema.sql", engine = "mariadb", policy = {}, readFile = (file) => fs.readFileSync(path.join(REPO_ROOT, file), "utf8") }) {
  const orderedFiles = files.map(RELATIVE);
  const contract = policy.foreign_key_compatibility_chain_contract || {};
  const tables = new Map();
  const findings = [];
  const warnings = [];
  const deferredBaseline = [];
  let statementsChecked = 0;
  let foreignKeysChecked = 0;
  let typeComparisons = 0;
  let typeMismatches = 0;
  let missingParentTables = 0;
  let missingParentColumns = 0;
  let missingParentIndexes = 0;

  const addFinding = (finding) => findings.push(finding);
  const applyForeignKey = (tableName, fk, file, statementIndex, statement) => {
    foreignKeysChecked += 1;
    const child = tables.get(tableName);
    const parent = tables.get(fk.parent);
    if (!child) {
      addFinding({ code: "missing_child_table", table: tableName, file, statement_index: statementIndex, detail: "foreign-key child table is absent before reference", statement: TEXT(statement).slice(0, 1600) });
      return;
    }
    if (!parent) {
      missingParentTables += 1;
      addFinding({ code: "missing_parent_table", table: tableName, columns: fk.columns, parent: fk.parent, parent_columns: fk.parentColumns, file, statement_index: statementIndex, detail: "foreign-key parent table is absent before reference", statement: TEXT(statement).slice(0, 1600) });
      return;
    }
    if (!prefixIndex(parent, fk.parentColumns)) {
      missingParentIndexes += 1;
      addFinding({ code: "missing_parent_index", table: tableName, columns: fk.columns, parent: fk.parent, parent_columns: fk.parentColumns, file, statement_index: statementIndex, detail: "foreign-key parent columns are not covered by a parent index", statement: TEXT(statement).slice(0, 1600) });
    }
    for (let index = 0; index < fk.columns.length; index += 1) {
      const childColumn = child.columns.get(fk.columns[index]);
      const parentColumn = parent.columns.get(fk.parentColumns[index]);
      if (!childColumn || !parentColumn) {
        missingParentColumns += !parentColumn ? 1 : 0;
        addFinding({ code: !childColumn ? "missing_child_column" : "missing_parent_column", table: tableName, column: fk.columns[index], parent: fk.parent, parent_column: fk.parentColumns[index], file, statement_index: statementIndex, detail: !childColumn ? "foreign-key child column is absent before reference" : "foreign-key parent column is absent before reference", statement: TEXT(statement).slice(0, 1600) });
        continue;
      }
      typeComparisons += 1;
      if (childColumn.signature !== parentColumn.signature) {
        typeMismatches += 1;
        addFinding({ code: "foreign_key_column_shape_mismatch", table: tableName, column: fk.columns[index], parent: fk.parent, parent_column: fk.parentColumns[index], child_signature: childColumn.signature, parent_signature: parentColumn.signature, file, statement_index: statementIndex, detail: "foreign-key child and parent column definitions must match exactly for MariaDB InnoDB", statement: TEXT(statement).slice(0, 1600) });
      }
    }
  };

  const applyStatement = (statement, file, statementIndex, includeForeignKeys = true) => {
    const clean = stripComments(statement).trim();
    if (!clean) return;
    const create = tableCreate(clean);
    if (create) {
      if (/\s+LIKE\s+/iu.test(clean)) {
        const like = clean.match(/\s+LIKE\s+(?:`([^`]+)`|([A-Za-z0-9_$.-]+))/iu);
        const source = like ? tables.get(IDENTIFIER(like[1] || like[2])) : null;
        if (!source) addFinding({ code: "missing_parent_table", table: create.table, parent: like ? IDENTIFIER(like[1] || like[2]) : null, file, statement_index: statementIndex, detail: "CREATE TABLE LIKE source is absent before operation", statement: TEXT(clean).slice(0, 1600) });
        if (!tables.has(create.table)) tables.set(create.table, cloneTable(source, create.table, file));
        return;
      }
      const definition = createTableDefinition(clean, file, includeForeignKeys);
      if (!definition) return;
      if (/\s+AS\s+SELECT\b/iu.test(clean)) {
        if (!tables.has(create.table)) tables.set(create.table, definition);
        return;
      }
      if (tables.has(create.table)) return;
      tables.set(create.table, definition);
      if (includeForeignKeys) for (const fk of definition.foreign_keys) applyForeignKey(create.table, fk, file, statementIndex, clean);
      return;
    }
    const alter = alterTable(clean);
    if (!alter) return;
    const table = tables.get(alter.table);
    if (!table) return;
    const body = clean.slice(alter.match[0].length).trim();
    for (const item of splitTopLevel(body)) {
      const add = item.match(/^ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(.+)$/iu);
      const modify = item.match(/^(?:MODIFY|CHANGE)\s+(?:COLUMN\s+)?(.+)$/iu);
      if (add) {
        const column = columnName(add[1]);
        if (column) table.columns.set(column, sqlType(add[1], table.defaults));
        const index = indexDefinition(add[1]);
        if (index) table.indexes.push(index);
        const fk = foreignKeyDefinition(add[1]);
        if (fk && includeForeignKeys) { table.foreign_keys.push(fk); applyForeignKey(alter.table, fk, file, statementIndex, clean); }
        continue;
      }
      if (modify) {
        const column = columnName(modify[1]);
        if (column) table.columns.set(column, sqlType(modify[1], table.defaults));
        continue;
      }
      const index = indexDefinition(item);
      if (index) table.indexes.push(index);
      const fk = foreignKeyDefinition(item);
      if (fk && includeForeignKeys) { table.foreign_keys.push(fk); applyForeignKey(alter.table, fk, file, statementIndex, clean); }
    }
  };

  const applySource = (sourceFile, isBaseline = false) => {
    const sql = readFile(sourceFile);
    const statements = splitStatements(sql);
    statementsChecked += statements.length;
    for (let statementIndex = 0; statementIndex < statements.length; statementIndex += 1) {
      const statement = statements[statementIndex];
      const hasForeignKey = /\bFOREIGN\s+KEY\b/iu.test(stripComments(statement));
      if (isBaseline && hasForeignKey) {
        const definition = tableCreateDefinitionForDeferred(statement, sourceFile);
        if (definition) {
          applyStatement(stripForeignKeys(statement), sourceFile, statementIndex, false);
          deferredBaseline.push({ statement, sourceFile, statementIndex });
        } else deferredBaseline.push({ statement, sourceFile, statementIndex });
      } else applyStatement(statement, sourceFile, statementIndex, true);
    }
  };

  const tableCreateDefinitionForDeferred = (statement, file) => createTableDefinition(statement, file, false);
  const stripForeignKeys = (statement) => {
    const clean = stripComments(statement);
    const create = tableCreate(clean);
    if (!create) return statement;
    const open = clean.indexOf("(", create.match[0].length);
    const close = open >= 0 ? findMatchingParen(clean, open) : -1;
    if (open < 0 || close < 0) return statement;
    const body = splitTopLevel(clean.slice(open + 1, close)).filter((item) => !/\bFOREIGN\s+KEY\b/iu.test(item));
    return `${clean.slice(0, open + 1)}${body.join(",\n")}${clean.slice(close)}`;
  };

  applySource(RELATIVE(baselineFile), true);
  for (const file of orderedFiles) applySource(file, false);
  for (const deferred of deferredBaseline) {
    const definition = createTableDefinition(deferred.statement, deferred.sourceFile, true);
    if (!definition) continue;
    for (const fk of definition.foreign_keys) applyForeignKey(definition.table, fk, deferred.sourceFile, deferred.statementIndex, deferred.statement);
  }

  const bridgeFindings = [];
  const bridgeRules = parseBridgeRules(policy);
  const bridgeValid = bridgeRules.filter((rule) => validateBridge(rule, orderedFiles, readFile, bridgeFindings));
  for (const finding of bridgeFindings) addFinding({ ...finding, category: "declared_fk_bridge" });
  const bridgeKeys = new Set(bridgeValid.flatMap((rule) => expectedBridgeEdges(rule)));
  const unresolvedMismatches = findings.filter((finding) => finding.code === "foreign_key_column_shape_mismatch" && !bridgeKeys.has(`${finding.table}.${finding.column}->${finding.parent}.${finding.parent_column}`));
  const effectiveFindings = findings.filter((finding) => finding.code !== "foreign_key_column_shape_mismatch" || !bridgeKeys.has(`${finding.table}.${finding.column}->${finding.parent}.${finding.parent_column}`));
  const allFindings = effectiveFindings;
  return {
    contract: "mad4b.mariadb.foreign-key-compatibility-ordered-chain.v1",
    engine,
    policy_key: contract.policy_key || "mariadb_foreign_key_compatibility_ordered_chain_v1",
    baseline_file: RELATIVE(baselineFile),
    files_checked: orderedFiles.length + 1,
    migration_files_checked: orderedFiles.length,
    statements_checked: statementsChecked,
    tables_projected: tables.size,
    foreign_keys_checked: foreignKeysChecked,
    type_comparisons: typeComparisons,
    type_mismatches: typeMismatches,
    unresolved_type_mismatches: unresolvedMismatches.length,
    missing_parent_tables: missingParentTables,
    missing_parent_columns: missingParentColumns,
    missing_parent_indexes: missingParentIndexes,
    compatibility_bridge_candidates: bridgeRules.length,
    allowed_compatibility_bridges: bridgeValid.length,
    findings: allFindings,
    warnings,
    ok: allFindings.length === 0,
    ready: allFindings.length === 0 && bridgeFindings.length === 0,
    database_connection_performed: false,
    sql_mutation_performed: false,
    provider_mutation_performed: false,
    credential_access_performed: false,
    data_export_performed: false,
    runtime_mutation_performed: false,
    secrets_included: false,
  };
}
