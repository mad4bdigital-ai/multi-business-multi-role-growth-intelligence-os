// appConnectionResolver.js — workspace app context loader for agents.
// Resolves which app connections are available for a given workspace + agent,
// and which actions are allowed. Does NOT decrypt or expose tokens.

import { getPool } from "./db.js";

function parseJsonArray(value, fallback = []) {
  if (!value) return fallback;
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function isTruthyGrantMode(mode = "") {
  return ["default_permissive", "auto_approved"].includes(String(mode || "").trim());
}

/**
 * Returns an array of safe app-connection descriptors for a workspace.
 * Each descriptor lists the app_key, connection metadata, and allowed actions.
 * Tokens are never included — they are only decrypted at executeAppAction() time.
 *
 * @param {string} workspace_key
 * @param {string} tenant_id
 * @param {string|null} agent_id  — when provided, filters to explicitly granted actions first
 * @returns {Promise<{ connected_apps: AppContextEntry[], workspace_key: string }>}
 */
export async function loadWorkspaceAppContext(workspace_key, tenant_id, agent_id = null) {
  if (!workspace_key || !tenant_id) return { connected_apps: [], workspace_key };

  // 1. Resolve workspace_id from key
  const [wsRows] = await getPool().query(
    "SELECT workspace_id FROM `workspace_registry` WHERE workspace_key = ? AND tenant_id = ? LIMIT 1",
    [workspace_key, tenant_id]
  ).catch(() => [[]]);

  const workspace_id = wsRows[0]?.workspace_id;
  if (!workspace_id) return { connected_apps: [], workspace_key };

  // 2. Load all active workspace→connection links. Keep this query aligned with
  // Sprint 25 table schema: app_integrations has `category`, while permission
  // mode lives on workspace_app_links only after Sprint 53 migration.
  const [linkRows] = await getPool().query(
    `SELECT wal.link_id,
            wal.connection_id,
            COALESCE(wal.permission_mode, 'strict') AS permission_mode,
            uac.app_key,
            uac.account_label,
            uac.account_metadata,
            uac.is_primary,
            uac.status AS conn_status,
            ai.display_name AS app_name,
            ai.auth_type,
            ai.category AS app_category,
            ai.default_action_grants
     FROM \`workspace_app_links\` wal
     JOIN \`user_app_connections\` uac
       ON uac.connection_id COLLATE utf8mb4_unicode_ci = wal.connection_id COLLATE utf8mb4_unicode_ci
     JOIN \`app_integrations\` ai
       ON ai.app_key COLLATE utf8mb4_unicode_ci = uac.app_key COLLATE utf8mb4_unicode_ci
     WHERE wal.workspace_id = ? AND wal.status = 'active' AND uac.status = 'active'
     ORDER BY uac.app_key ASC, uac.is_primary DESC`,
    [workspace_id]
  ).catch(() => [[]]);

  if (!linkRows.length) return { connected_apps: [], workspace_key };

  const connectionIds = linkRows.map(r => r.connection_id);

  // 3. Load explicit/default grants for these connections. The live
  // app_action_grants schema has `grant_mode`, not `auto_approve`.
  const [grantRows] = await getPool().query(
    `SELECT connection_id, action_key, grant_mode
     FROM \`app_action_grants\`
     WHERE connection_id IN (${connectionIds.map(() => "?").join(",")})
       AND status = 'active'
       AND (expires_at IS NULL OR expires_at > NOW())`,
    connectionIds
  ).catch(() => [[]]);

  // Build lookup maps.
  const grantMap = {};
  for (const g of grantRows) {
    if (!grantMap[g.connection_id]) grantMap[g.connection_id] = [];
    grantMap[g.connection_id].push({
      action_key: g.action_key,
      auto_approve: isTruthyGrantMode(g.grant_mode),
      source: g.grant_mode || "grant"
    });
  }

  const defaultGrantMap = {};
  for (const row of linkRows) {
    defaultGrantMap[row.connection_id] = parseJsonArray(row.default_action_grants);
  }

  // 4. Build safe context entries (no tokens).
  const connected_apps = linkRows.map(row => {
    let meta = {};
    try { meta = JSON.parse(row.account_metadata || "{}"); } catch { meta = {}; }

    const explicitGrants  = grantMap[row.connection_id]        || [];
    const defaultGrants   = defaultGrantMap[row.connection_id] || [];
    const permissionMode  = row.permission_mode || "strict";

    // Merge: explicit grants take precedence; permissive mode also includes defaults.
    const allAllowed = new Map();
    if (permissionMode === "permissive") {
      for (const dg of defaultGrants) {
        if (!dg?.action_key) continue;
        allAllowed.set(dg.action_key, {
          action_key: dg.action_key,
          source: "default",
          auto_approve: Boolean(dg.auto_approve)
        });
      }
    }
    for (const eg of explicitGrants) {
      if (!eg?.action_key) continue;
      allAllowed.set(eg.action_key, {
        action_key: eg.action_key,
        source: eg.source || "grant",
        auto_approve: Boolean(eg.auto_approve)
      });
    }

    return {
      connection_id:   row.connection_id,
      app_key:         row.app_key,
      app_name:        row.app_name,
      app_category:    row.app_category,
      auth_type:       row.auth_type,
      account_label:   row.account_label,
      account_summary: meta,
      is_primary:      Boolean(row.is_primary),
      permission_mode: permissionMode,
      allowed_actions: [...allAllowed.values()],
    };
  });

  return { connected_apps, workspace_key };
}

/**
 * Quick check: does a specific agent have permission to call action_key on connection_id?
 * Returns { allowed: boolean, mode: "grant"|"default"|"denied", auto_approve: boolean }
 */
export async function checkActionPermission(connection_id, action_key) {
  if (!connection_id || !action_key) return { allowed: false, mode: "denied", auto_approve: false };

  // Check explicit/default grant first.
  const [grantRows] = await getPool().query(
    `SELECT grant_mode FROM \`app_action_grants\`
     WHERE connection_id = ? AND action_key = ? AND status = 'active'
       AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1`,
    [connection_id, action_key]
  ).catch(() => [[]]);

  if (grantRows[0]) {
    const grantMode = grantRows[0].grant_mode || "grant";
    return {
      allowed: true,
      mode: grantMode,
      auto_approve: isTruthyGrantMode(grantMode)
    };
  }

  // Check permissive defaults through the linked workspace + app catalog.
  const [linkRows] = await getPool().query(
    `SELECT COALESCE(wal.permission_mode, 'strict') AS permission_mode,
            ai.default_action_grants
     FROM \`workspace_app_links\` wal
     JOIN \`user_app_connections\` uac
       ON uac.connection_id COLLATE utf8mb4_unicode_ci = wal.connection_id COLLATE utf8mb4_unicode_ci
     JOIN \`app_integrations\` ai
       ON ai.app_key COLLATE utf8mb4_unicode_ci = uac.app_key COLLATE utf8mb4_unicode_ci
     WHERE wal.connection_id = ? AND wal.status = 'active' AND uac.status = 'active'
     LIMIT 1`,
    [connection_id]
  ).catch(() => [[]]);

  if (linkRows[0]?.permission_mode === "permissive") {
    const defaults = parseJsonArray(linkRows[0].default_action_grants);
    const match = defaults.find(d => d.action_key === action_key);
    if (match) return { allowed: true, mode: "default", auto_approve: Boolean(match.auto_approve) };
  }

  return { allowed: false, mode: "denied", auto_approve: false };
}
