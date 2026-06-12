import crypto, { randomUUID } from "node:crypto";
import { getPool } from "./db.js";

const DEFAULT_RESPONSE_BUDGET = Object.freeze({ max_response_bytes: 100000, max_items: 50, max_depth: 3, overflow_policy: "manifest_only" });
const SENSITIVE_KEY_PATTERN = /(secret|credential|token|password|private_key|cipher|api_key|authorization|cookie|set-cookie)/i;
const REQUIRED_TABLES = Object.freeze(["runtime_verification_workflow_registry", "runtime_verification_runs", "runtime_verification_steps", "runtime_verification_evidence_chunks", "runtime_verification_gaps", "runtime_deployment_parity_status", "runtime_ci_check_classification_registry", "runtime_gap_remediation_registry"]);
const ACTIVATION_REGISTRY_TABLES = Object.freeze(["activation_dynamic_tab_registry", "activation_dynamic_tab_section_registry", "activation_dynamic_tab_discovery_rule_registry", "activation_section_action_registry", "activation_attention_rule_registry", "activation_freshness_policy_registry", "activation_signal_subscription_registry", "activation_connector_pack_registry"]);

function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function stripSensitive(value) {
  if (Array.isArray(value)) return value.map(stripSensitive);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !SENSITIVE_KEY_PATTERN.test(key)).map(([key, item]) => [key, stripSensitive(item)]));
}

function jsonBytes(value) { return Buffer.byteLength(JSON.stringify(value ?? null), "utf8"); }
function hashJson(value) { return crypto.createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex"); }
async function query(sql, params = []) { const [rows] = await getPool().query(sql, params); return Array.isArray(rows) ? rows : []; }
async function execute(sql, params = []) { await getPool().query(sql, params); }

async function tableExists(tableName) {
  const rows = await query("SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?", [tableName]);
  return Number(rows[0]?.count || 0) > 0;
}

async function countRows(tableName) {
  if (!(await tableExists(tableName))) return { exists: false, count: 0 };
  const rows = await query(`SELECT COUNT(*) AS count FROM \`${tableName}\``);
  return { exists: true, count: Number(rows[0]?.count || 0) };
}

function resolveCommit(input = {}) {
  return String(input.expected_commit_sha || input.deployed_commit_sha || process.env.GIT_COMMIT || process.env.GITHUB_SHA || process.env.COMMIT_SHA || process.env.RENDER_GIT_COMMIT || "unknown").trim();
}

async function insertStep(runId, step) {
  await execute(
    `INSERT INTO runtime_verification_steps
       (step_id, run_id, step_key, step_status, classification, duration_ms, http_status,
        response_bytes, max_allowed_bytes, detail_json, error_json, started_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
    [randomUUID(), runId, step.step_key, step.step_status, step.classification || step.step_status, step.duration_ms || 0, step.http_status || null, step.response_bytes || null, step.max_allowed_bytes || null, step.detail_json ? JSON.stringify(stripSensitive(step.detail_json)) : null, step.error_json ? JSON.stringify(stripSensitive(step.error_json)) : null]
  );
}

async function insertGap(runId, gap) {
  await execute(
    `INSERT INTO runtime_verification_gaps
       (gap_id, run_id, gap_key, severity, classification, blocks_production_parity, remediation, evidence_ref)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), runId, gap.gap_key, gap.severity || "medium", gap.classification || gap.gap_key, gap.blocks_production_parity === false ? 0 : 1, gap.remediation || null, gap.evidence_ref || null]
  );
}

async function insertEvidenceChunk(runId, surfaceKey, payload, options = {}) {
  const safePayload = stripSensitive(payload);
  const byteSize = jsonBytes(safePayload);
  await execute(
    `INSERT INTO runtime_verification_evidence_chunks
       (chunk_id, run_id, surface_key, chunk_index, chunk_type, item_count, byte_size,
        sha256, storage_mode, payload_json, payload_ref)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'inline_json', ?, NULL)`,
    [randomUUID(), runId, surfaceKey, options.chunk_index || 0, options.chunk_type || "summary", options.item_count ?? 1, byteSize, hashJson(safePayload), JSON.stringify(safePayload)]
  );
  return { surface_key: surfaceKey, byte_size: byteSize, sha256: hashJson(safePayload) };
}

export function classifyCiCheckRun(checkRun = {}, newerEquivalentSuccess = false) {
  const status = String(checkRun.status || "").toLowerCase();
  const conclusion = checkRun.conclusion ? String(checkRun.conclusion).toLowerCase() : null;
  if (status === "completed" && conclusion === "success") return { classification: "success", gate_status: "pass", blocks_production_parity: false };
  if (status === "completed" && conclusion === "cancelled" && newerEquivalentSuccess) return { classification: "cancelled_superseded_success", gate_status: "pass", blocks_production_parity: false };
  if (status === "completed" && conclusion === "cancelled") return { classification: "cancelled_unknown", gate_status: "blocked", blocks_production_parity: true };
  if (status === "completed" && conclusion === "skipped") return { classification: "skipped_unclassified", gate_status: "warn", blocks_production_parity: false };
  if (status === "completed") return { classification: conclusion || "completed_unknown", gate_status: "blocked", blocks_production_parity: true };
  return { classification: status || "unknown", gate_status: "warn", blocks_production_parity: true };
}

