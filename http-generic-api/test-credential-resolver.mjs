import assert from "node:assert/strict";
import { resolveCredentialReference, resolveEffectiveCredential, getEffectiveCredentialStatus, __test__ } from "./credentialResolver.js";

function makePool({ bindings = [], connections = [], actions = [], secretReferences = [], tenantSecrets = [], platformSecrets = [] } = {}) {
  return {
    async query(sql, params = []) {
      const compact = String(sql).replace(/\s+/g, " ");

      if (compact.includes("FROM `credential_bindings`")) {
        const [tenantId, role] = params;
        return [bindings.filter(row => row.tenant_id === tenantId && row.credential_role === role && row.status === "active")];
      }

      if (compact.includes("FROM `user_app_connections`")) {
        const [connectionId, tenantId, userId] = params;
        return [connections.filter(row =>
          row.connection_id === connectionId
          && (!compact.includes("tenant_id = ?") || row.tenant_id === tenantId)
          && (!compact.includes("user_id = ?") || row.user_id === userId)
        ).slice(0, 2)];
      }

      if (compact.includes("FROM `actions`")) {
        const [actionKey] = params;
        return [actions.filter(row => row.action_key === actionKey).slice(0, 1)];
      }

      if (compact.includes("FROM `secret_references`")) {
        if (compact.includes("owner_type = 'platform'")) {
          const [secretKey] = params;
          return [secretReferences.filter(row =>
            row.owner_type === "platform"
            && row.secret_key === secretKey
            && row.status === "active"
          ).slice(0, 2)];
        }
        const [tenantId, secretKey] = params;
        return [secretReferences.filter(row =>
          row.tenant_id === tenantId
          && row.secret_key === secretKey
          && row.status === "active"
        ).slice(0, 2)];
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
    connections: [
      {
        connection_id: "conn-wp",
        user_id: "user-1",
        tenant_id: "tenant-1",
        app_key: "wordpress_rest",
        auth_type: "basic_auth",
        encrypted_credentials: JSON.stringify({ username: "wp-author", application_password: "wp-app-password" }),
        account_label: "WordPress Author",
        status: "active"
      }
    ]
  });

  const safe = await getEffectiveCredentialStatus(
    {
      tenantId: "tenant-1",
      userId: "user-1",
      connectionId: "conn-wp",
      actionKey: "wordpress_create_post",
      targetKey: "almallah_wp",
      credentialRole: "wordpress_rest"
    },
    { pool, decryptCredentials, env: {} }
  );

  assert.equal(safe.status, "resolved");
  assert.equal(Object.prototype.hasOwnProperty.call(safe, "secret"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(safe, "username"), false);

  const resolved = await resolveEffectiveCredential(
    {
      tenantId: "tenant-1",
      userId: "user-1",
      connectionId: "conn-wp",
      actionKey: "wordpress_create_post",
      targetKey: "almallah_wp",
      credentialRole: "wordpress_rest",
      includeSecret: true
    },
    { pool, decryptCredentials, env: {} }
  );

  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.secret, "wp-app-password");
  assert.equal(resolved.username, "wp-author");
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
  const pool = makePool({
    bindings: [
      {
        binding_id: "tenant-sql-secret-binding",
        tenant_id: "tenant-1",
        owner_type: "tenant",
        owner_id: "tenant-1",
        target_key: "allroyalegypt_wp",
        credential_role: "wordpress_app_password",
        credential_ref: "tenant_secret:tenant-1:ALLROYALEGYPT_WP_APP_PASSWORD",
        resolution_priority: 50,
        status: "active"
      }
    ],
    tenantSecrets: [
      {
        tenant_id: "tenant-1",
        secret_key: "ALLROYALEGYPT_WP_APP_PASSWORD",
        secret_type: "basic_auth_app_password",
        storage_backend: "db_encrypted",
        value_sha256: "hash-present",
        value_ciphertext: "ciphertext-placeholder",
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
    { pool, decryptCredentials, decryptToken: () => "wp-app-password", env: {} }
  );

  assert.equal(status.status, "resolved");
  assert.equal(status.source, "credential_bindings");
  assert.equal(status.storage_backend, "db_encrypted");
  assert.equal(status.secret_present, true);
  assert.equal(Object.prototype.hasOwnProperty.call(status, "secret"), false);

  const resolved = await resolveEffectiveCredential(
    {
      tenantId: "tenant-1",
      targetKey: "allroyalegypt_wp",
      credentialRole: "wordpress_app_password",
      includeSecret: true
    },
    { pool, decryptCredentials, decryptToken: () => "wp-app-password", env: {} }
  );

  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.secret, "wp-app-password");
}

{
  const pool = makePool({
    bindings: [{
      binding_id: "tenant-2-shared-ref",
      tenant_id: "tenant-2",
      owner_type: "tenant",
      owner_id: "tenant-2",
      action_key: "shared_ref_action",
      credential_role: "api_key",
      credential_ref: "ref:secret:SHARED_KEY",
      resolution_priority: 10,
      status: "active"
    }],
    secretReferences: [
      { tenant_id: "tenant-1", owner_type: "tenant", owner_id: "tenant-1", secret_key: "SHARED_KEY", store_type: "db_encrypted", status: "active" },
      { tenant_id: "tenant-2", owner_type: "tenant", owner_id: "tenant-2", secret_key: "SHARED_KEY", store_type: "db_encrypted", status: "active" }
    ],
    tenantSecrets: [
      { tenant_id: "tenant-1", secret_key: "SHARED_KEY", storage_backend: "db_encrypted", value_ciphertext: "cipher-1", status: "active" },
      { tenant_id: "tenant-2", secret_key: "SHARED_KEY", storage_backend: "db_encrypted", value_ciphertext: "cipher-2", status: "active" }
    ]
  });
  const resolved = await resolveEffectiveCredential(
    { tenantId: "tenant-2", actionKey: "shared_ref_action", credentialRole: "api_key", includeSecret: true },
    { pool, decryptToken: (ciphertext) => ciphertext === "cipher-2" ? "tenant-2-secret" : "wrong-tenant-secret", env: {} }
  );
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.secret, "tenant-2-secret");
  assert.equal(resolved.resolved_source, "tenant_secrets");
}

{
  const pool = makePool({
    bindings: [{
      binding_id: "foreign-tenant-secret",
      tenant_id: "tenant-1",
      owner_type: "tenant",
      owner_id: "tenant-1",
      credential_role: "api_key",
      credential_ref: "tenant_secret:tenant-2:FOREIGN_KEY",
      resolution_priority: 1,
      status: "active"
    }]
  });
  const result = await resolveEffectiveCredential(
    { tenantId: "tenant-1", credentialRole: "api_key", includeSecret: true },
    { pool, env: {} }
  );
  assert.equal(result.status, "blocked_scope_mismatch");
  assert.equal(result.error_code, "credential_reference_scope_mismatch");
}

{
  const pool = makePool({
    bindings: [{
      binding_id: "foreign-connection",
      tenant_id: "tenant-1",
      owner_type: "tenant",
      owner_id: "tenant-1",
      connection_id: "conn-foreign",
      credential_role: "api_key",
      credential_ref: "user_app_connection:conn-foreign:encrypted_credentials.api_key",
      resolution_priority: 1,
      status: "active"
    }],
    connections: [{
      connection_id: "conn-foreign",
      tenant_id: "tenant-2",
      user_id: "user-2",
      auth_type: "api_key",
      encrypted_credentials: JSON.stringify({ api_key: "foreign-secret" }),
      status: "active"
    }]
  });
  const result = await resolveEffectiveCredential(
    { tenantId: "tenant-1", connectionId: "conn-foreign", credentialRole: "api_key", includeSecret: true },
    { pool, decryptCredentials, env: {} }
  );
  assert.equal(result.status, "blocked_missing_connection");
  assert.equal(Object.prototype.hasOwnProperty.call(result, "secret"), false);
}

{
  const pool = makePool({
    bindings: [{
      binding_id: "tenant-to-platform-mismatch",
      tenant_id: "tenant-1",
      owner_type: "tenant",
      owner_id: "tenant-1",
      credential_role: "api_key",
      credential_ref: "platform_secret:PLATFORM_ONLY_KEY",
      resolution_priority: 1,
      status: "active"
    }]
  });
  const result = await resolveEffectiveCredential(
    { tenantId: "tenant-1", credentialRole: "api_key" },
    { pool, env: {} }
  );
  assert.equal(result.status, "blocked_scope_mismatch");
}

{
  const pool = makePool({
    secretReferences: [{
      tenant_id: "f2795a7f-8d06-4053-8bee-35ca9af8b460",
      owner_type: "platform",
      owner_id: "platform",
      secret_key: "LEGACY_PLATFORM_KEY",
      store_type: "db_encrypted",
      status: "active"
    }],
    platformSecrets: [{
      secret_key: "LEGACY_PLATFORM_KEY",
      storage_backend: "db_encrypted",
      value_ciphertext: "legacy-platform-cipher",
      status: "active"
    }]
  });
  const resolved = await resolveCredentialReference(
    "ref:secret:LEGACY_PLATFORM_KEY",
    { includeSecret: true, expectedOwnerType: "platform", environmentKey: "staging" },
    { pool, decryptToken: () => "legacy-platform-secret", env: {} }
  );
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.secret, "legacy-platform-secret");
}

{
  const pool = makePool({
    secretReferences: [
      { tenant_id: "00000000-0000-0000-0000-000000000000", owner_type: "platform", secret_key: "AMBIGUOUS_PLATFORM_KEY", store_type: "db_encrypted", status: "active" },
      { tenant_id: "f2795a7f-8d06-4053-8bee-35ca9af8b460", owner_type: "platform", secret_key: "AMBIGUOUS_PLATFORM_KEY", store_type: "db_encrypted", status: "active" }
    ]
  });
  const result = await resolveCredentialReference(
    "ref:secret:AMBIGUOUS_PLATFORM_KEY",
    { expectedOwnerType: "platform" },
    { pool, env: {} }
  );
  assert.equal(result.status, "blocked_ambiguous_reference");
  assert.equal(result.error_code, "credential_reference_ambiguous");
}

{
  const pool = makePool({
    platformSecrets: [{
      secret_key: "STAGING_ONLY_KEY",
      storage_backend: "db_encrypted",
      value_ciphertext: "cipher",
      metadata_json: JSON.stringify({ environment: "staging" }),
      status: "active"
    }]
  });
  const result = await resolveCredentialReference(
    "platform_secret:STAGING_ONLY_KEY",
    { expectedOwnerType: "platform", environmentKey: "production" },
    { pool, decryptToken: () => "secret", env: {} }
  );
  assert.equal(result.status, "blocked_environment_mismatch");
  assert.equal(result.error_code, "credential_environment_mismatch");
}

{
  const pool = makePool({
    bindings: [{
      binding_id: "explicit-platform-binding",
      tenant_id: "tenant-1",
      owner_type: "platform",
      owner_id: "platform",
      credential_role: "api_key",
      credential_ref: "platform_secret:PLATFORM_KEY",
      resolution_priority: 1,
      status: "active"
    }],
    platformSecrets: [{
      secret_key: "PLATFORM_KEY",
      storage_backend: "db_encrypted",
      value_ciphertext: "cipher",
      status: "active"
    }]
  });
  const blocked = await resolveEffectiveCredential(
    { tenantId: "tenant-1", credentialRole: "api_key", allowPlatformBinding: false, includeSecret: true },
    { pool, decryptToken: () => "platform-secret", env: {} }
  );
  assert.equal(blocked.status, "blocked_missing_secret");

  const allowed = await resolveEffectiveCredential(
    { tenantId: "tenant-1", credentialRole: "api_key", allowPlatformBinding: true, allowPlatformFallback: false, includeSecret: true },
    { pool, decryptToken: () => "platform-secret", env: {} }
  );
  assert.equal(allowed.status, "resolved");
  assert.equal(allowed.secret, "platform-secret");
}

{
  assert.equal(__test__.upperEnvKey("allroyalegypt_wp"), "ALLROYALEGYPT_WP");
  assert.deepEqual(__test__.roleCandidateFields("mcp_bearer_token", "mcp").slice(0, 2), ["mcp_token", "mcp_bearer"]);
}

{
  const deniedPool = {
    async query(sql) {
      const error = new Error(`SELECT command denied for ${String(sql).match(/FROM \`([^\`]+)\`/)?.[1] || "credential_store"}`);
      error.code = "ER_TABLEACCESS_DENIED_ERROR";
      throw error;
    }
  };

  await assert.rejects(
    () => resolveEffectiveCredential(
      {
        tenantId: "00000000-0000-0000-0000-000000000000",
        actionKey: "activation_gateway_dark_deploy",
        targetKey: "staging_activation_gateway_cloudflare",
        credentialRole: "cloudflare_api_token",
        includeSecret: true
      },
      { pool: deniedPool, env: {} }
    ),
    (error) => error?.code === "ER_TABLEACCESS_DENIED_ERROR",
  );

  const directCases = [
    ["platform_secret:staging_cloudflare_activation_gateway_api_token", { includeSecret: true, expectedOwnerType: "platform" }],
    ["tenant_secret:tenant-1:TENANT_KEY", { includeSecret: true, tenantId: "tenant-1", expectedOwnerType: "tenant" }],
    ["user_app_connection:conn-1:encrypted_credentials.api_key", { includeSecret: true, tenantId: "tenant-1", userId: "user-1", expectedOwnerType: "connection" }],
    ["ref:secret:TENANT_KEY", { includeSecret: true, tenantId: "tenant-1", expectedOwnerType: "tenant" }],
  ];
  for (const [reference, options] of directCases) {
    await assert.rejects(
      () => resolveCredentialReference(reference, options, { pool: deniedPool, env: {} }),
      (error) => error?.code === "ER_TABLEACCESS_DENIED_ERROR",
    );
  }

  const actionDeniedPool = {
    async query(sql) {
      if (String(sql).includes("credential_bindings")) return [[]];
      if (String(sql).includes("actions")) {
        const error = new Error("SELECT command denied for actions");
        error.code = "ER_TABLEACCESS_DENIED_ERROR";
        throw error;
      }
      return [[]];
    }
  };
  await assert.rejects(
    () => resolveEffectiveCredential(
      { tenantId: "tenant-1", actionKey: "action-with-secret", credentialRole: "api_key", includeSecret: true },
      { pool: actionDeniedPool, env: {} }
    ),
    (error) => error?.code === "ER_TABLEACCESS_DENIED_ERROR",
  );
}

console.log("credential resolver tests passed");
