import fs from "node:fs";
import { getPool } from "./db.js";

const POLICY_URL = new URL("./config/database-engine-collation-policy.json", import.meta.url);

export function loadDatabaseEngineCollationPolicy() {
  return JSON.parse(fs.readFileSync(POLICY_URL, "utf8"));
}

function text(value = "") {
  return String(value ?? "").trim();
}

function normalizeName(value = "") {
  return text(value).replaceAll("`", "").toLowerCase();
}

function parseSemver(value = "") {
  const match = text(value).match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3] || 0)] : [0, 0, 0];
}

function semverAtLeast(actual, minimum) {
  const left = parseSemver(actual);
  const right = parseSemver(minimum);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return true;
    if (left[index] < right[index]) return false;
  }
  return true;
}

export function detectDatabaseEngineFamily(version = "") {
  const normalized = text(version).toLowerCase();
  if (normalized.includes("mariadb")) return "mariadb";
  if (normalized.includes("postgresql") || normalized.includes("postgres")) return "postgresql";
  if (/^\d+\.\d+/.test(normalized) || normalized.includes("mysql")) return "mysql";
  return "unknown";
}

export function resolveDatabaseEngineProfile(observation = {}, policy = loadDatabaseEngineCollationPolicy()) {
  const version = text(observation.version || observation.server_version);
  const engineFamily = text(observation.engine_family || detectDatabaseEngineFamily(version)).toLowerCase();
  const candidates = (policy.engine_profiles || []).filter((profile) => profile.engine_family === engineFamily);
  const profile = candidates
    .filter((candidate) => semverAtLeast(version, candidate.minimum_version))
    .sort((left, right) => parseSemver(right.minimum_version).join(".").localeCompare(parseSemver(left.minimum_version).join(".")))[0] || null;
  return {
    engine_family: engineFamily,
    version,
    profile,
    resolved: Boolean(profile),
    reason_code: profile ? null : "database_engine_profile_unresolved",
    secrets_included: false,
  };
}

function sqlCollations(sql = "") {
  const out = [];
  const regex = /\bCOLLATE\s*(?:=\s*)?([A-Za-z0-9_\-.]+)/gi;
  let match;
  while ((match = regex.exec(String(sql)))) out.push(match[1]);
  return [...new Set(out)];
}

function parseAliases(sql = "") {
  const aliases = new Map();
  const regex = /\b(?:UPDATE|FROM|JOIN)\s+`?([A-Za-z0-9_]+)`?(?:\s+(?:AS\s+)?`?([A-Za-z0-9_]+)`?)?/gi;
  let match;
  while ((match = regex.exec(String(sql)))) {
    const table = normalizeName(match[1]);
    const alias = normalizeName(match[2] || match[1]);
    if (table && alias && !["on", "where", "set", "inner", "left", "right", "join"].includes(alias)) aliases.set(alias, table);
    aliases.set(table, table);
  }
  return aliases;
}

export function extractSqlJoinComparisons(sql = "") {
  const aliases = parseAliases(sql);
  const comparisons = [];
  const regex = /(?:\bON\b|\bAND\b|\bWHERE\b)\s+`?([A-Za-z0-9_]+)`?\.`?([A-Za-z0-9_]+)`?\s*=\s*`?([A-Za-z0-9_]+)`?\.`?([A-Za-z0-9_]+)`?/gi;
  let match;
  while ((match = regex.exec(String(sql)))) {
    const leftAlias = normalizeName(match[1]);
    const rightAlias = normalizeName(match[3]);
    comparisons.push({
      left: { alias: leftAlias, table: aliases.get(leftAlias) || leftAlias, column: normalizeName(match[2]) },
      right: { alias: rightAlias, table: aliases.get(rightAlias) || rightAlias, column: normalizeName(match[4]) },
    });
  }
  return comparisons;
}

