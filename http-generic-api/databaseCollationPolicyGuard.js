import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const POLICY_PATH = path.join(__dirname, "config", "database-engine-collation-policy.json");
const POLICY = JSON.parse(fs.readFileSync(POLICY_PATH, "utf8"));

const TEXT = (value) => String(value ?? "").trim();
const NORMALIZE = (value) => TEXT(value).toLowerCase().replaceAll("-", "_");

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
    ok: false,
    ready: false,
    applies_sql: false,
    blocked_reason: code,
    reason_code: code,
    message,
    ...details,
    secrets_included: false,
  };
}

function passed(details = {}) {
  return {
    ok: true,
    ready: true,
    applies_sql: false,
    blocked_reason: null,
    reason_code: null,
    ...details,
    secrets_included: false,
  };
}

export function loadDatabaseCollationPolicy() {
  return JSON.parse(JSON.stringify(POLICY));
}

export function normalizeDatabaseEngine(value) {
  const engine = NORMALIZE(value);
  if (engine.includes("mariadb")) return "mariadb";
  if (engine.includes("mysql")) return "mysql";
  if (engine.includes("postgres") || engine === "pgsql") return "postgresql";
  return "unknown";
}

function versionParts(value) {
  return TEXT(value).match(/\d+/gu)?.map(Number) || [];
}

function versionAtLeast(value, minimum) {
  const actual = versionParts(value);
  const required = versionParts(minimum);
  for (let i = 0; i < Math.max(actual.length, required.length); i += 1) {
    const a = actual[i] || 0;
    const r = required[i] || 0;
    if (a !== r) return a > r;
  }
  return true;
}

export function resolveDatabaseCollationPolicy(engine, policy = POLICY, { version = "" } = {}) {
  const normalized = normalizeDatabaseEngine(engine);
  const rules = policy?.engines?.[normalized] || policy?.unknown_engine;
  if (!rules) return { engine: normalized, rules: null, version };
  const profile = rules.profiles?.find((candidate) => !candidate.minimum_version || versionAtLeast(version, candidate.minimum_version)) || null;
  return { engine: normalized, version, profile: profile?.profile_key || null, rules: { ...rules, ...(profile?.rules || {}) } };
}

function tableHasExplicitCollation(statement) {
  return /\b(?:DEFAULT\s+)?CHARSET\s*=\s*[A-Za-z0-9_]+\b/iu.test(statement)
    && /\b(?:DEFAULT\s+)?COLLATE\s*=\s*[A-Za-z0-9_]+\b/iu.test(statement);
}

function tableDefault(statement) {
  const charsetMatches = [...statement.matchAll(/\b(?:DEFAULT\s+)?CHARSET\s*=\s*([A-Za-z0-9_]+)/giu)];
  const collationMatches = [...statement.matchAll(/\b(?:DEFAULT\s+)?COLLATE\s*=\s*([A-Za-z0-9_]+)/giu)];
  return {
    charset: charsetMatches.at(-1)?.[1] || null,
    collation: collationMatches.at(-1)?.[1] || null,
  };
}

function normalizeIdentifier(value) {
  return TEXT(value).replaceAll("`", "").replace(/\s+/gu, " ").trim();
}

function canonicalIdentifier(value) {
  return normalizeIdentifier(value).split(".").at(-1).toLowerCase();
}

function statementsOf(sql) {
  return TEXT(sql).split(/;\s*(?:\r?\n|$)/u).map(stripLeadingSqlComments).filter(Boolean);
}