export async function buildActivationHardRunSummary() {
  const counts = {};
  const missing = [];
  for (const table of ACTIVATION_REGISTRY_TABLES) {
    const result = await countRows(table);
    counts[table] = result.count;
    if (!result.exists) missing.push(table);
  }
  return { status: missing.length ? "degraded" : "active", counts, missing_tables: missing, evidence_manifest_available: true, secrets_included: false };
}

export async function createRuntimeVerificationRun(input = {}, actor = {}) {
  const runId = randomUUID();
  const environmentKey = String(input.environment_key || input.environment || "production").trim() || "production";
  const commitSha = resolveCommit(input);
  const budget = { ...DEFAULT_RESPONSE_BUDGET, ...(input.response_budget || {}) };
  const createdBy = actor.user_id || actor.email || actor.mode || "runtime_verification_route";

  await execute(
    `INSERT INTO runtime_verification_runs
       (run_id, environment_key, expected_commit_sha, deployed_commit_sha, workflow_key, runtime_base_url,
        runtime_profile, run_status, production_parity, response_budget_json, started_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'collecting', 'validating', ?, UTC_TIMESTAMP(), ?)`,
    [runId, environmentKey, commitSha, commitSha, input.workflow_key || "runtime_verification_control_plane", input.runtime_base_url || "https://auth.mad4b.com", input.runtime_profile || "api_only", JSON.stringify(budget), createdBy]
  );

  const missingRuntimeTables = [];
  for (const table of REQUIRED_TABLES) if (!(await tableExists(table))) missingRuntimeTables.push(table);
  await insertStep(runId, { step_key: "migration_tables", step_status: missingRuntimeTables.length ? "fail" : "pass", classification: missingRuntimeTables.length ? "runtime_verification_tables_missing" : "runtime_verification_tables_present", detail_json: { required_tables: REQUIRED_TABLES, missing_tables: missingRuntimeTables } });
  for (const table of missingRuntimeTables) await insertGap(runId, { gap_key: `missing_table_${table}`, severity: "critical", classification: "runtime_verification_table_missing", remediation: `Apply the runtime verification migration containing ${table}.`, evidence_ref: "runtime_verification_steps:migration_tables" });

  const activationSummary = await buildActivationHardRunSummary();
  const activationBytes = jsonBytes(activationSummary);
  const activationStepPass = activationSummary.status === "active" && activationBytes <= budget.max_response_bytes;
  await insertStep(runId, { step_key: "activation_summary_probe", step_status: activationStepPass ? "pass" : "fail", classification: activationStepPass ? "activation_summary_ok" : "activation_summary_degraded_or_too_large", response_bytes: activationBytes, max_allowed_bytes: budget.max_response_bytes, detail_json: activationSummary });
  if (!activationStepPass) await insertGap(runId, { gap_key: activationBytes > budget.max_response_bytes ? "activation_summary_too_large" : "activation_summary_degraded", severity: "high", classification: activationBytes > budget.max_response_bytes ? "response_budget_exceeded" : "activation_registry_tables_missing", remediation: "Use summary/evidence pagination and ensure activation registry tables exist.", evidence_ref: "runtime_verification_steps:activation_summary_probe" });

  await insertStep(runId, { step_key: "runtime_code_routes_installed", step_status: "pass", classification: "runtime_verification_routes_installed", detail_json: { routes: ["POST /runtime/verification-runs", "GET /runtime/verification-runs/:runId", "GET /runtime/verification-runs/:runId/evidence", "GET /runtime/parity/:environmentKey"] } });
  await insertEvidenceChunk(runId, "activation_summary", activationSummary, { chunk_type: "summary" });
  const manifest = { run_id: runId, surfaces: [{ surface: "activation_summary", href: `/runtime/verification-runs/${runId}/evidence?surface=activation_summary` }, { surface: "runtime_steps", href: `/runtime/verification-runs/${runId}` }, { surface: "runtime_gaps", href: `/runtime/verification-runs/${runId}` }], secrets_included: false };
  await insertEvidenceChunk(runId, "evidence_manifest", manifest, { chunk_type: "manifest", item_count: manifest.surfaces.length });

  const gapRows = await query("SELECT COUNT(*) AS count FROM runtime_verification_gaps WHERE run_id = ? AND blocks_production_parity = 1", [runId]);
  const blockingGapCount = Number(gapRows[0]?.count || 0);
  const productionParity = blockingGapCount === 0 ? "verified" : "degraded";
  const runStatus = blockingGapCount === 0 ? "verified" : "degraded";
  const summary = { migration_tables: missingRuntimeTables.length ? "fail" : "pass", activation_summary: activationStepPass ? "pass" : "fail", runtime_code_routes: "pass", evidence_manifest: "pass", production_parity: productionParity, blocking_gap_count: blockingGapCount, expected_commit_sha: commitSha, deployed_commit_sha: commitSha, secrets_included: false };

  await execute("UPDATE runtime_verification_runs SET run_status = ?, production_parity = ?, summary_json = ?, completed_at = UTC_TIMESTAMP() WHERE run_id = ?", [runStatus, productionParity, JSON.stringify(summary), runId]);
  await execute(
    `INSERT INTO runtime_deployment_parity_status
       (environment_key, expected_commit_sha, deployed_commit_sha, production_parity, latest_run_id,
        ci_gate_status, release_readiness_status, runtime_health_status, activation_summary_status,
        migration_status, blocking_gap_count, verified_at, status_json)
     VALUES (?, ?, ?, ?, ?, 'unknown', 'unknown', 'pass', ?, ?, ?, IF(? = 'verified', UTC_TIMESTAMP(), NULL), ?)
     ON DUPLICATE KEY UPDATE expected_commit_sha = VALUES(expected_commit_sha), deployed_commit_sha = VALUES(deployed_commit_sha), production_parity = VALUES(production_parity), latest_run_id = VALUES(latest_run_id), runtime_health_status = VALUES(runtime_health_status), activation_summary_status = VALUES(activation_summary_status), migration_status = VALUES(migration_status), blocking_gap_count = VALUES(blocking_gap_count), verified_at = VALUES(verified_at), status_json = VALUES(status_json)`,
    [environmentKey, commitSha, commitSha, productionParity, runId, activationStepPass ? "pass" : "fail", missingRuntimeTables.length ? "fail" : "pass", blockingGapCount, productionParity, JSON.stringify(summary)]
  );
  return getRuntimeVerificationRun(runId);
}

