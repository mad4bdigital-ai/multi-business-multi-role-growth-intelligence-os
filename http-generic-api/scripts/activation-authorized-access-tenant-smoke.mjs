#!/usr/bin/env node
import { getPool } from "../db.js";
import { buildActivationAuthorizedAccess } from "../routes/activationRoutes.js";

function parseArgs(argv = process.argv.slice(2)) {
  const args = { tenant_id: null, user_id: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || "");
    if (arg === "--tenant-id") args.tenant_id = String(argv[++i] || "");
    else if (arg.startsWith("--tenant-id=")) args.tenant_id = arg.slice("--tenant-id=".length);
    else if (arg === "--user-id") args.user_id = String(argv[++i] || "");
    else if (arg.startsWith("--user-id=")) args.user_id = arg.slice("--user-id=".length);
    else throw new Error(`Unsupported argument: ${arg}`);
  }
  return args;
}

async function findTenantCandidate(args) {
  if (args.tenant_id && args.user_id) return { tenant_id: args.tenant_id, user_id: args.user_id, source: "provided_args" };
  const [rows] = await getPool().query(
    `SELECT m.tenant_id, m.user_id,
            COUNT(DISTINCT wr.workspace_id) AS workspaces,
            COUNT(DISTINCT cs.system_id) AS connected_systems,
            COUNT(DISTINCT i.installation_id) AS active_installations,
            COUNT(DISTINCT pg.permission_key) AS permission_grants
       FROM memberships m
       LEFT JOIN workspace_registry wr
              ON wr.tenant_id = m.tenant_id
             AND wr.bootstrap_status IN ('ready','in_progress','degraded')
       LEFT JOIN connected_systems cs
              ON cs.tenant_id = m.tenant_id
             AND cs.status <> 'archived'
       LEFT JOIN installations i
              ON i.tenant_id = m.tenant_id
             AND i.status = 'active'
             AND (i.expires_at IS NULL OR i.expires_at > UTC_TIMESTAMP())
       LEFT JOIN permission_grants pg
              ON pg.tenant_id = m.tenant_id
             AND pg.granted = 1
      WHERE m.status = 'active'
        AND m.tenant_id IS NOT NULL
        AND m.user_id IS NOT NULL
      GROUP BY m.tenant_id, m.user_id
      ORDER BY permission_grants DESC, connected_systems DESC, workspaces DESC
      LIMIT 1`
  );
  const row = rows?.[0];
  if (!row) throw new Error("No active tenant membership candidate found for activation smoke.");
  return { ...row, source: "auto_selected_active_membership" };
}

function collectTenantValues(surfaceRows = [], field) {
  return [...new Set(surfaceRows.map((row) => row?.[field]).filter(Boolean))].sort();
}

function summarizeRegisteredSurfaces(access, expectedTenantId) {
  return (access.authorized?.registered_surfaces || []).map((surface) => {
    const rows = surface.rows || [];
    const tenantValues = collectTenantValues(rows, "tenant_id");
    return {
      surface_key: surface.surface_key,
      row_count: rows.length,
      tenant_values: tenantValues,
      cross_tenant_row_count: tenantValues.filter((tenantId) => tenantId !== expectedTenantId).length,
      secrets_included: surface.secrets_included === true,
    };
  });
}

async function closePoolQuietly() {
  try {
    await getPool().end();
  } catch {
    // best effort only
  }
}

async function main() {
  const args = parseArgs();
  const candidate = await findTenantCandidate(args);
  const access = await buildActivationAuthorizedAccess({
    auth: {
      mode: "tenant_smoke_user_jwt_simulation",
      is_admin: false,
      tenant_id: candidate.tenant_id,
      user_id: candidate.user_id,
    },
    query: { authorized_access_limit: "10", authorized_surface_limit: "10" },
  }, {
    is_admin: false,
    tenant_id: candidate.tenant_id,
    user_id: candidate.user_id,
  });

  const registeredSurfaces = summarizeRegisteredSurfaces(access, candidate.tenant_id);
  const text = JSON.stringify(access);
  const blockedFieldLeakDetected = /\"(credential_ref|value_ciphertext|secret_value|token_value|password|private_key|config_json)\"\s*:/i.test(text);
  const crossTenantSurfaceLeaks = registeredSurfaces.filter((surface) => surface.cross_tenant_row_count > 0);
  const positiveRequiredSurfaceKeys = [
    "workspace_registry",
    "connected_systems",
    "installations",
    "permission_grants",
    "agent_skill_grants",
    "connected_app_connections",
    "workflow_runtime_bindings",
    "plugin_contributions",
    "pending_tasks",
    "tenant_tools",
    "app_action_grants",
    "tenant_integration_policies",
    "agent_catalog",
    "agent_skill_catalog",
    "agent_tool_catalog",
    "agent_bindings_catalog",
    "workflow_catalog",
    "task_route_catalog",
    "app_integration_catalog",
    "app_binding_catalog",
    "platform_plugin_catalog",
    "skill_manifest_catalog",
    "skill_package_catalog",
    "logic_pack_catalog",
    "local_gateway_tool_catalog",
  ];
  const surfaceByKey = new Map(registeredSurfaces.map((surface) => [surface.surface_key, surface]));
  const missingPositiveSurfaces = positiveRequiredSurfaceKeys.filter((key) => Number(surfaceByKey.get(key)?.row_count || 0) <= 0);
  const ok = access.readiness === "active"
    && access.scope_resolution === "tenant_user_authorized_only"
    && Number(access.counts?.admin_tools || 0) === 0
    && Number(access.counts?.permission_grants || 0) > 0
    && Number(access.counts?.runtime_actions || 0) > 0
    && (access.authorized?.admin_tools || []).length === 0
    && (access.authorized?.runtime_actions || []).some((action) => action.action_key === "wordpress_api")
    && registeredSurfaces.length > 0
    && missingPositiveSurfaces.length === 0
    && crossTenantSurfaceLeaks.length === 0
    && blockedFieldLeakDetected === false
    && access.secrets_included === false;

  console.log(JSON.stringify({
    ok,
    smoke: "activation_authorized_access_tenant_smoke",
    candidate,
    source: access.source,
    readiness: access.readiness,
    scope_resolution: access.scope_resolution,
    counts: access.counts,
    registered_surfaces: registeredSurfaces,
    auth_gaps: access.auth_gaps || [],
    degraded_surface_count: access.degraded_surfaces?.length || 0,
    admin_tools_visible: (access.authorized?.admin_tools || []).length,
    cross_tenant_surface_leaks: crossTenantSurfaceLeaks,
    blocked_field_leak_detected: blockedFieldLeakDetected,
    external_provider_called: false,
    session_opened: false,
    secrets_included: access.secrets_included === true,
  }, null, 2));
  await closePoolQuietly();
  process.exit(ok ? 0 : 2);
}

main().catch(async (error) => {
  await closePoolQuietly();
  console.error(JSON.stringify({ ok: false, error: { code: error.code || "activation_tenant_smoke_failed", message: error.message }, secrets_included: false }, null, 2));
  process.exit(1);
});
