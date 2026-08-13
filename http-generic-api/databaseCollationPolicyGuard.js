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
    blocked_reason: code,
    message,
    ...details,
    secrets_included: false,
  };
}

function passed(details = {}) {
  return {
    ok: true,
    ready: true,
    blocked_reason: null,
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

export function resolveDatabaseCollationPolicy(engine, policy = POLICY) {
  const normalized = normalizeDatabaseEngine(engine);
  const rules = policy?.engines?.[normalized] || policy?.unknown_engine;
  if (!rules) return { engine: normalized, rules: null };
  return { engine: normalized, rules: { ...rules } };
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

export function inspectMigrationCollationSql(sql, { engine, policy = POLICY } = {}) {
  const resolved = resolveDatabaseCollationPolicy(engine, policy);
  const normalizedSql = TEXT(sql);
  if (!normalizedSql) return blocked("collation_sql_missing", "Collation policy preflight requires migration SQL.");
  if (resolved.engine === "unknown" || !resolved.rules) {
    return blocked("database_engine_unknown", "Collation policy cannot evaluate an unknown database engine.", { engine: resolved.engine });
  }

  const statements = normalizedSql.split(/;\s*(?:\r?\n|$)/u).map((item) => item.trim()).filter(Boolean);
  const issues = [];
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
      issues.push({ code: "migration_default_collation_not_allowed", table: name, value: defaults.collation, required: resolved.rules.required_default_collation });
    }
    const inlineColumnCollations = [...statement.matchAll(/(?:\(|,)\s*`?([A-Za-z][A-Za-z0-9_]*)`?\s+[^,\n]+?\bCOLLATE\s*=?\s*([A-Za-z0-9_]+)/giu)];
    for (const match of inlineColumnCollations) {
      const column = match[1];
      const collation = match[2];
      const isJsonLike = /(^|_)json$|_json$|json_/.test(column);
      const allowed = isJsonLike
        ? (resolved.rules.binary_collation_allowlist || []).map(NORMALIZE).concat([NORMALIZE(resolved.rules.required_default_collation)])
        : [NORMALIZE(resolved.rules.required_default_collation)];
      if (!allowed.includes(NORMALIZE(collation))) {
        issues.push({ code: "migration_column_collation_not_allowed", table: name, column, value: collation, required: allowed });
      }
    }
    if (resolved.rules.required_default_charset && resolved.rules.required_default_collation && !tableHasExplicitCollation(statement)) {
      issues.push({ code: "migration_table_collation_not_explicit", table: name });
    }
  }

  const mixedJoinCollations = [...normalizedSql.matchAll(/\b(?:JOIN|FROM|WHERE)\b[\s\S]{0,240}?\b(?:COLLATE\s+([A-Za-z0-9_]+))/giu)]
    .map((match) => NORMALIZE(match[1]))
    .filter(Boolean);
  if (resolved.rules.reject_mixed_join_key_collations && new Set(mixedJoinCollations).size > 1) {
    issues.push({ code: "mixed_join_key_collations", collations: [...new Set(mixedJoinCollations)] });
  }

  return issues.length
    ? blocked("collation_policy_violation", "Migration SQL violates the selected database collation policy.", { engine: resolved.engine, issues, tables })
    : passed({ engine: resolved.engine, policy_key: policy.policy_key, tables, issues: [] });
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
    return passed({ engine, version, version_comment: versionComment });
  } catch (cause) {
    return blocked("database_engine_detection_failed", "Database engine detection failed closed.", { cause_code: cause?.code || null });
  }
}

export async function runDatabaseCollationPreflight({ pool, sql, migration, policy = POLICY } = {}) {
  const detection = await detectDatabaseEngine(pool);
  if (!detection.ready) {
    return blocked(detection.blocked_reason, detection.message, { migration: TEXT(migration), detection });
  }
  const evaluation = inspectMigrationCollationSql(sql, { engine: detection.engine, policy });
  return {
    ...evaluation,
    migration: TEXT(migration),
    detection,
    policy_key: policy.policy_key,
    secrets_included: false,
  };
}

export const DATABASE_COLLATION_POLICY_PATH = POLICY_PATH;