function projectedSchemaFromSql(sql) {
  const projected = new Map();
  for (const statement of statementsOf(sql)) {
    if (!/^CREATE\s+TABLE\b/iu.test(statement)) continue;
    const table = canonicalIdentifier(statement.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)/iu)?.[1] || "");
    const defaults = tableDefault(statement);
    if (!table) continue;
    const columns = new Map();
    const body = statement.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[^\s(]+\s*\(([\s\S]*)\)\s*(?:DEFAULT|ENGINE|$)/iu)?.[1] || "";
    for (const match of body.matchAll(/(?:^|,)\s*`?([A-Za-z][A-Za-z0-9_]*)`?\s+([A-Za-z][A-Za-z0-9_]*(?:\([^)]*\))?)[^,\n]*?(?:\bCHARACTER\s+SET\s+([A-Za-z0-9_]+))?[^,\n]*?(?:\bCOLLATE\s*=?\s*([A-Za-z0-9_]+))?/giu)) {
      const column = canonicalIdentifier(match[1]);
      columns.set(column, {
        table,
        column,
        charset: match[3] || defaults.charset || null,
        collation: match[4] || defaults.collation || null,
        source: "projected_ddl",
      });
    }
    projected.set(table, { table, charset: defaults.charset, collation: defaults.collation, columns });
  }
  return projected;
}

function relationAliases(sql) {
  const aliases = new Map();
  for (const match of TEXT(sql).matchAll(/\b(?:FROM|JOIN|UPDATE)\s+`?([A-Za-z0-9_.-]+)`?(?:\s+(?:AS\s+)?`?([A-Za-z][A-Za-z0-9_]*)`?)?/giu)) {
    const table = canonicalIdentifier(match[1]);
    const alias = canonicalIdentifier(match[2] || match[1]);
    if (table) aliases.set(alias, table);
  }
  return aliases;
}

function isPredicateComparison(sql, index) {
  const prefix = String(sql || "").slice(0, index).toUpperCase();
  const predicatePositions = [...prefix.matchAll(/\b(?:ON|WHERE|HAVING|WHEN)\b/gu)].map((match) => match.index || -1);
  const assignmentPositions = [...prefix.matchAll(/\b(?:SET|VALUES|UPDATE|SELECT)\b/gu)].map((match) => match.index || -1);
  const lastPredicate = predicatePositions.at(-1) ?? -1;
  const lastAssignment = assignmentPositions.at(-1) ?? -1;
  return lastPredicate > lastAssignment;
}

export function extractJoinColumnPairs(sql) {
  const normalizedSql = stripLeadingSqlComments(sql);
  const aliases = relationAliases(normalizedSql);
  const pairs = [];
  for (const match of normalizedSql.matchAll(/(?<![A-Za-z0-9_])`?([A-Za-z][A-Za-z0-9_]*)`?\s*\.\s*`?([A-Za-z][A-Za-z0-9_]*)`?(?:\s+COLLATE\s+([A-Za-z0-9_]+))?\s*(=|<=>)\s*`?([A-Za-z][A-Za-z0-9_]*)`?\s*\.\s*`?([A-Za-z][A-Za-z0-9_]*)`?(?:\s+COLLATE\s+([A-Za-z0-9_]+))?/giu)) {
    if (!isPredicateComparison(normalizedSql, match.index || 0)) continue;
    const leftAlias = canonicalIdentifier(match[1]);
    const rightAlias = canonicalIdentifier(match[5]);
    const leftTable = aliases.get(leftAlias);
    const rightTable = aliases.get(rightAlias);
    if (!leftTable || !rightTable) continue;
    if (leftAlias === rightAlias && canonicalIdentifier(match[2]) === canonicalIdentifier(match[6])) continue;
    pairs.push({
      operator: match[4],
      left: { alias: leftAlias, table: leftTable, column: canonicalIdentifier(match[2]), collation_override: match[3] || null },
      right: { alias: rightAlias, table: rightTable, column: canonicalIdentifier(match[6]), collation_override: match[7] || null },
    });
  }
  return pairs;
}

function normalizedColumn(row, source = "live_information_schema") {
  if (!row) return null;
  return {
    table: canonicalIdentifier(row.table || row.TABLE_NAME),
    column: canonicalIdentifier(row.column || row.COLUMN_NAME),
    charset: row.charset || row.CHARACTER_SET_NAME || null,
    collation: row.collation || row.COLLATION_NAME || null,
    source,
  };
}

