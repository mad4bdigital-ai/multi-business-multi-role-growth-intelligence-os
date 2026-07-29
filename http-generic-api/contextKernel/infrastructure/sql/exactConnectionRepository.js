import {
  cleanOptional,
  cleanRequired,
  createSqlExecutor,
  freezeRecord,
  parseJsonValue,
  requireUniqueRow,
  toBoolean,
} from "./sqlRepositorySupport.js";

function connectionSql({ appKey, userRef }) {
  return `
    SELECT
      c.connection_id,
      c.user_id,
      c.tenant_id,
      c.app_key,
      c.display_label,
      c.auth_type,
      c.credential_ref,
      c.token_expires_at,
      c.scopes_granted,
      c.account_label,
      c.account_metadata,
      c.api_base_url,
      c.is_primary,
      c.status,
      c.validation_status,
      c.last_validated_at,
      c.connected_at,
      c.last_used_at,
      l.link_id,
      l.workspace_id,
      l.workspace_key,
      l.permission_mode,
      l.status AS link_status
    FROM user_app_connections c
    INNER JOIN workspace_app_links l
      ON l.connection_id = c.connection_id
      AND l.tenant_id = c.tenant_id
      AND l.app_key = c.app_key
    WHERE c.tenant_id = ?
      AND l.tenant_id = ?
      AND l.workspace_id = ?
      AND c.connection_id = ?
      AND c.status = 'active'
      AND l.status = 'active'
      ${appKey ? "AND c.app_key = ? AND l.app_key = ?" : ""}
      ${userRef ? "AND c.user_id = ?" : ""}
    ORDER BY c.connection_id ASC, l.link_id ASC
    LIMIT 2
  `;
}

const ACTION_GRANT_SQL = `
  SELECT
    g.grant_id,
    g.connection_id,
    g.workspace_id,
    g.agent_id,
    g.app_key,
    g.action_key,
    g.grant_mode,
    g.granted_by,
    g.expires_at,
    g.status,
    g.created_at
  FROM app_action_grants g
  INNER JOIN user_app_connections c
    ON c.connection_id = g.connection_id
    AND c.app_key = g.app_key
  INNER JOIN workspace_app_links l
    ON l.connection_id = g.connection_id
    AND l.workspace_id = g.workspace_id
    AND l.app_key = g.app_key
    AND l.tenant_id = c.tenant_id
  WHERE c.tenant_id = ?
    AND l.tenant_id = ?
    AND c.status = 'active'
    AND l.status = 'active'
    AND g.connection_id = ?
    AND g.workspace_id = ?
    AND g.app_key = ?
    AND g.action_key = ?
    AND g.status = 'active'
    AND (g.expires_at IS NULL OR g.expires_at > UTC_TIMESTAMP())
  ORDER BY g.created_at DESC, g.grant_id ASC
  LIMIT 2
`;

function mapGrant(row) {
  if (!row) return null;
  return freezeRecord({
    grantRef: row.grant_id,
    connectionRef: row.connection_id,
    workspaceRef: row.workspace_id,
    agentRef: row.agent_id || null,
    appKey: row.app_key,
    actionKey: row.action_key,
    grantMode: row.grant_mode,
    grantedBy: row.granted_by || null,
    expiresAt: row.expires_at,
    status: row.status,
    createdAt: row.created_at,
  });
}

function mapConnection(row, grant) {
  return freezeRecord({
    connectionRef: row.connection_id,
    userRef: row.user_id,
    tenantRef: row.tenant_id,
    workspaceRef: row.workspace_id,
    workspaceKey: row.workspace_key || null,
    linkRef: row.link_id,
    appKey: row.app_key,
    displayLabel: row.display_label || null,
    authType: row.auth_type,
    credentialRef: row.credential_ref || null,
    tokenExpiresAt: row.token_expires_at,
    scopesGranted: parseJsonValue(row.scopes_granted, []),
    accountLabel: row.account_label || null,
    accountMetadata: parseJsonValue(row.account_metadata, null),
    apiBaseUrl: row.api_base_url || null,
    primary: toBoolean(row.is_primary),
    status: row.status,
    validationStatus: row.validation_status || null,
    lastValidatedAt: row.last_validated_at,
    connectedAt: row.connected_at,
    lastUsedAt: row.last_used_at,
    permissionMode: row.permission_mode,
    linkStatus: row.link_status,
    actionGrant: grant,
  });
}

export function createExactConnectionRepository(options = {}) {
  const sql = createSqlExecutor({ ...options, adapterName: "Exact connection" });

  async function findExactConnection({
    tenantRef,
    workspaceRef,
    connectionRef,
    appKey = null,
    actionKey = null,
    userRef = null,
  }) {
    const tenant = cleanRequired(tenantRef, "tenantRef");
    const workspace = cleanRequired(workspaceRef, "workspaceRef");
    const connection = cleanRequired(connectionRef, "connectionRef");
    const app = cleanOptional(appKey);
    const action = cleanOptional(actionKey);
    const user = cleanOptional(userRef);
    const params = [tenant, tenant, workspace, connection];
    if (app) params.push(app, app);
    if (user) params.push(user);

    const connectionRows = await sql.execute(connectionSql({ appKey: app, userRef: user }), params);
    const row = requireUniqueRow(connectionRows, {
      code: "exact_connection_ambiguous",
      entityName: "Exact app connection",
      details: {
        tenant_ref: tenant,
        workspace_ref: workspace,
        connection_ref: connection,
      },
    });
    if (!row) return null;

    let grant = null;
    if (action) {
      const grantRows = await sql.execute(ACTION_GRANT_SQL, [
        tenant,
        tenant,
        connection,
        workspace,
        row.app_key,
        action,
      ]);
      grant = requireUniqueRow(grantRows, {
        code: "exact_connection_action_grant_ambiguous",
        entityName: "Exact connection action grant",
        details: {
          connection_ref: connection,
          workspace_ref: workspace,
          app_key: row.app_key,
          action_key: action,
        },
      });
    }

    return mapConnection(row, mapGrant(grant));
  }

  return Object.freeze({ findExactConnection });
}

export const _testingExactConnectionRepository = Object.freeze({
  ACTION_GRANT_SQL,
  connectionSql,
});
