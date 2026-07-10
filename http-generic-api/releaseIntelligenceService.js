import crypto, { randomUUID } from "node:crypto";
import { getPool } from "./db.js";

const SENSITIVE_KEY_PATTERN = /(secret|credential|token|password|private_key|cipher|api_key|authorization|cookie|set-cookie)/i;
const VALID_SCOPES = new Set(["admin", "tenant"]);
const VALID_OPERATION_TYPES = new Set(["deploy_release", "restart_app", "rollback_release", "runtime_parity_recovery", "gate_open", "gate_close", "advisory"]);
const VALID_GATE_ACTIONS = new Set(["open", "close", "expire", "hard_disable", "request_open", "request_close"]);

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

function safeString(value, max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeCommitSha(value) {
  const sha = safeString(value, 64).toLowerCase();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : "";
}

function normalizeScope(scope) {
  const value = safeString(scope || "tenant", 24).toLowerCase();
  if (!VALID_SCOPES.has(value)) {
    const err = new Error("scope_type must be admin or tenant.");
    err.status = 400;
    err.code = "invalid_release_scope";
    throw err;
  }
  return value;
}

function normalizeOperationType(value) {
  const type = safeString(value || "runtime_parity_recovery", 64);
  return VALID_OPERATION_TYPES.has(type) ? type : "advisory";
}

function normalizeGateAction(value) {
  const action = safeString(value || "request_open", 32);
  if (!VALID_GATE_ACTIONS.has(action)) {
    const err = new Error("gate action is not supported.");
    err.status = 400;
    err.code = "invalid_release_gate_action";
    throw err;
  }
  return action;
}

function nowIso() {
  return new Date().toISOString();
}

function hashJson(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

async function query(sql, params = []) {
  const [rows] = await getPool().query(sql, params);
  return Array.isArray(rows) ? rows : [];
}

async function execute(sql, params = []) {
  const [result] = await getPool().query(sql, params);
  return result;
}

function assertTenantScope(context = {}, tenantId) {
  if (context.scope_type !== "tenant") return;
  if (!context.tenant_id) {
    const err = new Error("Tenant scope requires a tenant_id.");
    err.status = 401;
    err.code = "tenant_scope_required";
    throw err;
  }
  if (tenantId && tenantId !== context.tenant_id) {
    const err = new Error("Release operation is outside the caller tenant scope.");
    err.status = 403;
    err.code = "tenant_scope_violation";
    throw err;
  }
}

export function classifyReleaseDrift(input = {}) {
  const expected = normalizeCommitSha(input.expected_commit_sha);
  const deployed = normalizeCommitSha(input.deployed_commit_sha);
  if (expected && deployed && expected === deployed) return { classification: "verified", status: "verified", blocking_reasons: [], production_parity: "verified" };
  if (expected && deployed && expected !== deployed) return { classification: "approval_required", status: "approval_required", blocking_reasons: ["deployed_commit_mismatch"], production_parity: "degraded" };
  return { classification: "readback_pending", status: "readback_pending", blocking_reasons: ["commit_evidence_incomplete"], production_parity: "validating" };
}

export function buildReleaseAdvisorPlan(input = {}, context = {}) {
  const scope = normalizeScope(context.scope_type || input.scope_type || "tenant");
  const drift = classifyReleaseDrift(input);
  const targetId = safeString(input.target_id, 128);
  const runtimeFamily = safeString(input.runtime_family || "unknown", 64);
  const operationType = normalizeOperationType(input.operation_type || "runtime_parity_recovery");
  const blockedReasons = [...drift.blocking_reasons];
  if (!targetId) blockedReasons.push("target_id_required");
  if (runtimeFamily === "unknown") blockedReasons.push("runtime_family_required");
  if (scope === "tenant" && !context.tenant_id) blockedReasons.push("tenant_scope_required");
  const approvalRequired = drift.classification !== "verified" || operationType !== "advisory";
  const nextActions = blockedReasons.length ? ["resolve_blocked_reasons", "rerun_release_advisor"] : approvalRequired ? ["create_release_operation", "resolve_capability_envelope", "run_dry_run", "request_approval"] : ["record_verified_operation", "archive_evidence"];
  return stripSensitive({ ok: true, scope, operation_type: operationType, classification: blockedReasons.length ? "blocked" : drift.classification, production_parity: drift.production_parity, approval_required: approvalRequired, target: { target_id: targetId || null, runtime_family: runtimeFamily }, blocked_reasons: [...new Set(blockedReasons)], safe_next_actions: nextActions, required_controls: { capability_envelope: approvalRequired, readback: true, gate_ttl: operationType.includes("gate") || operationType === "deploy_release", no_secret_response: true, tenant_scope_filtering: scope === "tenant", admin_cross_tenant_audit: scope === "admin" }, evidence: { expected_commit_sha: normalizeCommitSha(input.expected_commit_sha) || null, deployed_commit_sha: normalizeCommitSha(input.deployed_commit_sha) || null, generated_at: nowIso(), secrets_included: false }, secrets_included: false });
}

function rowToOperation(row) {
  if (!row) return null;
  return stripSensitive({ operation_id: row.operation_id, scope_type: row.scope_type, tenant_id: row.tenant_id, workspace_id: row.workspace_id, user_id: row.user_id, target_id: row.target_id, runtime_family: row.runtime_family, operation_type: row.operation_type, expected_commit_sha: row.expected_commit_sha, deployed_commit_sha: row.deployed_commit_sha, status: row.status, classification: row.classification, capability_envelope_id: row.capability_envelope_id, approval_hold_id: row.approval_hold_id, latest_verification_run_id: row.latest_verification_run_id, evidence_summary: parseJson(row.evidence_summary_json, {}), created_by: row.created_by, created_at: row.created_at, updated_at: row.updated_at, secrets_included: false });
}

export async function createReleaseOperation(input = {}, context = {}) {
  const scope = normalizeScope(context.scope_type || input.scope_type || "tenant");
  const tenantId = scope === "tenant" ? context.tenant_id : safeString(input.tenant_id || context.tenant_id, 64);
  assertTenantScope({ ...context, scope_type: scope }, tenantId);
  const operationId = safeString(input.operation_id, 64) || randomUUID();
  const operationType = normalizeOperationType(input.operation_type);
  const drift = classifyReleaseDrift(input);
  const status = safeString(input.status || drift.status, 64);
  const classification = safeString(input.classification || drift.classification, 96);
  const evidenceSummary = stripSensitive(input.evidence_summary || buildReleaseAdvisorPlan(input, { ...context, scope_type: scope }));
  await execute(`INSERT INTO release_operations (operation_id, scope_type, tenant_id, workspace_id, user_id, target_id, runtime_family, operation_type, expected_commit_sha, deployed_commit_sha, status, classification, capability_envelope_id, approval_hold_id, latest_verification_run_id, evidence_summary_json, created_by, secrets_included) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`, [operationId, scope, tenantId || null, safeString(input.workspace_id || context.workspace_id, 64) || null, safeString(input.user_id || context.user_id, 64) || null, safeString(input.target_id, 128) || null, safeString(input.runtime_family || "unknown", 64), operationType, normalizeCommitSha(input.expected_commit_sha) || null, normalizeCommitSha(input.deployed_commit_sha) || null, status, classification, safeString(input.capability_envelope_id, 64) || null, safeString(input.approval_hold_id, 64) || null, safeString(input.latest_verification_run_id, 64) || null, JSON.stringify(evidenceSummary), safeString(context.user_id || input.created_by || "release_intelligence", 191)]);
  await appendReleaseOperationStep(operationId, { step_key: "operation_created", step_status: status, classification, detail: evidenceSummary }, { ...context, scope_type: scope });
  return getReleaseOperation(operationId, { ...context, scope_type: scope });
}

export async function getReleaseOperation(operationId, context = {}) {
  const scope = normalizeScope(context.scope_type || "tenant");
  const params = [operationId];
  let where = "operation_id = ?";
  if (scope === "tenant") { where += " AND tenant_id = ?"; params.push(context.tenant_id); }
  const rows = await query(`SELECT * FROM release_operations WHERE ${where} LIMIT 1`, params);
  if (!rows.length) return null;
  const operation = rowToOperation(rows[0]);
  const [steps, gates, evidence] = await Promise.all([query("SELECT step_id, step_key, step_status, classification, detail_json, created_at FROM release_operation_steps WHERE operation_id = ? ORDER BY id ASC LIMIT 100", [operationId]), query("SELECT gate_event_id, gate_key, action, ttl_minutes, reason, status, readback_status, verification_run_id, created_at FROM release_gate_events WHERE operation_id = ? ORDER BY id ASC LIMIT 100", [operationId]), query("SELECT evidence_id, surface_key, evidence_type, evidence_sha256, payload_preview_json, created_at FROM release_operation_evidence WHERE operation_id = ? ORDER BY id ASC LIMIT 100", [operationId])]);
  return stripSensitive({ ...operation, steps: steps.map((row) => ({ ...row, detail_json: parseJson(row.detail_json, {}) })), gate_events: gates, evidence: evidence.map((row) => ({ ...row, payload_preview_json: parseJson(row.payload_preview_json, {}) })), secrets_included: false });
}

export async function listReleaseOperations(options = {}, context = {}) {
  const scope = normalizeScope(context.scope_type || options.scope_type || "tenant");
  const limit = Math.min(Math.max(Number(options.limit || 25), 1), 100);
  const offset = Math.max(Number(options.cursor || 0), 0);
  const params = [];
  const where = [];
  if (scope === "tenant") { where.push("tenant_id = ?"); params.push(context.tenant_id); } else if (options.tenant_id) { where.push("tenant_id = ?"); params.push(safeString(options.tenant_id, 64)); }
  if (options.status) { where.push("status = ?"); params.push(safeString(options.status, 64)); }
  params.push(limit + 1, offset);
  const rows = await query(`SELECT * FROM release_operations ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`, params);
  const hasMore = rows.length > limit;
  return { items: rows.slice(0, limit).map(rowToOperation), page: { hasMore, nextCursor: hasMore ? String(offset + limit) : null }, secrets_included: false };
}

export async function appendReleaseOperationStep(operationId, step = {}, context = {}) {
  const operation = await getReleaseOperation(operationId, context.scope_type ? context : { ...context, scope_type: "admin" });
  if (!operation) { const err = new Error("Release operation was not found."); err.status = 404; err.code = "release_operation_not_found"; throw err; }
  const detail = stripSensitive(step.detail || step.detail_json || {});
  const stepId = safeString(step.step_id, 64) || randomUUID();
  await execute(`INSERT INTO release_operation_steps (step_id, operation_id, step_key, step_status, classification, detail_json, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`, [stepId, operationId, safeString(step.step_key || "manual_step", 128), safeString(step.step_status || "recorded", 64), safeString(step.classification || step.step_status || "recorded", 96), JSON.stringify(detail), safeString(context.user_id || "release_intelligence", 191)]);
  await execute("UPDATE release_operations SET status = ?, classification = ?, updated_at = CURRENT_TIMESTAMP WHERE operation_id = ?", [safeString(step.step_status || operation.status, 64), safeString(step.classification || operation.classification, 96), operationId]);
  return getReleaseOperation(operationId, context.scope_type ? context : { ...context, scope_type: "admin" });
}

export async function createReleaseGateEvent(input = {}, context = {}) {
  const operationId = safeString(input.operation_id, 64);
  if (!operationId) { const err = new Error("operation_id is required."); err.status = 400; err.code = "operation_id_required"; throw err; }
  const operation = await getReleaseOperation(operationId, context.scope_type ? context : { ...context, scope_type: "admin" });
  if (!operation) { const err = new Error("Release operation was not found for this scope."); err.status = 404; err.code = "release_operation_not_found"; throw err; }
  const gateEventId = safeString(input.gate_event_id, 64) || randomUUID();
  const action = normalizeGateAction(input.action);
  const ttl = Math.min(Math.max(Number(input.ttl_minutes || 30), 1), 240);
  const readbackStatus = action === "close" || action === "hard_disable" ? "required" : "pending";
  await execute(`INSERT INTO release_gate_events (gate_event_id, operation_id, gate_key, action, ttl_minutes, reason, capability_envelope_id, verification_run_id, status, readback_status, created_by, secrets_included) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'recorded', ?, ?, 0)`, [gateEventId, operationId, safeString(input.gate_key || "runtime_executor_gate", 128), action, ttl, safeString(input.reason || "release_intelligence_gate_event", 1000), safeString(input.capability_envelope_id, 64) || operation.capability_envelope_id || null, safeString(input.verification_run_id, 64) || operation.latest_verification_run_id || null, readbackStatus, safeString(context.user_id || "release_intelligence", 191)]);
  await appendReleaseOperationStep(operationId, { step_key: `gate_${action}`, step_status: action.includes("close") || action === "hard_disable" ? "cleanup_pending" : "approval_required", classification: `gate_${action}_recorded`, detail: { gate_event_id: gateEventId, gate_key: input.gate_key, action, ttl_minutes: ttl, secrets_included: false } }, context);
  return getReleaseOperation(operationId, context.scope_type ? context : { ...context, scope_type: "admin" });
}

export async function recordReleaseEvidence(operationId, surfaceKey, payload = {}, context = {}) {
  const operation = await getReleaseOperation(operationId, context.scope_type ? context : { ...context, scope_type: "admin" });
  if (!operation) { const err = new Error("Release operation was not found."); err.status = 404; err.code = "release_operation_not_found"; throw err; }
  const safePayload = stripSensitive(payload);
  const evidenceId = randomUUID();
  await execute(`INSERT INTO release_operation_evidence (evidence_id, operation_id, surface_key, evidence_type, evidence_sha256, payload_preview_json, payload_ref, secrets_included) VALUES (?, ?, ?, 'inline_preview', ?, ?, NULL, 0)`, [evidenceId, operationId, safeString(surfaceKey || "release_intelligence", 128), hashJson(safePayload), JSON.stringify(safePayload)]);
  return { evidence_id: evidenceId, evidence_sha256: hashJson(safePayload), secrets_included: false };
}

export async function runReleaseAdvisor(input = {}, context = {}) {
  let parity = null;
  if (!input.expected_commit_sha && !input.deployed_commit_sha && context.scope_type === "admin") {
    const rows = await query("SELECT expected_commit_sha, deployed_commit_sha, production_parity, latest_run_id FROM runtime_deployment_parity_status WHERE environment_key = ? LIMIT 1", [safeString(input.environment_key || "production", 64)]);
    parity = rows[0] || null;
  }
  const planInput = { ...input, expected_commit_sha: input.expected_commit_sha || parity?.expected_commit_sha, deployed_commit_sha: input.deployed_commit_sha || parity?.deployed_commit_sha };
  const plan = buildReleaseAdvisorPlan(planInput, context);
  let operation = null;
  if (input.create_operation === true) operation = await createReleaseOperation({ ...planInput, operation_type: plan.operation_type, status: plan.classification, classification: plan.classification, latest_verification_run_id: input.latest_verification_run_id || parity?.latest_run_id, evidence_summary: plan }, context);
  return stripSensitive({ ok: true, advisor: plan, parity_source: parity ? "runtime_deployment_parity_status" : "request", operation, secrets_included: false });
}
