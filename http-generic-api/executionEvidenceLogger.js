import { getPool } from "./db.js";
import { assertSurfaceAuthority, SURFACE_KEYS } from "./surfaceAuthorityResolver.js";

function isoNow() {
  return new Date().toISOString();
}

function sqlDate(iso) {
  return String(iso || isoNow()).slice(0, 10);
}

function compact(value = "", max = 1000) {
  return String(value ?? "").slice(0, max);
}

function safeJson(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? { secrets_included: false });
  } catch {
    return JSON.stringify({ ok: false, serialization_error: "output_summary_json_failed", secrets_included: false });
  }
}

async function safeQuery(pool, sql, params = []) {
  try {
    const [rows] = await pool.query(sql, params);
    return rows || [];
  } catch (err) {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(err?.code)) return [];
    throw err;
  }
}

export async function writeExecutionEvidence({
  pool = getPool(),
  traceId,
  entryType,
  executionClass,
  sourceLayer,
  userInput = "",
  routeKeys = "",
  selectedWorkflows = "",
  executionMode = "runtime_evidence",
  decisionTrigger = "runtime",
  executionStatus = "success",
  outputSummary = { secrets_included: false },
  recoveryStatus = "not_required",
  routeStatus = "resolved",
  routeSource = "sql_primary",
  intakeValidationStatus = "validated",
  executionReadyStatus = "ready",
  logSource = "sql_primary",
  createdAt = null,
  endedAt = null,
  durationSeconds = null,
  recoveryNotes = null,
  failureReason = null,
  artifactJsonAssetId = null,
  targetModuleWriteback = null,
  targetWorkflowWriteback = null,
  skipSurfaceAuthority = false,
} = {}) {
  if (!traceId) {
    const err = new Error("traceId is required for execution evidence logging.");
    err.status = 400;
    err.code = "missing_execution_trace_id";
    throw err;
  }
  if (!entryType) {
    const err = new Error("entryType is required for execution evidence logging.");
    err.status = 400;
    err.code = "missing_execution_entry_type";
    throw err;
  }

  let surfaceAuthority = null;
  if (skipSurfaceAuthority !== true) {
    surfaceAuthority = await assertSurfaceAuthority(
      SURFACE_KEYS.EXECUTION_LOG,
      { requireExecution: true },
      { pool }
    );
  }

  const now = createdAt || isoNow();
  const end = endedAt || now;
  const output = typeof outputSummary === "object" && outputSummary !== null && !Array.isArray(outputSummary)
    ? { ...outputSummary, secrets_included: outputSummary.secrets_included === true ? true : false }
    : outputSummary;

  await pool.query(
    `INSERT INTO execution_log
       (run_date, start_time, end_time, duration_seconds,
        entry_type, execution_class, source_layer, user_input,
        route_keys, selected_workflows, execution_mode, decision_trigger,
        execution_status, output_summary, recovery_status, recovery_notes,
        route_status, route_source, intake_validation_status, execution_ready_status,
        failure_reason, artifact_json_asset_id, target_module_writeback,
        target_workflow_writeback, execution_trace_id_writeback,
        log_source_writeback, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
    [
      sqlDate(now),
      now,
      end,
      durationSeconds === null || durationSeconds === undefined ? null : String(durationSeconds),
      compact(entryType, 255),
      compact(executionClass, 255),
      compact(sourceLayer, 255),
      compact(userInput, 1000),
      compact(routeKeys, 1000),
      compact(selectedWorkflows, 1000),
      compact(executionMode, 255),
      compact(decisionTrigger, 255),
      compact(executionStatus, 255),
      safeJson(output),
      compact(recoveryStatus, 255),
      recoveryNotes === null || recoveryNotes === undefined ? null : compact(recoveryNotes, 1000),
      compact(routeStatus, 255),
      compact(routeSource, 255),
      compact(intakeValidationStatus, 255),
      compact(executionReadyStatus, 255),
      failureReason === null || failureReason === undefined ? null : compact(failureReason, 1000),
      artifactJsonAssetId === null || artifactJsonAssetId === undefined ? null : compact(artifactJsonAssetId, 255),
      targetModuleWriteback === null || targetModuleWriteback === undefined ? null : compact(targetModuleWriteback, 255),
      targetWorkflowWriteback === null || targetWorkflowWriteback === undefined ? null : compact(targetWorkflowWriteback, 255),
      compact(traceId, 255),
      compact(logSource, 255),
    ]
  );

  const rows = await safeQuery(
    pool,
    `SELECT id, execution_status, execution_trace_id_writeback
       FROM execution_log
      WHERE execution_trace_id_writeback = ?
      ORDER BY id DESC
      LIMIT 1`,
    [traceId]
  );

  return {
    ok: Boolean(rows[0]),
    row: rows[0] || null,
    trace_id: traceId,
    surface_authority: surfaceAuthority ? {
      ok: surfaceAuthority.ok,
      resolved_surface_key: surfaceAuthority.resolved_surface_key,
      classification: surfaceAuthority.classification,
      code: surfaceAuthority.code,
    } : { skipped: true },
    secrets_included: false,
  };
}