function compatibleColumns(left, right, rules) {
  const leftCharset = NORMALIZE(left?.charset);
  const rightCharset = NORMALIZE(right?.charset);
  const leftCollation = NORMALIZE(left?.collation);
  const rightCollation = NORMALIZE(right?.collation);
  if (!leftCharset || !rightCharset || !leftCollation || !rightCollation) return false;
  if (leftCharset !== rightCharset || leftCollation !== rightCollation) return false;
  return (rules?.join_key_collation_mode || "blocked") !== "blocked";
}

function legacyWarning(columns, rules) {
  const legacy = new Set((rules?.legacy_compatible_collations || []).map(NORMALIZE));
  const values = columns.map((column) => NORMALIZE(column?.collation)).filter(Boolean);
  return values.some((value) => legacy.has(value)) ? {
    code: "legacy_collation_compatibility_warning",
    collations: [...new Set(values)],
    message: "Legacy-compatible collation observed; no implicit conversion is authorized.",
  } : null;
}

function explicitJoinBoundary(pair, rules, source) {
  const collations = [pair.left?.collation_override, pair.right?.collation_override].filter(Boolean);
  if (!collations.length) return null;
  const base = {
    pair,
    collations: [...new Set(collations.map(NORMALIZE))],
    source,
    applies_sql: false,
  };
  return rules?.allow_explicit_collation_boundary === true
    ? { ...base, code: "explicit_collation_join_boundary", message: "Explicit COLLATE boundary is permitted; implicit conversion remains forbidden." }
    : { ...base, code: "explicit_collation_boundary_not_allowed", message: "Explicit COLLATE boundary is not registered by policy." };
}

export function inspectProjectedJoinCollations(sql, { rules, projectedSchema = projectedSchemaFromSql(sql) } = {}) {
  const pairs = extractJoinColumnPairs(sql);
  const findings = [];
  const warnings = [];
  for (const pair of pairs) {
    const left = projectedSchema.get(pair.left.table)?.columns.get(pair.left.column);
    const right = projectedSchema.get(pair.right.table)?.columns.get(pair.right.column);
    if (!left || !right) continue;
    const explicitBoundary = explicitJoinBoundary(pair, rules, "projected_ddl");
    if (explicitBoundary) {
      if (explicitBoundary.code.endsWith("not_allowed")) findings.push(explicitBoundary);
      else warnings.push(explicitBoundary);
      continue;
    }
    if (!compatibleColumns(left, right, rules)) {
      findings.push({ code: "join_collation_incompatible", pair, left, right, source: "projected_ddl", applies_sql: false });
    }
    const warning = legacyWarning([left, right], rules);
    if (warning) warnings.push({ ...warning, pair, source: "projected_ddl" });
  }
  return { pairs, findings, warnings, projected_schema: projectedSchema };
}

