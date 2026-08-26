import fs from "node:fs";
import path from "node:path";
import { compareMigrationFiles } from "./scripts/migration-order.mjs";
import { splitStatements } from "./scripts/staging-sql-parser.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const TEXT = (value) => String(value ?? "").trim();
const IDENTIFIER = (value) => TEXT(value).replaceAll("`", "").split(".").at(-1).toLowerCase();
const SQL_IDENTIFIER = /`([^`]+)`|([A-Za-z0-9_$.-]+)/u;

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
    else if (current === delimiter && depth === 0) {
      parts.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(source.slice(start).trim());
  return parts.filter(Boolean);
}

function tableFromCreate(statement) {
  const match = statement.match(/^\s*CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(`([^`]+)`|([A-Za-z0-9_$.-]+))/iu);
  if (!match) return null;
  return { table: IDENTIFIER(match[3] || match[4]), ifNotExists: Boolean(match[1]), match };
}

function tableFromAlter(statement) {
  const match = statement.match(/^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(`([^`]+)`|([A-Za-z0-9_$.-]+))/iu);
  return match ? { table: IDENTIFIER(match[2] || match[3]), match } : null;
}

function identifierFromToken(token) {
  const match = TEXT(token).match(/^\s*(`([^`]+)`|([A-Za-z0-9_$.-]+))/u);
  return match ? IDENTIFIER(match[2] || match[3]) : null;
}

function parseColumn(item) {
  const source = TEXT(item);
  if (/^(?:CONSTRAINT|PRIMARY|UNIQUE|KEY|INDEX|FULLTEXT|SPATIAL|FOREIGN|CHECK)\b/iu.test(source)) return null;
  const match = source.match(/^\s*(`([^`]+)`|([A-Za-z0-9_$.-]+))\s+([A-Za-z]+)(?:\s*\(\s*(\d+)(?:\s*,\s*\d+)?\s*\))?/u);
  if (!match) return null;
  const type = match[4].toUpperCase();
  const length = match[5] ? Number(match[5]) : null;
  const charset = source.match(/\bCHARACTER\s+SET\s+([A-Za-z0-9_]+)/iu)?.[1]?.toLowerCase() || null;
  return { column: IDENTIFIER(match[2] || match[3]), type, length, charset };
}

function parseIndexParts(source) {
  const inner = TEXT(source);
  if (!inner.startsWith("(") || findMatchingParen(inner, 0) < 0) return { parts: [], parse_error: "index column list is missing parentheses" };
  const close = findMatchingParen(inner, 0);
  const parts = splitTopLevel(inner.slice(1, close)).map((part) => {
    const match = TEXT(part).match(/^\s*(`([^`]+)`|([A-Za-z0-9_$.-]+))(?:\s*\(\s*(\d+)\s*\))?(?:\s+(?:ASC|DESC))?\s*$/iu);
    if (!match) return { raw: TEXT(part), column: null, prefix_length: null, parse_error: "index expression or column syntax is unsupported" };
    return { raw: TEXT(part), column: IDENTIFIER(match[2] || match[3]), prefix_length: match[4] ? Number(match[4]) : null };
  });
  return { parts, parse_error: null };
}

