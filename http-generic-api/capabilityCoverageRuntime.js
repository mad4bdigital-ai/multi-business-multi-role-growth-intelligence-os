const USAGE_STATUSES = Object.freeze([
  "never_retrieved",
  "retrieved_never_selected",
  "selected_never_dispatched",
  "dispatched_never_succeeded",
  "succeeded_not_verified",
  "verified",
]);

async function poolFrom(deps = {}) {
  if (deps.pool) return deps.pool;
  const { getPool } = await import("./db.js");
  return getPool();
}

function normalizedLimit(value) {
  const parsed = Number(value || 100);
  if (!Number.isFinite(parsed)) return 100;
  return Math.max(1, Math.min(Math.trunc(parsed), 250));
}

function validatedKey(value, fieldName) {
  const key = String(value || "").trim();
  if (key && !/^[A-Za-z0-9_.:-]{1,191}$/.test(key)) {
    const error = new Error(`${fieldName} contains unsupported characters.`);
    error.status = 400;
    error.code = `agent_capability_coverage_${fieldName}_invalid`;
    throw error;
  }
  return key;
}

function validatedUsageStatus(value) {
  const status = String(value || "").trim();
  if (status && !USAGE_STATUSES.includes(status)) {
    const error = new Error(`usage_status must be one of: ${USAGE_STATUSES.join(", ")}.`);
    error.status = 400;
    error.code = "agent_capability_coverage_usage_status_invalid";
    throw error;
  }
  return status;
}

function validatedRegistryStatus(value) {
  const status = String(value || "").trim();
  if (status && !/^[a-z0-9_-]{1,32}$/.test(status)) {
    const error = new Error("registry_status contains unsupported characters.");
    error.status = 400;
    error.code = "agent_capability_coverage_registry_status_invalid";
    throw error;
  }
  return status;
}

function numberValue(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function summarizeCapabilityCoverage(rows = []) {
  const usageStatusCounts = Object.fromEntries(USAGE_STATUSES.map((status) => [status, 0]));
  const summary = {
    total: rows.length,
    evidence_event_count: 0,
    retrieval_count: 0,
    selected_count: 0,
    dispatch_count: 0,
    success_count: 0,
    verified_count: 0,
    never_used_count: 0,
    usage_status_counts: usageStatusCounts,
  };
  for (const row of rows) {
    summary.evidence_event_count += numberValue(row.evidence_event_count);
    summary.retrieval_count += numberValue(row.retrieval_count);
    summary.selected_count += numberValue(row.selected_count);
    summary.dispatch_count += numberValue(row.dispatch_count);
    summary.success_count += numberValue(row.success_count);
    summary.verified_count += numberValue(row.verified_count);
    if (row.usage_status in usageStatusCounts) usageStatusCounts[row.usage_status] += 1;
    if (row.usage_status === "never_retrieved") summary.never_used_count += 1;
  }
  return summary;
}

async function readCoverage({ input, deps, viewName, keyColumn, includeRegistryStatus }) {
  const key = validatedKey(input[keyColumn], keyColumn);
  const usageStatus = validatedUsageStatus(input.usage_status);
  const registryStatus = includeRegistryStatus ? validatedRegistryStatus(input.registry_status) : "";
  const where = [];
  const params = [];
  if (key) { where.push(`${keyColumn} = ?`); params.push(key); }
  if (usageStatus) { where.push("usage_status = ?"); params.push(usageStatus); }
  if (registryStatus) { where.push("registry_status = ?"); params.push(registryStatus); }
  const limit = normalizedLimit(input.limit);
  params.push(limit);
  const [rows] = await (await poolFrom(deps)).query(
    `SELECT * FROM ${viewName}
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY usage_status, ${keyColumn}
     LIMIT ?`,
    params
  );
  return {
    rows,
    summary: summarizeCapabilityCoverage(rows),
    filters: {
      [keyColumn]: key || null,
      usage_status: usageStatus || null,
      ...(includeRegistryStatus ? { registry_status: registryStatus || null } : {}),
      limit,
    },
    evidence_contract: {
      source: "capability_invocations",
      lifecycle_stages: ["retrieved", "selected", "dispatched", "succeeded", "verified"],
      inventory_is_not_usage: true,
    },
    secrets_included: false,
  };
}

export async function getLogicRuntimeCoverage(input = {}, deps = {}) {
  return readCoverage({ input, deps, viewName: "v_logic_runtime_coverage", keyColumn: "logic_key", includeRegistryStatus: true });
}

export async function getEngineRuntimeCoverage(input = {}, deps = {}) {
  return readCoverage({ input, deps, viewName: "v_engine_runtime_coverage", keyColumn: "engine_key", includeRegistryStatus: false });
}

export { USAGE_STATUSES };
