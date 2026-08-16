import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POLICY_PATH = path.join(__dirname, "config", "database-engine-collation-policy.json");
const POLICY = JSON.parse(fs.readFileSync(POLICY_PATH, "utf8"));

const TEXT = (value) => String(value ?? "").trim();
const NORMALIZE = (value) => TEXT(value).toLowerCase().replaceAll("-", "_");

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
  return TEXT(sql).split(/;\s*(?:\r?\n|$)/u).map((item) => item.trim()).filter(Boolean);
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

export function extractJoinColumnPairs(sql) {
  const aliases = relationAliases(sql);
  const pairs = [];
  for (const match of TEXT(sql).matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z][A-Za-z0-9_]*)\s*=\s*([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z][A-Za-z0-9_]*)/giu)) {
    const leftAlias = canonicalIdentifier(match[1]);
    const rightAlias = canonicalIdentifier(match[3]);
    const leftTable = aliases.get(leftAlias);
    const rightTable = aliases.get(rightAlias);
    if (!leftTable || !rightTable) continue;
    if (leftAlias === rightAlias && canonicalIdentifier(match[2]) === canonicalIdentifier(match[4])) continue;
    pairs.push({
      left: { alias: leftAlias, table: leftTable, column: canonicalIdentifier(match[2]) },
      right: { alias: rightAlias, table: rightTable, column: canonicalIdentifier(match[4]) },
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

export function inspectProjectedJoinCollations(sql, { rules, projectedSchema = projectedSchemaFromSql(sql) } = {}) {
  const pairs = extractJoinColumnPairs(sql);
  const findings = [];
  const warnings = [];
  for (const pair of pairs) {
    const left = projectedSchema.get(pair.left.table)?.columns.get(pair.left.column);
    const right = projectedSchema.get(pair.right.table)?.columns.get(pair.right.column);
    if (!left || !right) continue;
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
      if (!compatibleColumns(left, right, rules)) {
        findings.push({ code: "join_collation_incompatible", pair, left, right, source: left.source === "live_information_schema" && right.source === "live_information_schema" ? "live_information_schema" : "live_plus_projected_ddl", applies_sql: false });
      }
      const warning = legacyWarning([left, right], rules);
      if (warning) warnings.push({ ...warning, pair, source: left.source === "live_information_schema" && right.source === "live_information_schema" ? "live_information_schema" : "live_plus_projected_ddl" });
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

export const DATABASE_COLLATION_POLICY_PATH = POLICY_PATH;