export async function inspectLiveJoinCollations(pool, sql, { rules, projectedSchema = projectedSchemaFromSql(sql) } = {}) {
  const pairs = extractJoinColumnPairs(sql);
  if (!pairs.length) return { pairs: [], findings: [], warnings: [], projected_schema: projectedSchema, live_schema_inspected: false };
  if (!pool || typeof pool.query !== "function") return { pairs, findings: [{ code: "join_schema_inspection_pool_missing", applies_sql: false }], warnings: [], projected_schema: projectedSchema, live_schema_inspected: false };
  const findings = [];
  const warnings = [];
  const cache = new Map();
  async function readColumn(ref) {
    const key = `${ref.table}.${ref.column}`;
    if (cache.has(key)) return cache.get(key);
    const [rows] = await pool.query(
      "SELECT TABLE_NAME,COLUMN_NAME,CHARACTER_SET_NAME,COLLATION_NAME FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?",
      [ref.table, ref.column],
    );
    const value = normalizedColumn(rows?.[0], "live_information_schema") || projectedSchema.get(ref.table)?.columns.get(ref.column) || null;
    cache.set(key, value);
    return value;
  }
  try {
    for (const pair of pairs) {
      const left = await readColumn(pair.left);
      const right = await readColumn(pair.right);
      if (!left || !right) {
        findings.push({ code: "join_schema_metadata_missing", pair, source: "live_information_schema", applies_sql: false });
        continue;
      }
      const source = left.source === "live_information_schema" && right.source === "live_information_schema" ? "live_information_schema" : "live_plus_projected_ddl";
      const explicitBoundary = explicitJoinBoundary(pair, rules, source);
      if (explicitBoundary) {
        if (explicitBoundary.code.endsWith("not_allowed")) findings.push(explicitBoundary);
        else warnings.push(explicitBoundary);
        continue;
      }
      if (!compatibleColumns(left, right, rules)) {
        findings.push({ code: "join_collation_incompatible", pair, left, right, source, applies_sql: false });
      }
      const warning = legacyWarning([left, right], rules);
      if (warning) warnings.push({ ...warning, pair, source });
    }
  } catch (cause) {
    findings.push({ code: "join_schema_inspection_failed", cause_code: cause?.code || null, applies_sql: false });
  }
  return { pairs, findings, warnings, projected_schema: projectedSchema, live_schema_inspected: true };
}

export function inspectMigrationCollationSql(sql, { engine, version = "", policy = POLICY } = {}) {
  const resolved = resolveDatabaseCollationPolicy(engine, policy, { version });
  const normalizedSql = TEXT(sql);
  if (!normalizedSql) return blocked("collation_sql_missing", "Collation policy preflight requires migration SQL.");
  if (resolved.engine === "unknown" || !resolved.rules) {
    return blocked("database_engine_unknown", "Collation policy cannot evaluate an unknown database engine.", { engine: resolved.engine, engine_profile: resolved.profile });
  }

  const statements = statementsOf(normalizedSql);
  const issues = [];
  const warnings = [];
  const tables = [];
  for (const statement of statements) {
    if (!/^CREATE\s+TABLE\b/iu.test(statement)) continue;
    const name = normalizeIdentifier(statement.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)/iu)?.[1] || "");
    const defaults = tableDefault(statement);
    tables.push({ name, ...defaults, explicit: tableHasExplicitCollation(statement) });
    if (resolved.rules.required_default_charset && defaults.charset && NORMALIZE(defaults.charset) !== NORMALIZE(resolved.rules.required_default_charset)) {
      issues.push({ code: "migration_default_charset_not_allowed", table: name, value: defaults.charset });
    }
    if (resolved.rules.required_default_collation && defaults.collation && NORMALIZE(defaults.collation) !== NORMALIZE(resolved.rules.required_default_collation)) {
      const legacy = (resolved.rules.legacy_compatible_collations || []).map(NORMALIZE);
      const code = legacy.includes(NORMALIZE(defaults.collation)) ? "legacy_collation_default_warning" : "migration_default_collation_not_allowed";
      (code.endsWith("warning") ? warnings : issues).push({ code, table: name, value: defaults.collation, required: resolved.rules.required_default_collation });
    }
    const inlineColumnCollations = [...statement.matchAll(/(?:\(|,)\s*`?([A-Za-z][A-Za-z0-9_]*)`?\s+[^,\n]+?\bCOLLATE\s*=?\s*([A-Za-z0-9_]+)/giu)];
    for (const match of inlineColumnCollations) {
      const column = match[1];
      const collation = match[2];
      const isJsonLike = /(^|_)json$|_json$|json_/.test(column);
      const allowed = isJsonLike
        ? (resolved.rules.binary_collation_allowlist || []).map(NORMALIZE).concat([NORMALIZE(resolved.rules.required_default_collation)])
        : [NORMALIZE(resolved.rules.required_default_collation)];
      const legacy = (resolved.rules.legacy_compatible_collations || []).map(NORMALIZE);
      if (!allowed.includes(NORMALIZE(collation)) && !legacy.includes(NORMALIZE(collation))) {
        issues.push({ code: "migration_column_collation_not_allowed", table: name, column, value: collation, required: allowed });
      } else if (legacy.includes(NORMALIZE(collation))) {
        warnings.push({ code: "legacy_collation_column_warning", table: name, column, value: collation });
      }
    }
    if (resolved.rules.required_default_charset && resolved.rules.required_default_collation && !tableHasExplicitCollation(statement)) {
      issues.push({ code: "migration_table_collation_not_explicit", table: name });
    }
  }

  const projectedJoin = inspectProjectedJoinCollations(normalizedSql, { rules: resolved.rules });
  issues.push(...projectedJoin.findings);
  warnings.push(...projectedJoin.warnings);
  return issues.length
    ? blocked("collation_policy_violation", "Migration SQL violates the selected database collation policy.", { engine: resolved.engine, engine_profile: resolved.profile, issues, warnings, join_findings: projectedJoin.findings, tables })
    : passed({ engine: resolved.engine, engine_profile: resolved.profile, policy_key: policy.policy_key, tables, issues: [], warnings, join_findings: projectedJoin.findings });
}

