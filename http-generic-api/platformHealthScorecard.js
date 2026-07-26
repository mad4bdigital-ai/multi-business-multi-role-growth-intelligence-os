import crypto from "node:crypto";
import { getPool } from "./db.js";

function bool(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || ["true", "1", "yes"].includes(String(value).trim().toLowerCase());
}

function boundedInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
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

function noExecutionContract() {
  return {
    will_execute_provider_call: false,
    will_read_credential_payload: false,
    will_external_write: false,
    recommendation_only: true,
    readback_only: true,
  };
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
    execution: noExecutionContract(),
    secrets_included: Boolean(Number(summary?.secrets_included || 0)),
  };
}

export async function recordPlatformHealthScorecardSnapshot(input = {}) {
  const pool = getPool();
  const scorecard = await readPlatformHealthScorecard({ include_components: true });
  const snapshotId = input.snapshot_id || input.snapshotId || crypto.randomUUID();
  const recordedBy = input.recorded_by || input.recordedBy || "platform_health_scorecard_snapshot_record";
  const triggerSource = input.trigger_source || input.triggerSource || "manual_readback";
  const metadata = input.metadata && typeof input.metadata === "object" ? input.metadata : {};
  await pool.query(
    `INSERT INTO platform_health_scorecard_snapshots
       (snapshot_id, scorecard_key, overall_status, component_count, pass_count, warn_count, fail_count,
        components_json, recorded_by, trigger_source, metadata_json, secrets_included)
     VALUES (?, 'platform_health_scorecard', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE
       overall_status=VALUES(overall_status), component_count=VALUES(component_count), pass_count=VALUES(pass_count),
       warn_count=VALUES(warn_count), fail_count=VALUES(fail_count), components_json=VALUES(components_json),
       recorded_by=VALUES(recorded_by), trigger_source=VALUES(trigger_source), metadata_json=VALUES(metadata_json), secrets_included=0`,
    [
      snapshotId,
      scorecard.overall_status,
      scorecard.component_count,
      scorecard.pass_count,
      scorecard.warn_count,
      scorecard.fail_count,
      JSON.stringify(scorecard.components || []),
      recordedBy,
      triggerSource,
      JSON.stringify(metadata),
    ]
  );
  return {
    ok: true,
    snapshot_id: snapshotId,
    scorecard_key: "platform_health_scorecard",
    overall_status: scorecard.overall_status,
    component_count: scorecard.component_count,
    pass_count: scorecard.pass_count,
    warn_count: scorecard.warn_count,
    fail_count: scorecard.fail_count,
    recorded_by: recordedBy,
    trigger_source: triggerSource,
    execution: noExecutionContract(),
    secrets_included: false,
  };
}

export async function readPlatformHealthScorecardRemediationPlan(input = {}) {
  const includePassing = bool(input.include_passing ?? input.includePassing, false);
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT component_key, current_status, display_name, severity_on_fail, remediation_key, remediation_mode,
            recommended_tool_key, recommended_route, can_auto_fix, requires_approval, recommended_action_status,
            evidence_json, secrets_included
       FROM v_platform_health_scorecard_remediation_plan
      WHERE (? = 1 OR current_status <> 'pass')
      ORDER BY FIELD(current_status, 'fail', 'warn', 'pass'), component_key`,
    [includePassing ? 1 : 0]
  );
  return {
    ok: true,
    plan_key: "platform_health_scorecard_remediation_plan",
    include_passing: includePassing,
    item_count: rows.length,
    items: rows.map((row) => ({
      component_key: row.component_key,
      current_status: row.current_status,
      display_name: row.display_name,
      severity_on_fail: row.severity_on_fail,
      remediation_key: row.remediation_key,
      remediation_mode: row.remediation_mode,
      recommended_tool_key: row.recommended_tool_key,
      recommended_route: row.recommended_route,
      can_auto_fix: Boolean(Number(row.can_auto_fix || 0)),
      requires_approval: Boolean(Number(row.requires_approval || 0)),
      recommended_action_status: row.recommended_action_status,
      evidence: parseJsonMaybe(row.evidence_json, {}),
      secrets_included: Boolean(Number(row.secrets_included || 0)),
    })),
    execution: noExecutionContract(),
    secrets_included: false,
  };
}

export async function readPlatformHealthScorecardTenantRollout(input = {}) {
  const status = input.status || null;
  const limit = boundedInt(input.limit, 100, 1, 500);
  const pool = getPool();
  const params = [];
  let where = "";
  if (status) {
    where = "WHERE rollout_status = ?";
    params.push(status);
  }
  params.push(limit);
  const [rows] = await pool.query(
    `SELECT tenant_id, display_name, tenant_type, tenant_status, connected_system_count, active_system_count,
            error_system_count, enabled_tenant_tool_count, system_layer_tool_count, rollout_status,
            evidence_json, secrets_included
       FROM v_platform_health_scorecard_tenant_rollout_readiness
       ${where}
      ORDER BY FIELD(rollout_status, 'provider_attention_required', 'needs_onboarding', 'tenant_not_active', 'ready_or_partially_ready'), display_name
      LIMIT ?`,
    params
  );
  return {
    ok: true,
    rollout_key: "platform_health_scorecard_tenant_rollout_readiness",
    item_count: rows.length,
    items: rows.map((row) => ({
      tenant_id: row.tenant_id,
      display_name: row.display_name,
      tenant_type: row.tenant_type,
      tenant_status: row.tenant_status,
      connected_system_count: Number(row.connected_system_count || 0),
      active_system_count: Number(row.active_system_count || 0),
      error_system_count: Number(row.error_system_count || 0),
      enabled_tenant_tool_count: Number(row.enabled_tenant_tool_count || 0),
      system_layer_tool_count: Number(row.system_layer_tool_count || 0),
      rollout_status: row.rollout_status,
      evidence: parseJsonMaybe(row.evidence_json, {}),
      secrets_included: Boolean(Number(row.secrets_included || 0)),
    })),
    execution: noExecutionContract(),
    secrets_included: false,
  };
}

export async function readPlatformHealthScorecardLedgerHygiene(input = {}) {
  const limit = boundedInt(input.limit, 100, 1, 500);
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT migration_file, migration_checksum_sha256, mode, run_count, first_applied_at, last_applied_at,
            total_preflight_risk_count, secrets_rows, hygiene_status, evidence_json, secrets_included
       FROM v_platform_health_scorecard_ledger_hygiene
      ORDER BY last_applied_at DESC
      LIMIT ?`,
    [limit]
  );
  return {
    ok: true,
    report_key: "platform_health_scorecard_ledger_hygiene_report",
    item_count: rows.length,
    items: rows.map((row) => ({
      migration_file: row.migration_file,
      migration_checksum_sha256: row.migration_checksum_sha256,
      mode: row.mode,
      run_count: Number(row.run_count || 0),
      first_applied_at: row.first_applied_at,
      last_applied_at: row.last_applied_at,
      total_preflight_risk_count: Number(row.total_preflight_risk_count || 0),
      secrets_rows: Number(row.secrets_rows || 0),
      hygiene_status: row.hygiene_status,
      evidence: parseJsonMaybe(row.evidence_json, {}),
      secrets_included: Boolean(Number(row.secrets_included || 0)),
    })),
    execution: noExecutionContract(),
    secrets_included: false,
  };
}