function projectedTableContracts(sql = "") {
  const contracts = new Map();
  const regex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([A-Za-z0-9_]+)`?\s*\(([\s\S]*?)\)\s*([^;]*);/gi;
  let match;
  while ((match = regex.exec(String(sql)))) {
    const table = normalizeName(match[1]);
    const body = match[2];
    const tail = match[3] || "";
    const defaultCollation = (tail.match(/\bCOLLATE\s*(?:=\s*)?([A-Za-z0-9_\-.]+)/i) || [])[1] || null;
    const defaultCharset = (tail.match(/(?:DEFAULT\s+)?CHARSET\s*(?:=\s*)?([A-Za-z0-9_\-.]+)/i) || [])[1] || null;
    for (const rawLine of body.split(",")) {
      const line = rawLine.trim();
      const columnMatch = line.match(/^`?([A-Za-z0-9_]+)`?\s+(?:VAR)?CHAR\b/i);
      if (!columnMatch) continue;
      const column = normalizeName(columnMatch[1]);
      const collation = (line.match(/\bCOLLATE\s+([A-Za-z0-9_\-.]+)/i) || [])[1] || defaultCollation;
      const charset = (line.match(/\bCHARACTER\s+SET\s+([A-Za-z0-9_\-.]+)/i) || [])[1] || defaultCharset;
      contracts.set(`${table}.${column}`, { table, column, collation: collation || null, charset: charset || null, source: "projected_ddl" });
    }
  }
  return contracts;
}

function normalizeObservation(row = {}) {
  return {
    version: text(row.version || row.VERSION || row.server_version),
    engine_family: text(row.engine_family),
    character_set_server: text(row.character_set_server),
    collation_server: text(row.collation_server),
    character_set_connection: text(row.character_set_connection),
    collation_connection: text(row.collation_connection),
  };
}

export async function probeDatabaseRuntimeObservation(deps = {}) {
  if (typeof deps.observeDatabase === "function") return normalizeObservation(await deps.observeDatabase());
  const pool = deps.pool || getPool();
  const [rows] = await pool.query(
    "SELECT VERSION() AS version, @@character_set_server AS character_set_server, @@collation_server AS collation_server, @@character_set_connection AS character_set_connection, @@collation_connection AS collation_connection",
  );
  return normalizeObservation(rows?.[0] || {});
}

async function readLiveContracts(comparisons, deps = {}) {
  const projected = deps.projectedContracts || new Map();
  const wanted = new Map();
  for (const comparison of comparisons) {
    for (const side of [comparison.left, comparison.right]) {
      const key = `${side.table}.${side.column}`;
      if (!projected.has(key)) wanted.set(key, side);
    }
  }
  if (!wanted.size) return new Map();
  if (typeof deps.readColumnContracts === "function") {
    const rows = await deps.readColumnContracts([...wanted.values()]);
    return new Map((rows || []).map((row) => [`${normalizeName(row.table || row.TABLE_NAME)}.${normalizeName(row.column || row.COLUMN_NAME)}`, {
      table: normalizeName(row.table || row.TABLE_NAME), column: normalizeName(row.column || row.COLUMN_NAME),
      collation: text(row.collation || row.COLLATION_NAME) || null, charset: text(row.charset || row.CHARACTER_SET_NAME) || null, source: "live_schema",
    }]));
  }
  const pool = deps.pool || getPool();
  const tables = [...new Set([...wanted.values()].map((side) => side.table))];
  const placeholders = tables.map(() => "?").join(",");
  const [rows] = await pool.query(
    `SELECT TABLE_NAME, COLUMN_NAME, CHARACTER_SET_NAME, COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders})`,
    tables,
  );
  return new Map((rows || []).map((row) => [`${normalizeName(row.TABLE_NAME)}.${normalizeName(row.COLUMN_NAME)}`, {
    table: normalizeName(row.TABLE_NAME), column: normalizeName(row.COLUMN_NAME), collation: text(row.COLLATION_NAME) || null,
    charset: text(row.CHARACTER_SET_NAME) || null, source: "live_schema",
  }]));
}

function sameComparisonContract(left, right) {
  if (!left || !right) return null;
  if (!left.collation || !right.collation) return null;
  return normalizeName(left.collation) === normalizeName(right.collation)
    && normalizeName(left.charset || "") === normalizeName(right.charset || "");
}

export async function assessDatabaseCollationPolicy(sql = "", deps = {}) {
  const policy = deps.policy || loadDatabaseEngineCollationPolicy();
  const observation = await probeDatabaseRuntimeObservation(deps);
  const resolved = resolveDatabaseEngineProfile(observation, policy);
  const findings = [];
  if (!resolved.resolved) {
    return { contract: policy.contract, status: "block", engine_family: resolved.engine_family, profile_key: null, findings: [{ code: "database_engine_profile_unresolved" }], observation, secrets_included: false };
  }
  const profile = resolved.profile;
  const collations = sqlCollations(sql);
  for (const collation of collations) {
    const lower = collation.toLowerCase();
    const forbidden = (profile.forbidden_collation_patterns || []).find((pattern) => lower.includes(String(pattern).toLowerCase()));
    if (forbidden) findings.push({ code: "database_engine_collation_forbidden", collation, pattern: forbidden, severity: "block" });
    else if ((profile.legacy_compatible_collations || []).map((item) => item.toLowerCase()).includes(lower)) {
      findings.push({ code: "legacy_compatible_collation", collation, severity: "warn" });
    }
  }
  const projected = projectedTableContracts(sql);
  const comparisons = extractSqlJoinComparisons(sql);
  const live = await readLiveContracts(comparisons, { ...deps, projectedContracts: projected });
  for (const comparison of comparisons) {
    const leftKey = `${comparison.left.table}.${comparison.left.column}`;
    const rightKey = `${comparison.right.table}.${comparison.right.column}`;
    const left = projected.get(leftKey) || live.get(leftKey) || null;
    const right = projected.get(rightKey) || live.get(rightKey) || null;
    const compatible = sameComparisonContract(left, right);
    if (compatible === false) {
      findings.push({ code: "join_collation_incompatible", severity: "block", left, right });
    } else if (compatible === null && (left || right)) {
      findings.push({ code: "join_collation_contract_unprovable", severity: "block", left, right });
    }
  }
  const blocked = findings.some((finding) => finding.severity === "block");
  const warned = findings.some((finding) => finding.severity === "warn");
  return {
    contract: policy.contract,
    status: blocked ? "block" : warned ? "warn" : "pass",
    engine_family: resolved.engine_family,
    profile_key: profile.profile_key,
    observation,
    sql_collations: collations,
    join_comparison_count: comparisons.length,
    findings,
    applies_sql: false,
    secrets_included: false,
  };
}
