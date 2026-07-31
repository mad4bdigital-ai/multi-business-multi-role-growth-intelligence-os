from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_between(text: str, start_marker: str, end_marker: str, replacement: str, label: str) -> str:
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f"{label}:start_marker_missing")
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit(f"{label}:end_marker_missing")
    return text[:start] + replacement.rstrip() + "\n" + text[end:]


route_path = ROOT / "routes" / "agentSurfaceRoutes.js"
route = route_path.read_text(encoding="utf-8")
old_pool = '  const pool = deps.pool || { query: (...args) => getPool().query(...args) };'
new_pool = '  const pool = deps.pool || getPool();'
if old_pool in route:
    route = route.replace(old_pool, new_pool, 1)
elif new_pool not in route:
    raise SystemExit("agent_surface_route_pool_marker_missing")
route_path.write_text(route, encoding="utf-8")

service_path = ROOT / "agentSurfaceRuntimeService.js"
service = service_path.read_text(encoding="utf-8")
helper_marker = 'function error(status, code, message) { const err = new Error(message); err.status = status; err.code = code; return err; }'
helper = '''function error(status, code, message) { const err = new Error(message); err.status = status; err.code = code; return err; }
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
}'''
if "async function withTransaction(" not in service:
    if helper_marker not in service:
        raise SystemExit("agent_surface_transaction_helper_marker_missing")
    service = service.replace(helper_marker, helper, 1)

preferences = '''export async function upsertUserAgentSurfacePreferences({ tenantId, userId, surfaceKey, preferences, pool = getPool() }) {
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
'''
service = replace_between(service, 'export async function upsertUserAgentSurfacePreferences(', 'export async function upsertTenantAgentSurfaceDeployment(', preferences, "agent_surface_preferences")

deployment = '''export async function upsertTenantAgentSurfaceDeployment({ tenantId, actorUserId, surfaceKey, activationMode, enabled = true, dedicatedTargetType = null, dedicatedTargetId = null, source = "tenant_agent_surface_api", pool = getPool() }) {
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
'''
service = replace_between(service, 'export async function upsertTenantAgentSurfaceDeployment(', 'export async function upsertAgentSurfaceDeploymentsFromActivation(', deployment, "agent_surface_deployment")
service_path.write_text(service, encoding="utf-8")
print("agent surface transaction and readback patches applied")