function parseIndex(item) {
  const source = TEXT(item);
  let match = source.match(/^\s*PRIMARY\s+KEY\s*(?:USING\s+[A-Z]+\s*)?(\()/iu);
  if (match) return { name: "primary", kind: "PRIMARY", partsSource: source.slice(match.index + match[0].length - 1) };
  match = source.match(/^\s*UNIQUE\s+(?:KEY|INDEX)\s*(?:(?:`([^`]+)`|([A-Za-z0-9_$.-]+))\s*)?(?:USING\s+[A-Z]+\s*)?(\()/iu);
  if (match) return { name: IDENTIFIER(match[1] || match[2] || "unique"), kind: "UNIQUE", partsSource: source.slice(match.index + match[0].length - 1) };
  match = source.match(/^\s*(?:KEY|INDEX)\s*(?:(?:`([^`]+)`|([A-Za-z0-9_$.-]+))\s*)?(?:USING\s+[A-Z]+\s*)?(\()/iu);
  if (match) return { name: IDENTIFIER(match[1] || match[2] || "index"), kind: "INDEX", partsSource: source.slice(match.index + match[0].length - 1) };
  return null;
}

function charsetFromStatement(statement, fallback) {
  const match = String(statement).match(/(?:DEFAULT\s+)?(?:CHARSET|CHARACTER\s+SET)\s*(?:=\s*)?([A-Za-z0-9_]+)/iu);
  return (match?.[1] || fallback || "utf8mb4").toLowerCase();
}

function parseCreate(statement, sourceFile, statementIndex) {
  const info = tableFromCreate(statement);
  if (!info) return null;
  const remainder = statement.slice(info.match[0].length).trim();
  if (/^(?:AS\s+SELECT|LIKE)\b/iu.test(remainder)) return null;
  const open = statement.indexOf("(", info.match[0].length);
  const close = open >= 0 ? findMatchingParen(statement, open) : -1;
  if (open < 0 || close < 0) return { table: info.table, ifNotExists: info.ifNotExists, columns: [], indexes: [], parse_error: "CREATE TABLE body parentheses are unbalanced" };
  const body = splitTopLevel(statement.slice(open + 1, close));
  const columns = new Map();
  const indexes = [];
  for (const item of body) {
    const column = parseColumn(item);
    if (column) columns.set(column.column, { ...column, source_file: sourceFile, statement_index: statementIndex });
    const index = parseIndex(item);
    if (index) {
      const parsed = parseIndexParts(index.partsSource);
      indexes.push({ ...index, ...parsed, source_file: sourceFile, statement_index: statementIndex });
    }
  }
  return { table: info.table, ifNotExists: info.ifNotExists, columns, indexes, charset: charsetFromStatement(statement, "utf8mb4"), source_file: sourceFile, statement_index: statementIndex };
}

function parseIndexAlterSegment(segment, sourceFile, statementIndex) {
  const source = TEXT(segment).replace(/^ADD\s+(?:CONSTRAINT\s+[^\s]+\s+)?/iu, "");
  const index = parseIndex(source);
  return index ? { ...index, ...parseIndexParts(index.partsSource), source_file: sourceFile, statement_index: statementIndex } : null;
}

function byteWidthForColumn(column, tableCharset, policy) {
  if (!column) return { bytes: null, reason: "missing_column" };
  const type = column.type.toUpperCase();
  const charset = column.charset || tableCharset;
  const bytesPerChar = Number(policy.charset_max_bytes_per_char?.[charset] ?? 0);
  if (["VARCHAR", "CHAR", "NCHAR", "NVARCHAR"].includes(type)) {
    if (!Number.isInteger(column.length)) return { bytes: null, reason: "unbounded_character_column" };
    if (!bytesPerChar) return { bytes: null, reason: `unknown_charset:${charset}` };
    return { bytes: column.length * bytesPerChar, unit_length: column.length, bytes_per_unit: bytesPerChar };
  }
  if (["VARBINARY", "BINARY"].includes(type)) {
    if (!Number.isInteger(column.length)) return { bytes: null, reason: "unbounded_binary_column" };
    return { bytes: column.length, unit_length: column.length, bytes_per_unit: 1 };
  }
  if (["TINYTEXT", "TEXT", "MEDIUMTEXT", "LONGTEXT", "CLOB", "BLOB", "TINYBLOB", "MEDIUMBLOB", "LONGBLOB"].includes(type)) {
    return { bytes: null, reason: "unbounded_text_or_blob_column" };
  }
  const fixedBytes = policy.fixed_type_bytes?.[type];
  if (Number.isInteger(fixedBytes)) return { bytes: fixedBytes, unit_length: 1, bytes_per_unit: fixedBytes };
  if (["ENUM", "SET"].includes(type)) return { bytes: 2, unit_length: 1, bytes_per_unit: 2 };
  return { bytes: null, reason: `unknown_column_type:${type}` };
}

function inspectTableIndexes(tableState, policy, findings, metrics) {
  if (!tableState) return;
  const maxKeyBytes = Number(policy.index_key_width_chain_contract?.max_key_bytes);
  for (const index of tableState.indexes) {
    metrics.indexes_checked += 1;
    let totalBytes = 0;
    let unresolved = null;
    const columns = [];
    for (const part of index.parts) {
      metrics.index_columns_checked += 1;
      const column = tableState.columns.get(part.column);
      if (!column) {
        unresolved = { reason: "missing_index_column", part };
        break;
      }
      const width = byteWidthForColumn(column, tableState.charset, policy);
      if (width.bytes === null) {
        if (part.prefix_length !== null && Number.isInteger(part.prefix_length)) {
          const bytesPerChar = Number(policy.charset_max_bytes_per_char?.[column.charset || tableState.charset] ?? 0);
          const isCharacterType = ["VARCHAR", "CHAR", "NCHAR", "NVARCHAR", "TINYTEXT", "TEXT", "MEDIUMTEXT", "LONGTEXT", "CLOB"].includes(column.type.toUpperCase());
          if (isCharacterType && bytesPerChar > 0) {
            totalBytes += part.prefix_length * bytesPerChar;
            columns.push({ column: part.column, prefix_length: part.prefix_length, estimated_bytes: part.prefix_length * bytesPerChar });
            continue;
          }
        }
        unresolved = { reason: width.reason, part, column: { type: column.type, length: column.length }, charset: tableState.charset };
        break;
      }
      const unitLength = part.prefix_length === null ? width.unit_length : part.prefix_length;
      const bytes = part.prefix_length === null ? width.bytes : part.prefix_length * Number(width.bytes_per_unit || 1);
      totalBytes += bytes;
      columns.push({ column: part.column, declared_length: width.unit_length, prefix_length: part.prefix_length, estimated_bytes: bytes, type: column.type });
      if (part.prefix_length !== null && part.prefix_length > Number(width.unit_length || 0)) unresolved = { reason: "index_prefix_exceeds_column_length", part, column: part.column };
      void unitLength;
    }
    if (unresolved) {
      findings.push({ code: "unresolved_index_key_width", table: tableState.table, index: index.name, kind: index.kind, file: index.source_file, statement_index: index.statement_index, detail: unresolved, statement: tableState.last_statement || "" });
      continue;
    }
    if (totalBytes > maxKeyBytes) {
      findings.push({ code: "index_key_bytes_exceed_limit", table: tableState.table, index: index.name, kind: index.kind, file: index.source_file, statement_index: index.statement_index, max_key_bytes: maxKeyBytes, estimated_key_bytes: totalBytes, charset: tableState.charset, columns, statement: tableState.last_statement || "" });
    }
  }
}

function mutateAlter(tableState, statement, sourceFile, statementIndex) {
  const info = tableFromAlter(statement);
  if (!info) return null;
  const table = tableState || { table: info.table, columns: new Map(), indexes: [], charset: "utf8mb4" };
  table.table = info.table;
  table.charset = charsetFromStatement(statement, table.charset);
  const body = statement.slice(info.match[0].length).trim();
  for (const segment of splitTopLevel(body)) {
    const text = TEXT(segment);
    const addIndex = parseIndexAlterSegment(text, sourceFile, statementIndex);
    if (addIndex) { table.indexes.push(addIndex); continue; }
    const dropIndex = text.match(/^DROP\s+(?:INDEX|KEY)\s+(?:`([^`]+)`|([A-Za-z0-9_$.-]+))/iu);
    if (dropIndex) { const name = IDENTIFIER(dropIndex[1] || dropIndex[2]); table.indexes = table.indexes.filter((index) => index.name !== name); continue; }
    if (/^DROP\s+PRIMARY\s+KEY/iu.test(text)) { table.indexes = table.indexes.filter((index) => index.kind !== "PRIMARY"); continue; }
    const dropColumn = text.match(/^DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?(?:`([^`]+)`|([A-Za-z0-9_$.-]+))/iu);
    if (dropColumn) { table.columns.delete(IDENTIFIER(dropColumn[1] || dropColumn[2])); continue; }
    const change = text.match(/^(?:CHANGE\s+(?:COLUMN\s+)?(?:`([^`]+)`|([A-Za-z0-9_$.-]+))\s+)?(?:MODIFY\s+(?:COLUMN\s+)?|ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?)([\s\S]*)$/iu);
    if (change) {
      const definition = change[3] || "";
      const parsed = parseColumn(definition);
      if (parsed) {
        if (change[1] || change[2]) table.columns.delete(IDENTIFIER(change[1] || change[2]));
        table.columns.set(parsed.column, { ...parsed, source_file: sourceFile, statement_index: statementIndex });
      }
    }
    if (/^(?:CONVERT\s+TO\s+CHARACTER\s+SET|DEFAULT\s+(?:CHARSET|CHARACTER\s+SET))/iu.test(text)) table.charset = charsetFromStatement(text, table.charset);
  }
  table.last_statement = statement;
  return table;
}

function blocked(reason, message, details = {}) {
  return {
    contract: "mad4b.mariadb-index-key-width-ordered-chain.v1",
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

export function inspectOrderedMigrationChainIndexKeyWidths({ files = [], baselineFile = "http-generic-api/schema.sql", engine = "mariadb", policy = {}, readFile = (file) => fs.readFileSync(path.resolve(REPO_ROOT, file), "utf8") } = {}) {
  const contract = policy.index_key_width_chain_contract || {};
  const requiredSafe = contract.enabled === true && contract.static_only === true && contract.database_connection_allowed === false && contract.sql_mutation_allowed === false && contract.provider_access_allowed === false && contract.credential_access_allowed === false && contract.data_export_allowed === false && contract.runtime_mutation_allowed === false && contract.secrets_included === false;
  if (engine !== "mariadb") return blocked("unsupported_engine", "Ordered index-key-width inspection is currently defined for MariaDB staging only.", { engine });
  if (!requiredSafe || contract.fail_on_index_key_overflow !== true || contract.inspect_create_alter_index_definitions !== true || contract.inspect_character_set_byte_widths !== true || Number(contract.max_key_bytes) !== 3072) return blocked("index_key_width_contract_invalid", "The ordered MariaDB index-key-width contract must explicitly enable static-only fail-closed 3072-byte evaluation.", { engine, policy_key: contract.policy_key || null });
  const migrations = files.filter((file) => /^http-generic-api\/migrations\/.*\.sql$/u.test(String(file).replaceAll("\\", "/"))).slice().sort((left, right) => compareMigrationFiles(path.basename(String(left)), path.basename(String(right))));
  const sequence = [baselineFile, ...migrations];
  const tables = new Map();
  const findings = [];
  const warnings = [];
  const metrics = { files_checked: sequence.length, migration_files_checked: migrations.length, statements_checked: 0, tables_projected: 0, indexes_checked: 0, index_columns_checked: 0, max_key_bytes: Number(contract.max_key_bytes) };
  for (const file of sequence) {
    let sql;
    try { sql = readFile(file); } catch (error) { return blocked("source_unreadable", `Unable to read ${file}: ${error.message}`, metrics); }
    for (const [statementIndex, original] of splitStatements(sql).entries()) {
      const statement = stripSqlComments(original).trim();
      if (!statement) continue;
      metrics.statements_checked += 1;
      const created = parseCreate(statement, file, statementIndex);
      if (created) {
        if (created.parse_error) {
          findings.push({ code: "create_table_parse_error", file, statement_index: statementIndex, table: created.table, detail: created.parse_error, statement });
          continue;
        }
        if (created.ifNotExists && tables.has(created.table)) continue;
        const table = { table: created.table, columns: created.columns, indexes: created.indexes, charset: created.charset, last_statement: statement };
        tables.set(created.table, table);
        metrics.tables_projected += 1;
        inspectTableIndexes(table, policy, findings, metrics);
        continue;
      }
      const altered = tableFromAlter(statement);
      if (altered) {
        const table = mutateAlter(tables.get(altered.table), statement, file, statementIndex);
        tables.set(altered.table, table);
        if (!tables.has(altered.table)) metrics.tables_projected += 1;
        inspectTableIndexes(table, policy, findings, metrics);
        continue;
      }
      const createdIndex = statement.match(/^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:`([^`]+)`|([A-Za-z0-9_$.-]+))\s+ON\s+(?:`([^`]+)`|([A-Za-z0-9_$.-]+))\s*(\()/iu);
      if (createdIndex) {
        const tableName = IDENTIFIER(createdIndex[3] || createdIndex[4]);
        const table = tables.get(tableName) || { table: tableName, columns: new Map(), indexes: [], charset: "utf8mb4" };
        const parsed = parseIndexParts(statement.slice(createdIndex.index + createdIndex[0].length - 1));
        table.indexes.push({ name: IDENTIFIER(createdIndex[1] || createdIndex[2]), kind: /^CREATE\s+UNIQUE/iu.test(statement) ? "UNIQUE" : "INDEX", ...parsed, source_file: file, statement_index: statementIndex });
        table.last_statement = statement;
        tables.set(tableName, table);
        inspectTableIndexes(table, policy, findings, metrics);
      }
    }
  }
  return {
    contract: "mad4b.mariadb-index-key-width-ordered-chain.v1",
    engine,
    policy_key: contract.policy_key || null,
    baseline_file: baselineFile,
    files_checked: metrics.files_checked,
    migration_files_checked: metrics.migration_files_checked,
    statements_checked: metrics.statements_checked,
    tables_projected: metrics.tables_projected,
    indexes_checked: metrics.indexes_checked,
    index_columns_checked: metrics.index_columns_checked,
    max_key_bytes: metrics.max_key_bytes,
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

export function loadIndexKeyWidthPolicyContract(policyPath) {
  return JSON.parse(fs.readFileSync(policyPath, "utf8")).index_key_width_chain_contract || null;
}