export async function detectDatabaseEngine(pool) {
  if (!pool || typeof pool.query !== "function") {
    return blocked("database_engine_pool_missing", "Collation engine detection requires a database pool.");
  }
  try {
    const [rows] = await pool.query("SELECT VERSION() AS version, @@version_comment AS version_comment");
    const version = TEXT(rows?.[0]?.version);
    const versionComment = TEXT(rows?.[0]?.version_comment);
    const engine = normalizeDatabaseEngine(`${version} ${versionComment}`);
    if (engine === "unknown") return blocked("database_engine_unknown", "Database engine detection returned an unsupported engine.", { version, version_comment: versionComment });
    const resolved = resolveDatabaseCollationPolicy(engine, POLICY, { version });
    return passed({ engine, version, version_comment: versionComment, engine_profile: resolved.profile });
  } catch (cause) {
    return blocked("database_engine_detection_failed", "Database engine detection failed closed.", { cause_code: cause?.code || null });
  }
}

export async function runDatabaseCollationPreflight({ pool, sql, migration, policy = POLICY } = {}) {
  const detection = await detectDatabaseEngine(pool);
  if (!detection.ready) {
    return blocked(detection.blocked_reason, detection.message, { migration: TEXT(migration), detection, engine_profile: detection.engine_profile || null });
  }
  const evaluation = inspectMigrationCollationSql(sql, { engine: detection.engine, version: detection.version, policy });
  const liveJoin = await inspectLiveJoinCollations(pool, sql, { rules: resolveDatabaseCollationPolicy(detection.engine, policy, { version: detection.version }).rules, projectedSchema: projectedSchemaFromSql(sql) });
  const allIssues = [...(evaluation.issues || []), ...liveJoin.findings];
  const warnings = [...(evaluation.warnings || []), ...liveJoin.warnings];
  if (allIssues.length) {
    return blocked("database_collation_policy_mismatch", "Database collation policy or live JOIN contract failed closed.", {
      migration: TEXT(migration), detection, engine_profile: evaluation.engine_profile, issues: allIssues, join_findings: liveJoin.findings, warnings, tables: evaluation.tables || [],
    });
  }
  return {
    ...passed({ engine: detection.engine, engine_profile: evaluation.engine_profile, policy_key: policy.policy_key, tables: evaluation.tables || [], issues: [], join_findings: [], warnings }),
    migration: TEXT(migration),
    detection,
    live_schema_inspected: liveJoin.live_schema_inspected,
    policy_key: policy.policy_key,
    secrets_included: false,
  };
}