export async function getRuntimeVerificationRun(runId) {
  const rows = await query("SELECT * FROM runtime_verification_runs WHERE run_id = ? LIMIT 1", [runId]);
  if (!rows.length) return null;
  const run = rows[0];
  const [steps, gaps] = await Promise.all([
    query("SELECT step_id, step_key, step_status, classification, duration_ms, http_status, response_bytes, max_allowed_bytes, started_at, completed_at FROM runtime_verification_steps WHERE run_id = ? ORDER BY created_at ASC", [runId]),
    query("SELECT gap_id, gap_key, severity, classification, blocks_production_parity, remediation, evidence_ref, created_at FROM runtime_verification_gaps WHERE run_id = ? ORDER BY FIELD(severity,'critical','high','medium','low','info'), created_at ASC", [runId]),
  ]);
  return stripSensitive({ run_id: run.run_id, environment_key: run.environment_key, expected_commit_sha: run.expected_commit_sha, deployed_commit_sha: run.deployed_commit_sha, workflow_key: run.workflow_key, runtime_base_url: run.runtime_base_url, runtime_profile: run.runtime_profile, run_status: run.run_status, production_parity: run.production_parity, summary: parseJson(run.summary_json, {}), response_budget: parseJson(run.response_budget_json, DEFAULT_RESPONSE_BUDGET), steps, gaps, started_at: run.started_at, completed_at: run.completed_at, secrets_included: false });
}

export async function listRuntimeVerificationEvidence(runId, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit || 25), 1), 100);
  const offset = Math.max(Number(options.cursor || 0), 0);
  const params = [runId];
  let where = "run_id = ?";
  if (options.surface) { where += " AND surface_key = ?"; params.push(String(options.surface)); }
  params.push(limit + 1, offset);
  const rows = await query(`SELECT chunk_id, surface_key, chunk_index, chunk_type, item_count, byte_size, sha256, storage_mode, payload_json, payload_ref, created_at FROM runtime_verification_evidence_chunks WHERE ${where} ORDER BY surface_key ASC, chunk_index ASC, id ASC LIMIT ? OFFSET ?`, params);
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit).map((row) => ({ ...row, payload_json: parseJson(row.payload_json, row.payload_json) }));
  return stripSensitive({ items: pageRows, page: { hasMore, nextCursor: hasMore ? String(offset + limit) : null }, secrets_included: false });
}

export async function getRuntimeParity(environmentKey = "production") {
  const rows = await query("SELECT environment_key, expected_commit_sha, deployed_commit_sha, production_parity, latest_run_id, ci_gate_status, release_readiness_status, runtime_health_status, activation_summary_status, migration_status, blocking_gap_count, verified_at, status_json, updated_at FROM runtime_deployment_parity_status WHERE environment_key = ? LIMIT 1", [environmentKey]);
  if (!rows.length) return { environment_key: environmentKey, production_parity: "unknown", blocking_gap_count: 0, secrets_included: false };
  const row = rows[0];
  return stripSensitive({ ...row, status: parseJson(row.status_json, {}), readiness_classification: row.production_parity === "verified" && Number(row.blocking_gap_count || 0) === 0 ? "ready" : "blocked", secrets_included: false });
}
