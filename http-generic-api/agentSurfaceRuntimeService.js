import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { agentSurfaceCatalog, getAgentSurfaceDefinition, normalizeAgentSurfaceKey, normalizeAgentSurfaceMode, normalizeAgentSurfacePreferences } from "./agentSurfacePolicy.js";
function json(value, fallback = {}) { if (!value) return fallback; if (typeof value === "object") return value; try { return JSON.parse(String(value)); } catch { return fallback; } }
function error(status, code, message) { const err = new Error(message); err.status = status; err.code = code; return err; }
async function withTransaction(pool, marker, work) {
  if (!pool || typeof pool.getConnection !== "function") return work(pool);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (cause) {
    await connection.rollback();
    throw cause;
  } finally {
    connection.release();
  }
}
async function platformRuntime(pool, key) { if (!key) return null; const [rows] = await pool.query("SELECT runtime_key, display_name, runtime_type, provider_key, execution_surface, device_id, endpoint_url, command_hint, status, capabilities_json, policy_json, updated_at FROM dev_agent_runtime_registry WHERE runtime_key = ? LIMIT 1", [key]); return rows[0] || null; }
async function dedicatedTarget(pool, tenantId, type, id) {
  if (!id) return null;
  if (type === "local_device") { const [rows] = await pool.query("SELECT config_id AS target_id, tenant_id, user_id, device_id, IF(is_enabled=1,'active','disabled') AS status, IF(is_enabled=1,'valid','invalid') AS validation_status, last_health_at, updated_at FROM local_connector_user_configs WHERE tenant_id=? AND (device_id=? OR config_id=?) LIMIT 1", [tenantId, id, id]); return rows[0] ? { ...rows[0], target_kind: "local_device" } : null; }
  const [rows] = await pool.query("SELECT target_id, tenant_id, user_id, target_kind, provider_family, connector_family, host_label, root_path, status, validation_status, updated_at FROM remote_runtime_targets WHERE tenant_id=? AND target_id=? LIMIT 1", [tenantId, id]); return rows[0] || null;
}
export async function assessAgentSurfaceDeployment({ tenantId, deployment, pool = getPool() }) {
  if (!deployment || !Boolean(deployment.enabled)) return { ready: false, state: "disabled", blockers: ["surface_disabled"], runtime: null, target: null };
  const mode = normalizeAgentSurfaceMode(deployment.activation_mode);
  if (mode === "platform_managed") { const runtime = await platformRuntime(pool, deployment.platform_runtime_key); if (!runtime) return { ready: false, state: "runtime_missing", blockers: ["platform_runtime_missing"], mode, runtime: null, target: null }; const ready = ["active", "available"].includes(runtime.status); return { ready, state: runtime.status, blockers: ready ? [] : [runtime.status === "planned" ? "platform_runtime_not_deployed" : "platform_runtime_not_ready"], mode, runtime, target: null }; }
  const target = await dedicatedTarget(pool, tenantId, deployment.dedicated_target_type || "remote_runtime", deployment.dedicated_target_id); if (!target) return { ready: false, state: "target_missing", blockers: ["dedicated_target_missing"], mode, runtime: null, target: null };
  const ready = target.status === "active" && ["valid", "partial"].includes(String(target.validation_status || "").toLowerCase()); return { ready, state: ready ? "ready" : "blocked", blockers: ready ? [] : [target.status !== "active" ? "dedicated_target_not_active" : null, !["valid", "partial"].includes(String(target.validation_status || "").toLowerCase()) ? "dedicated_target_not_validated" : null].filter(Boolean), mode, runtime: null, target };
}
export async function assessTenantAgentSurfaceReadiness({ tenantId, userId, pool = getPool() }) {
  const [deployments] = await pool.query("SELECT deployment_id, tenant_id, surface_key, activation_mode, enabled, platform_runtime_key, dedicated_target_type, dedicated_target_id, status, source, activated_at, updated_at FROM tenant_agent_surface_deployments WHERE tenant_id=? ORDER BY surface_key", [tenantId]);
  const [preferences] = userId ? await pool.query("SELECT preference_id, tenant_id, user_id, surface_key, preferences_json, status, updated_at FROM user_agent_surface_preferences WHERE tenant_id=? AND user_id=? AND status='active' ORDER BY surface_key", [tenantId, userId]) : [[]];
  const deploymentMap = new Map(deployments.map((row) => [row.surface_key, row])); const preferenceMap = new Map(preferences.map((row) => [row.surface_key, row])); const items = [];
  for (const definition of agentSurfaceCatalog().surfaces) { const deployment = deploymentMap.get(definition.surface_key) || null; const preference = preferenceMap.get(definition.surface_key) || null; items.push({ surface_key: definition.surface_key, display_name: definition.display_name, role: definition.role, deployment: deployment ? { ...deployment, enabled: Boolean(deployment.enabled) } : null, preferences: preference ? { ...definition.defaults, ...json(preference.preferences_json) } : definition.defaults, preference_updated_at: preference?.updated_at || null, readiness: deployment ? await assessAgentSurfaceDeployment({ tenantId, deployment, pool }) : { ready: false, state: "not_configured", blockers: ["tenant_deployment_missing"], runtime: null, target: null }, secrets_included: false }); }
  return { tenant_id: tenantId, user_id: userId || null, ready_count: items.filter((item) => item.readiness.ready).length, configured_count: items.filter((item) => item.deployment).length, items, secrets_included: false };
}
export async function upsertUserAgentSurfacePreferences({ tenantId, userId, surfaceKey, preferences, pool = getPool() }) {
  const surface = normalizeAgentSurfaceKey(surfaceKey);
  const normalized = normalizeAgentSurfacePreferences(surface, preferences || {});
  const id = randomUUID();
  return withTransaction(pool, "tenant_agent_surface_preferences_update", async (connection) => { // MUTATION_TRANSACTION: tenant_agent_surface_preferences_update
    await connection.query("INSERT INTO user_agent_surface_preferences (preference_id,tenant_id,user_id,surface_key,preferences_json,status) VALUES (?,?,?,?,?,'active') ON DUPLICATE KEY UPDATE preferences_json=VALUES(preferences_json),status='active',updated_at=CURRENT_TIMESTAMP", [id, tenantId, userId, surface, JSON.stringify(normalized)]);
    const [rows] = await connection.query("SELECT preference_id,tenant_id,user_id,surface_key,preferences_json,status,updated_at FROM user_agent_surface_preferences WHERE tenant_id=? AND user_id=? AND surface_key=? LIMIT 2", [tenantId, userId, surface]);
    if (!Array.isArray(rows) || rows.length !== 1) throw error(409, "tenant_agent_surface_preferences_readback_invalid", "Agent surface preference readback must resolve exactly one row."); // MUTATION_READBACK: tenant_agent_surface_preferences_update
    const row = rows[0];
    if (row.status !== "active" || row.tenant_id !== tenantId || row.user_id !== userId || row.surface_key !== surface) throw error(409, "tenant_agent_surface_preferences_readback_mismatch", "Agent surface preference readback did not match the requested scope.");
    return { ...row, preferences: json(row.preferences_json, normalized), secrets_included: false };
  });
}
export async function upsertTenantAgentSurfaceDeployment({ tenantId, actorUserId, surfaceKey, activationMode, enabled = true, dedicatedTargetType = null, dedicatedTargetId = null, source = "tenant_agent_surface_api", pool = getPool() }) {
  const surface = normalizeAgentSurfaceKey(surfaceKey);
  const definition = getAgentSurfaceDefinition(surface);
  const mode = normalizeAgentSurfaceMode(activationMode);
  const type = mode === "dedicated_managed" ? String(dedicatedTargetType || "remote_runtime").trim() : null;
  const targetId = mode === "dedicated_managed" ? String(dedicatedTargetId || "").trim() : null;
  if (type && !["local_device", "remote_runtime"].includes(type)) throw error(400, "agent_surface_dedicated_target_type_invalid", "dedicated_target_type must be local_device or remote_runtime.");
  if (mode === "dedicated_managed" && !targetId) throw error(400, "agent_surface_dedicated_target_required", "dedicated_target_id is required for dedicated_managed mode.");
  const candidate = { enabled: enabled ? 1 : 0, activation_mode: mode, platform_runtime_key: mode === "platform_managed" ? definition.platform_runtime_key : null, dedicated_target_type: type, dedicated_target_id: targetId };
  const readiness = enabled ? await assessAgentSurfaceDeployment({ tenantId, deployment: candidate, pool }) : { ready: false, state: "disabled", blockers: ["surface_disabled"] };
  const status = !enabled ? "disabled" : readiness.ready ? (readiness.state === "active" ? "active" : "ready") : readiness.state === "planned" ? "planned" : "blocked";
  const id = randomUUID();
  const policy = { full_capability_catalog_visible: true, preferences_owned_by_authenticated_user: true, high_risk_execution_requires_approval: true, automatic_cross_mode_fallback: false, last_readiness: { ready: readiness.ready, state: readiness.state, blockers: readiness.blockers }, secrets_included: false };
  return withTransaction(pool, "tenant_agent_surface_deployment_upsert", async (connection) => { // MUTATION_TRANSACTION: tenant_agent_surface_deployment_upsert
    await connection.query("INSERT INTO tenant_agent_surface_deployments (deployment_id,tenant_id,surface_key,activation_mode,enabled,platform_runtime_key,dedicated_target_type,dedicated_target_id,status,policy_json,source,activated_by,activated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,IF(?=1,CURRENT_TIMESTAMP,NULL)) ON DUPLICATE KEY UPDATE activation_mode=VALUES(activation_mode),enabled=VALUES(enabled),platform_runtime_key=VALUES(platform_runtime_key),dedicated_target_type=VALUES(dedicated_target_type),dedicated_target_id=VALUES(dedicated_target_id),status=VALUES(status),policy_json=VALUES(policy_json),source=VALUES(source),activated_by=VALUES(activated_by),activated_at=IF(VALUES(enabled)=1,COALESCE(activated_at,CURRENT_TIMESTAMP),NULL),updated_at=CURRENT_TIMESTAMP", [id, tenantId, surface, mode, enabled ? 1 : 0, candidate.platform_runtime_key, type, targetId, status, JSON.stringify(policy), source, actorUserId, enabled ? 1 : 0]);
    const [rows] = await connection.query("SELECT deployment_id,tenant_id,surface_key,activation_mode,enabled,platform_runtime_key,dedicated_target_type,dedicated_target_id,status,policy_json,source,activated_by,activated_at,updated_at FROM tenant_agent_surface_deployments WHERE tenant_id=? AND surface_key=? LIMIT 2", [tenantId, surface]);
    if (!Array.isArray(rows) || rows.length !== 1) throw error(409, "tenant_agent_surface_deployment_readback_invalid", "Agent surface deployment readback must resolve exactly one row."); // MUTATION_READBACK: tenant_agent_surface_deployment_upsert
    const row = rows[0];
    if (row.tenant_id !== tenantId || row.surface_key !== surface || row.activation_mode !== mode || Boolean(row.enabled) !== Boolean(enabled)) throw error(409, "tenant_agent_surface_deployment_readback_mismatch", "Agent surface deployment readback did not match the requested state.");
    return { ...row, enabled: Boolean(row.enabled), policy: json(row.policy_json), readiness: await assessAgentSurfaceDeployment({ tenantId, deployment: row, pool: connection }), secrets_included: false };
  });
}
export async function upsertAgentSurfaceDeploymentsFromActivation({ tenantId, userId, modes = {}, source = "connect_activate", pool = getPool() }) { if (!modes || typeof modes !== "object" || Array.isArray(modes)) throw error(400, "agent_surface_modes_invalid", "agent_surface_modes must be an object."); const results = []; for (const [surfaceKey, raw] of Object.entries(modes)) { const config = typeof raw === "string" ? { activation_mode: raw } : raw; if (!config || typeof config !== "object" || Array.isArray(config)) throw error(400, "agent_surface_mode_config_invalid", `Invalid config for ${surfaceKey}.`); results.push(await upsertTenantAgentSurfaceDeployment({ tenantId, actorUserId: userId, surfaceKey, activationMode: config.activation_mode || config.mode || "platform_managed", enabled: config.enabled !== false, dedicatedTargetType: config.dedicated_target_type, dedicatedTargetId: config.dedicated_target_id, source, pool })); } return results; }