function cloneProjectedSchema(source) {
  const cloned = new Map();
  for (const [table, entry] of source.entries()) {
    cloned.set(table, {
      ...entry,
      columns: new Map([...entry.columns.entries()].map(([column, value]) => [column, { ...value }])),
    });
  }
  return cloned;
}

function columnReferenceFromProjectedSchema(schema, reference) {
  return schema.get(reference.table)?.columns.get(reference.column) || null;
}

function applyProjectedDdlStatement(statement, schema, databaseDefaults) {
  const normalized = TEXT(statement);
  const databaseCollation = normalized.match(/^ALTER\s+DATABASE\b[\s\S]*?\b(?:DEFAULT\s+)?(?:CHARACTER\s+SET|CHARSET)\s*=?\s*([A-Za-z0-9_]+)[\s\S]*?\bCOLLATE\s*=?\s*([A-Za-z0-9_]+)/iu);
  if (databaseCollation) {
    databaseDefaults.charset = databaseCollation[1];
    databaseDefaults.collation = databaseCollation[2];
  }

  const localTables = projectedSchemaFromSql(normalized);
  const createIfNotExists = /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\b/iu.test(normalized);
  for (const [table, entry] of localTables.entries()) {
    if (createIfNotExists && schema.has(table)) continue;
    const tableCharset = entry.charset || databaseDefaults.charset || null;
    const tableCollation = entry.collation || databaseDefaults.collation || null;
    const columns = new Map([...entry.columns.entries()].map(([column, value]) => [column, {
      ...value,
      charset: value.charset || tableCharset,
      collation: value.collation || tableCollation,
    }]));
    schema.set(table, { ...entry, charset: tableCharset, collation: tableCollation, columns });
  }

  const alterTable = normalized.match(/^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?`?([A-Za-z0-9_.-]+)`?/iu);
  if (!alterTable) return;
  const table = canonicalIdentifier(alterTable[1]);
  const entry = schema.get(table);
  const rename = normalized.match(/\bRENAME\s+TO\s+`?([A-Za-z0-9_.-]+)`?/iu);
  if (rename && entry) {
    schema.delete(table);
    schema.set(canonicalIdentifier(rename[1]), { ...entry, table: canonicalIdentifier(rename[1]) });
    return;
  }
  if (!entry) return;

  const convert = normalized.match(/\bCONVERT\s+TO\s+(?:CHARACTER\s+SET|CHARSET)\s*=?\s*([A-Za-z0-9_]+)\s+COLLATE\s*=?\s*([A-Za-z0-9_]+)/iu);
  const tableDefault = normalized.match(/\bDEFAULT\s+(?:CHARACTER\s+SET|CHARSET)\s*=?\s*([A-Za-z0-9_]+)[\s\S]*?\bCOLLATE\s*=?\s*([A-Za-z0-9_]+)/iu);
  if (convert) {
    entry.charset = convert[1];
    entry.collation = convert[2];
    for (const [column, value] of entry.columns.entries()) entry.columns.set(column, { ...value, charset: convert[1], collation: convert[2], source: "ordered_projected_ddl" });
  } else if (tableDefault) {
    entry.charset = tableDefault[1];
    entry.collation = tableDefault[2];
  }

  const modifyMatches = [...normalized.matchAll(/\b(?:MODIFY|CHANGE)\s+(?:COLUMN\s+)?`?([A-Za-z][A-Za-z0-9_]*)`?/giu)];
  modifyMatches.forEach((match, index) => {
    const column = canonicalIdentifier(match[1]);
    const start = match.index || 0;
    const end = modifyMatches[index + 1]?.index || normalized.length;
    const segment = normalized.slice(start, end);
    const charset = segment.match(/\b(?:CHARACTER\s+SET|CHARSET)\s*=?\s*([A-Za-z0-9_]+)/iu)?.[1] || null;
    const collation = segment.match(/\bCOLLATE\s*=?\s*([A-Za-z0-9_]+)/iu)?.[1] || null;
    if (!entry.columns.has(column) || (!charset && !collation)) return;
    const previous = entry.columns.get(column);
    entry.columns.set(column, {
      ...previous,
      charset: charset || previous.charset || entry.charset || null,
      collation: collation || previous.collation || entry.collation || null,
      source: "ordered_projected_ddl",
    });
  });
}

