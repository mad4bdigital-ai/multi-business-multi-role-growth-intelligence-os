import { getPool } from "./db.js";

const ACTIVE_WORKFLOW_SQL =
  "(active = 1 OR active = '1' OR active = 'TRUE' OR status IN ('active', 'ready', 'enabled', 'beta'))";

function compactCandidates(rows = []) {
  return rows.slice(0, 10).map((row) => ({
    workflow_id: row.workflow_id || null,
    workflow_key: row.workflow_key || null,
    target_module: row.target_module || null,
    execution_class: row.execution_class || null,
  }));
}

function failed(code, message, identity, rows = []) {
  return {
    ok: false,
    workflow: null,
    resolution: {
      code,
      message,
      requested_workflow_id: identity.workflow_id || null,
      requested_workflow_key: identity.workflow_key || null,
      candidate_count: rows.length,
      candidates: compactCandidates(rows),
      secrets_included: false,
    },
  };
}
export async function resolveRuntimeWorkflow({
  pool = getPool(),
  workflow_id = null,
  workflow_key = null,
} = {}) {
  const identity = {
    workflow_id: String(workflow_id || "").trim() || null,
    workflow_key: String(workflow_key || "").trim() || null,
  };

  if (!identity.workflow_id && !identity.workflow_key) {
    return failed(
      "workflow_identity_missing",
      "A workflow_id or workflow_key is required for runtime resolution.",
      identity
    );
  }

  const column = identity.workflow_id ? "workflow_id" : "workflow_key";
  const value = identity.workflow_id || identity.workflow_key;
  const [rows] = await pool.query(
    `SELECT *
       FROM \`workflows\`
      WHERE ${column} = ?
        AND ${ACTIVE_WORKFLOW_SQL}
      ORDER BY workflow_id ASC
      LIMIT 2`,
    [value]
  );

  if (!rows.length) {
    return failed(
      "workflow_not_found",
      `No active workflow matched ${column} '${value}'.`,
      identity
    );
  }

  if (rows.length > 1) {
    return failed(
      "workflow_ambiguous",
      `Multiple active workflows matched ${column} '${value}'. Provide an explicit workflow_id.`,
      identity,
      rows
    );
  }

  const workflow = rows[0];
  return {
    ok: true,
    workflow,
    resolution: {
      code: "workflow_resolved",
      matched_by: column,
      workflow_id: workflow.workflow_id || null,
      workflow_key: workflow.workflow_key || null,
      candidate_count: 1,
      secrets_included: false,
    },
  };
}
