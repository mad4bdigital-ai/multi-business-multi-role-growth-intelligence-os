import assert from "node:assert/strict";
import { resolveEffectiveCredential, getEffectiveCredentialStatus, __test__ } from "./credentialResolver.js";

function makePool({ bindings = [], connections = [], actions = [], tenantSecrets = [], platformSecrets = [] } = {}) {
  return {
    async query(sql, params = []) {
      const compact = String(sql).replace(/\s+/g, " ");

      if (compact.includes("FROM `credential_bindings`")) {
        const [tenantId, role] = params;
        return [bindings.filter(row => row.tenant_id === tenantId && row.credential_role === role && row.status === "active")];
      }

      if (compact.includes("FROM `user_app_connections`")) {
        const [connectionId] = params;
        return [connections.filter(row => row.connection_id === connectionId).slice(0, 1)];
      }

      if (compact.includes("FROM `actions`")) {
        const [actionKey] = params;
        return [actions.filter(row => row.action_key === actionKey).slice(0, 1)];
      }

      if (compact.includes("FROM `tenant_secrets`")) {
        const [tenantId, secretKey] = params;
        return [tenantSecrets.filter(row => row.tenant_id === tenantId && row.secret_key === secretKey && row.status === "active").slice(0, 1)];
      }

      if (compact.includes("FROM `platform_secrets`")) {
        const [secretKey] = params;
        return [platformSecrets.filter(row => row.secret_key === secretKey && row.status === "active").slice(0, 1)];
      }

      return [[]];
    }
  };
}

const decryptCredentials = (stored) => JSON.parse(stored);

{
  const pool = makePool({
    bindings: [
      {
        binding_id: "tenant-binding",
        tenant_id: "tenant-1",
        owner_type: "tenant",
        owner_id: "tenant-1",
        action_key: "makecom_mcp_client",
        credential_role: "mcp_bearer_token",
        credential_ref: "ref:secret:MAKE_MCP_TOKEN",
        resolution_priority: 80,
        status: "active"
      },
      {
        binding_id: "user-connection-binding",
        tenant_id: "tenant-1",
        owner_type: "connection",
        owner_id: "conn-1",
        user_id: "user-1",
        connection_id: "conn-1",
        action_key: "makecom_mcp_client",
        credential_role: "mcp_bearer_token",
        credential_ref: "user_app_connection:conn-1:encrypted_credentials.mcp_token",
        resolution_priority: 10,
        status: "active"
      }
    ],
    connections: [
      {
        connection_id: "conn-1",
        user_id: "user-1",
        tenant_id: "tenant-1",
        app_key: "mcp",
        auth_type: "mcp",
        encrypted_credentials: JSON.stringify({ mcp_token: "user-mcp-token" }),
        account_label: "User Make MCP",
        status: "active"
      }
    ]
  });

  const resolved = await resolveEffectiveCredential(
    {
      tenantId: "tenant-1",
      userId: "user-1",
      connectionId: "conn-1",
      actionKey: "makecom_mcp_client",
      credentialRole: "mcp_bearer_token",
      includeSecret: true
    },
    { pool, decryptCredentials, env: { MAKE_MCP_TOKEN: "tenant-token" } }
  );

  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.source, "credential_bindings");
  assert.equal(resolved.binding_id, "user-connection-binding");
  assert.equal(resolved.secret, "user-mcp-token");
}

{
  const pool = makePool({
    bindings: [
      {
        binding_id: "tenant-wp-binding",
        tenant_id: "tenant-1",
        owner_type: "tenant",
        owner_id: "tenant-1",
        target_key: "allroyalegypt_wp",
        credential_role: "wordpress_app_password",
        credential_ref: "ref:secret:ALLROYALEGYPT_WP_APP_PASSWORD",
        resolution_priority: 50,
        status: "active"
      }
    ]
  });

  const status = await getEffectiveCredentialStatus(
    {
      tenantId: "tenant-1",
      targetKey: "allroyalegypt_wp",
      credentialRole: "wordpress_app_password"
    },
    { pool, decryptCredentials, env: {} }
  );

  assert.equal(status.status, "blocked_missing_secret");
  assert.equal(status.missing_secret_key, "ALLROYALEGYPT_WP_APP_PASSWORD");
  assert.equal(status.binding_id, "tenant-wp-binding");
  assert.equal(Object.prototype.hasOwnProperty.call(status, "secret"), false);
}

{
  const pool = makePool({
    actions: [
      {
        action_key: "makecom_mcp_client",
        secret_store_ref: "ref:secret:MAKE_MCP_TOKEN",
        api_key_storage_mode: "secret_reference",
        api_key_mode: "bearer_token"
      }
    ]
  });

  const resolved = await resolveEffectiveCredential(
    {
      tenantId: "tenant-1",
      actionKey: "makecom_mcp_client",
      credentialRole: "mcp_bearer_token",
      includeSecret: true
    },
    { pool, decryptCredentials, env: { MAKE_MCP_TOKEN: "fallback-token" } }
  );

  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.source, "actions.secret_store_ref");
  assert.equal(resolved.secret, "fallback-token");
}

{
  assert.equal(__test__.upperEnvKey("allroyalegypt_wp"), "ALLROYALEGYPT_WP");
  assert.deepEqual(__test__.roleCandidateFields("mcp_bearer_token", "mcp").slice(0, 2), ["mcp_token", "mcp_bearer"]);
}

console.log("credential resolver tests passed");
