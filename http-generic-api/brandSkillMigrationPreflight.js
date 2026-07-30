import { getPool } from "./db.js";

const REQUIRED_COLLATION = "utf8mb4_uca1400_ai_ci";
const TARGET_OBJECTS = Object.freeze([
  "brand_skill_policies",
  "user_brand_skill_grants",
  "v_effective_user_brand_skill_grants",
]);

function check(key, status, detail, evidence = null) {
  return { key, status, detail, evidence, secrets_included: false };
}

function firstRow(queryResult) {
  const [rows = []] = queryResult || [];
  const [row = null] = rows;
  return row;
}

function allRows(queryResult) {
  const [rows = []] = queryResult || [];
  return Array.isArray(rows) ? rows : [];
}

export async function assessBrandSkillMigrationPreflight({ pool = getPool() } = {}) {
  const checks = [];
  const queries = [];

  async function run(key, sql, params = []) {
    queries.push(key);
    return pool.query(sql, params);
  }

  try {
    const server = firstRow(await run(
      "database_server",
      "SELECT VERSION() AS version, @@version_comment AS version_comment",
    ));
    const version = String(server?.version || "");
    const versionComment = String(server?.version_comment || "");
    const isMariaDb = /mariadb/i.test(`${version} ${versionComment}`);
    checks.push(check(
      "database_server",
      isMariaDb ? "pass" : "fail",
      isMariaDb ? "MariaDB server identified." : "Brand skill migration requires a MariaDB-compatible server.",
      { version, version_comment: versionComment },
    ));
  } catch (error) {
    checks.push(check("database_server", "fail", "Database server identity could not be read.", { code: error?.code || null }));
  }

  try {
    const collation = firstRow(await run(
      "required_collation",
      "SELECT COLLATION_NAME FROM information_schema.COLLATIONS WHERE COLLATION_NAME = ? LIMIT 1",
      [REQUIRED_COLLATION],
    ));
    checks.push(check(
      "required_collation",
      collation?.COLLATION_NAME === REQUIRED_COLLATION ? "pass" : "fail",
      collation?.COLLATION_NAME === REQUIRED_COLLATION
        ? `${REQUIRED_COLLATION} is available.`
        : `${REQUIRED_COLLATION} is unavailable.`,
      { required_collation: REQUIRED_COLLATION },
    ));
  } catch (error) {
    checks.push(check("required_collation", "fail", "Required collation could not be inspected.", { code: error?.code || null }));
  }

  try {
    const sha = firstRow(await run(
      "sha2_probe",
      "SELECT SHA2('brand-skill-preflight', 256) AS sha2_probe",
    ));
    const value = String(sha?.sha2_probe || "");
    checks.push(check(
      "sha2_probe",
      /^[a-f0-9]{64}$/i.test(value) ? "pass" : "fail",
      /^[a-f0-9]{64}$/i.test(value)
        ? "SHA2(..., 256) returned a 64-character digest."
        : "SHA2(..., 256) is unavailable or returned an invalid digest.",
      { digest_length: value.length },
    ));
  } catch (error) {
    checks.push(check("sha2_probe", "fail", "SHA2 compatibility probe failed.", { code: error?.code || null }));
  }

  try {
    const rows = allRows(await run(
      "target_object_absence",
      `SELECT TABLE_NAME, TABLE_TYPE
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN (?, ?, ?)
        ORDER BY TABLE_NAME`,
      TARGET_OBJECTS,
    ));
    checks.push(check(
      "target_object_absence",
      rows.length === 0 ? "pass" : "fail",
      rows.length === 0
        ? "Target tables and view are absent; additive creation can proceed after authorization."
        : "One or more target objects already exist. Stop and perform exact schema/readback reconciliation instead of relying on IF NOT EXISTS.",
      { existing_objects: rows.map((row) => ({ name: row.TABLE_NAME, type: row.TABLE_TYPE })) },
    ));
  } catch (error) {
    checks.push(check("target_object_absence", "fail", "Target object presence could not be inspected.", { code: error?.code || null }));
  }

  try {
    const rows = allRows(await run(
      "agent_skills_contract",
      `SELECT COLUMN_NAME, DATA_TYPE, COLLATION_NAME
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'agent_skills'
          AND COLUMN_NAME IN ('skill_id', 'skill_key', 'status')
        ORDER BY COLUMN_NAME`,
    ));
    const byName = new Map(rows.map((row) => [row.COLUMN_NAME, row]));
    const requiredPresent = ["skill_id", "skill_key", "status"].every((name) => byName.has(name));
    const skillIdCollation = String(byName.get("skill_id")?.COLLATION_NAME || "");
    const compatible = requiredPresent && skillIdCollation === REQUIRED_COLLATION;
    checks.push(check(
      "agent_skills_contract",
      compatible ? "pass" : "fail",
      compatible
        ? "agent_skills prerequisite columns and skill_id collation are compatible."
        : "agent_skills prerequisites or skill_id collation are incompatible with the readback view.",
      {
        required_columns_present: requiredPresent,
        skill_id_collation: skillIdCollation || null,
        required_collation: REQUIRED_COLLATION,
      },
    ));
  } catch (error) {
    checks.push(check("agent_skills_contract", "fail", "agent_skills prerequisites could not be inspected.", { code: error?.code || null }));
  }

  const failed = checks.filter((item) => item.status === "fail");
  return {
    ok: failed.length === 0,
    ready: failed.length === 0,
    status: failed.length === 0 ? "pass" : "fail",
    mode: "read_only_preflight",
    applies_sql: false,
    target_migration: "20260728_brand_scoped_user_skill_activation.sql",
    required_collation: REQUIRED_COLLATION,
    checks,
    failed_check_keys: failed.map((item) => item.key),
    queries_executed: queries,
    provider_calls: false,
    external_writes: false,
    secrets_included: false,
  };
}

export const _testingBrandSkillMigrationPreflight = {
  REQUIRED_COLLATION,
  TARGET_OBJECTS,
  firstRow,
  allRows,
};
