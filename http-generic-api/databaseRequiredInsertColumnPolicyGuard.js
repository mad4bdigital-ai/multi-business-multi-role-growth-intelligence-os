import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { splitStatements } from "./scripts/staging-sql-parser.mjs";
import { compareMigrationFiles } from "./scripts/migration-order.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const TEXT = (value) => String(value ?? "").trim();
const NORMALIZE = (value) => TEXT(value).replaceAll("`", "").replace(/\s+/gu, " ").trim().toLowerCase();
const IDENTIFIER = (value) => NORMALIZE(value).split(".").at(-1) || "";

function stripLeadingSqlComments(value) {
  let normalized = TEXT(value);
  let previous = null;
  while (normalized && normalized !== previous) {
    previous = normalized;
    normalized = normalized
      .replace(/^(?:--[^\r\n]*(?:\r?\n|$)|#[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/\s*)+/u, "")
      .trim();
  }
  return normalized;
}

function blocked(code, message, details = {}) {
  return {
    contract: "mad4b.mariadb-required-insert-column-ordered-chain.v1",
    ok: false,
    ready: false,
    applies_sql: false,
    blocked_reason: code,
    reason_code: code,
    message,
    ...details,
    database_connection_performed: false,
    sql_mutation_performed: false,
    provider_mutation_performed: false,
    credential_access_performed: false,
    data_export_performed: false,
    runtime_mutation_performed: false,
    secrets_included: false,
  };
}

function splitTopLevel(value) {
  const parts = [];
  let buffer = "";
  let depth = 0;
  let quote = null;
  for (let index = 0; index < String(value ?? "").length; index += 1) {
    const current = value[index];
    const next = value[index + 1] ?? "";
    if (quote) {
      buffer += current;
      if (current === "\\") { buffer += next; index += 1; }
      else if (current === quote) {
        if (next === quote) { buffer += next; index += 1; } else quote = null;
      }
      continue;
    }
    if (["'", '"', "`"].includes(current)) { quote = current; buffer += current; continue; }
    if (current === "(") depth += 1;
    if (current === ")") depth = Math.max(0, depth - 1);
    if (current === "," && depth === 0) { parts.push(buffer.trim()); buffer = ""; }
    else buffer += current;
  }
  if (buffer.trim()) parts.push(buffer.trim());
  return parts;
}

function parenthesized(text, offset) {
  let index = offset;
  while (/\s/u.test(text[index] ?? "")) index += 1;
  if (text[index] !== "(") return null;
  const start = index + 1;
  let depth = 1;
  let quote = null;
  for (index = start; index < text.length; index += 1) {
    const current = text[index];
    const next = text[index + 1] ?? "";
    if (quote) {
      if (current === "\\") index += 1;
      else if (current === quote) {
        if (next === quote) index += 1; else quote = null;
      }
      continue;
    }
    if (["'", '"', "`"].includes(current)) { quote = current; continue; }
    if (current === "(") depth += 1;
    else if (current === ")") {
      depth -= 1;
      if (depth === 0) return { content: text.slice(start, index), end: index + 1 };
    }
  }
  return null;
}

function columnSpec(name, definition) {
  const rest = TEXT(definition);
  const generated = /\bGENERATED\b|\bAS\s*\([^)]*\)\s*(?:STORED|VIRTUAL)/iu.test(rest);
  return {
    column: IDENTIFIER(name),
    has_default: !generated && /\bDEFAULT\b/iu.test(rest),
    required_without_default: !generated && /\bNOT\s+NULL\b/iu.test(rest) && !/\bDEFAULT\b/iu.test(rest) && !/\bAUTO_INCREMENT\b/iu.test(rest),
    generated,
    definition: rest,
  };
}

function createTableInfo(statement) {
  const match = statement.match(/^\s*CREATE\s+(?:TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:`([^`]+)`|([A-Za-z0-9_$]+))\s*/iu);
  if (!match) return null;
  const tail = statement.slice(match[0].length);
  const like = tail.match(/^\s*LIKE\s+(?:`([^`]+)`|([A-Za-z0-9_$]+))/iu);
  if (like) return { table: IDENTIFIER(match[1] || match[2]), like_source: IDENTIFIER(like[1] || like[2]) };
  if (/^\s*AS\s+SELECT\b/iu.test(tail)) return { table: IDENTIFIER(match[1] || match[2]), skip: true };
  const body = parenthesized(statement, match[0].length);
  if (!body) return { table: IDENTIFIER(match[1] || match[2]), parse_error: "CREATE TABLE body is not balanced" };
  const columns = new Map();
  for (const part of splitTopLevel(body.content)) {
    if (!part || /^(?:PRIMARY|UNIQUE|KEY|INDEX|CONSTRAINT|FOREIGN|CHECK|FULLTEXT|SPATIAL|PARTITION|PERIOD)\b/iu.test(part)) continue;
    const column = part.match(/^\s*(?:`([^`]+)`|([A-Za-z_][A-Za-z0-9_$]*))\s+([\s\S]*)$/u);
    if (!column) continue;
    const info = columnSpec(column[1] || column[2], column[3]);
    if (info.column) columns.set(info.column, info);
  }
  return {
    table: IDENTIFIER(match[1] || match[2]),
    columns,
    if_not_exists: /CREATE\s+(?:TEMPORARY\s+)?TABLE\s+IF\s+NOT\s+EXISTS/iu.test(statement),
  };
}

function alterClauses(statement) {
  const header = statement.match(/^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:`([^`]+)`|([A-Za-z0-9_$]+))/iu);
  if (!header) return null;
  const table = IDENTIFIER(header[1] || header[2]);
  const pattern = /\b(?:ADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?|MODIFY(?:\s+COLUMN)?|CHANGE(?:\s+COLUMN)?)\s+(?:`([^`]+)`|([A-Za-z_][A-Za-z0-9_$]*))(?:\s+(?:`([^`]+)`|([A-Za-z_][A-Za-z0-9_$]*)))?/giu;
  const matches = [...statement.matchAll(pattern)];
  const clauses = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const keyword = match[0].toUpperCase();
    const end = matches[index + 1]?.index ?? statement.length;
    const segment = statement.slice(match.index, end).replace(/,\s*(?:ALGORITHM|LOCK)\b[\s\S]*$/iu, "");
    const first = IDENTIFIER(match[1] || match[2]);
    const second = IDENTIFIER(match[3] || match[4]);
    const definitionStart = match[0].length;
    const definition = segment.slice(definitionStart).replace(/^\s*,\s*/u, "");
    if (keyword.startsWith("CHANGE")) clauses.push({ operation: "change", old_column: first, column: second, spec: columnSpec(second, definition) });
    else if (keyword.startsWith("MODIFY")) clauses.push({ operation: "modify", column: first, spec: columnSpec(first, definition) });
    else clauses.push({ operation: "add", column: first, spec: columnSpec(first, definition) });
  }
  for (const match of statement.matchAll(/\bDROP\s+COLUMN\s+(?:`([^`]+)`|([A-Za-z_][A-Za-z0-9_$]*))/giu)) clauses.push({ operation: "drop", column: IDENTIFIER(match[1] || match[2]) });
  return { table, clauses };
}

function insertInfo(statement) {
  const match = statement.match(/^\s*INSERT\s+(?:IGNORE\s+)?INTO\s+(?:(?:`[^`]+`|[A-Za-z0-9_$]+)\s*\.\s*)?(?:`([^`]+)`|([A-Za-z0-9_$]+))\s*/iu);
  if (!match) return null;
  const after = statement.slice(match[0].length);
  const block = parenthesized(after, 0);
  const columns = block ? splitTopLevel(block.content).map(IDENTIFIER).filter(Boolean) : [];
  return { table: IDENTIFIER(match[1] || match[2]), columns, has_columns: Boolean(block && columns.length), statement };
}

function decodeSqlLiteral(value) {
  const normalized = TEXT(value);
  if (/^'(?:''|[^'])*'$/u.test(normalized)) return normalized.slice(1, -1).replaceAll("''", "'");
  if (/^"(?:""|[^"])*"$/u.test(normalized)) return normalized.slice(1, -1).replaceAll('""', '"');
  return normalized;
}

function defaultLiteral(definition) {
  const match = TEXT(definition).match(/\bDEFAULT\s+((?:'(?:''|[^'])*')|(?:"(?:""|[^"])*")|[^\s,]+)/iu);
  return match ? decodeSqlLiteral(match[1]) : null;
}

function contractRules(contract) {
  return new Map((contract.required_tables || []).map((rule) => [IDENTIFIER(rule.table), {
    ...rule,
    table: IDENTIFIER(rule.table),
    columns: (rule.columns || rule.required_columns || []).map(IDENTIFIER).filter(Boolean),
  }]));
}

function bridgeFor(rule, file) {
  const bridge = rule.default_bridge;
  if (!bridge || !(bridge.writer_files || []).includes(path.basename(file))) return null;
  return bridge;
}

function normalizeFiles(files) {
  return files
    .map((file) => String(file).replaceAll("\\", "/"))
    .filter((file) => /(?:^|\/)migrations\/[^/]+\.sql$/iu.test(file))
    .sort((left, right) => compareMigrationFiles(path.basename(left), path.basename(right)));
}

export function inspectOrderedMigrationChainRequiredInsertColumns({ files = [], baselineFile = "http-generic-api/schema.sql", engine = "mariadb", policy = {}, readFile = (file) => fs.readFileSync(path.resolve(REPO_ROOT, file), "utf8") } = {}) {
  const contract = policy.required_insert_column_chain_contract || {};
  const safe = contract.enabled === true
    && contract.static_only === true
    && contract.database_connection_allowed === false
    && contract.sql_mutation_allowed === false
    && contract.provider_access_allowed === false
    && contract.credential_access_allowed === false
    && contract.data_export_allowed === false
    && contract.runtime_mutation_allowed === false
    && contract.secrets_included === false;
  if (engine !== "mariadb") return blocked("unsupported_engine", "Required INSERT-column inspection is defined for MariaDB staging only.", { engine });
  if (!safe || contract.fail_on_omitted_required_columns !== true || contract.inspect_insert_replace_writers !== true || contract.inspect_create_alter_required_columns !== true || contract.max_bridge_omissions !== undefined && !Number.isInteger(contract.max_bridge_omissions)) {
    return blocked("required_insert_column_contract_invalid", "The required INSERT-column contract must explicitly enable static fail-closed evaluation.", { engine, policy_key: contract.policy_key || null });
  }
  const rules = contractRules(contract);
  if (!rules.size) return blocked("required_insert_column_rules_missing", "At least one required INSERT-column table rule is required.");
  const migrations = normalizeFiles(files);
  const sequence = [String(baselineFile).replaceAll("\\", "/"), ...migrations];
  const tables = new Map();
  const findings = [];
  const warnings = [];
  const bridgeApplied = new Set();
  const metrics = {
    files_checked: sequence.length,
    migration_files_checked: migrations.length,
    statements_checked: 0,
    tables_projected: 0,
    writer_checks: 0,
    required_columns_checked: 0,
    omitted_required_columns: 0,
    allowed_bridge_omissions: 0,
  };
  const bridgeDefinitions = new Map();
  for (const rule of rules.values()) {
    if (rule.default_bridge) bridgeDefinitions.set(path.basename(rule.default_bridge.bridge_file || ""), { rule, bridge: rule.default_bridge });
  }

  function push(code, file, statement, message, details = {}) {
    findings.push({ code, file, statement_index: null, table: details.table || null, ...details, message, statement });
  }
  function applyCreate(info, file, statement) {
    if (!info?.table) return;
    if (info.skip) return;
    if (info.parse_error) { push("create_table_parse_error", file, statement, info.parse_error, { table: info.table }); return; }
    if (info.like_source) {
      const source = tables.get(info.like_source);
      if (!source) return;
      if (info.if_not_exists && tables.has(info.table)) return;
      tables.set(info.table, { table: info.table, columns: new Map(source.columns), source_file: file });
      metrics.tables_projected += 1;
      return;
    }
    if (info.if_not_exists && tables.has(info.table)) return;
    tables.set(info.table, { table: info.table, columns: info.columns, source_file: file });
    metrics.tables_projected += 1;
  }
  function applyAlter(info, file, statement) {
    if (!info?.table) return;
    const table = tables.get(info.table);
    if (!table) return;
    for (const clause of info.clauses) {
      if (clause.operation === "drop") table.columns.delete(clause.column);
      else if (clause.operation === "change") { table.columns.delete(clause.old_column); table.columns.set(clause.column, clause.spec); }
      else table.columns.set(clause.column, clause.spec);
      for (const rule of rules.values()) {
        const bridge = rule.default_bridge;
        if (!bridge || path.basename(file) !== path.basename(bridge.bridge_file || "") || IDENTIFIER(bridge.table) !== info.table || IDENTIFIER(bridge.column) !== clause.column) continue;
        const observedDefault = defaultLiteral(clause.spec.definition);
        if (observedDefault !== TEXT(bridge.default_literal)) {
          push("required_insert_bridge_default_mismatch", file, statement, `Bridge default for ${info.table}.${clause.column} does not match policy`, { table: info.table, column: clause.column, expected_default: bridge.default_literal, observed_default: observedDefault });
        } else {
          bridgeApplied.add(`${path.basename(file)}:${info.table}.${clause.column}`);
        }
      }
    }
  }

  for (const file of sequence) {
    let sql;
    try { sql = readFile(file); } catch (error) { return blocked("source_unreadable", `Unable to read ${file}: ${error.message}`, metrics); }
    for (const [statementIndex, original] of splitStatements(sql).entries()) {
      const statement = stripLeadingSqlComments(original);
      if (!statement) continue;
      metrics.statements_checked += 1;
      const create = createTableInfo(statement);
      if (create) { applyCreate(create, file, statement); continue; }
      const alter = alterClauses(statement);
      if (alter) { applyAlter(alter, file, statement); continue; }
      const insert = insertInfo(statement);
      if (!insert) continue;
      const rule = rules.get(insert.table);
      if (!rule) continue;
      metrics.writer_checks += 1;
      if (!tables.has(insert.table)) {
        push("required_insert_table_missing", file, statement, `${insert.table} INSERT target is absent before writer`, { table: insert.table, statement_index: statementIndex });
        continue;
      }
      for (const requiredColumn of rule.columns) {
        metrics.required_columns_checked += 1;
        if (!insert.has_columns || !insert.columns.includes(requiredColumn)) {
          metrics.omitted_required_columns += 1;
          const bridge = bridgeFor(rule, file);
          const bridgeKey = bridge ? `${path.basename(bridge.bridge_file || "")}:${insert.table}.${IDENTIFIER(bridge.column)}` : null;
          const bridgeFileIndex = bridge ? sequence.findIndex((candidate) => path.basename(candidate) === path.basename(bridge.bridge_file || "")) : -1;
          const writerFileIndex = sequence.indexOf(file);
          const allowed = Boolean(bridge
            && IDENTIFIER(bridge.column) === requiredColumn
            && bridgeFileIndex >= 0
            && bridgeFileIndex < writerFileIndex
            && bridgeApplied.has(bridgeKey)
            && (bridge.writer_files || []).includes(path.basename(file)));
          if (allowed) {
            metrics.allowed_bridge_omissions += 1;
            warnings.push({ code: "required_insert_column_omission_satisfied_by_ddl_bridge", file, table: insert.table, column: requiredColumn, bridge_file: bridge.bridge_file, default_literal: bridge.default_literal, statement_index: statementIndex });
          } else {
            push("required_insert_column_omitted", file, statement, `${insert.table} INSERT omits required column ${requiredColumn}`, { table: insert.table, column: requiredColumn, required_column: requiredColumn, statement_index: statementIndex, bridge_file: bridge?.bridge_file || null });
          }
        }
      }
      const bridgeForFile = bridgeDefinitions.get(path.basename(file));
      if (bridgeForFile) push("required_insert_bridge_contains_dml", file, statement, "A required-column DDL bridge contains a DML statement", { table: bridgeForFile.bridge.table, bridge_file: bridgeForFile.bridge.bridge_file, statement_index: statementIndex });
    }
  }
  if (contract.max_bridge_omissions !== undefined && metrics.allowed_bridge_omissions > contract.max_bridge_omissions) {
    push("required_insert_bridge_omission_limit_exceeded", "policy", "", `Allowed bridge omissions ${metrics.allowed_bridge_omissions} exceed policy maximum ${contract.max_bridge_omissions}`, { allowed_bridge_omissions: metrics.allowed_bridge_omissions, max_bridge_omissions: contract.max_bridge_omissions });
  }
  return {
    contract: "mad4b.mariadb-required-insert-column-ordered-chain.v1",
    engine,
    policy_key: contract.policy_key || null,
    baseline_file: baselineFile,
    files_checked: metrics.files_checked,
    migration_files_checked: metrics.migration_files_checked,
    statements_checked: metrics.statements_checked,
    tables_projected: metrics.tables_projected,
    writer_checks: metrics.writer_checks,
    required_columns_checked: metrics.required_columns_checked,
    omitted_required_columns: metrics.omitted_required_columns,
    allowed_bridge_omissions: metrics.allowed_bridge_omissions,
    required_tables: [...rules.values()].map((rule) => ({ table: rule.table, columns: rule.columns })),
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

export function loadRequiredInsertColumnPolicy(policyPath = path.join(REPO_ROOT, "http-generic-api", "config", "staging-migration-contract-policy.json")) {
  return JSON.parse(fs.readFileSync(policyPath, "utf8")).required_insert_column_chain_contract || null;
}