export function inspectOrderedMigrationChainCollations({
  files = [],
  baselineFile = "http-generic-api/schema.sql",
  engine = "mariadb",
  policy = POLICY,
  readFile = (file) => fs.readFileSync(path.resolve(REPO_ROOT, file), "utf8"),
} = {}) {
  const resolved = resolveDatabaseCollationPolicy(engine, policy);
  if (resolved.engine === "unknown" || !resolved.rules) return blocked("database_engine_unknown", "Ordered collation-chain inspection requires a supported database engine.", { engine: resolved.engine });
  const databaseDefaults = {
    charset: resolved.rules.required_default_charset || null,
    collation: resolved.rules.required_default_collation || null,
  };
  const schema = new Map();
  const findings = [];
  const warnings = [];
  const migrationFiles = files
    .filter((file) => /^http-generic-api\/migrations\/.*\.sql$/u.test(String(file).replaceAll("\\", "/")))
    .slice()
    .sort((left, right) => {
      const leftName = path.basename(String(left));
      const rightName = path.basename(String(right));
      const leftMatch = leftName.match(/^(\d+)_/u);
      const rightMatch = rightName.match(/^(\d+)_/u);
      if (!leftMatch || !rightMatch) return leftName.localeCompare(rightName);
      const leftVersion = BigInt(leftMatch[1]);
      const rightVersion = BigInt(rightMatch[1]);
      if (leftVersion < rightVersion) return -1;
      if (leftVersion > rightVersion) return 1;
      return leftName.localeCompare(rightName);
    });
  const sequence = [baselineFile, ...migrationFiles];
  let statementsChecked = 0;
  for (const file of sequence) {
    const sql = readFile(file);
    const statements = statementsOf(sql);
    statements.forEach((statement, statementIndex) => {
      statementsChecked += 1;
      for (const pair of extractJoinColumnPairs(statement)) {
        const left = columnReferenceFromProjectedSchema(schema, pair.left);
        const right = columnReferenceFromProjectedSchema(schema, pair.right);
        if (!left || !right) continue;
        const explicitBoundary = explicitJoinBoundary(pair, resolved.rules, "ordered_projected_schema");
        if (explicitBoundary) {
          if (explicitBoundary.code.endsWith("not_allowed")) findings.push({ ...explicitBoundary, file, statement_index: statementIndex });
          else warnings.push({ ...explicitBoundary, file, statement_index: statementIndex });
          continue;
        }
        if (!compatibleColumns(left, right, resolved.rules)) {
          findings.push({
            code: "ordered_join_collation_incompatible",
            file,
            statement_index: statementIndex,
            pair,
            left,
            right,
            source: "ordered_projected_schema",
            applies_sql: false,
          });
        }
        const warning = legacyWarning([left, right], resolved.rules);
        if (warning) warnings.push({ ...warning, file, statement_index: statementIndex, pair, source: "ordered_projected_schema" });
      }
      applyProjectedDdlStatement(statement, schema, databaseDefaults);
    });
  }
  return {
    contract: "mad4b.mariadb-collation-ordered-chain.v1",
    engine: resolved.engine,
    engine_profile: resolved.profile,
    policy_key: policy.policy_key,
    baseline_file: baselineFile,
    files_checked: sequence.length,
    migration_files_checked: migrationFiles.length,
    statements_checked: statementsChecked,
    projected_tables: schema.size,
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

export const DATABASE_COLLATION_POLICY_PATH = POLICY_PATH;
