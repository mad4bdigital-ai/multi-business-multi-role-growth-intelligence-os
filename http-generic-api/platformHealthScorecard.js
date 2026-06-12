import { getPool } from "./db.js";

function bool(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || ["true", "1", "yes"].includes(String(value).trim().toLowerCase());
}

function parseJsonMaybe(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

export async function readPlatformHealthScorecard(input = {}) {
  const includeComponents = bool(input.include_components ?? input.includeComponents, true);
  const pool = getPool();
  const [[summary]] = await pool.query(
    `SELECT overall_status, component_count, pass_count, warn_count, fail_count, components_json, secrets_included
       FROM v_platform_health_scorecard
      LIMIT 1`
  );
  const [componentRows] = includeComponents
    ? await pool.query(
        `SELECT component_key, status, evidence_json, secrets_included
           FROM v_platform_health_scorecard_components
          ORDER BY component_key`
      )
    : [[]];

  const components = includeComponents
    ? (componentRows || []).map((row) => ({
        component_key: row.component_key,
        status: row.status,
        evidence: parseJsonMaybe(row.evidence_json, {}),
        secrets_included: Boolean(Number(row.secrets_included || 0)),
      }))
    : parseJsonMaybe(summary?.components_json, []);

  const overallStatus = summary?.overall_status || "fail";
  return {
    ok: overallStatus !== "fail",
    scorecard_key: "platform_health_scorecard",
    overall_status: overallStatus,
    component_count: Number(summary?.component_count || components.length || 0),
    pass_count: Number(summary?.pass_count || 0),
    warn_count: Number(summary?.warn_count || 0),
    fail_count: Number(summary?.fail_count || 0),
    components,
    execution: {
      will_execute_provider_call: false,
      will_read_credential_payload: false,
      will_external_write: false,
      recommendation_only: true,
      readback_only: true,
    },
    secrets_included: Boolean(Number(summary?.secrets_included || 0)),
  };
}
