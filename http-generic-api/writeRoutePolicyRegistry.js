import { createHash } from "node:crypto";
import { getPool } from "./db.js";

const MODES = new Set(["shadow", "staging", "production-canary", "production-live"]);
const ENVIRONMENTS = new Set(["staging", "production"]);

function text(value) { return String(value ?? "").trim(); }
function bool(value) { return Number(value) === 1 || value === true; }
function safeJson(value, fallback = {}) {
  if (value && typeof value === "object") return value;
  try { return value ? JSON.parse(String(value)) : fallback; } catch { return fallback; }
}
function hash(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function requestedEnvironment(value) {
  const candidate = text(value).toLowerCase();
  return ENVIRONMENTS.has(candidate) ? candidate : "staging";
}
function requestedMode(value) {
  const candidate = text(value).toLowerCase();
  return MODES.has(candidate) ? candidate : "shadow";
}

export function normalizeWriteRoutePolicy(row = {}) {
  const environment = requestedEnvironment(row.environment);
  const mode = requestedMode(row.mode);
  const enabled = bool(row.enabled);
  const allowlisted = bool(row.allowlisted);
  const approvalRequired = row.approval_required === undefined ? true : bool(row.approval_required);
  const promotionMode = mode === "production-canary" || mode === "production-live";
  const safeEnabled = enabled && allowlisted && approvalRequired && !promotionMode;
  return {
    policy_id: Number(row.policy_id || 0),
    route_id: text(row.route_id),
    bundle: text(row.bundle),
    risk_class: text(row.risk_class) || "unknown",
    environment,
    mode,
    status: text(row.status) || "draft",
    enabled: safeEnabled,
    allowlisted,
    approval_required: approvalRequired,
    approved_by: text(row.approved_by) || null,
    approved_at: row.approved_at || null,
    ttl_seconds: row.ttl_seconds == null ? null : Number(row.ttl_seconds),
    quota_limit: row.quota_limit == null ? null : Number(row.quota_limit),
    lease_seconds: row.lease_seconds == null ? null : Number(row.lease_seconds),
    rollback_policy: safeJson(row.rollback_policy_json),
    readback_policy: safeJson(row.readback_policy_json),
    kill_switch_key: text(row.kill_switch_key),
    policy_version: Number(row.policy_version || 1),
    policy_hash: text(row.policy_hash) || hash({ route_id: text(row.route_id), environment, mode, policy_version: Number(row.policy_version || 1) }),
    updated_at: row.updated_at || null,
    secrets_included: false,
  };
}

const SELECT_COLUMNS = `policy_id, route_id, bundle, risk_class, environment, mode, status,
  enabled, allowlisted, approval_required, approved_by, approved_at, ttl_seconds,
  quota_limit, lease_seconds, rollback_policy_json, readback_policy_json,
  kill_switch_key, policy_version, policy_hash, updated_at`;

export async function resolveWriteRoutePolicy({ routeId, environment = "staging", mode = "shadow" } = {}, deps = {}) {
  const route = text(routeId);
  const scope = requestedEnvironment(environment);
  const requested = requestedMode(mode);
  if (!route) return { ok: false, reason_code: "write_route_policy_route_id_required", environment: scope, mode: requested, policy: null, secrets_included: false };
  const pool = deps.pool || getPool();
  try {
    const [rows] = await pool.query(
      `SELECT ${SELECT_COLUMNS} FROM write_route_policy_registry
        WHERE route_id = ? AND environment = ?`,
      [route, scope],
    );
    if (!rows?.length) return { ok: false, reason_code: "write_route_policy_not_found", environment: scope, mode: requested, policy: null, secrets_included: false };
    if (rows.length > 1) return { ok: false, reason_code: "write_route_policy_ambiguous", environment: scope, mode: requested, policy: null, candidate_count: rows.length, secrets_included: false };
    const [policyRow] = rows;
    const policy = normalizeWriteRoutePolicy(policyRow);
    if (policy.mode !== requested) return { ok: false, reason_code: "write_route_policy_mode_mismatch", environment: scope, mode: requested, policy, secrets_included: false };
    if (policy.environment === "production" || requested.startsWith("production-")) {
      return { ok: false, reason_code: "production_write_route_activation_requires_separate_promotion", environment: scope, mode: requested, policy: { ...policy, enabled: false }, secrets_included: false };
    }
    if (!policy.enabled || policy.status !== "active") return { ok: false, reason_code: "write_route_policy_not_active", environment: scope, mode: requested, policy, secrets_included: false };
    return { ok: true, reason_code: null, environment: scope, mode: requested, policy, secrets_included: false };
  } catch (error) {
    if (/doesn't exist|ER_NO_SUCH_TABLE|unknown table/i.test(String(error?.message || ""))) {
      return { ok: false, reason_code: "write_route_policy_registry_not_migrated", environment: scope, mode: requested, policy: null, secrets_included: false };
    }
    throw error;
  }
}

export async function listWriteRoutePolicies({ environment = "staging", mode = "shadow", status = null } = {}, deps = {}) {
  const scope = requestedEnvironment(environment);
  const requested = requestedMode(mode);
  const pool = deps.pool || getPool();
  const params = [scope, requested];
  const statusClause = status ? " AND status = ?" : "";
  if (status) params.push(text(status));
  try {
    const [rows] = await pool.query(
      `SELECT ${SELECT_COLUMNS} FROM write_route_policy_registry
        WHERE environment = ? AND mode = ?${statusClause} ORDER BY route_id`,
      params,
    );
    const policies = (rows || []).map(normalizeWriteRoutePolicy);
    return { ok: true, environment: scope, mode: requested, policies, policy_count: policies.length, registry_revision: hash(policies), secrets_included: false };
  } catch (error) {
    if (/doesn't exist|ER_NO_SUCH_TABLE|unknown table/i.test(String(error?.message || ""))) {
      return { ok: false, reason_code: "write_route_policy_registry_not_migrated", environment: scope, mode: requested, policies: [], policy_count: 0, secrets_included: false };
    }
    throw error;
  }
}
